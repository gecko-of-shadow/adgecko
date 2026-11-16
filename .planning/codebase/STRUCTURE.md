# Directory and file structure

Analysis date: 2026-11-16
Commit: `b01e6a5` (output of `git rev-parse --short HEAD`)

## 1. How to read this document

This document is an inventory. It tells you where each file is and what its function is.
Line counts come from `wc -l`. This tool counts end-of-line characters. A one-line file without a last end-of-line character shows 0.
The word UNVERIFIED marks a statement about runtime behaviour that comes only from a comment or a document.
No test was run. The extension was not loaded.

The column "Origin" uses these words:

| Word | Meaning |
|------|---------|
| hand-written | A person or an agent writes and edits the file directly. |
| generated | A script in `scripts/` writes the file. Do not edit it. |
| vendored | The file is a copy from a different project. Do not edit it. |
| packed data | A script writes the file from downloaded filter lists. Do not edit it. |
| licence text | The file holds a licence or a credit. |

## 2. Top-level layout

The repository has 418 tracked files (`git ls-files`).

| Path | Tracked files | Purpose | In the release zip |
|------|---------------|---------|--------------------|
| `manifest.json` | 1 | Chrome Manifest V3 definition. | Yes |
| `src/` | 59 | All extension code and packed data. | Yes (58 of 59 files) |
| `icons/` | 11 | 9 PNG icons and 2 SVG sources. | PNG files only |
| `scripts/` | 23 | Maintainer tools (Deno, Node, Python, Bash). | No |
| `test/` | 145 | 121 Deno test files and 24 fixture files. | No |
| `docs/` | 169 | Documents and images. | No |
| `.github/workflows/` | 4 | GitHub Actions workflows. | No |
| Root files | 6 | Readme, changelog, licence, to-do list, git settings. | No |
| `.planning/codebase/` | not tracked | This codebase map. | No |

There is no build step and no package manifest for a package manager.
Git ignores `*.zip`, `scripts/.dnr-cache/` and `scripts/.list-cache/` (`.gitignore`).
The two cache directories hold packer work files. They are not in the repository.

## 3. Repository root files

| File | Lines | Origin | Purpose |
|------|-------|--------|---------|
| `manifest.json` | 325 | hand-written | Permissions, service worker, 3 static rulesets, 11 content script entries, popup, settings page. |
| `README.md` | 113 | hand-written | User document: features, install, use, privacy, troubleshooting, development. |
| `CHANGELOG.md` | 399 | hand-written | Changes for each version, newest first. The release workflow copies one section into the release notes. |
| `TODO.md` | 42 | hand-written | Project status and next steps. |
| `LICENSE` | 705 | licence text | Licence of the project. |
| `.gitignore` | 8 | hand-written | Ignores zip files, the two packer caches, Python cache files, two operating-system files and `.playwright-mcp/`. |
| `.gitattributes` | 7 | hand-written | Forces LF line ends. Marks PNG, ICO and ZIP files as binary. A comment says that a test compares generated files byte for byte. |

## 4. `src/` inventory

### 4.1 Load contexts

Each `src/` file runs in one or more of these contexts.

| Short name | Meaning | Source of the fact |
|------------|---------|--------------------|
| SW | Service worker. `src/general-background.js` is the worker file. It loads 16 files with `importScripts`. | `manifest.json` (`background`), `src/general-background.js:7` |
| CS-n | Content script entry number n in `manifest.json` (see 4.2). | `manifest.json` (`content_scripts`) |
| POPUP | `src/popup.html`, the toolbar popup. | `manifest.json` (`action.default_popup`) |
| SETTINGS | `src/settings.html`, the options page in a tab. | `manifest.json` (`options_ui`) |
| DNR | Chrome reads the file as a static ruleset. | `manifest.json` (`declarative_net_request`) |
| FETCH | Extension code gets the file with `fetch(chrome.runtime.getURL(...))`. | Line numbers in the tables below |
| NONE | No manifest entry, `importScripts` call or HTML page loads the file. | `scripts/lib/package_files.py:36-58` |

The `importScripts` call is at `src/general-background.js:7-8`. Paths are relative to `src/`. The order is:
`settings/features.js`, `general-settings.js`, `general/filter-options.js`, `general/never-block-captcha.js`, `threat/psl.js`, `threat/protected-hosts.js`, `threat/compile.js`, `general/update.js`, `general/cosmetic-parse.js`, `feed/config.js`, `feed/keys.js`, `feed/canonical.js`, `feed/schema.js`, `feed/verify.js`, `feed/compile.js`, `feed/client.js`.

`src/popup.html` loads `popup.css` and `popup.js` (`src/popup.html:7`, `src/popup.html:55`). It also shows `icons/icon48-working.png` (`src/popup.html:12`).
`src/settings.html` loads `settings/features.js`, `threat/psl.js`, `threat/compile.js` and `settings.js`, in this order (`src/settings.html:112-115`).
`src/settings.html` does not load `popup.css`. It has its own `<style>` block (`src/settings.html:7-56`).

### 4.2 Content script entries in `manifest.json`

The entries are numbered in file order. All entries use `run_at: document_start`.
An entry without a `world` key runs in the ISOLATED world. That is the Chrome default (not verified in this session).

