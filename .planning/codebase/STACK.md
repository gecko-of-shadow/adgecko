# Technology stack

Analysis date: 2026-11-16
Commit: b01e6a5

This document lists the languages, runtimes, browser APIs, tools and vendored code of Adgecko 0.3.5.
Each statement gives the file that it comes from.
A statement with the mark UNVERIFIED comes only from a comment or a document. No run proved it in this analysis.

## 1. Summary

- Adgecko is a Chrome Manifest V3 extension (`manifest.json:2`). The version is 0.3.5 (`manifest.json:4`).
- The extension code is plain JavaScript, HTML, CSS and JSON in `src/`. Chrome loads the files as they are.
- There is no build step, no bundler, no transpiler, no package manager and no lockfile (section 10).
- The tools in `scripts/` use Deno, Python 3, Bash, ripgrep and zip. Two scripts use Node.js.
- The tests in `test/` are Deno tests (121 files with the name `*.test.js`).
- GitHub Actions runs the tests, a privacy scan and the release gate (`.github/workflows/checks.yml`).

## 2. Languages

| Language | Where | Use |
|---|---|---|
| JavaScript (classic scripts) | `src/**/*.js` | Service worker, content scripts, popup page, settings page. No `import` or `export` in shipped code that the worker loads; files set a global and the worker uses `importScripts` (`src/general-background.js:7`). |
| JavaScript (ES modules, `.mjs`) | `scripts/*.mjs`, `scripts/lib/*.mjs`, `test/fixtures/*.mjs` | Maintainer tools for Deno or Node.js. |
| JavaScript (Deno tests) | `test/*.test.js` | 121 test files. They use `Deno.test`, `Deno.Command`, `Deno.readTextFile` and `Deno.build.os`. |
| Python 3 | `scripts/*.py`, `scripts/lib/*.py`, inline blocks in `scripts/release-gate.sh` and the workflows | List packer, DNR merger, package file list, privacy scan, release notes. Standard library only (`scripts/pack-filter-lists.py:10-18`). |
| Bash | `scripts/pack-zip.sh`, `scripts/release-gate.sh`, `run:` steps in `.github/workflows/*.yml` | Packaging and the release gate. Both scripts set `set -euo pipefail` (`scripts/pack-zip.sh:11`, `scripts/release-gate.sh:9`). |
| HTML | `src/popup.html`, `src/settings.html` | The two extension pages. `src/popup.html:55` loads `popup.js`. `src/settings.html:112-115` loads `settings/features.js`, `threat/psl.js`, `threat/compile.js` and `settings.js`. |
| CSS | `src/popup.css`, `src/cosmetic-hide.css`, `src/youtube-ads.css`, `src/vendor/ubo-youtube.css` | Page styles and cosmetic hide sheets. `src/popup.html:7` links `popup.css`. `src/settings.html:7` has an inline `<style>` block. |
| JSON | `manifest.json`, `src/rules/*.json`, `src/vendor/ubo-youtube-meta.json`, `scripts/vendor-pins.json`, `test/fixtures/*.json` | Manifest, packed rule data, pin records, test cases. |
| YAML | `.github/workflows/*.yml` | Four workflows. |
| SVG | `icons/source/` (2 files) | Icon sources. `scripts/build-icons.mjs` makes the PNG icons from them. |
| Markdown | `README.md`, `CHANGELOG.md`, `TODO.md`, `docs/` | Documentation. |

The repository has no TypeScript file. The tracked file list (`git ls-files`) shows no `.ts` extension.

## 3. Browser runtime

### 3.1 Chrome version and manifest

- `manifest_version` is 3 (`manifest.json:2`).
- `minimum_chrome_version` is "137" (`manifest.json:5`).
- `src/feed/verify.js:2-3` says that Ed25519 in WebCrypto needs Chrome 137 or later. A search of `src/` for "137" found no other reason. UNVERIFIED.
- The manifest has no `web_accessible_resources` key and no `content_security_policy` key (`manifest.json`, all top-level keys read).
- The options page is `src/settings.html`, opened in a tab (`manifest.json:321-324`, `open_in_tab` is true).
- The toolbar popup is `src/popup.html` (`manifest.json:45-53`).

### 3.2 Service worker

- The service worker is `src/general-background.js` (`manifest.json:23-25`). It is a classic worker: the manifest sets no `"type": "module"`.
- The worker loads 16 files with one `importScripts` call (`src/general-background.js:7-8`). The order is:
  `settings/features.js`, `general-settings.js`, `general/filter-options.js`, `general/never-block-captcha.js`, `threat/psl.js`, `threat/protected-hosts.js`, `threat/compile.js`, `general/update.js`, `general/cosmetic-parse.js`, `feed/config.js`, `feed/keys.js`, `feed/canonical.js`, `feed/schema.js`, `feed/verify.js`, `feed/compile.js`, `feed/client.js`.
- The order is important. `src/general/update.js:119-121` throws an error if `general/never-block-captcha.js` did not load first.
- The worker uses no `setInterval`. The release gate refuses `setInterval` in this file (`scripts/release-gate.sh:722-723`).
- The worker serialises all declarativeNetRequest writes through one queue, `dnrExclusive` (`src/general-background.js:51-52`; the comment before it starts at line 29).

