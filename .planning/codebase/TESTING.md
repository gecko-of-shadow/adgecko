# Testing

Analysis date: 2026-11-16
Commit: b01e6a5

This document tells you how the tests of Adgecko 0.3.5 work.
All statements come from files that were read. No test was run for this document.
Statements about test results are UNVERIFIED.

## 1. Test runner and command

The test runner is the built-in Deno test runner (`Deno.test`).
There is no `deno.json`, no lock file and no package manifest in the repository root.
CI pins Deno to `v2.9.8` (`.github/workflows/checks.yml:38`).

The exact command is the same in `README.md:99`, `docs/UPDATING-DEPENDENCIES.md:19`, `.github/workflows/checks.yml:46` and `scripts/release-gate.sh:739`:

```
deno test --no-lock --allow-read --allow-run --allow-env test/
```

| Flag | Why the tests need it |
|---|---|
| `--no-lock` | The repository has no lock file. |
| `--allow-read` | Tests read source files, rule files, icons and fixtures from disk. |
| `--allow-run` | Tests start `python3`, `bash`, `git` and child `deno` processes (`Deno.Command`). |
| `--allow-env` | Tests read `PRIVACY_PATTERNS`, `GITHUB_ACTIONS`, `PATH`, `SYSTEMROOT`; fixtures read `SCENARIO`, `LAYERS`, `UBO_VARIANT`, `UBO_OPTS`, `YT_SRC`. |

The command gives no network permission and no write permission.
Child processes that a test starts do not have these limits.
Four test files start a child `deno run -A --location <YouTube URL>` process (`test/ubo-youtube.test.js:15`, `test/ubo-youtube-edge.test.js:9`, `test/youtube-layers.test.js:8`, `test/youtube-decoy-nav.test.js:9`).
`test/youtube-decoy-nav.test.js` starts a second child process for `youtube-clock-run.mjs` (line 18).

Two test files import `assert` from `jsr:@std/assert@1`: `test/nightly-manifest-scripts-1-the-ads-twitch-tv-carve-out-in-the-merge.test.js` and `test/nightly-threat-1-regional-path-style-s3-endpoints-4-label.test.js`.
Deno must download this module or have it in its cache. UNVERIFIED: the effect on a machine with no network access.

The release gate needs `deno`, `python3` and `rg` (ripgrep), and `unzip` for `--zip` (`scripts/release-gate.sh:44`, `:53`).

## 2. How tests load source code

The extension has no build step and its source files are not ES modules.
Thus the tests cannot import functions from `src/` directly. They use these methods:

| Method | Use | Example |
|---|---|---|
| Text import + `new Function` | The test imports a source file as text (`with { type: "text" }`). It appends `return <installer>;` and runs the text with `new Function`. Fake globals are the function parameters. | `test/final-storage-budget.test.js:15-19` gets `installGeneralAdblockUpdate` from `src/general/update.js`. |
| Side-effect import | The test imports a source file that sets a global object (`import "../src/general/filter-options.js"`). | `test/nightly-worker-refresh-1-an-offline-refresh-is-recorded-as-a-succ.test.js:1-2` |
| JSON import | The test imports `manifest.json` or a packed rule file (`with { type: "json" }`). | `test/nightly-manifest-scripts-1-the-ads-twitch-tv-carve-out-in-the-merge.test.js:6` |
| Source text assertion | The test checks that the source text includes or does not include a string. | `test/bug.test.js:7-13` |
| Python child process | The test runs a Python snippet that imports a packer script from `scripts/`. A helper tries `python3`, then `python`. On Windows it tries `py -3`, `python`, then `python3`. | `test/nightly-manifest-scripts-1-the-ads-twitch-tv-carve-out-in-the-merge.test.js:11-24` |
| Deno child process | The test runs a fixture `.mjs` file in a new process with `--location` and reads the printed result. | `test/youtube-layers.test.js:6-8` |
| Worker model | The test calls `loadWorker()` from `test/fixtures/fake-chrome-worker.js`. | See section 5. |

Counts from `grep -l` on `test/*.test.js`: 95 files use a text import, 85 files use `new Function`, 12 files use the worker model.

The most frequent static imports, by number of test files: `src/general/never-block-captcha.js` (38), `src/general/filter-options.js` (30), `src/general/update.js` (29), `manifest.json` (28), `src/threat/psl.js` (26), `src/settings/features.js` (24), `test/fixtures/main-source.mjs` (22), `src/threat/protected-hosts.js` (21), `src/youtube.js` (19) and `src/rules/general-network.json` (19).

The MAIN-world files (`src/youtube.js`, `src/kick.js`, `src/guards/*.js`) have one IIFE wrapper.
Tests remove the wrapper with `unwrapMain()` before they use `new Function` (`test/fixtures/main-source.mjs:1-19`).

`src/youtube.js` and the uBO bundle do not read options from `localStorage`.
Test harnesses write options into the source text with `withYtOpts()` and `withUboOpts()` (`test/fixtures/source-opts.mjs`).

Note: the release gate refuses `new Function` in packaged `src/` code (`scripts/release-gate.sh:594-599`). `new Function` is a test method only.

## 3. Assertion style

Most test files (114 of 121) define a local `assert(condition, label)` function that throws `new Error(label)`.
The most frequent form is one line: `function assert(c, l) { if (!c) throw new Error(l); }` (74 files).
Some files also define a local `assertEquals(actual, expected, label)` (20 files).
Only the two files in section 1 use `jsr:@std/assert@1`.