| Entry | Sites | World | Frames | Files |
|-------|-------|-------|--------|-------|
| CS-1 | Twitch | MAIN | all | `src/vendor/video-swap-new.user.js` |
| CS-2 | YouTube | MAIN | top | `src/vendor/ubo-youtube.js` |
| CS-3 | YouTube | ISOLATED | top | `src/vendor/ubo-youtube-isolated.js`, CSS: `src/vendor/ubo-youtube.css`, `src/youtube-ads.css` |
| CS-4 | YouTube | MAIN | top | `src/youtube.js` |
| CS-5 | Kick | MAIN | all | `src/kick.js` |
| CS-6 | Twitch | ISOLATED | top | `src/settings/features.js`, `src/twitch-directory-ads.js` |
| CS-7 | Ordinary sites | ISOLATED | all | `src/settings/features.js`, `src/general/cosmetic-parse.js`, `src/cosmetic.js` |
| CS-8 | YouTube family and Twitch | ISOLATED | top | `src/settings/features.js`, `src/settings/flags.js` |
| CS-9 | Kick | ISOLATED | all | `src/settings/features.js`, `src/settings/flags.js` |
| CS-10 | Ordinary sites | ISOLATED | all, also `about:blank` frames | `src/settings/features.js`, `src/settings/flags.js` |
| CS-11 | Ordinary sites | MAIN | all, also `about:blank` frames | `src/guards/clipboard.js`, `src/guards/popups.js` |

"Ordinary sites" means `http://*/*` and `https://*/*` with an `exclude_matches` list of 34 stream-site patterns.
The 34 patterns come from 17 hosts in `STREAM_SITES` (`src/settings/features.js:25-29`), two patterns for each host.
`streamExcludeMatches()` makes the patterns (`src/settings/features.js:69-73`). A comment there says that `test/settings.test.js` compares them with the manifest.
CS-10 and CS-11 also set `match_about_blank` and `match_origin_as_fallback`.

### 4.3 `src/` (top level)

| File | Lines | Origin | Context | Purpose |
|------|-------|--------|---------|---------|
| `src/general-background.js` | 1215 | hand-written | SW (worker file) | Icon state, DNR write queue, settings sync, refresh alarm, message handler, list and threat rule dependencies. |
| `src/general-settings.js` | 75 | hand-written | SW | Shared storage key names and helpers (`self.GeneralSettings`). |
| `src/general-exclude-hosts.js` | 116 | hand-written | NONE | Stream host lists for DNR exclusion rules. Packed as a dead module (`scripts/lib/package_files.py:44-45`). `test/dnr.test.js:4` imports it as text. `scripts/merge-dnr-rules.py:29` keeps a copy of its lists. |
| `src/cosmetic.js` | 273 | hand-written | CS-7 | Hides leftover ad boxes on ordinary sites. |
| `src/cosmetic-hide.css` | 4214 | packed data (origin UNVERIFIED) | FETCH (path at `src/cosmetic.js:9`, fetch at `src/cosmetic.js:110`, `src/general-background.js:1171`) | Generic hide selectors. The header says "Generated". No script in `scripts/` writes it. `scripts/pack-cosmetic.mjs:95` reads it. |
| `src/youtube.js` | 2216 | hand-written | CS-4 | YouTube ad removal in the page world and the stuck-start watchdog. |
| `src/youtube-ads.css` | 45 | hand-written | CS-3 (CSS) | Hides YouTube feed ad tiles and one toast. |
| `src/kick.js` | 769 | hand-written | CS-5 | Kick in-stream ad skip. The release gate freezes this file (`scripts/release-gate.sh:147-150`). |
| `src/twitch-directory-ads.js` | 152 | hand-written | CS-6 | Hides Twitch directory banner and ad cards. |
| `src/popup.html` | 57 | hand-written | POPUP | Popup markup. |
| `src/popup.js` | 640 | hand-written | POPUP | Popup logic. It gets the feature registry from the worker with a `siteInfo` message. |
| `src/popup.css` | 242 | hand-written | POPUP | Style sheet for the popup. The settings page has its own `<style>` block with the same themes (`src/settings.html:8`). |
| `src/settings.html` | 117 | hand-written | SETTINGS | Settings page markup and its style block. |
| `src/settings.js` | 323 | hand-written | SETTINGS | Feature switches, per-site list, allow-domain box, feed status. |
| `src/LICENSE-EasyList.txt` | 11 | licence text | NONE | Licence note for the EasyList data. |

### 4.4 `src/general/` (filter list engine)

| File | Lines | Origin | Context | Purpose |
|------|-------|--------|---------|---------|
| `src/general/update.js` | 1344 | hand-written | SW | List refresh engine: sources, download, parse, dynamic DNR rules (`self.GeneralAdblockUpdate`). |
| `src/general/filter-options.js` | 447 | hand-written | SW | Converts filter options to DNR conditions (`self.GeneralFilterOptions`). The packer reads its table as JSON. `scripts/build-threat-rules.mjs:24` imports it. |
| `src/general/cosmetic-parse.js` | 472 | hand-written | SW, CS-7 | Parses hide rules and builds page CSS (`self.GeneralCosmeticParse`). `scripts/pack-cosmetic.mjs` uses it too. |
| `src/general/never-block-captcha.js` | 9 | generated | SW | Captcha host suffixes that no tier can block. Written by `scripts/pack-filter-lists.py --never-block-captcha-js`. |
| `src/general/cosmetic.js` | 75 | hand-written | NONE | Old cosmetic gate. Dead module, packed until an owner decision (`scripts/lib/package_files.py:54-58`). |
| `src/general/exclusions.js` | 133 | hand-written | NONE | Old exclusion host logic. Dead module, packed. |
| `src/general/toggles.js` | 113 | hand-written | NONE | Old toggle logic. Dead module, packed. |