### 3.3 Content scripts and worlds

All entries use `run_at: document_start`. An entry with no `world` key runs in the ISOLATED world (Chrome default).

| # | Lines in `manifest.json` | Matches | Files | World | All frames |
|---|---|---|---|---|---|
| 0 | 60-71 | `twitch.tv` and subdomains | `src/vendor/video-swap-new.user.js` | MAIN | yes |
| 1 | 72-84 | `www.youtube.com`, `m.youtube.com`, `youtube.com` | `src/vendor/ubo-youtube.js` | MAIN | no |
| 2 | 85-100 | same three YouTube hosts | `src/vendor/ubo-youtube-isolated.js`; CSS `src/vendor/ubo-youtube.css`, `src/youtube-ads.css` | ISOLATED | no |
| 3 | 101-113 | same three YouTube hosts | `src/youtube.js` | MAIN | no |
| 4 | 114-125 | `kick.com` and subdomains | `src/kick.js` | MAIN | yes |
| 5 | 126-137 | `twitch.tv` and subdomains | `src/settings/features.js`, `src/twitch-directory-ads.js` | ISOLATED | no |
| 6 | 138-186 | `http://*/*`, `https://*/*`, with 34 `exclude_matches` for stream hosts | `src/settings/features.js`, `src/general/cosmetic-parse.js`, `src/cosmetic.js` | ISOLATED | yes |
| 7 | 187-206 | 10 patterns: YouTube hosts, `youtubekids.com`, `youtube-nocookie.com`, `twitch.tv` | `src/settings/features.js`, `src/settings/flags.js` | ISOLATED | no |
| 8 | 207-218 | `kick.com` and subdomains | `src/settings/features.js`, `src/settings/flags.js` | ISOLATED | yes |
| 9 | 219-268 | `http://*/*`, `https://*/*`, with 34 `exclude_matches` | `src/settings/features.js`, `src/settings/flags.js` | ISOLATED | yes; `match_about_blank` and `match_origin_as_fallback` are true |
| 10 | 269-319 | `http://*/*`, `https://*/*`, with 34 `exclude_matches` | `src/guards/clipboard.js`, `src/guards/popups.js` | MAIN | yes; `match_about_blank` and `match_origin_as_fallback` are true |

Notes:

- MAIN-world scripts cannot use `chrome.*`. The ISOLATED script `src/settings/flags.js` gives them their feature switches through a private `MessagePort` (`src/settings/flags.js:1-21`).
- `src/settings/features.js` can run two times in one frame (entries 6 and 9). The file keeps the first registry (`src/settings/features.js:12-18`).
- `src/settings/flags.js:17-20` says that the run order of `document_start` scripts in one task is UNVERIFIED.

### 3.4 Static rulesets

`manifest.json:26-44` declares three static declarativeNetRequest rulesets. All three are enabled by default.

| Ruleset id | File | Rule count (counted in this session) | Made by |
|---|---|---|---|
| `general` | `src/rules/general-network.json` | 2856 | `scripts/pack-filter-lists.py`, then `scripts/merge-dnr-rules.py` |
| `ubo-youtube` | `src/rules/ubo-youtube-network.json` | 4 | `scripts/sync-ubo-youtube.mjs` |
| `threat` | `src/rules/threat-network.json` | 199 | `scripts/build-threat-rules.mjs` |

The packer budget for static list rules is 28,000 (`scripts/pack-filter-lists.py:25`). Each rule holds up to 80 domains (`src/rules/meta.json`, `domains_per_rule`).

### 3.5 Web platform APIs (not `chrome.*`)

- `fetch` in the worker: list downloads and reads of packaged files (`src/general-background.js:391`, `:581-584`, `:631-638`, `:650`, `:1171`).
- `importScripts` (`src/general-background.js:7`).
- WebCrypto Ed25519: `crypto.subtle.importKey` and `crypto.subtle.verify` (`src/feed/verify.js:17`, `:31`).
- `MessageChannel` and `MessagePort` between the ISOLATED and MAIN worlds (`src/settings/flags.js:9-17`).
- Streams and `TextDecoder` to read a list body with a size limit (`src/general/update.js:39-66`).

## 4. Chrome extension APIs used in `src/`

Method: `grep` for `chrome.` in `src/**/*.js` and `src/*.html`, then a second `grep` for aliases (`dnr.`, `local.`, `area.`) in the worker.
The HTML files contain no `chrome.` text.

### 4.1 Use by file