The label is the failure message. Many tests put the actual value into the label with `JSON.stringify`.
Tests are flat `Deno.test("name", fn)` calls. There are no `describe` blocks and no shared setup hooks.
The object form `Deno.test({ name, ignore, fn })` is used when a test has an `ignore` condition.
Three files switch off the Deno sanitizers (`sanitizeOps: false`, `sanitizeResources: false`): `test/final-storage-budget.test.js` (one test), `test/guards.test.js` (three tests) and `test/settings.test.js` (one test).

## 4. Fixture files in `test/fixtures/`

There are 21 files and one directory (`threat-cache-mismatch/`) with 3 files.

| File | Purpose | Used by |
|---|---|---|
| `fake-chrome-worker.js` | Model of the Chrome service-worker environment for `src/general-background.js`. See section 5. | 12 test files (section 5) |
| `dnr-matcher.js` | Small declarativeNetRequest matcher: priority, action rank (allow > allowAllRequests > block), frame inheritance, domain, type, method, `urlFilter` and `regexFilter` conditions. Its header says that two behaviours were checked in Chrome for Testing 155. | 10 test files, for example `test/threat-tier.test.js`, `test/navigation-scope.test.js` |
| `main-source.mjs` | `unwrapMain()`: removes the IIFE wrapper of MAIN-world files. | 22 test files (guards, Kick, YouTube, `test/psl.test.js`, `test/stream-hygiene.test.js`, `test/ubo-youtube.test.js`) |
| `source-opts.mjs` | `withYtOpts()` and `withUboOpts()`: write test options into source text. | `test/hardening.test.js` and 5 fixture runners |
| `memory-storage.mjs` | In-memory `localStorage` for fixture processes that run with `--location`. It prevents shared on-disk storage between parallel runs. | 4 fixture runners |
| `filter-options-cases.json` | Table of filter lines and the expected `[domain, scope key, cancel]`. The JavaScript runtime and the Python packer use the same table. | `test/filter-options.test.js` and 3 `final-lists-*` files |
| `merge-scope-cases.json` | Cases for `scopeForMerge` (runtime) and `scope_for_merge` (packer). | `test/navigation-scope.test.js` |
| `stream-hosts.txt` | Hosts that Twitch, YouTube and Kick need. No threat rule may match them. | `test/threat-tier.test.js`, `test/navigation-scope.test.js` |
| `png-reader.js` | Minimal PNG reader (8-bit RGBA, not interlaced). | `test/icons.test.js` |
| `threat-cache-mismatch/` | Three list files whose bytes differ from `src/rules/meta.json` on purpose. | `test/feed-client.test.js` |
| `twitch-live-master.m3u8` | Synthetic Twitch master playlist. | `test/fixtures.test.js` |
| `twitch-stitched-ad.m3u8` | Synthetic playlist with a stitched ad. | `test/fixtures.test.js` |
| `twitch-midroll-cue.m3u8` | Synthetic playlist with a midroll cue. | `test/fixtures.test.js` |
| `twitch-maf-ad.m3u8` | Redacted playlist with the `twitch-maf-ad` tag. All its segments are live segments. | `test/fixtures.test.js` |
| `youtube-player-ad.json` | Redacted YouTube player response with ad data. | `test/fixtures.test.js` |
| `youtube-home-sponsored.json` | Redacted YouTube home response with a sponsored item. | `test/fixtures.test.js` |
| `ubo-youtube-run.mjs` | Runs the generated uBO MAIN-world bundle under a minimal YouTube page shim and prints the prune results. | `test/ubo-youtube.test.js` |
| `ubo-youtube-edge.mjs` | Edge cases of the uBO bundle (`JSON.stringify` edit, `setTimeout` boost). `UBO_VARIANT` selects `upstream` or `double`. | `test/ubo-youtube-edge.test.js` |
| `youtube-layers-run.mjs` | Loads `src/vendor/ubo-youtube.js` and `src/youtube.js` in one realm in the order given by `LAYERS`. | `test/youtube-layers.test.js` |
| `youtube-decoy-run.mjs` | Loads the two YouTube layers and operates the resource-timing decoy watcher. `SCENARIO` selects the setup. | `test/youtube-decoy-nav.test.js` |
| `youtube-clock-run.mjs` | Runs all of `src/youtube.js` on a virtual clock and records reload times. `SCENARIO` selects the case. | `test/youtube-decoy-nav.test.js` |
| `youtube-sim.mjs` | Loads `src/youtube.js` in the test process with fake globals and a virtual clock (`load()`). | `test/youtube-sim.test.js` |

The headers of `youtube-decoy-run.mjs` and `youtube-clock-run.mjs` say that all URLs are synthetic.
The test "fixture files stay redacted" in `test/fixtures.test.js:51` checks the playlist and JSON fixtures.

## 5. The fake Chrome worker model

File: `test/fixtures/fake-chrome-worker.js` (163 lines).
`loadWorker(opts)` runs the real text of `src/general-background.js` with `new Function` (line 141).
The parameters are fake `chrome`, `importScripts`, `setTimeout`, `fetch` and `console` objects.
`opts.store` gives the initial content of `chrome.storage.local` (line 10).

What the model simulates:

| Part | Behaviour in the model | Lines |
|---|---|---|
| Callback timing | Each callback fires on a later macrotask (default delay 1 ms). `opts.jitter` makes the delay random. | 14 |
| `chrome.runtime` | Fixed extension ID (`EXT`, line 7), `lastError`, `getURL`, `getManifest` (reads the real `manifest.json`), `onMessage`, `onInstalled`. `onStartup.addListener` does nothing. | 19-28 |
| `chrome.storage.local` | `get`, `getBytesInUse`, `set`, `remove`. Size is key length plus JSON value length. `opts.quotaBytes` makes `set` fail with the message `QUOTA_BYTES quota exceeded`. `opts.setError` can fail a `set`. | 29-34, 41-67 |
| `chrome.storage.session` | `get` returns `listRefreshStarted` (true unless `opts.sessionStarted` is false). `set` stores nothing. | 68 |
| `chrome.storage.onChanged` | Listeners get the changes after each successful `set` on `local`. A `remove` sends no change. | 64, 69 |
| `declarativeNetRequest` | `getDynamicRules`, `updateDynamicRules`, `getSessionRules`, `updateSessionRules`, `updateEnabledRulesets`. Dynamic rule updates apply in call order and are atomic. A rule ID that is not unique makes the full update fail. Removal of a missing ID has no effect. `opts.updateDelay` sets the callback delay (default 5 ms). Session rule updates have no ID check. `updateEnabledRulesets` knows only `general` and `threat`. | 71-96 |
| `chrome.action` | Records `setIcon` calls. `setTitle` does nothing. | 97 |
| `chrome.alarms` | `create`, `get`, `clear`, `onAlarm`. `create` throws on an unknown key. With `opts.strictAlarms`, `persistAcrossSessions` is also an unknown key. `opts.noAlarms` removes the API. `opts.alarms` gives alarms that exist at the start (line 112). | 98-112 |
| `importScripts` | Reads each named file from `src/` and runs it with indirect `eval`. | 113-115 |
| `fetch` | Serves five packed files from `src/rules/` for extension URLs: `general-network.json`, `dnr-merge-meta.json`, `cosmetic-rules.json`, `threat-snapshot.json`, `packed-cross.json`. `opts.listFetch` supplies all other responses. Without it, the request throws `Failed to fetch`. `opts.fetchDelay` sets the delay (default 2 ms). `opts.onFetch` sees each URL. | 116-131 |
| Console | `opts.captureWarnings` collects `console.warn` calls. | 132-139 |
| Startup timer | The model replaces `setTimeout` with a function that does nothing, unless `opts.setTimeout` is given. | 140-141 |

`loadWorker()` returns `chrome`, `store`, `dnr`, `send` (a message from the popup page), `iconCalls`, `alarms`, `alarmCreates`, `fireAlarm`, `install`, `fetched`, `warnings`, `alarmListenerCount`, `bytesRead`, `resetBytes`, `peakBytes` and `totalBytes` (lines 148-153).
The `dnr` object holds `dynamic`, `session`, `staticOn`, `threatOn`, `updates`, `errors` and `gets` (line 15).
The file also exports `EXT`, `settle(ms)` (a wait, default 400 ms) and `refreshedState(SOURCES)` (a synthetic refreshed list state in the old one-key layout).

What the model does not simulate: real request matching, tabs, content-script injection, real network, service-worker stop and start by Chrome, and real storage quota accounting by Chrome.
The model is an approximation written from the documented Chrome behaviour. UNVERIFIED: that Chrome behaves the same in each case.

The 12 test files that use the model: `test/dnr-queue.test.js`, `test/feed-client.test.js`, `test/final-storage-budget.test.js`, `test/general-race.test.js`, `test/list-guard.test.js`, `test/nightly-worker-refresh-3-manual-update-lists-joins-an-in-flight-a.test.js`, `test/nightly-worker-refresh-4-per-site-allow-rules-can-overflow-their-.test.js`, `test/settings.test.js`, `test/storage-alarm.test.js`, `test/threat-tier.test.js`, `test/wave2-perf-cosmetic-index.test.js`, `test/worker-restart.test.js`.

Other tests make their own small fakes. For example, 4 test files define `fakeDeps` and 12 test files define `fakeEl` (Kick, popup and settings tests).

## 6. Test inventory and counts

`ls test/*.test.js` gives 121 test files.
`grep -c "Deno.test"` gives 770 matching lines in total.
This number is a line count. A test that is registered in a loop counts one time, and a comment line with the text counts too.
`TODO.md:9` records a run on 2026-11-14 with 766 passed, 0 failed and 8 ignored. UNVERIFIED for this commit.

### 6.1 Groups by filename prefix

| Prefix | Files | `Deno.test` lines | Meaning |
|---|---|---|---|
| `nightly-` | 38 | 75 | One file for each bug. Many headers start with "Nightly verify". See 6.2. |
| `final-` | 12 | 59 | Findings of the final review of 0.3.5 (lists, upgrade, clipboard, DNR fields, storage budget, UTF-8). The headers say "Final review (0.3.5)". |
| `wave2-` | 6 | 57 | Three groups: `lists` (2 files), `perf` (2) and `ux` (2). UNVERIFIED: the meaning of the name `wave2`. |
| `pr12-` | 1 | 3 | One cosmetic exclusion bug from a pull request. |
| `youtube*` | 7 | 80 | `src/youtube.js` behaviour. |
| `ubo-` | 3 | 30 | The uBO YouTube port in `src/vendor/`. |
| `popup-` | 3 | 35 | Popup behaviour and design rules. |
| `privacy-` | 2 | 31 | `scripts/privacy-check.py` and CI hardening. |
| No prefix (subject name) | 49 | 400 | One file for each subject. See 6.3. |

