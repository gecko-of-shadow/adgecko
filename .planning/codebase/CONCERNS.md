# Concerns: technical debt, risks and stale items

Analysis date: 2026-11-16
Commit: 5cd4ab6 (version 0.3.6)

This document lists the known concerns, sorted by impact. Each item gives what, evidence and a suggested action.
Open owner decisions are in `TODO.md`. This document does not repeat them.
UNVERIFIED: all behaviour in Chrome. No statement here was proven on the owner's PC.

## 1. Summary

| ID | Concern | Impact |
|---|---|---|
| H1 | Storage quota headroom is small, and CI does not measure it | High |
| H2 | Package size is 3.8 % below the release gate cap | High |
| H3 | The vendored Twitch script has an archived upstream and an `eval` call | High |
| H4 | YouTube response patching depends on upstream shapes | High |
| H5 | 0.3.6 changes behaviour in many places, and no live test was done | High |
| M1 | Stream-site host lists exist in many files | Medium |
| M2 | Six tests are always ignored | Medium |
| M3 | Legacy storage mirrors and migrations stay in the code | Medium |
| M4 | Storage key strings are repeated in several files | Medium |
| M5 | Very large files and functions | Medium |
| M6 | Release gate: hard-coded values, lines that pass with no check, old comments | Medium |
| M7 | Page-world scripts: known limits | Medium |
| M8 | The signed feed is dormant, but its code and data ship | Medium |
| M9 | Public-suffix data and hand-kept platform lists have no refresh schedule | Medium |
| L1 | A retired workflow stays in the repository | Low |
| L2 | Old documents and image folders (done: deleted) | Low |
| L3 | References to a file that is not in the repository | Low |
| L4 | Generated `src/rules/README.md` and `meta.json` hints are old | Low |
| L5 | Small duplicates and one wrong workflow comment | Low |

Section 5 lists items that were checked and are not a concern now.

## 2. High impact

### H1. Storage quota headroom is small, and CI does not measure it

- **What.** The extension stores parsed lists in `chrome.storage.local`. The quota is 10,485,760 bytes. The manifest does not request `unlimitedStorage`, and the gate forbids it.
- **Evidence.** `CHANGELOG.md` (0.3.5) gives a fresh-install peak of approximately 8.1 MB. `test/final-storage-budget.test.js` permits a peak of 9,000,000 bytes, but it is ignored without a full list cache, thus CI never runs it. Measured on 2026-11-16 for 0.3.6, with the lists downloaded at 2026-11-16 20:28 UTC (scratch repack, not committed): peak 8,155,204 bytes. That is 844,796 bytes below the test limit and 2,330,556 bytes below the quota.
- **Impact.** The upstream lists grow. If the peak goes above the quota, each refresh fails with a quota error and the lists become old. No automatic check finds the problem before a release.
- **Action.** Run `scripts/pack-filter-lists.py`, then run the budget test with the full cache before each release, and record the peak in `TODO.md`. Do not add new stored list data before a decision about an IndexedDB store.

### H2. Package size is 3.8 % below the release gate cap

- **What.** The gate fails when the package is larger than 8,000,000 bytes. On 2026-11-20 the derived package list has 63 files and 7,695,447 bytes. The headroom is 304,553 bytes. Before the removal of `cosmetic-sample.json`, the list had 64 files and 7,868,295 bytes.
- **Evidence.** `src/rules/general-network.json` is 5,168,730 bytes. `src/rules/threat-snapshot.json` (333,354 bytes) is used only when the feed is configured (M8). The gate comments record that the cap was increased two times.
- **Impact.** The next list repack can make the gate fail. A cap that moves with each release does not catch a runaway pack.
- **Action.** RESOLVED on 2026-11-20 (owner decision): `src/rules/cosmetic-sample.json` (172,666 bytes, no reader) is deleted. The packer does not write it, and it is not in the package list or in the gate. OPEN: make a decision about the snapshot. Then set the cap from the measured size plus a fixed margin.

### H3. The vendored Twitch script has an archived upstream and an `eval` call

