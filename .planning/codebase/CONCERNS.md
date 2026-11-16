# Concerns: technical debt, risks and stale items

Analysis date: 2026-11-16
Commit: b01e6a5

This document lists the known concerns of Adgecko 0.3.5.
Each item gives: what, evidence, impact, and a suggested action.
The items are sorted by impact. The highest impact is first.

All statements come from files that were read in this session.
No test was run. The extension was not loaded in a browser.
A statement about runtime behaviour that comes only from a comment or a document has the mark UNVERIFIED.

## 1. Summary

| ID | Concern | Impact |
|---|---|---|
| H1 | Storage quota headroom is small, and CI does not run the budget test | High |
| H2 | Package size is 2.2 % below the release gate cap | High |
| H3 | The vendored Twitch script has an archived upstream and an `eval` call | High |
| H4 | YouTube response patching depends on upstream shapes | High |
| H5 | No live site test for 0.3.5; unreleased changes sit on version 0.3.5 | High |
| M1 | Documents give numbers that disagree with the packed data | Medium |
| M2 | `TODO.md` disagrees with the git history | Medium |
| M3 | Six tests are always ignored; owner decisions are open | Medium |
| M4 | The stream-site host list exists in many files | Medium |
| M5 | Dead modules and unused data are in the package | Medium |
| M6 | Legacy storage mirrors and migrations stay in the code | Medium |
| M7 | Storage key strings are repeated in several files | Medium |
| M8 | Very large files and functions | Medium |
| M9 | Release gate: hard-coded values, checks that always pass, old comments | Medium |
| M10 | Hard-coded line numbers in documents | Medium |
| M11 | Page-world scripts: known limits | Medium |
| M12 | The signed feed is dormant, but its code and data ship | Medium |
| M13 | The public-suffix subset has no refresh schedule | Medium |
| L1 | A retired workflow stays in the repository | Low |
| L2 | Old documents and card folders use 33.7 MB | Low |
| L3 | References to a file that is not in the repository | Low |
| L4 | Damaged characters in comments | Low |
| L5 | Generated `src/rules/README.md` and `meta.json` hints are old | Low |
| L6 | Small duplicates: status text, version literal, comment about exit code | Low |

Section 5 lists items that were checked and are not a concern now.

## 2. High impact

### H1. Storage quota headroom is small, and CI does not run the budget test

**What.** The extension stores parsed lists in `chrome.storage.local`. The quota is 10,485,760 bytes. The manifest does not request `unlimitedStorage`.

**Evidence.**
- `CHANGELOG.md` (section 0.3.5, "Changed"): a fresh-install refresh has a peak of about 8.1 MB. UNVERIFIED in this session.
- `CHANGELOG.md` (same section): AdGuard Base hide rules needed 12.9 MB, thus they were removed.
- `src/general/update.js:85-90`: the comment tells that these rules needed about 5 MB and "can come back with an IndexedDB store". The refresh code for `cosmetic: "sites"` sources stays in the file.
- `test/final-storage-budget.test.js:21-22`: the quota in the test is 10,485,760 bytes. The peak limit is 9,000,000 bytes.
- With a peak of 8.1 MB, the headroom to the quota is about 2.4 MB. The headroom to the test limit is about 0.9 MB.
- `TODO.md` ("Where it was left off"): a headless Chrome run stored about 7.8 MB, and one list host refused the download. UNVERIFIED in this session.
- `scripts/release-gate.sh:349`: the gate forbids the `unlimitedStorage` permission.
- `test/final-storage-budget.test.js:23-31,36`: the test is ignored when `scripts/.list-cache/` does not hold all lists.
- `.gitignore`: `scripts/.list-cache/` is not in git. Thus the test is ignored in CI.
- `src/general-background.js:480-515`: the code records a failed write in `listState.lastError`. The comment tells that the popup shows it (UNVERIFIED).

**Impact.** The upstream lists grow with time. If the peak goes above the quota, each refresh fails with a quota error. Then the lists become old. `docs/permissions-and-privacy.md` tells that the packed rules stay in use (UNVERIFIED). No automatic check finds the problem before a release, because CI ignores the test.

**Suggested action.**
1. Run `test/final-storage-budget.test.js` with a full list cache before each release.
2. Record the peak value in `TODO.md` for each list repack.
3. Think about a small fixture test for CI that makes sure that a quota error is reported.
4. Do not add new stored list data before a decision about an IndexedDB store.

### H2. Package size is 2.2 % below the release gate cap

**What.** The release gate fails when the package is larger than 8,000,000 bytes.

**Evidence.**
- `scripts/release-gate.sh:254`: the cap.
- `scripts/release-gate.sh:245-253`: the cap was 7 MB, then 7.5 MB, then 8 MB.
- This session ran `scripts/lib/package_files.py --root .` (read only) and added the file sizes. Result: 68 files, 7,821,123 bytes. The headroom is 178,877 bytes.
- `src/rules/general-network.json` is 5,168,730 bytes. That is 66 % of the package.

**Impact.** The next list repack can make the gate fail. The gate comments record two increases of the cap. A cap that moves with each release does not catch a runaway pack.

**Suggested action.**
1. Remove the files of item M5 from the package. That gives about 186 KB.
2. Make a decision about `src/rules/threat-snapshot.json` (333,354 bytes, see M12).
3. Then set the cap from the measured size plus a fixed margin, and write the rule in the gate.

### H3. The vendored Twitch script has an archived upstream and an `eval` call

**What.** `src/vendor/video-swap-new.user.js` is TwitchAdSolutions video-swap-new 1.55, copied byte for byte.

**Evidence.**
- `docs/UPDATING-DEPENDENCIES.md` (table): the upstream repository is "archived, read-only".
- `scripts/vendor-pins.json`: commit `cebf3d7`, commit date 2026-02-26, SHA-256 `ef804d16...`. This session calculated the same SHA-256 and the same size (51,556 bytes).
- `src/vendor/video-swap-new.user.js:169`: `eval(workerString)`.
- `src/vendor/video-swap-new.user.js:739`: one `innerHTML` write.
- `manifest.json` (first content script): the file runs in world `MAIN`, at `document_start`, in all frames of Twitch.
- `src/settings/features.js` (`twitchPlayer`, `apply: "always"`): the user cannot set this feature to off.
- `docs/permissions-and-privacy.md` ("What it transmits"): the script copies the `Authorization` and `Client-Integrity` headers of the page into its requests to Twitch. UNVERIFIED in this session.
- `docs/STORE-REVIEW-NOTES.md`: an automated store check or a reviewer can flag the `eval` call. `TODO.md` (section 3): nothing was submitted to the store.
- `TODO.md` (section 2) tells you to check upstream for a newer version. This disagrees with the archived state.