A text search found these files that name the dead modules or `src/general-exclude-hosts.js`: `test/dnr.test.js`, `test/exclusions.test.js`, `test/general-cosmetic-contract.test.js`, `test/no-background-fetch.test.js`, `test/toggles.test.js`, `test/fixtures/stream-hosts.txt`, `scripts/merge-dnr-rules.py`, `scripts/pack-filter-lists.py`, `scripts/release-gate.sh`, `scripts/lib/package_files.py`.

### 4.5 `src/settings/` (feature registry)

| File | Lines | Origin | Context | Purpose |
|------|-------|--------|---------|---------|
| `src/settings/features.js` | 205 | hand-written | SW, SETTINGS, CS-6, CS-7, CS-8, CS-9, CS-10 | The one feature registry (`FEATURES`, line 39) and the one stream-site list (`STREAM_SITES`, line 25). |
| `src/settings/flags.js` | 143 | hand-written | CS-8, CS-9, CS-10 | Gives feature switches to page-world scripts through a private `MessagePort` (UNVERIFIED, from the file header). |

### 4.6 `src/guards/` (page guards)

| File | Lines | Origin | Context | Purpose |
|------|-------|--------|---------|---------|
| `src/guards/clipboard.js` | 712 | hand-written | CS-11 | Feature `guardClipboard`: stops pages that copy shell commands (UNVERIFIED). |
| `src/guards/popups.js` | 337 | hand-written, with one generated block | CS-11 | Feature `guardPopups` (default off): blocks pop-ups without a user gesture (UNVERIFIED). `scripts/build-psl-subset.mjs:246-252` writes the data between the `POPUP-PSL` markers. |

### 4.7 `src/threat/` (threat tier)

| File | Lines | Origin | Context | Purpose |
|------|-------|--------|---------|---------|
| `src/threat/compile.js` | 144 | hand-written | SW, SETTINGS | Makes threat block rules at priority 2,000,010. Holds `THREAT_LISTS` (line 18). |
| `src/threat/protected-hosts.js` | 100 | hand-written | SW | The one list of hosts that a threat rule must not match. |
| `src/threat/psl.js` | 105 | generated | SW, SETTINGS | Public Suffix List subset. Written by `scripts/build-psl-subset.mjs`. |

### 4.8 `src/feed/` (signed threat feed, dormant)

The feed client does nothing while `FEED_ORIGIN` and `FEED_KEYS` are empty (`src/feed/config.js:8`, `src/feed/keys.js:10`). Both are empty in this commit.

| File | Lines | Origin | Context | Purpose |
|------|-------|--------|---------|---------|
| `src/feed/config.js` | 12 | hand-written | SW | Feed origin and paths. Empty origin. |
| `src/feed/keys.js` | 13 | hand-written | SW | Pinned public keys. Empty. |
| `src/feed/canonical.js` | 73 | hand-written | SW | Size limits and the signature file format. |
| `src/feed/schema.js` | 199 | hand-written | SW | Strict schema of feed format 1. |
| `src/feed/verify.js` | 64 | hand-written | SW | Signature check, then parse, then schema. |
| `src/feed/compile.js` | 49 | hand-written | SW | Feed document to DNR session rules (ids 700001 to 704500). |
| `src/feed/client.js` | 315 | hand-written | SW | Fetch, verify and apply the feed. |

### 4.9 `src/rules/` (packed data)

Do not read the large JSON files in full. `general-network.json` has 5,168,730 bytes on one line.