### 6.2 The `nightly-` files by area

The name pattern is `nightly-<area>-<number>-<start of the bug title>.test.js`.

| Area | Files | `Deno.test` lines | Subject |
|---|---|---|---|
| `cosmetic` | 6 (0-5) | 11 | Hide rules: exclusions, generic exceptions, IDN hosts, stale sheet load. |
| `feed` | 1 (0) | 1 | Signed feed: an unchanged feed. |
| `guards` | 8 (0-7) | 19 | Clipboard guard and popup guard in `src/guards/`. |
| `manifest-scripts` | 3 (0-2) | 9 | Packer and merger scripts: `$badfilter`, the Twitch ad host, `@@` exceptions. |
| `site-scripts` | 5 (0-4) | 11 | `src/youtube.js`, `src/youtube-ads.css` and `src/kick.js` page behaviour. |
| `threat` | 4 (0-3) | 9 | Public-suffix subset, regional S3 endpoints, IDN in "Allow this domain", captcha hosts. |
| `ui` | 6 (0-5) | 9 | Popup and settings page: allow, fix, overrides. |
| `worker-refresh` | 5 (0-4) | 6 | Service worker and list refresh. |

### 6.3 Files by subject

The number in brackets is the `Deno.test` line count.

| Subject | Files |
|---|---|
| Twitch vendor script (`src/vendor/video-swap-new.user.js`) | `bug` (3), `memory` (2), `page` (7), `playlist` (2), `reload` (4), `swap` (5), `fixtures` (7), `vendor-pin` (5) |
| Twitch directory ads | `twitch-directory-ads` (4), `stream-hygiene` (18, also Kick) |
| YouTube script (`src/youtube.js`) | `youtube` (34), `youtube-sim` (5), `youtube-decoy` (11), `youtube-decoy-nav` (9), `youtube-error-flash` (6), `youtube-fallback` (10), `youtube-layers` (5), `stall` (19), `stall-decoy` (20), `race` (2), `stealth` (2) |
| uBO YouTube port | `ubo-youtube` (18), `ubo-youtube-edge` (6), `ubo-rpnt-payload` (6) |
| Kick script (`src/kick.js`) | `kick` (13) |
| Network rules and packer | `dnr` (7), `filter-options` (9), `packer-options` (1), `navigation-scope` (14), `meta-counts` (5), `hcaptcha-never-block` (11), `imasdk-never-block` (3), `final-dnr-fields` (3), `final-lists-0` (3), `final-lists-1` (3), `final-lists-5` (1), `final-lists-6` (8), `final-lists-7` (4), `wave2-lists-network-options` (14) |
| Cosmetic filtering | `cosmetic` (8), `cosmetic-filters` (6), `general-cosmetic-contract` (5), `pr12-cosmetic-parent-child-exclusion` (3), `final-lists-2` (4), `wave2-lists-cosmetic-pack` (12), `wave2-perf-cosmetic-index` (10) |
| Service worker and list refresh | `background-message` (6), `dnr-queue` (10), `general-race` (3), `list-guard` (14), `list-refresh` (15), `storage-alarm` (16), `worker-restart` (3), `no-background-fetch` (5), `final-storage-budget` (1) |
| Settings and feature registry | `settings` (21), `settings-page` (4), `toggles` (6), `exclusions` (6), `wave2-perf-features-idempotent` (2), `wave2-ux-settings` (5), `final-upgrade-3` (4), `final-upgrade-4` (3) |
| Popup | `popup-allow-page` (22), `popup-design` (8), `popup-general` (5), `wave2-ux-popup` (14) |
| Page guards | `guards` (13), `final-clipboard-8-9-cross-realm-and-nested-copy` (24) |
| Threat tier and public-suffix list | `threat-tier` (13), `psl` (11), `no-openphish` (12) |
| Signed feed (dormant) | `feed-core` (11), `feed-client` (15) |
| Security hardening | `hardening` (8) |
| Design, art and accessibility | `art-rules` (6), `contrast` (6), `icons` (8) |
| Packaging, licence, encoding | `packaging` (4), `license` (2), `final-chrome-utf8` (1) |
| Privacy checker and CI | `privacy-generic` (28), `privacy-mask` (3) |

The short names `final-lists-N`, `final-upgrade-N` stand for the full file names in `test/`.

## 7. Ignored tests

A search for `ignore:` in `test/*.test.js` finds 10 tests.
Six tests are always ignored. Four tests are ignored only when a condition is true.

### 7.1 Always ignored (`ignore: true`)