**Impact.** If Twitch changes its player, no upstream correction will come. The Twitch function then stops, and the project must use a fork or write its own code. The `eval` call is a risk for a store submission. The script handles session headers, thus each replacement needs a code review.

**Suggested action.**
1. Make an owner decision: stay on the archived copy, move to a maintained fork (`--repo` option of `scripts/update-twitch-vendor.mjs`), or own the code.
2. Correct the `TODO.md` line about upstream checks.
3. Keep `test/vendor-pin.test.js` as the guard against hand edits.

### H4. YouTube response patching depends on upstream shapes

**What.** Two layers change YouTube data in the page world. The uBlock Origin layer is generated. `src/youtube.js` adds its own hooks.

**Evidence.**
- `src/youtube.js:1768`, `:1995`, `:2017`, `:2030`: the file replaces `window.fetch`, `XMLHttpRequest.prototype.open`, `XMLHttpRequest.prototype.send` and `JSON.parse`.
- `src/youtube.js:1871-1915`: the file redefines `responseText` and `response` on the XHR prototype, and `response` on single XHR objects.
- `src/youtube.js:1019` and `:20`: `startYoutubeAdblock` has 1,195 lines and `installYoutubeAdblock` has 998 lines.
- `src/youtube.js:27`: a `STEALTH` object holds four A/B switches. Three of them are `false` in the literal. Line 1108 sets `patchUmpBackoff` from an option.
- `scripts/sync-ubo-youtube.mjs:247` and `:250`: a local patch that matches nothing gives only a warning. Line 337 exits with code 0.
- `scripts/lib/youtube-local-patches.mjs:18-24` (`ensurePlayerAdsPruned`): this patch throws an error when the upstream text changes.
- `CHANGELOG.md` ("Unreleased"): uAssets `c7e01d3` renamed variables, and `ARG_PATCHES[0]` did not match. A third patch was added. The text ends with "Not tested in Chrome."
- `.github/workflows/ubo-youtube-drift.yml`: a weekly job fails when the generated files change. It does not open an issue or a pull request.
- `src/vendor/ubo-youtube-meta.json`: `ublock_tag` is `1.75.0`, `uassets_commit` is `e140ffc7...`.

**Impact.** A YouTube change or an upstream filter change can break playback or let ads through. The drift job only becomes red. A person must see it. The patches are text replacements, thus a small upstream rename removes them.

**Suggested action.**
1. Make `scripts/sync-ubo-youtube.mjs` exit with a non-zero code when a patch matches nothing.
2. Do a manual YouTube test in Chrome before the next release (see H5).
3. Split `src/youtube.js` only together with tests, because many tests read its source text.

### H5. No live site test for 0.3.5; unreleased changes sit on version 0.3.5

**What.** The 0.3.5 code was not tested on live sites. Changes that the changelog calls "Unreleased" are on the same version number.

**Evidence.**
- `TODO.md` ("Where it was left off"): "Not done: any live site test (YouTube, Twitch, Kick, news sites)."
- `manifest.json`: `"version": "0.3.5"`.
- `CHANGELOG.md` ("Unreleased"): PR #13 was merged after 0.3.5 and is "not in a release yet".
- `.github/workflows/release.yml`: the workflow packs the checked-out commit and uses the changelog section of the manifest version as the notes. It stops if the tag exists.
- `README.md` ("Install"): the link points to an `adgecko-0.3.5.zip` release file.
- This checkout has no git tags. This session did not check if a 0.3.5 release exists.

**Impact.** If no 0.3.5 release exists, a release made now contains the PR #13 changes, but the notes do not list them. If a release exists, the unreleased changes need a new version number before the workflow can run. In the two cases, behaviour on live sites is UNVERIFIED.

**Suggested action.**
1. Find out if tag `v0.3.5` exists on the remote.
2. If it exists: change the version to 0.3.6 and move "Unreleased" into that section.
3. If it does not exist: move the "Unreleased" text into the 0.3.5 section before the release.
4. Do the manual tests that `TODO.md` lists, and record the results.

## 3. Medium impact

### M1. Documents give numbers that disagree with the packed data

The data files are the source of truth. `test/meta-counts.test.js` compares `meta.json`, `dnr-merge-meta.json` and `threat-meta.json` with the rule files. No test compares the documents with the data.

| Document | Statement in the document | Value in the data (this session) |
|---|---|---|
| `docs/how-it-works.md` ("Other websites") | 194,896 whole-domain entries | 195,069 (`src/rules/meta.json` `domains_total`) |
| `docs/how-it-works.md` | 5,350 scoped entries | 18,422 (`scoped_entries_total`) |
| `docs/how-it-works.md` | 2,536 list rules | 2,851 (`dnr_rules_total`) |
| `docs/how-it-works.md` | 2,541 rules in `general-network.json` | 2,856 (counted in the file) |
| `docs/how-it-works.md` | lists downloaded 2026-11-09 03:01 UTC | `packed_at_utc` is 2026-11-14T22:00:32Z |
| `docs/threat-tier.md` ("Protected hosts") | 15,827 hosts in 198 rules | 15,865 hosts in 199 rules (`src/rules/threat-meta.json`) |
| `docs/threat-tier.md` | "The current pack is 2026-11-09 03:01 UTC" | 2026-11-14 (see above) |
| `docs/threat-tier.md` | `psl.js`: about 7,000 names, 82 KB | 113,218 bytes; header: 5,208 ICANN + 3,116 private suffixes (`src/threat/psl.js:5`) |
| `src/threat/protected-hosts.js:55` (comment at `SUFFIX_LIKE_FIRST_LABEL`) | the full Public Suffix List is "not bundled" | a subset is bundled in `src/threat/psl.js`; the worker loads it before this file (`src/general-background.js:7`) |
| `src/rules/README.md` | lists 4 files | the folder has 14 files (see L5) |