| File | Namespace | Methods and events | Lines |
|---|---|---|---|
| `src/general-background.js` | `chrome.action` | `setIcon`, `setTitle`, `setBadgeBackgroundColor`, `setBadgeText`, `getBadgeText` | 95, 99, 1100, 1101, 1130, 1152 |
| `src/general-background.js` | `chrome.alarms` | `create`, `get`, `onAlarm.addListener` | 935, 938, 948, 959 |
| `src/general-background.js` | `chrome.declarativeNetRequest` | `updateEnabledRulesets` (119, 281, 626), `getDynamicRules` (187, 238, 621), `updateDynamicRules` (194, 245, 412, 625), `getSessionRules` (380), `updateSessionRules` (387) | see cells |
| `src/general-background.js` | `chrome.runtime` | `getManifest` (353, 656, 1026), `getURL` (391, 631-638, 650, 1171, 1185), `id` (411, 1167), `lastError`, `onInstalled.addListener` (975), `onStartup.addListener` (994), `onMessage.addListener` (1162) | see cells |
| `src/general-background.js` | `chrome.storage.local` | `get` (85, 234, 347, 472, 671, 980), `set` (485, 508), `remove` (493), `getBytesInUse` (607-613, through the alias `local`) | see cells |
| `src/general-background.js` | `chrome.storage.session` | `get`, `set` through `sessionArea()` | 1089-1091, 1108-1118, 1137-1143 |
| `src/general-background.js` | `chrome.storage.onChanged` | `addListener` | 999 |
| `src/popup.js` | `chrome.runtime` | `getManifest` (88), `sendMessage` (363), `openOptionsPage` (590, 609), `getURL` (597), `lastError` | see cells |
| `src/popup.js` | `chrome.storage.local` | `get` (326), `set` (349), `remove` (351) | see cells |
| `src/popup.js` | `chrome.tabs` | `query` (380), `sendMessage` (394), `reload` (429), `create` (597) | see cells |
| `src/settings.js` | `chrome.storage.local` | `get` (14), `set` (18) | see cells |
| `src/settings.js` | `chrome.runtime` | `sendMessage` (25), `lastError` | see cells |
| `src/settings.js` | `chrome.storage.onChanged` | `addListener` | 290 |
| `src/cosmetic.js` | `chrome.runtime` | `sendMessage` (86), `getURL` (105), `onMessage` (227), `lastError` | see cells |
| `src/cosmetic.js` | `chrome.storage` | `local.get` (183-184), `onChanged` (240) | see cells |
| `src/settings/flags.js` | `chrome.storage` | `local.get` (95), `onChanged.addListener` (124) | see cells |
| `src/settings/flags.js` | `chrome.runtime` | `onMessage.addListener` (135), `sendMessage` (56), `lastError` | see cells |
| `src/twitch-directory-ads.js` | `chrome.storage` | `local.get` (128), `onChanged.addListener` (142), `chrome.runtime.lastError` | see cells |

### 4.2 Files with no extension API

- `src/settings/features.js`, `src/general/cosmetic-parse.js` and `src/general/update.js` name `chrome.storage.local` only in comments (`src/settings/features.js:6`, `src/general/cosmetic-parse.js:416`, `src/general/update.js:87`).
- `src/feed/*.js` name `chrome.*` only in comments that say "no chrome.*" (`src/feed/verify.js:2`, `src/feed/canonical.js:2`, `src/feed/schema.js:1`).
- `grep` found no `chrome.` text in `src/youtube.js`, `src/kick.js`, `src/guards/*.js`, `src/threat/*.js`, `src/general-settings.js`, `src/general-exclude-hosts.js`, `src/general/filter-options.js`, `src/general/exclusions.js`, `src/general/toggles.js`, `src/general/cosmetic.js` and `src/vendor/*.js`.
- The worker gives its libraries the browser functions through dependency objects: `feedDeps()` (`src/general-background.js:345-393`) and `listDeps()` (`src/general-background.js:578-643`).

### 4.3 The release gate enforces this scope

`scripts/release-gate.sh:674-734` (section 4) fails the gate when a file uses a namespace outside its allow-list.

| File | Allowed namespaces |
|---|---|
| `src/general-background.js` | `runtime`, `storage`, `action`, `declarativeNetRequest`, `alarms` |
| `src/popup.js` | `runtime`, `tabs`, `storage` |
| `src/cosmetic.js`, `src/settings.js`, `src/settings/flags.js`, `src/twitch-directory-ads.js` | `runtime`, `storage` |
| `src/general-settings.js`, `src/settings/features.js`, `src/general/cosmetic-parse.js` | none |
| The four playback files (`src/vendor/video-swap-new.user.js`, `src/youtube.js`, `src/vendor/ubo-youtube.js`, `src/vendor/ubo-youtube-isolated.js`), `src/kick.js`, `src/guards/*.js`, `src/threat/*.js`, `src/feed/*.js`, `src/general/update.js`, `src/general/filter-options.js` | none (`chrome.` and `browser.` are refused) |

The gate also permits only one alarm, with the name `gecko-refresh` (`scripts/release-gate.sh:724-727`, `src/general/update.js:18`).

### 4.4 Messages

- The worker accepts runtime messages only when `message.source` is `"adgecko-general"` and the sender is this extension (`src/general-background.js:1162-1167`).
- Message types: `cosmeticCss`, `guardEvent`, `applyGeneralState`, `updateLists`, `revertLists`, `tabSignal`, `siteInfo` (`src/general-background.js:1170-1214`).
- The popup sends `{ type: "pageOrigin" }` to the top frame of the active tab (`src/popup.js:394`). `src/settings/flags.js:134-135` listens on stream hosts; `src/cosmetic.js:227` listens on other sites.