| File | Lines | Bytes | Origin | Context | Purpose |
|------|-------|-------|--------|---------|---------|
| `src/rules/general-network.json` | 0 | 5168730 | packed data | DNR (ruleset `general`), FETCH (`src/general-background.js:631`) | Static block rules and stream-site allow rules. Written by `scripts/merge-dnr-rules.py:305`. |
| `src/rules/threat-network.json` | 1 | 365721 | packed data | DNR (ruleset `threat`), FETCH (`src/general-background.js:638`) | Static threat block rules. Written by `scripts/build-threat-rules.mjs:101`. |
| `src/rules/ubo-youtube-network.json` | 73 | 1169 | generated | DNR (ruleset `ubo-youtube`) | YouTube DNR rules from the uBlock Origin filters. Written by `scripts/sync-ubo-youtube.mjs`. |
| `src/rules/threat-snapshot.json` | 1 | 333354 | packed data | FETCH (`src/general-background.js:391`) | Threat host snapshot in feed format. Written by `scripts/build-threat-rules.mjs:117`. |
| `src/rules/cosmetic-rules.json` | 0 | 804416 | packed data | FETCH (`src/general-background.js:650`) | Bundled hide rules. Written by `scripts/pack-cosmetic.mjs`. |
| `src/rules/packed-cross.json` | 1 | 60306 | packed data | FETCH (`src/general-background.js:634`) | Cross-list exception and cancel data. Written by `scripts/pack-filter-lists.py:953`. |
| `src/rules/dnr-merge-meta.json` | 35 | 784 | generated | FETCH (`src/general-background.js:632`) | Rule counts and id ranges of the merge. Written by `scripts/merge-dnr-rules.py:322`. |
| `src/rules/meta.json` | 156 | 4634 | generated | NONE (packed, optional) | Source URLs, hashes and counts of the list pack. Written by `scripts/pack-filter-lists.py:1269`. |
| `src/rules/threat-meta.json` | 79 | 1747 | generated | NONE (packed, optional) | Counts and rejected hosts of the threat build. Written by `scripts/build-threat-rules.mjs:118`. |
| `src/rules/cosmetic-sample.json` | 8006 | 172666 | generated | NONE (packed, optional) | Sample of 2000 generic hide rules. Written by `scripts/pack-filter-lists.py:1282`. |
| `src/rules/never-block-captcha.json` | 6 | 711 | hand-written | Build tools only | The one list of captcha host suffixes. Not in the zip. Read by `scripts/pack-filter-lists.py:145`, `scripts/merge-dnr-rules.py:95` and `scripts/lib/youtube-local-patches.mjs:3`. |
| `src/rules/LICENSES.md` | 95 | 5136 | generated | NONE (packed) | List licences. `write_licenses` at `scripts/pack-filter-lists.py:1075`. |
| `src/rules/README.md` | 12 | 458 | generated | NONE (packed, optional) | Short table of the artifacts. Written at `scripts/pack-filter-lists.py:1299`. |
| `src/rules/CREDIT-EasyList.txt` | 16 | 697 | licence text | NONE | Credit for the EasyList data. |

A JSON parse in this session gave these rule counts: `general-network.json` 2856, `threat-network.json` 199, `ubo-youtube-network.json` 4.
`src/rules/dnr-merge-meta.json` gives the same count for the `general` ruleset: 3 allow rules, 2852 block rules and 1 YouTube rule.

### 4.10 `src/vendor/` (code from other projects)

| File | Lines | Origin | Context | Purpose |
|------|-------|--------|---------|---------|
| `src/vendor/video-swap-new.user.js` | 985 | vendored | CS-1 | TwitchAdSolutions userscript 1.55, a byte-for-byte copy. The pin is in `scripts/vendor-pins.json`. |
| `src/vendor/ubo-youtube.js` | 2021 | generated | CS-2 | uBlock Origin 1.75.0 scriptlets for YouTube, MAIN world. Written by `scripts/sync-ubo-youtube.mjs`. |
| `src/vendor/ubo-youtube-isolated.js` | 373 | generated | CS-3 | Same source, ISOLATED world part. |
| `src/vendor/ubo-youtube.css` | 5 | generated | CS-3 (CSS) | Plain hide rules from the same sync. |
| `src/vendor/ubo-youtube-meta.json` | 166 | generated | NONE (packed, optional) | Commits used, ported filters and skipped filters. |
| `src/vendor/README.md` | 10 | hand-written | NONE | Source and rule for the Twitch userscript. |
| `src/vendor/LICENSE-TwitchAdSolutions` | 21 | licence text | NONE | MIT licence of the Twitch userscript. |
| `src/vendor/LICENSE-uBlock.md` | 16 | licence text | NONE | Licence note for the uBlock Origin code. |
| `src/vendor/LICENSE-uBlock-GPLv3.txt` | 674 | licence text | NONE | GPLv3 text. |

## 5. `icons/`

| Path | Files | Origin | Purpose |
|------|-------|--------|---------|
| `icons/icon{16,48,128}.png` | 3 | generated | Extension icons (`manifest.json` `icons`). |
| `icons/icon{16,48,128}-working.png` | 3 | generated | Toolbar icon, default state (`manifest.json` `action.default_icon`). |
| `icons/icon{16,48,128}-off.png` | 3 | generated | Toolbar icon, off state (`src/general-background.js:24-28`). |
| `icons/source/gecko.svg`, `icons/source/gecko-16.svg` | 2 | hand-written | SVG sources. `scripts/build-icons.mjs` renders the PNG files from them. Not in the zip. |

## 6. `scripts/` inventory

All files are hand-written, with one exception: `scripts/vendor-pins.json`.
The column "Runtime" comes from the first line or the usage comment of each file.