Statements that agree with the data:
- `README.md` and `docs/permissions-and-privacy.md`: eight lists. `src/rules/meta.json` has eight sources. `src/general/update.js:69-92` has eight `SOURCES`.
- `manifest.json`: the permissions are `storage`, `declarativeNetRequest`, `alarms`. The gate allows only these three (`scripts/release-gate.sh:334`).
- `README.md`: Chrome 137 or newer. `manifest.json` has `minimum_chrome_version` 137.
- `README.md` and `docs/permissions-and-privacy.md`: a check each 3 hours, a download at most each 12 hours, a retry after 30 minutes. `src/general/update.js:19-21` agrees.
- `docs/threat-tier.md`: priority 2,000,010 and ids 600000-609999. `src/rules/threat-meta.json` and `src/general/update.js:31-32` agree.
- The host permissions in `docs/permissions-and-privacy.md` agree with `manifest.json` (nine patterns).
- `CHANGELOG.md` 0.3.5: 195,069 / 18,422 / 2,851 / 2,856. These agree with the data.
- `docs/how-it-works.md`: uBlock Origin 1.75.0 and TwitchAdSolutions 1.55. These agree with the pin files.

**Impact.** A reader or an agent can plan with wrong counts. The error in the scoped count is large (5,350 against 18,422).

**Suggested action.** Replace fixed numbers in the documents with a pointer to `src/rules/meta.json`. As an alternative, add a test that reads the numbers from the two documents.

### M2. `TODO.md` disagrees with the git history