| File and line | Test name | Reason given in the file |
|---|---|---|
| `test/nightly-manifest-scripts-1-the-ads-twitch-tv-carve-out-in-the-merge.test.js:37` | "merger: the extra tracker rule blocks the carved-out ad host edge.ads.twitch.tv" | Owner decision, not shipped in 0.3.5. A block of the Twitch ad host could break the player and was not tested live (lines 33-36). |
| Same file, `:59-61` | "a shipped rule blocks the carved-out ad host edge.ads.twitch.tv" | Same owner decision. The comment also says that the packed file `src/rules/general-network.json` was not generated again for this change (lines 56-58). |
| `test/nightly-manifest-scripts-2-every-exception-is-dropped-so-hosts-that.test.js:105-107` | "hosts un-blocked by a parent-domain or type-scoped list @@ exception are not blocked by the shipped ruleset" | Known issue, not fixed in 0.3.5. The fix needs DNR allow rules or a split of parent blocks. The file calls this too much risk for the release (lines 94-98). |
| `test/nightly-site-scripts-2-kick-a-hidden-post-roll-cover-is-never-s.test.js:25` | "kick covers: a hidden cover with no visible <video> is shown again when only its ad controls are removed" | Known issue, not fixed in 0.3.5. `src/kick.js` is a frozen playback file (gate section 1b) and Kick was not tested live. The fix is in `docs/proposals/kick-0.3.5-fixes.patch` (lines 22-24). |
| `test/nightly-site-scripts-4-kick-banner-collapse-can-permanently-hid.test.js:43` | "kick banner collapse: a cover holding <video-player> is not hidden by the banner path" | Same reason as the Kick test above (lines 40-42). |
| Same file, `:55` | "kick banner collapse: switching the kick switch off shows the collapsed box again" | Same reason (lines 52-54). |

Each of these tests describes the correct behaviour. Remove `ignore: true` when the owner approves the related change.

### 7.2 Ignored on a condition

| File and line | Test name | Condition | Reason |
|---|---|---|---|
| `test/final-storage-budget.test.js:34-36` | "storage budget: fresh-install refresh of the real lists fits the 10 MB quota with headroom" | `ignore: !haveCache` | The test needs each list in `scripts/.list-cache/<name>.txt`. CI has no cache (lines 7-10). |
| `test/packaging.test.js:87-89` | "packaging: pack-zip.sh builds a zip holding every derived file and nothing else" | `ignore: !canPack` | The test needs `zip` on the path, or the Windows system `tar.exe`. The test also needs `bash` (lines 81-86). |
| `test/privacy-generic.test.js:223-225` | "no personal machine references in code, tests or docs (L-1)" | `ignore: personalWords.length === 0` | The test needs the `PRIVACY_PATTERNS` variable (lines 11-13). |
| `test/privacy-generic.test.js:280-282` | "the design record and the art sources carry no personal name or place" | `ignore: personalWords.length === 0` | Same condition. |

## 8. Tests that need external tools, secrets or caches

| Need | Tests | Notes |
|---|---|---|
| `PRIVACY_PATTERNS` (secret) | Two tests in `test/privacy-generic.test.js` (section 7.2). | CI gives the secret to the `tests` job only on a push to `main` (`.github/workflows/checks.yml:40-46`). In all other runs the two tests show as ignored. `test/privacy-mask.test.js` sets its own test value for the child process and needs no secret. |
| `scripts/.list-cache/` | `test/final-storage-budget.test.js` | The cache directory is in `.gitignore` (line 5). The packer writes it. `test/final-lists-7-shipped-rules-honour-limits.test.js` names the cache only in a comment. |
| `zip` (or Windows `tar.exe`) and `bash` | The last test of `test/packaging.test.js` | The test builds the real zip in a temporary directory with `scripts/pack-zip.sh`, then checks it with `scripts/lib/package_files.py --check-zip`. |
| `python3` | 18 files start Python: `filter-options`, `packer-options`, `navigation-scope`, `hcaptcha-never-block`, `imasdk-never-block`, `no-openphish`, `packaging`, `psl`, `privacy-generic`, `privacy-mask`, `final-lists-0`, `final-lists-5`, `final-lists-6`, `wave2-lists-cosmetic-pack`, `wave2-lists-network-options`, `nightly-manifest-scripts-0`, `-1`, `-2`. | These tests have no ignore condition for Python. In 13 files a helper tries more than one Python name and throws "no usable Python 3". Five files start `python3` only: `no-openphish`, `packaging`, `psl`, `privacy-generic`, `privacy-mask`. |
| `git` | `test/privacy-generic.test.js`, `test/privacy-mask.test.js` | They run `git rev-parse` and `git grep` in the repository. A full git checkout is necessary. |
| Child `deno` | `ubo-youtube`, `ubo-youtube-edge`, `youtube-layers`, `youtube-decoy-nav`, `feed-client` | `feed-client` runs `scripts/feed-keygen.mjs` with the `deno` on the path (line 268) and one more Deno child (line 319). The other four files use `Deno.execPath()`. |
| Network for `jsr:` | The two files in section 1. | Only for the first download of `jsr:@std/assert@1`. |

No test needs a browser.

## 9. Tests that check documents, versions, pins or packaging

These tests do not check runtime behaviour. They can fail after an edit of a document, a version, a generated file or a workflow.