## 5. Permissions

### 5.1 API permissions

`manifest.json:7-11` requests three permissions.

| Permission | Use | Source |
|---|---|---|
| `storage` | `chrome.storage.local` and `chrome.storage.session` | section 4; `docs/permissions-and-privacy.md` |
| `declarativeNetRequest` | Three static rulesets, dynamic rules, session rules | `manifest.json:26-44`; section 4 |
| `alarms` | One alarm, `gecko-refresh`, period 180 minutes, first delay 5 to 30 minutes | `src/general/update.js:18-19`; `src/general-background.js:930-935` |

Other facts:

- `chrome.action` needs no permission; the manifest has an `action` key (`manifest.json:45`).
- The popup uses `chrome.tabs` methods, but the manifest does not request the `tabs` permission. The gate allows the `tabs` namespace for `src/popup.js` only.
- `docs/permissions-and-privacy.md` says that the manifest does not request `tabs`, `activeTab`, `scripting`, `cookies`, `history`, `webRequest`, `unlimitedStorage` or `declarativeNetRequestFeedback`. The read of `manifest.json:7-11` agrees.
- The worker tries `persistAcrossSessions: true` for the alarm and tries again without the key if Chrome refuses it (`src/general-background.js:933-938`). The related comment about Chrome 150 is UNVERIFIED.

### 5.2 Host permissions

`manifest.json:12-22` lists nine host patterns. All are for filter-list downloads (`docs/permissions-and-privacy.md`).

| Host pattern | Lists (from `src/general/update.js:69-93`) |
|---|---|
| `https://easylist.to/*` | EasyList, EasyPrivacy (primary URLs) |
| `https://pgl.yoyo.org/*` | The `pgl.yoyo.org` ad-server list |
| `https://malware-filter.gitlab.io/*` | `urlhaus_hosts` |
| `https://ublockorigin.github.io/*` | `ublock_badware`; mirrors of EasyList and EasyPrivacy |
| `https://easylist-downloads.adblockplus.org/*` | Mirrors of EasyList and EasyPrivacy |
| `https://secure.fanboy.co.nz/*` | Mirrors of EasyList and EasyPrivacy |
| `https://raw.githubusercontent.com/hagezi/dns-blocklists/*` | `hagezi_pro_mini` |
| `https://raw.githubusercontent.com/DandelionSprout/adfilt/*` | `dandelion_antimalware` |
| `https://filters.adtidy.org/extension/ublock/*` | `adguard_base` |

- The worker refuses a download from a URL that is not a list URL (`src/general-background.js:581-584`).
- A dynamic allow rule (id 990001, priority 3,000,000) keeps block rules away from the list downloads (`src/general/update.js:94-107`).
- The signed feed is dormant. `FEED_ORIGIN` is an empty string and the key tables are empty (`src/feed/config.js:8`, `src/feed/keys.js:10-11`). A feed host would be one more host permission (`src/feed/config.js:1-6`).

## 6. Tool runtimes for `scripts/`, `test/` and CI

| Tool | Version | Where the version comes from | Used by |
|---|---|---|---|
| Deno | v2.9.8 | `deno-version` in `.github/workflows/checks.yml`, `release.yml`, `ubo-youtube-drift.yml` | Tests, `scripts/*.mjs` (most), release gate sections 5 and 6 |
| Python 3 | No pin. The runner image supplies it. | `python3` calls in the workflows and scripts | `scripts/*.py`, `scripts/lib/*.py`, inline blocks |
| Bash | No pin | Shebang `#!/usr/bin/env bash` | `scripts/pack-zip.sh`, `scripts/release-gate.sh` |
| ripgrep (`rg`) | No pin. CI installs it only if it is absent. | `.github/workflows/checks.yml` step "Ensure ripgrep" | `scripts/release-gate.sh:44-50` (the gate stops if `deno`, `python3` or `rg` is absent) |
| `zip` (Info-ZIP) | No pin | `scripts/pack-zip.sh:62-63` | Packaging. Windows `tar.exe` is the fallback (section 11). |
| `unzip` | No pin | `scripts/release-gate.sh:53` | Release gate with `--zip` |
| `git` | No pin | `scripts/sync-ubo-youtube.mjs:32`, `scripts/privacy-check.py:248`, `scripts/release-gate.sh:256-262` | uBO sync, privacy scan, gate section 1b |
| Node.js | 22 or later for `scripts/lib/chrome-shot.mjs:9` | Comments in the scripts | `scripts/build-icons.mjs`, `scripts/bench-youtube.mjs` (not in CI) |
| GitHub runner | `ubuntu-24.04` | All four workflows | CI |
| `gh` CLI | No pin | `.github/workflows/release.yml` | Tag check and release creation |

Pinned actions (`.github/workflows/checks.yml:15-16`, `:31`, `:36`): `actions/checkout` v7.0.1 at commit `3d3c42e5aac5ba805825da76410c181273ba90b1`, and `denoland/setup-deno` v2.0.5 at commit `22d081ff2d3a40755e97629de92e3bcbfa7cf2ed`.