**Evidence.**
- `TODO.md`: "Last updated 2026-11-14". The last commit that changed the file is `cd2253f`.
- `TODO.md`: 0.3.5 is "Prepared, not pushed" on a local branch.
- `git log`: commit `6e0caf8` merges pull request #12 from the branch `nightly/0.3.5`. Commit `aa5f5af` merges pull request #13.
- `TODO.md` step 0, first box ("Review the branch, push it, open a PR and merge it") is open.
- `TODO.md` does not mention `scripts/update-twitch-vendor.mjs` or `docs/UPDATING-DEPENDENCIES.md` (added in PR #13).

**Impact.** The next agent can repeat work that is done, or miss the real next step (the release).

**Suggested action.** Update `TODO.md`: set the first box of step 0, add the PR #13 state, and correct the Twitch upstream line (see H3).

### M3. Six tests are always ignored; owner decisions are open

| Test file | Ignored tests | Reason in the file | Related item |
|---|---|---|---|
| `test/nightly-manifest-scripts-1-the-ads-twitch-tv-carve-out-in-the-merge.test.js:37,61` | 2 | Block of the Twitch ad host `ads.twitch.tv` is held back | `CHANGELOG.md` "Not in this release" |
| `test/nightly-manifest-scripts-2-every-exception-is-dropped-so-hosts-that.test.js:107` | 1 | Exceptions under a parent-domain block or with a type scope are not honoured; "too risky for this release" | Known issue, three example hosts in the file |
| `test/nightly-site-scripts-2-kick-a-hidden-post-roll-cover-is-never-s.test.js:25` | 1 | Kick fix held back | `docs/proposals/kick-0.3.5-fixes.patch` |
| `test/nightly-site-scripts-4-kick-banner-collapse-can-permanently-hid.test.js:43,55` | 2 | Kick fix held back | same patch |

Tests that are ignored only in some environments:

| Test file | Condition |
|---|---|
| `test/final-storage-budget.test.js:36` | no full list cache (see H1) |
| `test/packaging.test.js:89` | no tool to make a zip |
| `test/privacy-generic.test.js:225,282` | the `PRIVACY_PATTERNS` secret is not set |

More evidence:
- `src/general-exclude-hosts.js:89` (`buildDnrExclusionRules`): the Twitch allow rule excludes `ads.twitch.tv`. The extra tracker rule (`extra_tracker_domains` in `src/rules/dnr-merge-meta.json`) does not name that host.
- `docs/proposals/kick-0.3.5-fixes.patch` has 96 lines. `git apply --check` accepted it at this commit (read-only check).
- `scripts/release-gate.sh:147-150` and `:256-280`: `src/kick.js` is a frozen playback file. A change fails section 1b until the change is on `origin/main`.
- `TODO.md` step 0 lists three more ideas without a decision: frames on an allowed site, a default allow list for checkout helpers, path filters.

**Impact.** Two known Kick defects stay in `src/kick.js`: a hidden cover can stay hidden, and a banner collapse can hide the player (from the test names and `CHANGELOG.md`; UNVERIFIED on the live site). After the next change of `src/kick.js`, it is possible that the patch does not apply.

**Suggested action.** Get the owner decisions. For each one, apply the change and remove `ignore: true`, or delete the patch and the tests and record the decision.

### M4. The stream-site host list exists in many files

`src/settings/features.js:25-29` (`STREAM_SITES`, 17 hosts) is named "the one list". Other copies exist.

| Copy | Location | Guard |
|---|---|---|
| Three `exclude_matches` blocks, 34 patterns each, identical | `manifest.json` | `test/settings.test.js:49-51` (cosmetic block), `test/guards.test.js:296` (guards and flags blocks), `test/settings.test.js:337` |
| `NEVER_BLOCK_SUFFIXES` (runtime) | `src/general/update.js:109-114` | `test/settings.test.js` ("stream hosts: registry, threat protected hosts and list never-block hosts agree") |
| `SUFFIX` and `EXACT` (threat tier) | `src/threat/protected-hosts.js:26`, `:40` | same test |
| `NEVER_BLOCK_SUFFIXES` (packer) | `scripts/pack-filter-lists.py:115-139` | `test/settings.test.js` ("the packer's never-block list covers every registry host") |
| `never_block_suffixes` (generated) | `src/rules/meta.json` | `test/hcaptcha-never-block.test.js:175-178` |
| `SITE_DOMAINS`, `VIDEO_CDN_DOMAINS` (merger) | `scripts/merge-dnr-rules.py:30-46`, comment "Keep in sync" | Partial: `test/dnr.test.js` ("buildDnrExclusionRules matches packed high-priority allows") |
| `SITE_DOMAINS`, `VIDEO_CDN_DOMAINS` | `src/general-exclude-hosts.js:11`, `:26` | Used by tests only; nothing loads the file at runtime (see M5) |
| `SITE_SUFFIXES`, `VIDEO_SUFFIXES`, `SITE_DOMAINS`, `VIDEO_DOMAINS` | `src/general/exclusions.js:5-60` | Dead module; its lists differ from `STREAM_SITES` |
| Host fragments for the URL scan | `scripts/release-gate.sh:497-498`, `:621-631` | None |
| Test fixture (61 lines) | `test/fixtures/stream-hosts.txt` | Read by `test/threat-tier.test.js` and `test/navigation-scope.test.js` |

Differences found:
- `VIDEO_CDN_DOMAINS` (7 hosts) does not contain `twitchcdn.com`, `ext-twitch.tv`, `kick-streamer.com` and `kickusercontent.com`. `STREAM_SITES` contains them. The effect is UNVERIFIED; the packer never emits these hosts as block targets.
- `src/general/exclusions.js:5-27` (`SITE_SUFFIXES`, `VIDEO_SUFFIXES`) does not contain `youtube-nocookie.com`, `ext-twitch.tv`, `kick-streamer.com` and `kickusercontent.com`.
- The manifest blocks are not generated. No script writes them. The tests compare them with `streamExcludeMatches()` in `src/settings/features.js:69`.

**Impact.** A new stream host needs a change in up to seven places. The tests catch most errors, but not the merger list and not the gate fragments.

**Suggested action.** Make `scripts/merge-dnr-rules.py` read the hosts from one data file, as the captcha list does (`src/rules/never-block-captcha.json`). Delete the dead copies (M5).

### M5. Dead modules and unused data are in the package

| File | Bytes | Evidence |
|---|---|---|
| `src/general-exclude-hosts.js` | 3,943 | `scripts/lib/package_files.py:44-45`: "nothing loads it (dead module)". It is in the gate `REQUIRED` list (`scripts/release-gate.sh:125`). |
| `src/general/toggles.js` | 3,317 | `scripts/lib/package_files.py:53-57`: "Dead modules ... kept packed until the owner decides (NEEDS OWNER)" |
| `src/general/exclusions.js` | 3,730 | same |
| `src/general/cosmetic.js` | 2,821 | same |
| `src/rules/cosmetic-sample.json` | 172,666 | Written by `scripts/pack-filter-lists.py:1282`. A search in `src/` found no reader. |

The `importScripts` call in `src/general-background.js:7-8` and the manifest do not name the four modules. The gate allow-list names all five files (`scripts/release-gate.sh:144`).

**Impact.** 186,477 bytes of the package have no function (see H2). The dead modules hold old host lists (M4) that can mislead a reader. Five test files name them (`test/dnr.test.js`, `test/exclusions.test.js`, `test/toggles.test.js`, `test/general-cosmetic-contract.test.js`, `test/no-background-fetch.test.js`), thus a removal needs test changes.

**Suggested action.** Get the owner decision that `package_files.py` asks for. Then remove the files from `EXTRA_REQUIRED`, `EXTRA_OPTIONAL`, the gate `REQUIRED` list and `ALLOWED_RE`. Move test-only helpers to `test/fixtures/`.

### M6. Legacy storage mirrors and migrations stay in the code

| Legacy item | Location | State |
|---|---|---|
| Keys `generalEnabled` and `generalAllowedOrigins` as derived mirrors of `settings` and `siteOverrides` | Written: `src/general-background.js:311-314`. Read: `src/cosmetic.js:7-8`, `src/popup.js:11-12` and `:126-134`. Built: `legacyMirror` in `src/settings/features.js:188` | Active on each settings change |
| One-time migration from the old keys | `migrateLegacy` in `src/settings/features.js:166`; `migrateSettings` in `src/general-background.js:271-275` | Runs at each worker start; returns early when `settings` exists |
| Old single key `generalListRefresh` (about 6 MB) to `listState` and `listData:<name>` | `src/general-background.js:454-458`, `:522-547` | Runs at each worker start; returns early when the old key is absent |
| `cosMeta.keys` to `cosKeys` (upgrade from 0.3.4) | `src/general-background.js:676-683`, `:736-742` | Runs in `ensureCosmeticNow` |
| `PARSER_VERSION = 4`: stored list data from an older parser is fetched again | `src/general/update.js:127-133` | Each change of the number forces a full refetch for all users |
| `dropRetiredCosmetic`, `RETIRED_LISTS`, `dropRetiredLists` | `src/general/update.js:745-746`, `:773`, export at `:1332` | Clean-up for data of older builds |
| Fix state that 0.3.4 saved on a parent domain | `src/popup.js:200` (comment) | Compatibility path |
| "Back-compat" helper names | `src/general/update.js:140`, `src/cosmetic.js:177` | Kept for older tests or callers |

The names of `test/final-upgrade-3-*.test.js`, `test/final-upgrade-4-*.test.js` and `test/storage-alarm.test.js` point to tests for these paths. `test/settings.test.js:63`, `:132` and `:167` hold tests for the migration and the mirror (from the test names). This session did not read the test bodies.

**Impact.** Two sources hold the same settings. `src/cosmetic.js:7-8` and the DNR code (`src/general-background.js:436`, `:446`) use the mirror keys. `src/cosmetic.js:10-11` also names `settings` and `siteOverrides`. A missed mirror write gives a state where the popup and the page disagree. Each migration adds start-up work and code paths that few users still need.

**Suggested action.** Make `src/cosmetic.js` and the DNR code read `settings` and `siteOverrides` through `GeckoFeatures.resolve`. Then remove the mirror. Set a version after which each migration can be deleted, and write it next to the code.

### M7. Storage key strings are repeated in several files

| Key string | Files that hold the literal |
|---|---|
| `settings`, `siteOverrides` | `src/general-background.js`, `src/popup.js`, `src/settings.js`, `src/settings/flags.js`, `src/cosmetic.js`, `src/twitch-directory-ads.js` |
| `generalEnabled`, `generalAllowedOrigins` | `src/general-settings.js`, `src/general-background.js`, `src/popup.js`, `src/cosmetic.js`, `src/settings/features.js` (as property names) |
| `generalListStatus` | `src/general-settings.js`, `src/popup.js`, `src/settings.js` |
| `feedPaused` | `src/feed/client.js`, `src/general-background.js`, `src/popup.js` |
| `feedState` | `src/feed/client.js`, `src/popup.js`, `src/settings.js` |
| `threatAllowDomains` | `src/general-background.js`, `src/settings.js` |
| `uiTheme` | `src/popup.js`, `src/settings.js` |
| `listState`, `listData:`, `generalListRefresh` | `src/general-background.js:456-458` only |
| `cosMeta`, `cosKeys` | Defined in `src/general/cosmetic-parse.js:423-424`. `src/cosmetic.js:244` also reads the property `changes.cosMeta`. |
| `feedCache` | `src/feed/client.js:15` only |
| `generalListUpdatedAt` | `src/general-settings.js`, `src/popup.js`, `src/settings.js` |
| `popupFix`, `popupWelcomed` | `src/popup.js` only |

More evidence:
- `src/general-settings.js:7-13` defines `STORAGE_KEYS` with five keys. It does not hold `settings`, `siteOverrides` or the feed keys.
- `src/popup.js:10-23` defines its own `KEYS` object. `scripts/release-gate.sh:238-243` lets `popup.html` load only `popup.js`, thus the popup cannot load a shared key module.
- `src/cosmetic.js:6`: the comment tells "do not rename without coordinating".
- This session did not find a test that compares the key strings across files. The test files were not all read.

**Impact.** A typing error in one file gives a silent read of `undefined`. The features then use their defaults (fail-open), and no error shows.

**Suggested action.** Add one test that reads the source files and makes sure that each key literal is in one known list.

### M8. Very large files and functions

Line counts from this session (`wc -l`, and a script that finds the closing brace of each function):

| File | Lines | Largest functions (lines) |
|---|---|---|
| `src/youtube.js` | 2,216 | `startYoutubeAdblock` 1,195; `installYoutubeAdblock` 998 |
| `src/vendor/ubo-youtube.js` | 2,021 | Generated file |
| `scripts/pack-filter-lists.py` | 1,362 | `main` 195; `convert_options` 122 (from the Python syntax tree) |
| `src/general/update.js` | 1,344 | `installGeneralAdblockUpdate` 1,325 (one closure); inner `refresh` 254 |
| `src/general-background.js` | 1,215 | `refreshLists` 71; `listDeps` 67 |
| `src/vendor/video-swap-new.user.js` | 985 | Vendored file |
| `scripts/release-gate.sh` | 806 | Four inline Python programs |
| `src/kick.js` | 769 | `installKickAdblock` 756 (one closure) |
| `src/guards/clipboard.js` | 712 | `installClipboardGuard` 546 |
| `src/popup.js` | 640 | `render` 55 |

Large data files: `src/rules/general-network.json` 5,168,730 bytes; `src/rules/cosmetic-rules.json` 804,416 bytes; `src/rules/threat-network.json` 365,721 bytes; `CHANGELOG.md` 62,467 bytes.

Duplicated logic in two languages:
- `convertOptions` in `src/general/filter-options.js:131` and `convert_options` in `scripts/pack-filter-lists.py:411`. Shared cases are in `test/fixtures/filter-options-cases.json`.
- `isIcannSuffix` in `src/threat/psl.js` and `is_public_suffix` in `scripts/pack-filter-lists.py:678-692`. Guard: `test/final-lists-5-packer-psl-parity.test.js`. The packer reads its data from `src/threat/psl.js` (`scripts/pack-filter-lists.py:646-675`), thus only one copy of the PSL data exists.

**Impact.** A change in one closure of more than 700 lines has a high risk of side effects. Many tests read source text with regular expressions (for example `test/settings.test.js` on `src/youtube.js`), thus a refactor breaks tests that do not test behaviour.

**Suggested action.** Do not refactor these files without a need. If a function must change, first add behaviour tests for that part.

### M9. Release gate: hard-coded values, checks that always pass, old comments

| What | Evidence | Impact |
|---|---|---|
| The Twitch conflict version is a literal | `scripts/release-gate.sh:774`: `ourTwitchAdSolutionsVersion = 23`. `test/vendor-pin.test.js` compares the literal with `scripts/vendor-pins.json`. | The update script does not edit the gate. An owner must change the line by hand (`docs/UPDATING-DEPENDENCIES.md`). |
| The playback freeze cannot tell an approved change from another change | `:256-280`: a difference from `origin/main` in `src/vendor/video-swap-new.user.js` or `src/kick.js` fails. | Each approved change must merge with a red gate. On a push to `main` the check always passes. |
| Lines that print PASS without a check | `:518` (Kick host note), `:616` (ad-server names), `:790-792` (YouTube JSON) | The output looks stronger than the checks are. |
| Old comments | `:5-8` ("General-adblock beta (Phase 0)"), `:146` ("YouTube is the beta script"), `:629` ("Manual list Update (popup fetch)") | They describe an older design. `docs/permissions-and-privacy.md` tells that the popup does not fetch. |
| Fixed file names in the system temp folder | `:238`, `:577-584`, `:594`, `:601`, `:609`, `:739` (`gate-popup.txt`, `gate-danger.txt`, `gate-deno.txt` and others). Lines 54 and 771 already use `mktemp`. | Two gate runs at the same time on one machine can mix their results. |
| The package size cap | `:254` | See H2. |
| The version literal in two tests | `test/exclusions.test.js:99`, `test/youtube.test.js:218` | Each version change needs edits in `manifest.json`, `README.md` and these tests. |
| The Deno tests run two times in CI | `.github/workflows/checks.yml`: job `tests`, and job `release-gate` (gate section 5, `:735-755`) | Longer CI time. |

**Suggested action.** Read the conflict version from `scripts/vendor-pins.json` in the gate. Replace the fixed temp names with `mktemp`. Remove or change the PASS lines that do not check. Update the comments.

### M10. Hard-coded line numbers in documents

| Reference | Where | Correct at this commit | Guard |
|---|---|---|---|
| Gate line 774 | `docs/UPDATING-DEPENDENCIES.md`, `CHANGELOG.md` ("Unreleased") | Yes | None for the line number. `test/vendor-pin.test.js` checks the literal text. |
| `eval` at line 169 of the vendored script | `docs/STORE-REVIEW-NOTES.md` | Yes | `scripts/update-twitch-vendor.mjs` rewrites it; `test/vendor-pin.test.js` ("every pin site agrees with the pin") |
| `getWasmWorkerJs` at line 208 | `docs/STORE-REVIEW-NOTES.md` | Yes | same |
| Line 25 of `scripts/sync-ubo-youtube.mjs` (`arg("--ubo", "1.75.0")`) | `docs/UPDATING-DEPENDENCIES.md` (three times) | Yes | None |

**Impact.** An edit above line 774 of the gate or above line 25 of the sync script makes the documents wrong. No test finds that.

**Suggested action.** Refer to the text to search for (for example the literal `ourTwitchAdSolutionsVersion =`), not to a line number.

### M11. Page-world scripts: known limits

Five manifest entries run in world `MAIN`: the Twitch script, `src/vendor/ubo-youtube.js`, `src/youtube.js`, `src/kick.js`, and one entry for the two guards. The page can see and change the same JavaScript world.

| Note | Evidence | Mark |
|---|---|---|
| The guards run on all ordinary sites, in all frames, also in `about:blank` frames | `manifest.json` (last entry: `match_about_blank`, `match_origin_as_fallback`) | From the file |
| A same-origin frame that the guard has not reached yet has native clipboard methods | `src/guards/clipboard.js:50-52` ("Known limit") | UNVERIFIED in Chrome |
| A page that rewrites Promise internals can interfere with the `clipboard.write()` check | `src/guards/clipboard.js:53-55` | UNVERIFIED in practice |
| The context-menu Copy path was not tested | `src/guards/clipboard.js:45-47` | UNVERIFIED |
| The guards fail open: an error in the guard lets the original call through | `src/guards/clipboard.js:56-57` | From the comment |
| The flag channel depends on the order of `document_start` scripts in one task | `src/settings/flags.js:18-20` | UNVERIFIED (Chrome behaviour); the comment tells that the two orders are handled |
| Without a port, page-world features use their defaults | `src/settings/flags.js:17-18` | From the comment |
| Vendored scripts get no flags and are always on | `src/settings/flags.js:20-21`; `src/settings/features.js` (`apply: "always"`) | From the file |
| The gate lets no `chrome.*` call into the page-world files | `scripts/release-gate.sh:679-695` | From the file |
| The clipboard guard is a large page-world file that the project owns: 712 lines. It captures built-ins at load | `src/guards/clipboard.js:62-83` | From the file |

**Impact.** The clipboard guard gives a security promise in `README.md`. The known limits show that a page can get past the guard in some cases (UNVERIFIED). A user can think that the protection is complete.

**Suggested action.** Keep the limits in the file header. Add one sentence about the limits to `docs/how-it-works.md` ("Page guards"). Do a test of the four UNVERIFIED items in Chrome, then remove the marks.

### M12. The signed feed is dormant, but its code and data ship

**Evidence.**
- `src/feed/config.js`: `FEED_ORIGIN = ""`.
- `src/feed/keys.js`: `FEED_KEYS` and `KILL_KEYS` are empty objects.
- `src/feed/client.js:163-168` and `:205-206`: the client returns "dormant" before a fetch.
- `docs/feed-setup.md`: two decisions are open (the feed host, D-1; who signs, D-7).
- The seven files in `src/feed/` have 37,198 bytes. The worker loads all of them (`src/general-background.js:8`).
- `src/rules/threat-snapshot.json` (333,354 bytes) is read only by `loadSnapshot` (`src/general-background.js:391`). `src/feed/client.js:155-159` and `:193` call it only after the configuration check passes.
- `src/settings/features.js:42`: the feature `threatFeed` is in the registry with default `true`. `src/settings.js:93-94` and `:262` connect it to a `pause-feed` control. The UNVERIFIED effect: the settings page shows a control for a function that does nothing.
- `scripts/release-gate.sh:313-321`: the gate accepts one more host permission when `FEED_ORIGIN` is set.
- `scripts/feed-keygen.mjs` and `scripts/feed-sign.mjs` exist. `docs/feed-setup.md` tells that private keys must stay out of the repository.

**Impact.** About 370 KB of the package have no function now (see H2). The code path has tests (`test/feed-client.test.js`, `test/feed-core.test.js`) but no production use. A later activation adds a host permission. The effect of that on installed copies was not checked.

**Suggested action.** Make the owner decisions D-1 and D-7, or record that the feed stays off. If it stays off, think about removal of the snapshot from the package.

### M13. The public-suffix subset has no refresh schedule

**Evidence.**
- `src/threat/psl.js:1-7`: generated from the Public Suffix List, version 2026-10-31.
- `scripts/build-psl-subset.mjs:5` and `:65`: the script needs a local copy of the list (`--psl`). It never fetches.
- `.github/workflows/`: no workflow runs this script.
- `src/threat/psl.js:7`: 120 platform parents are "hand-kept".
- `src/rules/threat-meta.json` (`rejected`): five hosts were rejected as public suffixes in the last pack.

**Impact.** A new public suffix or a new shared-hosting platform is not protected. One list line can then block all sites below it. The risk grows slowly with time.

**Suggested action.** Add the PSL refresh to the list-repack procedure, and record the PSL version in `TODO.md`.

## 4. Low impact

### L1. A retired workflow stays in the repository

- `.github/workflows/refresh-release-notes.yml`: the comment tells "Retired". The job only prints one line.
- The comment tells that "v0.2.13 is the only current release". `TODO.md` names v0.3.4 as the last release.
- `test/privacy-generic.test.js:6` and `:217` read this file. Thus a deletion needs a test change.
- Impact: a person can start it from the Actions page and think that it does something.
- Suggested action: ask the owner for approval, then delete the file and change the test.

### L2. Old documents and card folders use 33.7 MB

Sizes from `du -sk` in this session. The `docs/` folder has 40,596 KB. The `src/` folder has 7,748 KB. The `.git` folder has 27,128 KB.

| Folder or file | Size (KB) | Files | References found in `*.md`, `*.yml`, `*.py`, `*.mjs`, `*.js`, `*.sh`, `*.html`, `*.json` |
|---|---|---|---|
| `docs/cards-beta-0.2.5` | 3,708 | 7 | `docs/beta-0.2.5-release.md` to `docs/beta-0.2.8-release.md` |
| `docs/cards-beta` | 3,580 | 10 | None |
| `docs/cards-release` | 3,576 | 10 | `docs/release-notes/v0.2.3.md` |
| `docs/cards` | 3,568 | 10 | None |
| `docs/cards2` | 3,568 | 10 | None |
| `docs/cards-main` | 3,568 | 10 | None |
| `docs/cards-beta-0.2.9` | 3,024 | 7 | `docs/beta-0.2.9-release.md` |
| `docs/cards-beta-0.2.10` | 3,024 | 7 | `docs/beta-0.2.10-release.md` |
| `docs/cards-beta-0.2.11` | 3,024 | 7 | `docs/beta-0.2.11-release.md` |
| `docs/cards-beta-0.2.12` | 3,016 | 7 | `docs/beta-0.2.12-release.md` |
| `docs/install` | 1,988 | 6 | None |
| `docs/safe` | 756 | 2 | None |
| `docs/whats-new.png`, `docs/what-it-is.png`, `docs/found-a-problem.png` | 436, 384, 292 | 3 | `what-it-is.png`: `docs/release-notes/v0.2.3.md`; the others: none |
| `docs/icon-preview` | 48 | 2 | None |
| `docs/agent-notes` | 28 | 2 | `TODO.md` (tidy task) and itself |
| `docs/gecko-avatar.jpg` | 132 | 1 | `docs/README-backup-2026-10-24.md` |
| `docs/release-notes` | 16 | 3 | None |
| Eight `docs/beta-0.2.*-release.md` files | 8 each | 8 | None |
| `docs/README-backup-2026-10-24.md`, `docs/chat-2026-10-11.md`, `docs/efficiency-check-2026-10-11.md` | 4, 4, 8 | 3 | The first two: `TODO.md` (tidy task). The third: `docs/chat-2026-10-11.md`, `docs/release-notes/v0.2.12.md` |

More facts:
- The ten `cards*` folders use 33,656 KB in total.
- `docs/cards`, `docs/cards2` and `docs/cards-main` are byte-identical (same hash of all file hashes).
- `docs/whats-new.png` is identical to `docs/cards/whats-new.png`. `docs/install/01-open-github.png` is identical to the file in `docs/cards/install/`.
- `docs/design` (2,704 KB, 44 files) is in use: `README.md` and three tests refer to it.
- `TODO.md` (section 3) already lists this tidy task as open.
- `scripts/pack-zip.sh` does not pack `docs/`. Thus the package size does not change.

Impact: each clone and each "Download ZIP" copy carries about 34 MB of old images. Old release pages can mislead a reader.

Suggested action: ask the owner for approval with this list. Then delete the unreferenced folders, or move them to a release asset. The history keeps the size until a history rewrite; do not rewrite history without approval.

### L3. References to a file that is not in the repository

- The name `BUILD-PROGRESS` is in `scripts/lib/package_files.py:16`, `src/general/filter-options.js:67`, `test/navigation-scope.test.js:3`, `test/no-openphish.test.js:197` and `test/fixtures/dnr-matcher.js:16`.
- `git ls-files` shows no file with that name.
- Impact: the evidence for some decisions (for example the DNR matcher model) cannot be found.
- Suggested action: move the necessary facts into the comments, or restore the file under `docs/`.

### L4. Damaged characters in comments

- `src/general-exclude-hosts.js`: three comment lines hold damaged characters where a dash or an ellipsis was (lines 3, 10 and 66).
- `test/no-openphish.test.js:58` also holds such characters.
- Impact: none at runtime. The subject of commit `bf1bf8f` tells that Chrome refused to load the extension because of one raw character. `test/final-chrome-utf8.test.js` exists; this session did not read it.
- Suggested action: replace the characters with plain ASCII when the file is next changed. The file is in the package (see M5).

### L5. Generated `src/rules/README.md` and `meta.json` hints are old

- `scripts/pack-filter-lists.py:1299-1310` writes `src/rules/README.md` with four files. The folder has 14 files. The text uses the words "DNR agent" and "cosmetic agent".
- `src/rules/meta.json` (`manifest_hint`): the ruleset id is `general_network`. `manifest.json` uses the id `general`. `scripts/release-gate.sh:376` requires `general`.
- `src/rules/meta.json` (`headroom_note`, written at `scripts/pack-filter-lists.py:1241`): the text is about a "DNR agent". The hint id comes from line 1261.
- Impact: a reader can use the wrong ruleset id. A hand edit of the README is lost at the next pack.
- Suggested action: correct the text in the packer, not in the generated files.

### L6. Small duplicates

| What | Evidence | Suggested action |
|---|---|---|
| Two default texts for the list status | `src/general-settings.js:19` ("auto refresh after startup") and `src/popup.js:28` ("checked every 3 hours") | Use one text. |
| A workflow comment disagrees with the script | `.github/workflows/ubo-youtube-drift.yml` (header: the sync "exits non-zero when a local patch no longer finds its upstream shape"); `scripts/sync-ubo-youtube.mjs:247-250,337` (warning, exit code 0) | See H4, action 1. The later `git diff --exit-code` step still finds a changed output. |
| The sync script runs upstream code with full Deno permissions | `docs/UPDATING-DEPENDENCIES.md` ("Security note"); the weekly job runs `deno run -A` | The job has `contents: read` and no secret. Keep the uBlock tag pinned. |

## 5. Checked and not a concern now

| Subject | Result | Evidence |
|---|---|---|
| Static rule count against the Chrome limit | 3,059 enabled static rules (2,856 + 199 + 4) of the 30,000 guaranteed | Counted in the three rule files; `scripts/release-gate.sh:488-490`, `:544` |
| Packer budget | 2,856 rules of a budget of 28,000 | `scripts/pack-filter-lists.py:25`, `:1211` |
| Regular-expression rules | 1 rule (`src/rules/ubo-youtube-network.json`) | Counted in the files |
| Dynamic rule caps in code | `MAX_LIST_RULES = 25000`, `DYNAMIC_RULE_LIMIT = 30000`, `THREAT_RULE_ID_BASE = 600000`, `THREAT_RULE_ID_END = 610000` | `src/general/update.js:24-33`, `:572` |
| Dynamic rules after the first refresh | 3,062 | `TODO.md`; UNVERIFIED in this session |
| Rule metadata against rule files | The counts agree | `src/rules/meta.json`, `dnr-merge-meta.json`, `threat-meta.json`; guard `test/meta-counts.test.js` |
| Captcha never-block list | One source, `src/rules/never-block-captcha.json`; the JS copy is generated | `src/general/update.js:115-122`; guard `test/hcaptcha-never-block.test.js` |
| Vendored Twitch file against its pin | The SHA-256 and the size agree | `scripts/vendor-pins.json`; `sha256sum` in this session |
| Workflow actions | Pinned to full commit ids; `persist-credentials: false` | `.github/workflows/checks.yml`, `release.yml`, `ubo-youtube-drift.yml` |
| Permissions | Three API permissions; no optional permissions; the gate refuses more | `manifest.json`; `scripts/release-gate.sh:334-367` |
| The Kick patch | It applies to `src/kick.js` at this commit | `git apply --check` (read only) |

## Checked and not checked

### Read from the files in this session

- `manifest.json` (all), `TODO.md` (all), `README.md` (all), `.gitignore`, `.gitattributes`.
- `CHANGELOG.md`: the first 80 lines ("Unreleased" and 0.3.5).
- `docs/how-it-works.md`, `docs/permissions-and-privacy.md`, `docs/threat-tier.md`, `docs/STORE-REVIEW-NOTES.md`, `docs/UPDATING-DEPENDENCIES.md` (all); `docs/feed-setup.md` (first 60 lines); `docs/proposals/kick-0.3.5-fixes.patch` (first 80 lines).
- `src/rules/README.md`, `src/vendor/README.md`, `src/rules/dnr-merge-meta.json`, `src/rules/threat-meta.json` (all); `src/rules/meta.json` (all keys, by script).
- Rule counts, rule ids and top-level keys of the JSON files in `src/rules/` (by script; the large files were not read as text).
- `scripts/release-gate.sh` (all), `scripts/pack-zip.sh` (all), `scripts/vendor-pins.json` (all), `scripts/lib/package_files.py` (lines 1-110).
- `scripts/pack-filter-lists.py` (lines 100-140, 1296-1320, and search results); `scripts/merge-dnr-rules.py` (lines 25-60); `scripts/sync-ubo-youtube.mjs` (lines 15-35, 225-255, and search results); `scripts/lib/youtube-local-patches.mjs` (first 70 lines); `scripts/build-psl-subset.mjs` (search results).
- The four workflow files in `.github/workflows/` (all).
- `src/general-settings.js`, `src/general-exclude-hosts.js`, `src/settings/flags.js`, `src/feed/config.js`, `src/feed/keys.js` (all).
- `src/general/update.js` (lines 1-140, and search results); `src/general-background.js` (lines 7-28, 255-345, 480-560, 660-760, and search results); `src/settings/features.js` (lines 15-45, 160-203); `src/general/exclusions.js` (lines 1-60); `src/threat/protected-hosts.js` (first 80 lines); `src/threat/psl.js` (header); `src/guards/clipboard.js` (lines 1-84); `src/popup.js` (lines 1-45); `src/youtube.js` (lines 1-30, and search results); `src/feed/client.js` (lines 155-200, and search results).
- `src/vendor/video-swap-new.user.js`: search results for `eval`, `innerHTML`, version lines; SHA-256 and size.
- `test/final-storage-budget.test.js` (lines 1-75), `test/vendor-pin.test.js` (test names and the pin checks), `test/meta-counts.test.js` (the five test names); parts of `test/settings.test.js`, `test/dnr.test.js`, `test/guards.test.js`, `test/final-lists-5-packer-psl-parity.test.js`, and the two `nightly-manifest-scripts` tests; all `ignore:` lines in `test/`.
- `git log` (the last 40 subjects), `git tag`, `git branch -a`, `git status`, `git ls-files` (read-only commands).
- Sizes: `du -sk` of `docs/*`, `.git`, `src`, `test`, `scripts`; `wc -l` of the source files; function lengths by a brace-matching script (approximate).
- The package list and size: `scripts/lib/package_files.py --root .` (read only).

### Not checked

- No test was run. Deno is not installed. All test results in `TODO.md` and `CHANGELOG.md` are UNVERIFIED.
- The extension was not loaded in Chrome. All runtime behaviour is UNVERIFIED: storage peak, dynamic rule count, refresh timing, the guards, the YouTube, Twitch and Kick functions.
- The remote repository was not read. It is not known if a `v0.3.5` tag or release exists, or if the weekly drift job is green.
- The state of the upstream repositories (archived or not, newer commits) comes only from `docs/UPDATING-DEPENDENCIES.md`.
- The current Chrome limits for rules and storage were not looked up. The numbers come from the code and the gate.
- `CHANGELOG.md` below the 0.3.5 section, `docs/credits.md` (two lines only), `docs/allow-a-page.md`, `docs/design/`, the old `docs/beta-*` pages and `docs/agent-notes/` were not read.
- Most of `src/youtube.js`, `src/kick.js`, `src/guards/popups.js`, `src/cosmetic.js`, `src/settings.js`, `src/general/cosmetic-parse.js`, `src/general/filter-options.js`, `src/feed/schema.js`, `src/feed/verify.js` and `src/threat/compile.js` were not read line by line.
- Most of the 121 test files in `test/` were not read. A statement "no guard found" means: not found by the searches of this session.
- The reference search for the `docs/` folders covered eight file types. Links from the GitHub release pages or from other sites were not checked.
- `scripts/privacy-check.py` was not run on this document.
- An independent check of this document read the cited lines again with `grep -n`. It corrected line numbers, counts and reference results. It did not measure again each function length in the M8 table; it measured eight of them.
- The four UNVERIFIED items in M11 and the storage values in H1 come from comments, `CHANGELOG.md` and `TODO.md` only.
- The byte comparison of the duplicate card folders used one hash for each folder. `docs/safe` was compared with `docs/cards/safe` by file names only.