| File | Lines | Runtime | Purpose |
|------|-------|---------|---------|
| `scripts/pack-filter-lists.py` | 1362 | Python 3 | Downloads the filter lists and packs the DNR artifacts in `src/rules/`. It runs the next three scripts. |
| `scripts/merge-dnr-rules.py` | 339 | Python 3 | Merges stream-site allow rules and list block rules into `src/rules/general-network.json`. |
| `scripts/pack-cosmetic.mjs` | 106 | Deno | Builds `src/rules/cosmetic-rules.json` from the list cache. Offline. |
| `scripts/build-threat-rules.mjs` | 119 | Deno | Builds `threat-network.json`, `threat-snapshot.json` and `threat-meta.json` from the list cache. Offline. |
| `scripts/build-psl-subset.mjs` | 253 | Deno | Builds `src/threat/psl.js` from a local Public Suffix List file. Also updates one data block in `src/guards/popups.js`. Offline. |
| `scripts/sync-ubo-youtube.mjs` | 337 | Deno | Downloads uBlock Origin filters and scriptlets. Writes the four `ubo-youtube*` files and the meta file. |
| `scripts/update-twitch-vendor.mjs` | 191 | Deno | Replaces the Twitch userscript from upstream and writes `scripts/vendor-pins.json`. |
| `scripts/vendor-pins.json` | 14 | data, generated | Commit, version and SHA-256 of the Twitch userscript. |
| `scripts/pack-zip.sh` | 76 | Bash | Packs the release zip from the derived file list. |
| `scripts/release-gate.sh` | 806 | Bash | Release checks on the checkout or on a zip. Needs Deno, Python 3 and ripgrep. |
| `scripts/release-notes.py` | 42 | Python 3 | Prints one version section of `CHANGELOG.md`. |
| `scripts/privacy-check.py` | 683 | Python 3 | Scans a diff, changed files and commits for forbidden strings. |
| `scripts/feed-keygen.mjs` | 42 | Deno | Makes an Ed25519 key pair for the signed feed. |
| `scripts/feed-sign.mjs` | 39 | Deno | Signs a feed file or a kill document. |
| `scripts/build-icons.mjs` | 79 | Node | Renders the PNG icons from `icons/source/`. It uses `scripts/lib/chrome-shot.mjs` when `CHROME_PATH` is set. |
| `scripts/bench-youtube.mjs` | 323 | Node | YouTube page-load benchmark with Puppeteer. |

### `scripts/lib/`

| File | Lines | Runtime | Purpose |
|------|-------|---------|---------|
| `scripts/lib/package_files.py` | 219 | Python 3 | The one derived list of package files. Can also check a zip. |
| `scripts/lib/curben_check.py` | 250 | Python 3 | Checks that only one approved list of one upstream project is used. |
| `scripts/lib/feed-tools.mjs` | 83 | Deno | Shared key and signature helpers for the two feed scripts. |
| `scripts/lib/twitch-vendor.mjs` | 187 | Deno | Pure helpers for `scripts/update-twitch-vendor.mjs`. |
| `scripts/lib/youtube-local-patches.mjs` | 46 | Deno | Local YouTube patches that the sync applies after each build. |
| `scripts/lib/youtube-expire-window.mjs` | 78 | Deno | Local change to one upstream YouTube DNR rule (the link expiry window). |
| `scripts/lib/chrome-shot.mjs` | 127 | Node 22 | Renders HTML to PNG with a local Chrome. Used by `scripts/build-icons.mjs`. |

### Packer chain

`scripts/pack-filter-lists.py` is the entry point for a list repack.
It calls `scripts/merge-dnr-rules.py` (line 1276), `scripts/pack-cosmetic.mjs` (lines 1147 and 1155) and `scripts/build-threat-rules.mjs` (line 1344).
The option `--never-block-captcha-js` writes only `src/general/never-block-captcha.js` (line 1168).
The packer writes block batches to `scripts/.dnr-cache/general-network.blocks.json` (line 1222). The merger reads that file.
The packer keeps downloaded lists in `scripts/.list-cache/` (line 22). The two Deno scripts read that cache.

## 7. `.github/workflows/`

| File | Lines | Trigger | Purpose |
|------|-------|---------|---------|
| `.github/workflows/checks.yml` | 116 | Pull request, push to `main` | Three jobs: `tests` (Deno tests), `privacy` (`scripts/privacy-check.py`), `release-gate` (pack the zip, then the gate on the checkout and on the zip). |
| `.github/workflows/release.yml` | 89 | Manual, `main` only | Checks the version, makes notes, packs, runs the gate, then creates the tag and the GitHub release with the zip. |
| `.github/workflows/ubo-youtube-drift.yml` | 49 | Monday 06:00 UTC, manual | Runs `scripts/sync-ubo-youtube.mjs` and fails if the four shipped YouTube files change. |
| `.github/workflows/refresh-release-notes.yml` | 14 | Manual | Retired. It prints one message only. |

All four files are hand-written. Actions are pinned to full commit SHAs (`.github/workflows/checks.yml:12-23`).
The test command is `deno test --no-lock --allow-read --allow-run --allow-env test/` (`.github/workflows/checks.yml:46`).
The workflows install Deno v2.9.8 (`.github/workflows/checks.yml:38`).

## 8. `test/` summary

`test/` has 121 files with the name `*.test.js` and 24 files in `test/fixtures/`. All test files are in one directory.
The 145 files have 17,667 lines in total. All are hand-written.
Tests use `Deno.test`. They import `src/` files as a side effect or as text (`with { type: "text" }`).

### Groups with a name prefix

| Prefix | Files | Meaning |
|--------|-------|---------|
| `nightly-*` | 38 | One file for each bug that the 0.3.5 bug hunt found. The changelog gives 38 bugs (`CHANGELOG.md:26`). The name is `nightly-<area>-<number>-<short text>`. |
| `final-*` | 12 | Tests from the final review of 0.3.5. The changelog says that this review found 10 bugs (`CHANGELOG.md:26`). 9 file names have item numbers from 0 to 9. 3 file names have no number. |
| `wave2-*` | 6 | "Wave 2" tests in three groups: `lists`, `perf` and `ux`, 2 files each (`test/wave2-ux-popup.test.js:1`). |
| `pr12-*` | 1 | A test from the review of pull request 12. |

