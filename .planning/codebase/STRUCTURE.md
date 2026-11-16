# Directory and file structure

Analysis date: 2026-11-16
Commit: 5cd4ab6 (version 0.3.6)

This document tells you where each file is, what its function is, and where to add new code.
"Generated", "vendored" and "packed data" files must not be edited by hand (`CONVENTIONS.md` sections 8 and 9).

## 1. Top-level layout

| Path | Purpose | In the release zip |
|---|---|---|
| `manifest.json` | Chrome Manifest V3 definition. | Yes |
| `src/` | All extension code and packed data. | Yes (all files but one, see section 5) |
| `icons/` | 9 PNG icons and 2 SVG sources. | PNG files only |
| `scripts/` | Maintainer tools. See `STACK.md` section 6. | No |
| `test/` | 133 Deno test files and 26 fixture files. See `TESTING.md`. | No |
| `docs/` | Documents, images and the review record. See section 4. | No |
| `.github/workflows/` | GitHub Actions. See `INTEGRATIONS.md` section 8. | No |
| `.planning/codebase/` | This codebase map. | No |
| Root files | `README.md`, `CHANGELOG.md`, `TODO.md`, `HANDOFF.md`, `CLAUDE.md`, `LICENSE`, `.gitignore`, `.gitattributes` | No |

## 2. `src/` inventory

The column "Context" uses these words: SW (service worker), CS-n (content script entry n, see `ARCHITECTURE.md` section 2), POPUP, SETTINGS, DNR (static ruleset), FETCH (read with `fetch(chrome.runtime.getURL(...))`), NONE (packed, but no code loads it).

### `src/` (top level)

| File | Context | Purpose |
|---|---|---|
| `general-background.js` | SW (worker file) | Icon state, DNR write queue, settings sync, alarms, message handler, dependencies for the list engine and the feed. |
| `general-settings.js` | SW | Shared storage key names and helpers (`GeneralSettings`). |
| `cosmetic.js` | CS-7 | Hides leftover ad boxes on ordinary sites. |
| `cosmetic-hide.css` | FETCH | Bundled generic hide selectors (fallback sheet). |
| `youtube.js` | CS-4 | YouTube ad removal in the page world and the stuck-start watchdog. |
| `youtube-ads.css` | CS-3 (CSS) | Hides YouTube feed ad tiles and one toast. |
| `kick.js` | CS-5 | Kick in-stream ad skip. Frozen. |
| `twitch-directory-ads.js` | CS-6 | Hides the Twitch directory banner and ad cards. |
| `popup.html`, `popup.js`, `popup.css` | POPUP | The toolbar popup. It gets the feature registry from the worker with `siteInfo`. |
| `settings.html`, `settings.js` | SETTINGS | Feature switches, per-site list, allow-domain box, feed status. The page has its own `<style>` block. |
| `LICENSE-EasyList.txt` | NONE | Licence note for the EasyList data. |

### `src/general/` (filter list engine)

| File | Context | Purpose |
|---|---|---|
| `update.js` | SW | List refresh engine: sources, download, parse, dynamic DNR rules (`GeneralAdblockUpdate`). |
| `filter-options.js` | SW | Converts filter options to DNR conditions (`GeneralFilterOptions`). The packer and `scripts/build-threat-rules.mjs` use it too. |
| `cosmetic-parse.js` | SW, CS-7 | Parses hide rules and builds page CSS (`GeneralCosmeticParse`). `scripts/pack-cosmetic.mjs` uses it too. |
| `never-block-captcha.js` | SW | Generated. Captcha host suffixes that no tier can block. |

### `src/settings/`, `src/guards/`, `src/threat/`

| File | Context | Purpose |
|---|---|---|
| `settings/features.js` | SW, SETTINGS, CS-6 to CS-10 | The one feature registry (`FEATURES`) and the one stream-site list (`STREAM_SITES`). |
| `settings/flags.js` | CS-8, CS-9, CS-10 | Gives feature switches to page-world scripts through a private `MessagePort`. |
| `guards/clipboard.js` | CS-11 | Feature `guardClipboard`: stops pages that copy shell commands. |
| `guards/popups.js` | CS-11 | Feature `guardPopups` (default off): blocks pop-ups without a user gesture. Contains one generated data block (`POPUP-PSL` markers). |
| `threat/compile.js` | SW, SETTINGS | Makes threat block rules at priority 2,000,010. Holds `THREAT_LISTS`. |
| `threat/protected-hosts.js` | SW | The one list of hosts that a threat rule must not match. |
| `threat/psl.js` | SW, SETTINGS | Generated. Public Suffix List subset and platform lists. |