| File | What it checks |
|---|---|
| `test/vendor-pin.test.js` | The vendored Twitch file is byte for byte the pinned upstream file (`scripts/vendor-pins.json`). Each pin site agrees with the pin. Helpers of `scripts/lib/twitch-vendor.mjs`. No network. |
| `test/page.test.js`, `test/playlist.test.js`, `test/bug.test.js`, `test/reload.test.js`, `test/swap.test.js`, `test/memory.test.js` | Mostly source text of the unmodified vendor userscript, vendor provenance and the vendor licence file. |
| `test/license.test.js` | Root `LICENSE` text and copyright line; licence and brand note in `README.md`; the manifest name. |
| `test/meta-counts.test.js` | `src/rules/meta.json`, `src/rules/dnr-merge-meta.json` and `src/rules/threat-meta.json` agree with the packed rule files. The packer runs the merger after it writes the metadata. |
| `test/packaging.test.js` | The derived package list of `scripts/lib/package_files.py`; the `REQUIRED` list and `ALLOWED_RE` of `scripts/release-gate.sh` agree with it; `importScripts` takes string literals only; the real zip. |
| `test/final-chrome-utf8.test.js` | Each shipped text file passes the Chrome UTF-8 check. |
| `test/final-dnr-fields.test.js` | Each static rule obeys the DNR field limits, so Chrome does not refuse the ruleset. |
| `test/final-lists-7-shipped-rules-honour-limits.test.js` | The shipped `src/rules/general-network.json` shows the list fixes (a repack was done). |
| `test/dnr.test.js` | Ruleset ID, rule count below 30,000, stream-site exclusions in the packed rules and the manifest. |
| `test/hcaptcha-never-block.test.js` | Each layer carries the same list as `src/rules/never-block-captcha.json`. |
| `test/no-openphish.test.js`, `test/no-background-fetch.test.js` | Forbidden list sources and fetch policy, by source scan. `no-openphish` runs the same checker as gate section 2c. |
| `test/hardening.test.js` | No page-writable option channel, no web-accessible resources, diagnostic log off by default. |
| `test/icons.test.js`, `test/art-rules.test.js`, `test/contrast.test.js`, `test/popup-design.test.js` | Icon files and sizes, approved art, WCAG 2.1 contrast computed from the CSS tokens, the approved popup elements and wording. |
| `test/privacy-generic.test.js` | `scripts/privacy-check.py` functions; the text of `.github/workflows/checks.yml` (secret use, SHA pins, runner version); a retired workflow file. |
| `test/privacy-mask.test.js` | The checker masks each pattern before other output. |
| `test/ubo-youtube.test.js` (part) | Manifest wiring and provenance of the uBO port. |

Rule for agents: after a change to `manifest.json`, `scripts/release-gate.sh`, a file in `src/rules/`, a vendor file, a CSS token, popup text or `checks.yml`, expect failures in this table.

## 10. Release gate (`scripts/release-gate.sh`)

Command: `bash scripts/release-gate.sh [--expect-version X.Y.Z] [--dir PATH | --zip PATH.zip]`.
The default is the repository root. The expected version comes from that `manifest.json`.
The gate counts failures and prints `VERDICT: CLEAN` or `VERDICT: FAIL` (lines 794-801). The exit code is 0 or 1.
In `--zip` mode the gate extracts the zip to a temporary directory, uses the strict file allow-list, and does not run the Deno tests (lines 52-67, 736, 754).

| Section | Lines | What it runs |
|---|---|---|
| 1. Package allowlist + version | 152-254 | Manifest version equals the expected version. A local git tag `v<version>`, if present, has the same version. Each file in `REQUIRED` exists. In zip mode each file matches `ALLOWED_RE`. `scripts/lib/package_files.py` derives the package list; in zip mode the zip must hold exactly that list. The popup is in `src/` and `popup.html` loads only `popup.js`. Package size is not more than 8,000,000 bytes. In repository mode the size is the sum of the `REQUIRED` files only. |
| 1b. Playback files untouched | 256-301 | `src/vendor/video-swap-new.user.js` and `src/kick.js` have no content difference from `origin/main` (or `main`). No debug log files in the package. No debug section in the popup. |
| 2. Permissions + host coverage + DNR | 303-548 | Python checks of `manifest.json`: `storage` and `declarativeNetRequest` are necessary, `alarms` is permitted, and no other permission is permitted; list hosts only (plus the feed host when configured); no optional permissions; the service worker is `src/general-background.js`; the action popup is `src/popup.html`; no debug script. Twitch, YouTube and Kick content-script matches, script order, world, `run_at` and frames. The cosmetic content script excludes the stream sites. `general-network.json` is an array with unique IDs and not more than 30,000 rules. Allow rules with a priority of 9000 or more cover the stream hosts. Each ruleset is well formed and has no redirect or header rule. The enabled rulesets have not more than 30,000 rules together. |
| 2c. List source rule | 549-563 | `scripts/lib/curben_check.py`: only the one allowed URLhaus host list from `malware-filter.gitlab.io`; no phishing feed source. The same checker runs in the Deno suite. |
| 3. Dangerous APIs + identity / phone-home | 565-672 | `rg` scans of packaged JavaScript: `eval`, `innerHTML`, `document.write`, `importScripts`, identity, beacon, geolocation, WebRTC; `new Function`; secret and identity strings; tracker names in JavaScript files. Three known line shapes are permitted: `eval(workerString)` and one `innerHTML` write in the vendor userscript, and the `importScripts` call with string literals in the worker. A Python scan compares each URL in the JavaScript code (comment lines and `src/rules/` excluded) with an allow-list of hosts. |
| 4. Privileged extension API usage | 674-733 | Playback scripts (the vendor userscript, `src/youtube.js`, the two `src/vendor/ubo-youtube*.js` files), guards, `src/kick.js`, `src/threat/*`, `src/feed/*`, `src/general/update.js` and `src/general/filter-options.js` use no `chrome.*` API. Other files use only their allowed `chrome` namespaces. No `setInterval` in the worker. Only the `gecko-refresh` alarm. |
| 5. Deno tests | 735-755 | The command from section 1 with `NO_COLOR=1`. The gate fails on a non-zero exit code, on the word `FAILED`, or on "N failed" with N of 1 or more. Skipped when there is no `test/` directory. |
| 6. Fuzz smoke | 757-792 | A temporary Deno script (`deno run --no-lock`) imports the vendor userscript as text, checks three marker strings, and parses the body with `new Function`. The body is not run. Lines 790-792 print a pass line for YouTube malformed JSON. That line runs no check. |