Areas in `nightly-*`: `cosmetic` 6, `feed` 1, `guards` 8, `manifest-scripts` 3, `site-scripts` 5, `threat` 4, `ui` 6, `worker-refresh` 5.
Areas in `final-*`: `lists` 6, `upgrade` 2, `chrome-utf8` 1, `clipboard` 1, `dnr-fields` 1, `storage-budget` 1.

### Tests named by subject (64 files)

| Subject | Files | Test files |
|---------|-------|------------|
| YouTube | 14 | `youtube`, `youtube-sim`, `youtube-layers`, `youtube-decoy`, `youtube-decoy-nav`, `youtube-error-flash`, `youtube-fallback`, `ubo-youtube`, `ubo-youtube-edge`, `ubo-rpnt-payload`, `stall`, `stall-decoy`, `race`, `stealth` |
| Twitch vendor script | 7 | `bug`, `page`, `swap`, `playlist`, `fixtures`, `memory`, `reload` |
| Twitch and Kick, other | 3 | `twitch-directory-ads`, `kick`, `vendor-pin` |
| Lists, DNR and packer | 13 | `dnr`, `dnr-queue`, `filter-options`, `packer-options`, `list-guard`, `list-refresh`, `meta-counts`, `navigation-scope`, `exclusions`, `hcaptcha-never-block`, `imasdk-never-block`, `no-openphish`, `toggles` |
| Cosmetic | 3 | `cosmetic`, `cosmetic-filters`, `general-cosmetic-contract` |
| Threat and feed | 4 | `threat-tier`, `psl`, `feed-core`, `feed-client` |
| Worker | 5 | `background-message`, `general-race`, `worker-restart`, `storage-alarm`, `no-background-fetch` |
| Popup and settings | 8 | `art-rules`, `popup-general`, `popup-design`, `popup-allow-page`, `settings`, `settings-page`, `contrast`, `icons` |
| Guards and hardening | 3 | `guards`, `hardening`, `stream-hygiene` |
| Package and repository | 4 | `packaging`, `license`, `privacy-generic`, `privacy-mask` |

Each name in the third column has the suffix `.test.js`. The groups come from the file names. For 15 files with unclear names, the group comes from the import lines.

### `test/fixtures/` (24 files)

| Kind | Files |
|------|-------|
| Fake Chrome and helpers | `fake-chrome-worker.js` (loads the real worker with a fake Chrome), `dnr-matcher.js`, `png-reader.js`, `memory-storage.mjs`, `source-opts.mjs`, `main-source.mjs` |
| YouTube harness modules | `youtube-sim.mjs`, `youtube-clock-run.mjs`, `youtube-decoy-run.mjs`, `youtube-layers-run.mjs`, `ubo-youtube-run.mjs`, `ubo-youtube-edge.mjs` |
| Data | 4 Twitch `.m3u8` playlists, 2 YouTube JSON files, `filter-options-cases.json`, `merge-scope-cases.json`, `stream-hosts.txt` |
| List cache sample | `threat-cache-mismatch/` with 3 list text files |

## 9. `docs/` summary

`docs/` has 169 tracked files: 125 PNG, 15 JPG, 28 Markdown and 1 patch file.

| Group | Files | Content |
|-------|-------|---------|
| Current technical documents | 7 | `how-it-works.md`, `permissions-and-privacy.md`, `threat-tier.md`, `feed-setup.md`, `UPDATING-DEPENDENCIES.md`, `youtube-expire-window.md`, `allow-a-page.md` |
| Other current documents | 2 | `credits.md`, `STORE-REVIEW-NOTES.md` |
| `docs/design/` | 44 | `DESIGN-RULES.md`, `README.md`, images, `rejected/` and `screenshots/` (with its own `README.md`). |
| Old release pages | 8 | `beta-0.2.5-release.md` to `beta-0.2.12-release.md` |
| `docs/release-notes/` | 3 | Notes for versions 0.2.3, 0.2.12 and 0.2.16. |
| Image card folders | 85 | `cards/`, `cards2/`, `cards-main/`, `cards-beta/`, `cards-release/` (10 files each) and five `cards-beta-0.2.x/` folders (7 files each). |
| Loose images and image folders | 14 | `install/` 6, `safe/` 2, `icon-preview/` 2, and 4 images in `docs/`. |
| Old one-off notes | 5 | `README-backup-2026-10-24.md`, `chat-2026-10-11.md`, `efficiency-check-2026-10-11.md`, `agent-notes/` (2 files). |
| `docs/proposals/` | 1 | `kick-0.3.5-fixes.patch`: Kick fixes that are not applied. `src/kick.js` is frozen (`TODO.md`). |

`TODO.md` says that the old one-off files, the `beta-0.2.x-release.md` pages and the `cards-*` folders can move to an archive or be removed. No decision is recorded.

## 10. What goes into the release zip

`scripts/pack-zip.sh` makes `adgecko-<version>.zip`. The version comes from `manifest.json` (`scripts/pack-zip.sh:14-15`).
The zip can hold only `manifest.json`, `src/` and `icons/` paths (`scripts/pack-zip.sh:37-42`).
`docs/`, `test/`, `scripts/` and the root documents are not in the zip.