- **What.** `src/vendor/video-swap-new.user.js` is TwitchAdSolutions video-swap-new 1.55 (upstream commit of 2026-02-26), copied byte for byte.
- **Evidence.** `docs/UPDATING-DEPENDENCIES.md` says that the upstream repository is archived. The file contains `eval(workerString)` and one `innerHTML` write. It runs in the MAIN world in all Twitch frames, and the user cannot switch it off (`twitchPlayer`, `apply: "always"`). It copies session headers of the page into its requests to Twitch. `test/twitch-playlist.test.js` records one upstream defect: the ad tracking-URL rewrite has no effect.
- **Impact.** If Twitch changes its player, no upstream correction will come. The `eval` call is a risk for a store submission (`docs/STORE-REVIEW-NOTES.md`).
- **Action.** Owner decision: stay on the archived copy, move to a maintained fork (`--repo` option of the update script), or own the code.

### H4. YouTube response patching depends on upstream shapes

- **What.** Two layers change YouTube data in the page world: the generated uBlock Origin layer and `src/youtube.js`, which replaces `fetch`, XHR methods and `JSON.parse` of the page.
- **Evidence.** The local patches in `scripts/sync-ubo-youtube.mjs` are text replacements. A patch that matches nothing gives only a warning, and the script exits with code 0. The weekly drift job only becomes red. It opens no issue. `CHANGELOG.md` records that one uAssets change already made a new local patch necessary.
- **Impact.** A YouTube change or an upstream filter change can break playback or let ads through, and a person must see the red job.
- **Action.** Make the sync exit with a non-zero code when a patch matches nothing. Do a manual YouTube test before each release. Split `src/youtube.js` only together with tests, because many tests read its source text.

### H5. 0.3.6 changes behaviour in many places, and no live test was done

- **What.** 0.3.6 has the corrections of 25 work packages. `CHANGELOG.md` says: no item was tested on the owner's PC or on live sites.
- **Evidence.** Changes that a user can see: copies on ordinary sites are plain text only, the hide rules use an adopted style sheet, each list is downloaded again one time (`PARSER_VERSION` 5), a second alarm exists, the flag channel closes earlier. Some checks ran in headless Chromium only. The 0.3.6 workflow changes did not run on GitHub before the merge.
- **Impact.** A regression on a live site (YouTube, Twitch, Kick, Gmail, a React site) is possible and no test finds it.
- **Action.** Do the manual tests in `TODO.md` before the release, and record the results. Remove the UNVERIFIED marks only after a run on the owner's PC.

## 3. Medium impact

### M1. Stream-site host lists exist in many files

`STREAM_SITES` in `src/settings/features.js` (17 hosts) is "the one list". These copies exist:

| Copy | Guard |
|---|---|
| Three `exclude_matches` blocks in `manifest.json` (kept by hand, no generator) | `test/settings.test.js`, `test/guards.test.js` |
| `NEVER_BLOCK_SUFFIXES` in `src/general/update.js` and in `scripts/pack-filter-lists.py` | `test/settings.test.js` |
| `SUFFIX` and `EXACT` in `src/threat/protected-hosts.js` | `test/settings.test.js` |
| `SITE_DOMAINS` and `VIDEO_CDN_DOMAINS` in `scripts/merge-dnr-rules.py` | `test/dnr.test.js` (its own copy of the lists) |
| Host fragments for the URL scan in `scripts/release-gate.sh` | None |
| `test/fixtures/stream-hosts.txt` | Read by two tests |

- The merger lists (6 site hosts and 7 CDN hosts) do not contain `twitchcdn.com`, `ext-twitch.tv`, `kick-streamer.com` and `kickusercontent.com`. `STREAM_SITES` contains them. The effect is UNVERIFIED.
- **Action.** Make `scripts/merge-dnr-rules.py` read the hosts from one data file, as the captcha list does.

### M2. Six tests are always ignored

- The six tests and their reasons are in `TESTING.md` section 5. Two known Kick defects stay in `src/kick.js`: a hidden cover can stay hidden, and a banner collapse can hide the player.
- `docs/proposals/kick-0.3.5-fixes.patch` applies to `src/kick.js` at this commit (`git apply --check`). After a change of `src/kick.js` it is possible that it does not apply.
- **Action.** Get the owner decisions. For each one, apply the change and remove `ignore: true`, or remove the patch and the tests and record the decision.