The gate writes temporary files with fixed names to the temporary directory (for example the Deno output file in section 5).
`docs/UPDATING-DEPENDENCIES.md:12-28` gives the procedure: run the tests, run the gate, then test by hand in Chrome.

## 11. CI jobs (`.github/workflows/checks.yml`)

The workflow runs on each pull request and on each push to `main`. Its permission is `contents: read`.
All jobs use `ubuntu-24.04`. Actions are pinned to full commit SHAs (lines 12-23). Each checkout step sets `persist-credentials: false`.

| Job | Steps |
|---|---|
| `tests` | Checkout. Install Deno `v2.9.8`. Run the test command. `PRIVACY_PATTERNS` is set only on a push to `main`; on a pull request it is empty (lines 40-46). |
| `privacy` | Checkout with full history. On a pull request, take `scripts/privacy-check.py` from the base commit; on a push, use the pushed file (lines 58-71). Run `python3 -u -I` on that copy with `PRIVACY_PATTERNS`, `REQUIRE_PATTERNS`, `BASE_SHA`, `HEAD_SHA` (lines 73-83). |
| `release-gate` | Checkout with full history. Install Deno. Make sure that ripgrep is installed. Pack the zip with `scripts/pack-zip.sh`. Run the gate on the checkout. Run the gate on the zip (lines 85-116). This job has no secret. |

Result: on a push or pull request the Deno suite runs two times (job `tests` and gate section 5).

Other workflows that run checks:

- `.github/workflows/release.yml` starts by hand (`workflow_dispatch`). It packs the zip and runs the gate on the checkout and on the zip before it publishes (lines 66-77).
- `.github/workflows/ubo-youtube-drift.yml` runs `scripts/sync-ubo-youtube.mjs` each Monday at 06:00 UTC and fails on drift in the shipped YouTube files. It can also start by hand. It needs the network. It does not run the Deno suite.
- `.github/workflows/refresh-release-notes.yml` is retired. Its one step prints a message. `test/privacy-generic.test.js:6` reads its text.

## 12. Privacy check (`scripts/privacy-check.py`)

The script has 683 lines. Its docstring (lines 2-51) and `main()` (lines 618-679) give this behaviour.

What it scans:

- The diff between `BASE_SHA` and `HEAD_SHA` (added and removed lines).
- The full content of each changed file.
- Each changed file path. On a push to `main` (`REQUIRE_PATTERNS` is `true`) it also scans each path in the tree.
- Commit author names, committer names, their addresses and the commit messages in the range.
- Binary files: printable runs of 6 or more characters. Changed images: metadata (EXIF, XMP, comments, PNG text chunks other than "Software").
- With `--all`: each tracked file, and no commit scan. CI does not use `--all`.

What it looks for:

| Kind | Needs the secret | Detail |
|---|---|---|
| Forbidden personal strings | Yes | One regular expression for each line of `PRIVACY_PATTERNS`, not case-sensitive. Each text line is also tested with camelCase, underscore, hyphen and letter-digit joins split into words. |
| Obvious secrets | No | Private-key blocks, common API token shapes, JSON web tokens. |
| IP addresses | No | IPv4 and IPv6 literals outside the documentation ranges, loopback, `0.0.0.0` and broadcast. `src/rules/*.json` files skip this check. |
| E-mail addresses | No | All addresses except noreply addresses and example, test and invalid domains. |
| Home-directory paths | No | Linux, macOS and Windows home paths with a name that looks real. |
| Image metadata | No | See above. |

Rules of the script:

- If `PRIVACY_PATTERNS` is empty, the personal-string check is skipped with a warning. If `REQUIRE_PATTERNS` is `true`, the job fails.
- The marker `privacy-check: allow` on a line permits a generic value. The marker does not apply to secrets, personal strings or paths.
- In `src/rules/*.json` files, quoted lower-case host names skip the personal-string check.
- The output gives file paths and line numbers only. It does not print patterns or matches. It registers each pattern with `::add-mask::` before other output.
- The script removes the secret from its environment before other work (lines 623-625).

For agents: do not write home-directory paths, e-mail addresses, real IP addresses, tokens or names of persons in a file. This rule includes test files and documents. Tests build fake values at run time (`test/privacy-generic.test.js:1-4`).

## 13. What automated tests do not cover

- No automated test plays a real stream (`docs/UPDATING-DEPENDENCIES.md:28`).
- No test loads the extension in Chrome. All Chrome APIs are models (section 5) or local fakes.
- `TODO.md:16` says that YouTube, Twitch, Kick and a news site were not tested live for 0.3.5. `TODO.md:30` says that YouTube refused the build machine.
- The DNR matcher in `test/fixtures/dnr-matcher.js` follows the documented precedence. It is not the Chrome code.
- YouTube, Twitch and Kick tests use synthetic or redacted payloads and DOM fakes. A change of the live sites does not make them fail.
- No test downloads a real filter list. The storage budget test reads a local cache and CI ignores it.
- The six tests in section 7.1 are known gaps: the Twitch ad host, parent-domain and type-scoped `@@` exceptions, and two Kick cover problems.
- The signed feed in `src/feed/` is dormant. Its tests use keys made in memory, not a real feed server.
- `TODO.md:9` mentions one headless Chrome smoke test of the packed zip. This test is not in `test/` and is not in CI. UNVERIFIED.