### `src/feed/` (signed threat feed, dormant)

| File | Context | Purpose |
|---|---|---|
| `config.js`, `keys.js` | SW | Feed origin and pinned public keys. Both are empty. |
| `canonical.js` | SW | Size limits and the signature file format. |
| `schema.js` | SW | Strict schema of feed format 1. |
| `verify.js` | SW | Signature check, then parse, then schema. |
| `compile.js` | SW | Feed document to DNR session rules. |
| `client.js` | SW | Fetch, verify and apply the feed. |

### `src/rules/` (packed data)

Do not read the large JSON files in full. `general-network.json` has 5,168,730 bytes on one line.

| File | Context | Purpose |
|---|---|---|
| `general-network.json` | DNR (`general`), FETCH | Static list block rules and the stream-site allow rules. |
| `threat-network.json` | DNR (`threat`), FETCH | Static threat block rules. |
| `ubo-youtube-network.json` | DNR (`ubo-youtube`) | Generated. YouTube rules from the uBlock Origin filters. |
| `threat-snapshot.json` | FETCH | Threat host snapshot in feed format. Used only when the feed is configured. |
| `cosmetic-rules.json` | FETCH | Bundled hide rules. |
| `packed-cross.json` | FETCH | Cross-list exception and cancel data. |
| `dnr-merge-meta.json` | FETCH | Rule counts and id ranges of the merge. |
| `meta.json`, `threat-meta.json` | NONE | Source URLs, hashes and counts of the list pack and the threat build. |
| `cosmetic-sample.json` | NONE | Sample of generic hide rules. No code reads it. |
| `never-block-captcha.json` | Build tools only | Hand-written. The one list of captcha host suffixes. Not in the zip. |
| `LICENSES.md`, `README.md` | NONE | Generated by the packer. List licences, and a short table of the artifacts. |
| `CREDIT-EasyList.txt` | NONE | Credit for the EasyList data. |

### `src/vendor/` (code from other projects)

| File | Context | Purpose |
|---|---|---|
| `video-swap-new.user.js` | CS-1 | Vendored and frozen. TwitchAdSolutions userscript, a byte-for-byte copy. |
| `ubo-youtube.js` | CS-2 | Generated. uBlock Origin scriptlets for YouTube, MAIN world. |
| `ubo-youtube-isolated.js`, `ubo-youtube.css` | CS-3 | Generated. The ISOLATED part and plain hide rules of the same sync. |
| `ubo-youtube-meta.json` | NONE | Generated. Commits used, ported filters and skipped filters. |
| `README.md` | NONE | Source and rule for the Twitch userscript. The update script and two tests read it. |
| `LICENSE-TwitchAdSolutions`, `LICENSE-uBlock.md`, `LICENSE-uBlock-GPLv3.txt` | NONE | Licence texts. |

## 3. `icons/`

`icons/icon{16,48,128}.png` are the extension icons. The `-working` files are the default toolbar icon. The `-off` files are the off state.
`scripts/build-icons.mjs` renders all nine files from `icons/source/gecko.svg` and `gecko-16.svg`. The SVG sources are not in the zip.

## 4. `docs/`

| Group | Content |
|---|---|
| Current user documents | `how-it-works.md`, `allow-a-page.md`, `permissions-and-privacy.md`, `threat-tier.md`, `credits.md` |
| Current owner documents | `UPDATING-DEPENDENCIES.md`, `feed-setup.md`, `STORE-REVIEW-NOTES.md`, `youtube-expire-window.md` |
| `design/` | `DESIGN-RULES.md`, `README.md`, images, `rejected/`, `screenshots/`. Tests refer to it. |
| `review-2026-11-16/` | Record of the 0.3.6 code review: `PLAN.md`, `RESULTS.md`, `findings.json`, `repros/`. |
| `proposals/` | `kick-0.3.5-fixes.patch`: Kick corrections that are not applied, because `src/kick.js` is frozen. |

## 5. What goes into the release zip

`scripts/pack-zip.sh` makes `adgecko-<version>.zip`. The zip can hold only `manifest.json`, `src/` and `icons/` paths.
The file list is derived, not kept by hand. `scripts/lib/package_files.py` adds these paths:

1. `manifest.json`, and each path that the manifest names: the worker, content script `js` and `css`, rulesets, popup, options page, icons.
2. Each string argument of `importScripts(...)` in the worker.
3. Each `<script src>`, `<link href>` and `<img src>` target in the extension pages.
4. Each `src/...` or `icons/...` path that is a string literal in a packed JavaScript file, to closure.
5. `EXTRA_REQUIRED`: the licence and credit files and `src/vendor/README.md`.
6. `EXTRA_OPTIONAL`, if the file exists: `src/rules/README.md`, `meta.json`, `threat-meta.json`, `cosmetic-sample.json`, `src/vendor/ubo-youtube-meta.json`.

At this commit the list has 64 paths (7,862,441 bytes): `manifest.json`, 9 PNG icons and 54 `src/` files. The gate cap is 8,000,000 bytes.
The only tracked `src/` file that is not in the list is `src/rules/never-block-captcha.json`.
After the pack, the script makes sure that the zip holds exactly the derived list, with the same bytes as the checkout.
The gate has a second, hand-kept control: the `REQUIRED` array and the `ALLOWED_RE` pattern. `test/packaging.test.js` compares them with the derived list.

## 6. Where to add new code

UNVERIFIED: no change and test run proved these steps. They come from the structure of the files.

### A new feature switch

1. Add one entry to `FEATURES` in `src/settings/features.js`: `id`, `label`, `layer`, `default`, `apply`, `perSite`, `sites`. Optional keys: `keepOnAllow`, `available`, `scripts`.
2. Do not add markup to the settings page. `src/settings.js` makes the list from `F.FEATURES`. Do not add the registry to the popup. It gets the features from the worker.
3. For a `dnr` feature, add the rule logic to the worker or to `src/general/update.js`.
4. For a `main` feature, read the switch from the port of `src/settings/flags.js`, and add the id to `PAGE_FLAGS` there. Use `src/guards/popups.js` as the model.
5. For an `isolated` feature, call `GeckoFeatures.resolve(...)` in the content script. Use `src/twitch-directory-ads.js` as the model.
6. Add a test. `test/settings.test.js` and `test/settings-page.test.js` are the related tests.

### A new filter list

1. Add the source to `SOURCES` in `src/general/update.js` and to `SOURCES` in `scripts/pack-filter-lists.py` (with `license`, `role` and `priority`).
2. If the host is new: add it to `LIST_HOSTS` in `src/general/update.js`, to `host_permissions` in `manifest.json`, and to `LIST_HOSTS` and the URL host list in `scripts/release-gate.sh`. Update `docs/permissions-and-privacy.md`.
3. For a threat list, also add the name to `THREAT_LISTS` in `src/threat/compile.js`.
4. For a list with hide rules, also change `COSMETIC_LISTS` in `scripts/pack-cosmetic.mjs` and in `scripts/pack-filter-lists.py`.
5. Run `scripts/pack-filter-lists.py` to write the files in `src/rules/` again.
6. Read `scripts/lib/curben_check.py` and `docs/threat-tier.md` before you add a malware or phishing source. Some sources are refused.
7. Think about the storage quota first (`CONCERNS.md`, H1).

### A new content script

1. Put the file in `src/`, or in `src/guards/` for a page guard on ordinary sites.
2. Add an entry to `content_scripts` in `manifest.json`. Set `world: "MAIN"` only if the script must be in the page world.
3. For an ordinary-site script, copy the `exclude_matches` list of CS-7. It must agree with `STREAM_SITES`.
4. For an ISOLATED script that reads switches, put `src/settings/features.js` first in the `js` list.
5. Add the path to `REQUIRED` and to `ALLOWED_RE` in `scripts/release-gate.sh`, and give the file its permitted `chrome.*` namespaces in gate section 4.
6. Do not change `scripts/lib/package_files.py`. It finds the file from the manifest.
7. Obey the page-world rules in `CONVENTIONS.md` section 6.

### A new worker module

1. Write a classic script that sets one global on `self`. Use the form of `src/feed/config.js`. Do not use ES module syntax.
2. Put the file in the applicable folder: `src/general/`, `src/threat/`, `src/feed/` or `src/settings/`.
3. Add the path to the `importScripts` call in `src/general-background.js`, after the files that it needs. Use a string literal.
4. Add the path to `REQUIRED` and to `ALLOWED_RE` in `scripts/release-gate.sh`.
5. If the settings page also needs the module, add a `<script>` tag to `src/settings.html` before `settings.js`.

### A new test

See `TESTING.md` section 11.