Test command (`.github/workflows/checks.yml`, job `tests`): `deno test --no-lock --allow-read --allow-run --allow-env test/`.

Remote module: two test files import `jsr:@std/assert@1` (`test/nightly-threat-1-regional-path-style-s3-endpoints-4-label.test.js:6`, `test/nightly-manifest-scripts-1-the-ads-twitch-tv-carve-out-in-the-merge.test.js:5`). This is the only remote import found in `test/` and `scripts/`. The `--no-lock` flag means that no lockfile pins it.

### 6.1 Workflows

| Workflow | Trigger | Function |
|---|---|---|
| `.github/workflows/checks.yml` | Pull request; push to `main` | Three jobs: `tests` (Deno), `privacy` (`scripts/privacy-check.py` with `python3 -u -I`), `release-gate` (pack the zip, then run the gate on the checkout and on the zip). |
| `.github/workflows/release.yml` | Manual | Reads the version from `manifest.json`, makes release notes, packs, runs the gate two times, then creates the tag and the GitHub release. Runs only on `main`. |
| `.github/workflows/ubo-youtube-drift.yml` | Monday 06:00 UTC; manual | Runs `scripts/sync-ubo-youtube.mjs` and fails if the four shipped YouTube files changed. It commits nothing. |
| `.github/workflows/refresh-release-notes.yml` | Manual | Retired. It prints one line. |

## 7. Scripts

| Script | Runtime | Function | Network |
|---|---|---|---|
| `scripts/pack-filter-lists.py` | Python 3; starts Deno | Downloads eight public lists, packs `src/rules/general-network.json` and metadata, writes `src/general/never-block-captcha.js`, then runs the merger, `pack-cosmetic.mjs` and `build-threat-rules.mjs` (`scripts/pack-filter-lists.py:1146-1157`, `:1275`, `:1343-1349`). Cache: `scripts/.list-cache/`. | Yes (`urllib.request`, line 613) |
| `scripts/merge-dnr-rules.py` | Python 3 | Merges stream-site allow rules and list block rules into `src/rules/general-network.json`; writes `src/rules/dnr-merge-meta.json` (`scripts/merge-dnr-rules.py:1-22`). | No |
| `scripts/pack-cosmetic.mjs` | Deno (uses `node:` modules) | Builds `src/rules/cosmetic-rules.json` from the list cache (`scripts/pack-cosmetic.mjs:1-14`). | No |
| `scripts/build-threat-rules.mjs` | Deno | Builds `src/rules/threat-network.json` from the list cache with the runtime parser and `src/threat/compile.js`. It stops if a list hash does not agree with `src/rules/meta.json` (`scripts/build-threat-rules.mjs:1-15`). | No |
| `scripts/build-psl-subset.mjs` | Deno | Builds `src/threat/psl.js` from a Public Suffix List file that the maintainer downloads (`scripts/build-psl-subset.mjs:1-7`). | No |
| `scripts/sync-ubo-youtube.mjs` | Deno with `-A`; starts `git` | Clones uBlock Origin at a tag, reads uAssets filters, and writes the five YouTube port files (`scripts/sync-ubo-youtube.mjs:1-14`, `:25-44`). | Yes |
| `scripts/update-twitch-vendor.mjs` | Deno with limited net, read and write permissions | Replaces `src/vendor/video-swap-new.user.js` with an upstream copy and writes `scripts/vendor-pins.json`. `--check` writes nothing (`scripts/update-twitch-vendor.mjs:1-21`). | Yes |
| `scripts/feed-keygen.mjs` | Deno | Makes an Ed25519 key pair for the signed feed. The private key goes to a file outside the repository (`scripts/feed-keygen.mjs:1-9`). | No |
| `scripts/feed-sign.mjs` | Deno | Signs a feed file after the same checks that the extension does (`scripts/feed-sign.mjs:1-11`). | No |
| `scripts/pack-zip.sh` | Bash, Python 3, `zip` | Packs `manifest.json`, `src/` and `icons/` into `adgecko-<version>.zip`. The file list comes from `scripts/lib/package_files.py`. | No |
| `scripts/release-gate.sh` | Bash, Deno, Python 3, `rg`, `unzip`, `git` | Release checks on a directory or a zip (section 7.1). | No (`scripts/release-gate.sh:3`) |
| `scripts/privacy-check.py` | Python 3; starts `git` | Scans a diff, changed files and commits for forbidden strings and secret shapes (`scripts/privacy-check.py:1-20`). | No |
| `scripts/release-notes.py` | Python 3 | Prints the `CHANGELOG.md` section for one version (`scripts/release-notes.py:1-8`). | No |
| `scripts/build-icons.mjs` | Node.js | Renders `icons/*.png` from `icons/source/*.svg` with a local Chrome or with Playwright (`scripts/build-icons.mjs:1-12`). | No |
| `scripts/bench-youtube.mjs` | Node.js with Puppeteer from an external directory | YouTube page-load benchmark for the unpacked extension (`scripts/bench-youtube.mjs:1-10`). | Yes (loads YouTube). UNVERIFIED. |