Manual procedure after a change (from `docs/UPDATING-DEPENDENCIES.md:12-28`):

1. Run the test command.
2. Run `scripts/release-gate.sh`. The last line must be `VERDICT: CLEAN`.
3. Load the unpacked extension in Chrome.
4. Test the related site by hand.

## 14. How to add a test for a new bug

Use the method of the `nightly-*` files: one new file for one bug. Do not use the `nightly-` prefix for a new file.

1. The prefixes `nightly-`, `final-`, `wave2-` and `pr12-` are records of past reviews. The newest test (`test/ubo-rpnt-payload.test.js`, 2026-11-15) has a subject name.
2. Name the file `test/<subject>-<short bug title>.test.js`, unless the owner gives a prefix. Use lower-case words with hyphens. This agrees with `STRUCTURE.md`, "A new test".
3. Write a comment at the top. Tell what was wrong, the correct behaviour and the fix.
4. Import the source file as text. Use `unwrapMain()` for `src/youtube.js`, `src/kick.js` and `src/guards/*.js`.
5. Get the function with `new Function`. Give fake globals as parameters.
6. For worker bugs, use `loadWorker()` and `settle()` from `test/fixtures/fake-chrome-worker.js`.
7. For rule bugs, use `evaluate()` from `test/fixtures/dnr-matcher.js` on the packed rules.
8. For packer bugs, run a Python snippet in a child process. Copy the `runPython` helper from an existing file.
9. Add the local one-line `assert` function. Put the actual value into each label.
10. Write a test that fails before the fix and passes after the fix.
11. If the fix is not approved, keep the test with `ignore: true`. Write the reason in a comment above the test.
12. Use only synthetic hosts (for example `*.example`) and values built at run time. Do not write real personal data.
13. Run the test command, then the release gate.

Cautions:

- Do not change `src/vendor/video-swap-new.user.js` or `src/kick.js` for a fix. Gate section 1b fails when they differ from `origin/main` (or `main`).
- When a fix changes a packed file in `src/rules/`, run the packer again. The tests in section 9 compare the metadata with the files.
- When you add a shipped file, update `REQUIRED` and `ALLOWED_RE` in `scripts/release-gate.sh`. `test/packaging.test.js` compares them with the derived list.
- When you add a shared case table, put it in `test/fixtures/` so that the runtime test and the packer test read the same file.

## Checked and not checked

Checked (read from the files in this session):

- The list of `test/` and `test/fixtures/`, and the counts from `ls` and `grep -c "Deno.test"` for each file, each prefix and each `nightly-` area.
- The counts from `grep -l` for text imports, `new Function`, the worker model, `jsr:`, the local `assert` forms, `assertEquals`, the sanitizer options, `fakeDeps` and `fakeEl`.
- The number of test files for each static import path.
- `test/fixtures/fake-chrome-worker.js`, `main-source.mjs`, `memory-storage.mjs`, `source-opts.mjs` in full.
- The header lines of all other fixture files, and which test files name each fixture (by `grep`).
- The first lines of each `nightly-*` file and of 36 other test files; the test names of 15 files in section 9.
- Each `ignore` location and the comments that give the reason.
- Each `Deno.Command` and `Deno.env` location in `test/`, and each `list-cache` location in `test/` and `scripts/` (by `grep`).
- `scripts/release-gate.sh`: lines 1-302 and 549-806 in full; lines 303-548 by their section, pass, fail and comment lines.
- `.github/workflows/checks.yml` in full; the trigger, step names and run lines of `release.yml` and `ubo-youtube-drift.yml`; `refresh-release-notes.yml` in full.
- `scripts/privacy-check.py`: the docstring, the list of functions and constants, and `main()`.
- The first 25 lines of `scripts/pack-zip.sh`; `.gitignore` lines 1-8; `docs/UPDATING-DEPENDENCIES.md:10-30`; `TODO.md:5-16` and `:30`; `README.md:95-101`.
- That `deno.json`, `deno.lock` and `package.json` are not in the repository root.
- The commit ID from `git rev-parse --short HEAD`.

Not checked:

- No test was run. Deno is not installed. All pass, fail and ignore results are UNVERIFIED.
- The release gate and the privacy check were not run.
- The extension was not loaded in a browser.
- The bodies of most test files were not read. The subject of each file comes from its name, header, imports and test names.
- The exact number of tests that Deno registers was not measured. The 770 value is a `grep` line count.
- The bodies of `scripts/lib/package_files.py`, `scripts/lib/curben_check.py` and the scan functions of `scripts/privacy-check.py` were not read.
- The Python body of gate section 2 (lines 303-548) was not read line by line.
- The CI behaviour on GitHub (secrets, repository settings) was not observed.
- The statement that the fake models agree with real Chrome behaviour is UNVERIFIED.
- The meaning of the prefixes `wave2-` and `pr12-` comes from file names and one header comment only.