### M3. Legacy storage mirrors and migrations stay in the code

- The keys `generalEnabled` and `generalAllowedOrigins` are derived mirrors of `settings` and `siteOverrides`. The DNR code and the popup read them. Since 0.3.6, `src/cosmetic.js` reads them only before the migration.
- Migrations that run at each worker start: `migrateLegacy`, the old key `generalListRefresh`, `cosMeta.keys` to `cosKeys`. Each change of `PARSER_VERSION` forces a full download for all users. `RETIRED_LISTS` and `dropRetiredCosmetic` clean data of older builds.
- **Impact.** Two sources hold the same settings. A missed mirror write gives a state where the popup and the rules disagree.
- **Action.** Make the DNR code read `settings` and `siteOverrides` through `GeckoFeatures.resolve`, then remove the mirrors. Write next to each migration the version after which it can be deleted.

### M4. Storage key strings are repeated in several files

- `settings` and `siteOverrides` are literals in six files. The feed keys, `threatAllowDomains`, `uiTheme` and the list status keys are literals in two or three files each. `src/popup.js` has its own `KEYS` object, because the gate lets `popup.html` load only `popup.js`.
- **Impact.** A typing error in one file gives a silent read of `undefined`. The features then use their defaults, and no error shows.
- **Action.** Add one test that reads the source files and makes sure that each key literal is in one known list.

### M5. Very large files and functions

| File | Lines | Note |
|---|---|---|
| `src/youtube.js` | 2,256 | Two functions of approximately 1,000 and 1,230 lines |
| `scripts/pack-filter-lists.py` | 1,432 | |
| `src/general/update.js` | 1,370 | One closure |
| `src/general-background.js` | 1,248 | |
| `src/guards/clipboard.js` | 1,024 | 0.3.6 added more than 300 lines |
| `scripts/release-gate.sh` | 859 | Inline Python programs |
| `src/kick.js` | 769 | One closure, frozen |

- Duplicated logic in two languages: `convertOptions` (JavaScript) and `convert_options` (Python), with shared cases in `test/fixtures/filter-options-cases.json`.
- **Action.** Do not refactor these files without a need. If a function must change, first add behaviour tests for that part. Many tests read source text.

### M6. Release gate: hard-coded values, lines that pass with no check, old comments

| What | Impact |
|---|---|
| The Twitch conflict version is a literal (`ourTwitchAdSolutionsVersion = 23`). | The update script does not edit the gate. The owner must change the line by hand. |
| Three lines print PASS with no real check ("ad-server names permitted inside src/rules/ only", "youtube malformed JSON covered by deno suite", and the Kick video host line in section 2). | The output looks stronger than the checks are. |
| Old comments ("General-adblock beta (Phase 0)", "YouTube is the beta script", "Manual list Update (popup fetch)"). | They describe an older design. |
| Fixed file names in the system temp folder (`gate-popup.txt`, `gate-danger.txt`, `gate-deno.txt` and others). | Two gate runs at the same time on one machine can mix their results. |
| The Deno tests run two times in CI (job `tests` and gate section 5). | Longer CI time. |

- **Action.** Read the conflict version from `scripts/vendor-pins.json`. Use `mktemp` for all scratch files. Remove or change the PASS lines that do not check. Update the comments.

### M7. Page-world scripts: known limits

Five manifest entries run in the MAIN world. The page can see and change the same JavaScript world.

- A same-origin frame that the clipboard guard has not reached yet has native clipboard methods (injection-timing gap, UNVERIFIED in Chrome).
- The copy event of the context-menu Copy was not tested (UNVERIFIED).
- A page click handler in 500 ms after a selection gesture, and visible but disguised text, can still pass the "user copied it" check (`TODO.md`).
- The flag channel depends on the order of `document_start` scripts. The order was measured only in headless Chromium.
- The pop-up guard checks `window.open` only. Links and forms with `target=_blank` are out of scope.
- **Impact.** The clipboard guard gives a security promise in `README.md`. A user can think that the protection is complete.
- **Action.** Keep the limits in the file headers. Test the UNVERIFIED items in Chrome, then remove the marks.