Deno permissions come from the first line (shebang) of each script. `scripts/build-psl-subset.mjs`, `scripts/build-threat-rules.mjs`, `scripts/feed-keygen.mjs` and `scripts/feed-sign.mjs` use `--allow-read --allow-write`. `scripts/pack-cosmetic.mjs` has no shebang; its header gives the same two flags (`scripts/pack-cosmetic.mjs:5`). `scripts/sync-ubo-youtube.mjs` uses `-A`. `scripts/update-twitch-vendor.mjs` permits the network only for `api.github.com` and `raw.githubusercontent.com`, and file access only in the current directory.

Libraries in `scripts/lib/`:

| File | Function |
|---|---|
| `scripts/lib/package_files.py` | Derives the list of package files from the manifest, `importScripts`, page tags and string paths; checks a zip against the list. |
| `scripts/lib/curben_check.py` | Text check: only the `urlhaus_hosts` source from its upstream project is permitted. |
| `scripts/lib/feed-tools.mjs` | Ed25519 helpers for the two feed scripts. |
| `scripts/lib/twitch-vendor.mjs` | Pure helpers and constants for the Twitch vendor update. |
| `scripts/lib/youtube-expire-window.mjs` | Local change to one uBO YouTube DNR rule (allow-only). |
| `scripts/lib/youtube-local-patches.mjs` | Local YouTube patches that the sync applies again after each build. |
| `scripts/lib/chrome-shot.mjs` | Renders HTML to PNG through the DevTools protocol of a local Chrome. |

### 7.1 Release gate sections

`scripts/release-gate.sh` has these sections (section titles at lines 152, 256, 303, 549, 565, 674, 735, 757, 794):

1. Package allow-list and version. 1b: playback files agree with `origin/main`.
2. Permissions, host coverage and DNR. 2c: list-source rule (`scripts/lib/curben_check.py`).
3. Dangerous APIs, identity strings and tracker hosts.
4. Privileged extension API usage (section 4.3 of this document).
5. Deno tests (only when `test/` is adjacent to the package).
6. Parse check of the vendored Twitch userscript. Line 774 holds the text `ourTwitchAdSolutionsVersion = 23`.
7. Summary. `docs/UPDATING-DEPENDENCIES.md` says that the last line must be `VERDICT: CLEAN`.

## 8. Vendored dependencies and pins

| Dependency | Files | Version and pin | Pin record | Update command |
|---|---|---|---|---|
| TwitchAdSolutions `video-swap-new` | `src/vendor/video-swap-new.user.js`, `src/vendor/LICENSE-TwitchAdSolutions` | Userscript 1.55; conflict version 23; upstream commit `cebf3d73f0743f99708812dfeb946be701f1a97f` (commit date 2026-02-26); 51,556 bytes; SHA-256 `ef804d16e4d7623554aec59b1608097b5059ac7a337ee4e22120efb955c3b6f4`. MIT licence. | `scripts/vendor-pins.json`; checked by `test/vendor-pin.test.js` | `scripts/update-twitch-vendor.mjs` |
| uBlock Origin scriptlets | `src/vendor/ubo-youtube.js`, `src/vendor/ubo-youtube-isolated.js` | Tag 1.75.0; commit `21f0e686506bb21b514b451c8c6cb9bf8c82d232`. GPLv3. | `src/vendor/ubo-youtube-meta.json` (`ublock_tag`, `ublock_commit`); file banners; default tag at `scripts/sync-ubo-youtube.mjs:25` | `scripts/sync-ubo-youtube.mjs` |
| uAssets YouTube filters | The two files above, `src/vendor/ubo-youtube.css`, `src/rules/ubo-youtube-network.json` | uAssets commit `e140ffc75aee8c1af136f579126389d6defae5ed`; generated 2026-11-15. GPLv3. | `src/vendor/ubo-youtube-meta.json` (`uassets_commit`, `generated_at_utc`) | `scripts/sync-ubo-youtube.mjs` |
| Public Suffix List subset | `src/threat/psl.js` | List version `2026-10-31_14-17-28_UTC`; commit `73f8cc701c084fe07d888ec552b2f0b53281a674`; 5208 ICANN and 3116 private suffixes; 120 hand-kept platform parents. MPL 2.0. | Header of `src/threat/psl.js:1-7` | `scripts/build-psl-subset.mjs` |
| Packed filter lists (data) | `src/rules/general-network.json`, `src/rules/cosmetic-rules.json`, `src/rules/threat-network.json`, `src/rules/threat-snapshot.json`, `src/rules/packed-cross.json` | Packed 2026-11-14T22:00:32Z; one SHA-256 for each of eight sources | `src/rules/meta.json` (`sources.*.sha256`), `src/rules/threat-meta.json`, `src/rules/dnr-merge-meta.json` | `scripts/pack-filter-lists.py` |

More facts from `src/vendor/ubo-youtube-meta.json`:

- The port covers the hosts `www.youtube.com`, `m.youtube.com` and `youtube.com`.
- It records 36 MAIN-world scriptlet calls, 2 ISOLATED-world calls, 1 CSS rule and 4 DNR rules.
- It lists the ported filters, the skipped filters with a reason, and two local additions.
- Two scriptlet groups are off by default: `rmnt` and `domBypass`.

Rules for vendored files:

- Do not edit `src/vendor/video-swap-new.user.js` by hand (`src/vendor/README.md`). The pin test fails if the file and the pin record do not agree (`docs/UPDATING-DEPENDENCIES.md`).
- `src/vendor/ubo-youtube.js`, `src/vendor/ubo-youtube-isolated.js`, `src/vendor/ubo-youtube.css` and `src/threat/psl.js` are generated. Their banners say "Do not edit by hand".
- `src/rules/ubo-youtube-network.json` and `src/vendor/ubo-youtube-meta.json` are generated by the same sync (`scripts/sync-ubo-youtube.mjs:315`, `:334`). JSON files have no banner.
- `src/general/never-block-captcha.js` is generated by the packer from `src/rules/never-block-captcha.json` (`scripts/pack-filter-lists.py:142-187`).
- The uBO sync runs upstream code with full Deno permissions. Use only an official release tag (`docs/UPDATING-DEPENDENCIES.md`, "Security note").

Licence files: `LICENSE` (repository), `src/LICENSE-EasyList.txt`, `src/rules/CREDIT-EasyList.txt`, `src/rules/LICENSES.md`, `src/vendor/LICENSE-uBlock.md`, `src/vendor/LICENSE-uBlock-GPLv3.txt`, `src/vendor/LICENSE-TwitchAdSolutions`.

## 9. Configuration files

| File | Content |
|---|---|
| `manifest.json` | Extension manifest: name, version, minimum Chrome version, permissions, host permissions, service worker, rulesets, popup, icons, 11 content-script entries, options page. |
| `.gitattributes` | `* text=auto eol=lf`; `*.png`, `*.ico` and `*.zip` are binary. The comment says that a CRLF checkout on Windows made a byte-parity test fail. |
| `.gitignore` | `.DS_Store`, `Thumbs.db`, `*.zip`, `scripts/.dnr-cache/`, `scripts/.list-cache/`, `__pycache__/`, `*.pyc`, `.playwright-mcp/`. |
| `scripts/vendor-pins.json` | Pin record for the Twitch userscript. Written by `scripts/update-twitch-vendor.mjs`. |
| `src/vendor/ubo-youtube-meta.json` | Pin and provenance record for the uBO YouTube port. |
| `src/rules/never-block-captcha.json` | Source list of captcha host suffixes. The packer makes `src/general/never-block-captcha.js` from it. |
| `src/rules/meta.json`, `src/rules/threat-meta.json`, `src/rules/dnr-merge-meta.json` | Pack metadata: times, counts, source URLs and hashes. The worker reads `dnr-merge-meta.json` at run time (`src/general-background.js:632`). |
| `src/feed/config.js`, `src/feed/keys.js` | Feed origin and public keys. Both are empty. The feed is dormant. |
| `.github/workflows/*.yml` | CI configuration (section 6.1). |

Run-time settings are not in a file. They are in `chrome.storage.local` under the keys `settings` and `siteOverrides` (`src/settings/features.js:6-10`).

## 10. No package manager, no lockfile, no bundler

- The tracked files include no `package.json`, `package-lock.json`, `deno.json`, `deno.lock`, `tsconfig.json`, `Makefile` or bundler configuration. A search of `git ls-files` in this session found none.
- CI runs Deno with `--no-lock` (`.github/workflows/checks.yml:46`; `scripts/release-gate.sh:739`, `:781`).
- The shipped zip is a copy of source files. `scripts/pack-zip.sh` copies files and makes a zip; it does not change file content.
- Third-party code is copied into the repository (section 8). The pin records and the tests replace a lockfile for this code.
- The Node.js scripts load Puppeteer or Playwright from a location that the maintainer supplies (`scripts/bench-youtube.mjs:4`, `scripts/build-icons.mjs:10-12`). The repository does not install them.

## 11. Platform notes (Windows)

- `docs/UPDATING-DEPENDENCIES.md` gives all maintainer commands for PowerShell 5.1 on Windows 11. It runs the Bash scripts with the Bash of Git for Windows.
- `.gitattributes` forces LF line ends, because generated files are compared byte for byte.
- `scripts/pack-zip.sh:31` removes CR characters from Python output, because Python on Windows prints CRLF.
- `scripts/pack-zip.sh:52-69` uses the Windows System32 `tar.exe` when `zip` is absent. It converts paths with `cygpath`.
- `scripts/pack-zip.sh:17-20` accepts an output path with a drive letter.
- `scripts/release-gate.sh:762-764` converts an MSYS path with `cygpath -m` before it gives the path to Deno.
- `scripts/release-gate.sh:204` and `:225` remove CR characters from Python output.
- `scripts/lib/package_files.py:203` changes backslashes to forward slashes in zip entry names. The gate does the same for relative paths (`scripts/release-gate.sh:687`).
- `scripts/sync-ubo-youtube.mjs:17` removes the leading slash from a drive-letter path. Line 217 handles CRLF sources from a Windows checkout.
- `scripts/build-threat-rules.mjs:19` changes backslashes in the `--cache` argument.
- Tests look for Python as `py -3`, `python` or `python3` on Windows (`test/filter-options.test.js:17`; 13 uses of `Deno.build.os` in `test/`).
- `scripts/build-icons.mjs:5` gives a PowerShell example with the `CHROME_PATH` variable.
- The release gate writes scratch files to the POSIX temp directory. `scripts/release-gate.sh` has 18 lines with this path: 16 lines use fixed file names and 2 lines use `mktemp` (lines 54 and 771). Operation of this on Windows is UNVERIFIED.
- All Windows statements in this section come from code and comments. No run on a Windows PC proved them. UNVERIFIED.