The file list is derived, not kept by hand. `scripts/lib/package_files.py` adds these paths:

1. `manifest.json`.
2. The service worker, all content script `js` and `css` paths, the ruleset paths, the popup, the options page and all icons from the manifest (lines 109-133).
3. Each string argument of `importScripts(...)` in the worker (lines 135-141). An argument that is not a string literal is an error.
4. Each `<script src>`, `<link href>` and `<img src>` target in the extension pages (lines 143-151).
5. Each `src/...` or `icons/...` path that is a string literal in a packed JavaScript file, to closure (lines 153-169).
6. `EXTRA_REQUIRED`: licence and credit files `src/vendor/README.md` and `src/general-exclude-hosts.js` (lines 36-46 and 171-172).
7. `EXTRA_OPTIONAL`, if the file exists: `src/rules/README.md`, `meta.json`, `threat-meta.json`, `cosmetic-sample.json`, `src/vendor/ubo-youtube-meta.json` and the three dead modules in `src/general/` (lines 47-58 and 173-175).

In this session the tool printed 68 paths for this commit: `manifest.json`, 9 PNG icons and 58 `src/` files.
The only tracked `src/` file that is not in the list is `src/rules/never-block-captcha.json`.
`icons/source/` is not in the list.

After the pack, the script checks that the zip holds exactly the derived list (`scripts/pack-zip.sh:71-75`).
`scripts/release-gate.sh` has a second, hand-kept control: the `REQUIRED` array (lines 81-140) and the `ALLOWED_RE` pattern (line 144).
A comment at `scripts/release-gate.sh:142-143` says that `test/packaging.test.js` compares `ALLOWED_RE` with the derived list.

## 11. Where to add new code

These steps come from the structure of the files. No step was proven by a test run (UNVERIFIED).

### A new feature switch

1. Add one entry to `FEATURES` in `src/settings/features.js:39-53`. Give `id`, `label`, `layer`, `default`, `apply`, `perSite` and `sites`.
   The optional keys are `keepOnAllow` and `available` (`src/settings/features.js:50-52`).
2. Add `scripts: [...]` to the entry if a content script implements the feature.
3. Do not add markup to the settings page for the switch. `src/settings.js:66` makes the list from `F.FEATURES`.
4. Do not add the registry to the popup. `src/popup.js` gets it from the worker (`siteInfo`, `src/general-background.js:1038`).
5. For a `dnr` feature, add the rule logic to the worker (`src/general-background.js`) or to `src/general/update.js`.
6. For a `main` feature, read the switch from the port that `src/settings/flags.js` supplies. Use `src/guards/popups.js` as the model.
7. For an `isolated` feature, call `GeckoFeatures.resolve(...)` in the content script. Use `src/twitch-directory-ads.js` as the model.
8. Add a test in `test/`. `test/settings.test.js` and `test/settings-page.test.js` are the related tests.

### A new filter list

1. Add the source to `SOURCES` in `src/general/update.js:69-92` (runtime refresh).
2. Add the same source to `SOURCES` in `scripts/pack-filter-lists.py:31` (packed rules), with `license`, `role` and `priority`.
3. Add the host to `LIST_HOSTS` in `src/general/update.js:93`, if the host is new.
4. Add the host pattern to `host_permissions` in `manifest.json`, if the host is new.
5. Change `LIST_HOSTS` in `scripts/release-gate.sh:311` and the host list at `scripts/release-gate.sh:620-631` to agree.
6. For a threat list, also add the name to `THREAT_LISTS` in `src/threat/compile.js:18`.
7. For a list with hide rules, also change `COSMETIC_LISTS` in `scripts/pack-cosmetic.mjs:20` and `scripts/pack-filter-lists.py:1138`.
8. Run `scripts/pack-filter-lists.py` to write the files in `src/rules/` again. Do not edit those files by hand.
9. Read `scripts/lib/curben_check.py` and `docs/threat-tier.md` before you add a malware or phishing source. Some sources are refused.

### A new content script

1. Put the file in `src/`, or in `src/guards/` for a page guard on ordinary sites.
2. Add an entry to `content_scripts` in `manifest.json`. Set `world: "MAIN"` only if the script must be in the page world.
3. For an ordinary-site script, copy the `exclude_matches` list of CS-7. It must agree with `STREAM_SITES`.
4. For an ISOLATED script that reads switches, put `src/settings/features.js` first in the `js` list.
5. Add the path to `REQUIRED` and to `ALLOWED_RE` in `scripts/release-gate.sh:81-144`.
6. Do not change `scripts/lib/package_files.py`. It finds the file from the manifest.
7. Do not use `chrome.*` in stream playback files. The header of `scripts/release-gate.sh` says that the gate refuses it.
   The gate applies the same check to `src/kick.js` and the two guard files (`scripts/release-gate.sh:684-686`).
8. Do not edit `src/vendor/*`, `src/kick.js` or the generated files. Change the generator script or the upstream pin.

### A new worker module