### M8. The signed feed is dormant, but its code and data ship

- `FEED_ORIGIN` and the key tables are empty. The client returns "dormant" before a fetch. Two decisions are open (D-1, D-7).
- The seven files in `src/feed/` and `src/rules/threat-snapshot.json` (333,354 bytes) are in the package. The feature `threatFeed` is in the registry, thus the settings page shows a control for a function that does nothing (UNVERIFIED effect).
- **Action.** Make the owner decisions, or record that the feed stays off. If it stays off, think about removal of the snapshot from the package (H2).

### M9. Public-suffix data and hand-kept platform lists have no refresh schedule

- `src/threat/psl.js` is generated from the Public Suffix List of 2026-11-15. `scripts/build-psl-subset.mjs` never fetches, and no workflow runs it.
- The script holds hand-kept lists: 120 platform parents (33 of them single-service), 12 exact shared service hosts and 12 regional wildcard bases.
- **Impact.** A new public suffix or a new shared platform is not protected. One list line can then block all sites below it.
- **Action.** Add the PSL refresh to the list-repack procedure, and record the PSL version in `TODO.md`.

## 4. Low impact

### L1. A retired workflow stays in the repository

`.github/workflows/refresh-release-notes.yml` only prints one line. Its comment names v0.2.13 as "the only current release". `test/privacy-generic.test.js` reads this file, thus a deletion needs a test change and the owner's approval.

### L2. Old documents and image folders (done)

The owner approved the deletion on 2026-11-16. 95 old files (approximately 30 MB) were deleted from `docs/`: the old release pages and notes, `agent-notes/`, the `cards*` folders, `install/`, `safe/`, `icon-preview/` and four loose images. The git history keeps them. Do not rewrite history without the owner's approval.

### L3. References to a file that is not in the repository

The name `BUILD-PROGRESS` is in `src/general/filter-options.js`, `scripts/lib/package_files.py`, `test/navigation-scope.test.js`, `test/no-openphish.test.js` and `test/fixtures/dnr-matcher.js`. No tracked file has that name. Move the necessary facts into the comments.

### L4. Generated `src/rules/README.md` and `meta.json` hints are old

The packer writes `src/rules/README.md` with four files. The folder has 14 files. `manifest_hint` in `src/rules/meta.json` gives the ruleset id `general_network`. The manifest uses `general`. Correct the text in the packer, not in the generated files. These files ship in the zip, thus the correction belongs to a release.

### L5. Small duplicates and one wrong workflow comment

- Two default texts for the list status: "auto refresh after startup" (`src/general-settings.js`) and "checked every 3 hours" (`src/popup.js`).
- The header of `.github/workflows/ubo-youtube-drift.yml` says that the sync "exits non-zero when a local patch no longer finds its upstream shape". The script gives only a warning (H4).
- `src/vendor/LICENSE-uBlock.md` still shows `deno run -A` for the sync. It ships in the zip, thus it was not changed.

## 5. Checked and not a concern now

| Subject | Result |
|---|---|
| Static rule count | 3,059 enabled static rules (2,856 + 199 + 4) of the 30,000 that the gate permits |
| Dynamic rule caps in code | `MAX_LIST_RULES` 25,000, `DYNAMIC_RULE_LIMIT` 30,000, threat ids 600000 to 609999 |
| Rule metadata against rule files | The counts agree. Guard: `test/meta-counts.test.js` |
| Numbers in `docs/how-it-works.md` | They agree with `meta.json`. Guard: `test/docs-claims.test.js` |
| Frozen files against their pins | `src/kick.js` and the Twitch file agree with `scripts/frozen-pins.json`. Guard: gate section 1b, `test/release-tooling.test.js` |
| Dead modules | Removed in 0.3.6 |
| Workflow actions | Pinned to full commit ids. `persist-credentials: false` |
| Permissions | Three API permissions, no optional permissions. The gate refuses more. |