## 12. Checked and not checked

An independent check of this document ran in the same session as the analysis date. The lists below give the result of that check.

### Checked (read from the files in this session)

- `manifest.json`: all top-level keys, the line numbers of the keys, and all 11 content-script entries (matches, files, world, frames), read with a Python program.
- `.gitattributes`, `.gitignore`: full text.
- `scripts/vendor-pins.json`: full text.
- `src/vendor/video-swap-new.user.js`: header lines 1-12, byte size (51,556) and SHA-256. The computed hash agrees with `scripts/vendor-pins.json`.
- `src/vendor/ubo-youtube-meta.json`: all keys, pin fields, hosts and counts. The long filter lists were cut after 300 characters.
- `src/threat/psl.js`: header lines 1-22.
- `src/vendor/README.md` (first 10 lines) and the banners of `src/vendor/ubo-youtube.js`, `src/vendor/ubo-youtube-isolated.js` and `src/vendor/ubo-youtube.css`.
- `src/rules/meta.json`, `src/rules/threat-meta.json`, `src/rules/dnr-merge-meta.json`: all keys (long values cut).
- Rule counts of the three static rulesets, counted with a Python program.
- All `chrome.` text in `src/**/*.js` and `src/*.html` (`grep` with line numbers), and the worker aliases `dnr`, `local` and `area`.
- `src/general-background.js`: lines 1-75, 340-346, 390-394, 455-466, 576-590, 640-645, 924-945, 1160-1215.
- `src/general/update.js`: lines 1-135.
- `src/settings/features.js` lines 1-30, `src/settings/flags.js` lines 1-30 and 136-140, `src/feed/config.js`, `src/feed/keys.js`, `src/feed/verify.js` lines 1-35, `src/cosmetic.js` lines 225-232.
- Script and link tags in `src/popup.html` and `src/settings.html`.
- `.github/workflows/checks.yml`: full text. The other three workflows: `grep` results and the header comments.
- `scripts/pack-zip.sh`: full text. `scripts/release-gate.sh`: lines 1-8, 40-56, 254-264, 674-806, the section titles, and `grep` results for temp paths and Windows handling.
- The first 22 lines of each file in `scripts/` and `scripts/lib/`, and `grep` results for tool and network use in `scripts/pack-filter-lists.py`, `scripts/sync-ubo-youtube.mjs`, `scripts/privacy-check.py` and `scripts/lib/package_files.py`.
- `docs/UPDATING-DEPENDENCIES.md` and `docs/permissions-and-privacy.md`: `grep` results for the statements that this document cites.
- The tracked file list (`git ls-files`) for package-manager files and file extensions. Remote imports in `test/` and `scripts/` (`grep`).
- The number of test files (121) and the `Deno.*` functions that `test/` uses (`grep`).
- The commit id, from `git rev-parse --short HEAD`.

### Not checked

- No test ran. Deno is not installed in this session.
- The extension was not loaded in Chrome. All run-time behaviour is UNVERIFIED.
- No script in `scripts/` ran. The functions in section 7 come from file headers and `grep` results.
- The full text of `src/youtube.js`, `src/kick.js`, `src/guards/*.js`, `src/cosmetic.js`, `src/popup.js`, `src/settings.js`, `src/vendor/*.js`, `src/feed/client.js` and `src/threat/compile.js` was not read. Only `grep` results were used for them.
- `src/rules/cosmetic-rules.json`, `threat-snapshot.json` and `packed-cross.json` were not read. For the three ruleset files, only the rule count was taken.
- The full text of `scripts/release-gate.sh` lines 80-253 and 265-673 was not read. The summary of gate sections 1 to 3 comes from the section titles and `grep` results.
- The full text of `release.yml`, `ubo-youtube-drift.yml` and `refresh-release-notes.yml` was not read line by line.
- `docs/how-it-works.md`, `docs/threat-tier.md`, `CHANGELOG.md` and `TODO.md` were not read for this document.
- The reason for `minimum_chrome_version` 137 comes from one code comment only.
- The pinned commits and hashes were not compared with the upstream repositories.
- The GitHub repository settings that `checks.yml` describes (SHA pinning, allowed actions) were not checked.
- The versions of Python, Bash, ripgrep, zip and Node.js on the CI runner or on a maintainer PC were not checked.
- All Windows behaviour in section 11 was not checked on a Windows PC.