1. Write a classic script that sets one global on `self`. Use the form of `src/feed/config.js` (an immediately-called function with `root`).
2. Do not use ES module syntax. The worker is a classic worker that uses `importScripts` (`src/feed/canonical.js:2-3`).
3. Put the file in the applicable folder: `src/general/` (lists), `src/threat/`, `src/feed/` or `src/settings/`.
4. Add the path to the `importScripts` call at `src/general-background.js:7-8`. Put it after the files that it needs.
5. Use a string literal for the path. A different argument makes the package tool fail (`scripts/lib/package_files.py:91-92`).
6. Add the path to `REQUIRED` and to `ALLOWED_RE` in `scripts/release-gate.sh`.
7. If the settings page also needs the module, add a `<script>` tag to `src/settings.html` before `settings.js`.

### A new test

1. Add `test/<subject>.test.js`. Use `Deno.test(...)`. All test files are in `test/`, not in subfolders.
2. Import pure modules as a side effect, then read the global. Example: `test/nightly-ui-0-a-child-s-own-override-hides-the-parent-.test.js:5-7`.
3. Import a script as text when it needs a fake page or a fake Chrome. Example: `test/wave2-ux-popup.test.js:5-9`.
4. Use `test/fixtures/fake-chrome-worker.js` to run the real service worker with a fake Chrome.
5. Use `test/fixtures/dnr-matcher.js` to evaluate DNR rules.
6. Put shared data and harness modules in `test/fixtures/`.
7. The prefixes `nightly-`, `final-`, `wave2-` and `pr12-` are records of past reviews. Use a subject name for a new test, unless the owner gives a prefix.
8. Two tests need the `PRIVACY_PATTERNS` secret. They show as ignored without it (`.github/workflows/checks.yml:40-42`).

## Checked and not checked

### Checked in this session (read from the files)

- `git rev-parse --short HEAD`, `git ls-files` counts for each top-level path, and `git status`.
- `wc -l` for each tracked file in `src/`, `scripts/`, `.github/workflows/` and the repository root. Byte sizes of `src/rules/` files from `ls -l`.
- `manifest.json`, in full. All content script entries, worlds, frames and file lists.
- `src/general-background.js`: lines 1-30, the `importScripts` call, the `getURL` fetch lines and the message type lines.
- `src/settings/features.js`: lines 14-80. The line numbers of `STREAM_SITES`, `FEATURES` and `streamExcludeMatches()`.
- `src/general/update.js`: lines 60-100 and the positions of `SOURCES`, `LIST_HOSTS` and `THREAT_LISTS` uses.
- The first 8 to 20 lines of each `.js`, `.mjs`, `.py` and `.sh` file in `src/` (not `src/vendor/video-swap-new.user.js`) and `scripts/`.
- `src/popup.html` and `src/settings.html`: the `<script>`, `<link>`, `<img>` and `<style>` lines.
- `src/feed/config.js`, `src/feed/keys.js`, `src/rules/README.md`, `src/vendor/README.md`, `src/rules/dnr-merge-meta.json`, `scripts/vendor-pins.json`, in full.
- Rule counts of the three ruleset files, the count in `src/rules/cosmetic-sample.json` and the top-level keys of `src/vendor/ubo-youtube-meta.json`, with a JSON parse.
- `scripts/lib/package_files.py` and `scripts/pack-zip.sh`, in full. The output of `package_files.py --root .` (68 paths, exit status 0) and its difference from the tracked files.
- `scripts/release-gate.sh`: lines 1-40, 140-152, 596-632, 676-690 and the section titles.
- `scripts/pack-filter-lists.py`: lines 28-48 and each line that this document cites. `scripts/merge-dnr-rules.py`, `scripts/build-threat-rules.mjs`, `scripts/sync-ubo-youtube.mjs` and `scripts/build-psl-subset.mjs`: the output-path lines.
- The four workflow files, in full.
- The names of all files in `test/` and `docs/`, and the counts for each group. The first lines of 3 test files. The `src/` paths that 21 test files name.
- A text search for the names of the dead modules in `src/`, `scripts/`, `test/`, `docs/` and the root documents.
- `TODO.md` in full, the headings of `CHANGELOG.md` and its line 26, and the headings of `README.md`.
- `.gitignore` and `.gitattributes`, in full.

### Not checked

- No test was run. Deno is not installed in this environment.
- The extension was not loaded in a browser. All runtime behaviour is UNVERIFIED.
- `scripts/pack-zip.sh` and `scripts/release-gate.sh` were not run. The zip content is known only from the derived list.
- The bodies of most `src/` and `scripts/` files were not read in full. Purposes come from file headers.
- The bodies of most test files were not read. The subject groups in section 8 come from file names and from the paths that the files name.
- The large JSON files in `src/rules/` were not read as text. Only their rule counts were measured.
- The documents in `docs/` were not read. Section 9 comes from file names.
- The image files in `docs/` and `icons/` were not opened.
- The default world of a content script entry without a `world` key was not checked against Chrome documentation.
- The comparison of `exclude_matches` with `STREAM_SITES` by `test/settings.test.js` was not checked. The claim comes from a comment.
- The comparison of `ALLOWED_RE` with the derived list by `test/packaging.test.js` was not checked. The claim comes from a comment.
- The steps in section 11 were not proven by a change and a test run.
- The origin of `src/cosmetic-hide.css` is not clear. Its header says "Generated", but a search of `scripts/` found no writer.
