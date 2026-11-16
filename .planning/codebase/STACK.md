# Technology stack

Analysis date: 2026-11-16
Commit: 5cd4ab6 (version 0.3.6)

This document lists the languages, runtimes, browser APIs, tools and vendored code of Adgecko.
UNVERIFIED: all behaviour in Chrome and on Windows. No script that downloads was run for this document.

## 1. Summary

- Adgecko is a Chrome Manifest V3 extension. The version is the `version` field of `manifest.json`.
- The extension code is plain JavaScript, HTML, CSS and JSON in `src/`. Chrome loads the files as they are.
- There is no build step, no bundler, no transpiler, no package manager and no lockfile. The tracked files include no `package.json`, `deno.json` or `tsconfig.json`.
- Third-party code is copied into the repository. Pin records and tests replace a lockfile (section 7).
- The tools in `scripts/` use Deno, Python 3 (standard library only), Bash, ripgrep and zip. Two scripts use Node.js.
- The tests in `test/` are Deno tests. GitHub Actions runs the tests, a privacy scan and the release gate.

## 2. Languages

| Language | Where |
|---|---|
| JavaScript, classic scripts | `src/**/*.js`: worker, content scripts, popup, settings page |
| JavaScript, ES modules | `scripts/*.mjs`, `scripts/lib/*.mjs`, `test/fixtures/*.mjs`, `test/*.test.js` |
| Python 3 | `scripts/*.py`, `scripts/lib/*.py`, inline blocks in `scripts/release-gate.sh`, `scripts/pack-zip.sh` and the workflows |
| Bash | `scripts/pack-zip.sh`, `scripts/release-gate.sh` (both use `set -euo pipefail`), `run:` steps of the workflows |
| HTML, CSS | `src/popup.html`, `src/settings.html` (inline `<style>` block), `src/popup.css`, `src/cosmetic-hide.css`, `src/youtube-ads.css`, `src/vendor/ubo-youtube.css` |
| JSON | `manifest.json`, `src/rules/*.json`, pin records, test fixtures |
| YAML | `.github/workflows/*.yml` |

## 3. Browser runtime

- `manifest_version` is 3. `minimum_chrome_version` is 137. A code comment gives the reason: Ed25519 in WebCrypto (UNVERIFIED).
- The manifest has no `web_accessible_resources` and no `content_security_policy` key. The gate permits only the current top-level keys.
- The service worker `src/general-background.js` is a classic worker. It loads 16 files with one `importScripts` call. It uses no `setInterval`.
- Content scripts run in the ISOLATED world or the MAIN world. MAIN-world scripts cannot use `chrome.*`. The table is in `ARCHITECTURE.md` section 2.
- Three static rulesets are enabled by default: `general` (2,856 rules), `ubo-youtube` (4), `threat` (199). The packer budget for static list rules is 28,000.
- The options page `src/settings.html` opens in a tab. The toolbar popup is `src/popup.html`.

Extension APIs in use:

| API | Use |
|---|---|
| `chrome.storage.local`, `chrome.storage.session`, `chrome.storage.onChanged` | Settings, list data, hide rules, feed state, tab signals |
| `chrome.declarativeNetRequest` | `updateEnabledRulesets`, `getDynamicRules`, `updateDynamicRules`, `getSessionRules`, `updateSessionRules` (worker only) |
| `chrome.alarms` | `create`, `get`, `onAlarm` (worker only) |
| `chrome.action` | Icon, title and badge (worker only). It needs no permission. |
| `chrome.runtime` | Messages, `getURL`, `getManifest`, `onInstalled`, `onStartup`, `openOptionsPage` |
| `chrome.tabs` | `query`, `sendMessage`, `reload`, `create` in the popup only. The manifest does not request the `tabs` permission. |

The gate limits the `chrome.*` namespaces of each file: `CONVENTIONS.md` section 7.

Web platform APIs: `fetch` in the worker (list downloads and reads of package files), `importScripts`, WebCrypto Ed25519 (`src/feed/verify.js`), `MessageChannel` between the worlds, streams and `TextDecoder` for a body read with a size limit, constructed style sheets in `document.adoptedStyleSheets` (`src/cosmetic.js`).

## 4. Permissions

| Permission | Use |
|---|---|
| `storage` | `chrome.storage.local` and `chrome.storage.session` |
| `declarativeNetRequest` | Three static rulesets, dynamic rules, session rules |
| `alarms` | `gecko-refresh` and the one-shot `gecko-refresh-retry` |

- Host permissions: nine patterns, all for filter-list downloads. See `INTEGRATIONS.md` section 2.
- The content scripts match all http and https sites. Thus Chrome shows "Read and change all your data on all websites".
- The gate permits no other permission and no optional permission.

## 5. Tool runtimes

| Tool | Version | Used by |
|---|---|---|
| Deno | v2.9.8 (pinned in the workflows) | Tests, most `scripts/*.mjs`, gate sections 5 and 6 |
| Python 3 | No pin | `scripts/*.py`, `scripts/lib/*.py`, inline blocks, many tests |
| Bash | No pin | `scripts/pack-zip.sh`, `scripts/release-gate.sh`, some tests |
| ripgrep (`rg`) | No pin. CI installs it only if it is absent. | The gate stops if `deno`, `python3` or `rg` is absent. Two tests are ignored without `rg`. |
| `zip` (Info-ZIP), `unzip` | No pin | Packaging, the gate with `--zip`. Windows `tar.exe` is the fallback for `zip`. |
| `git` | No pin | uBlock Origin sync, privacy scan, gate section 1b, reproducible zip time |
| Node.js | 22 or later for `scripts/lib/chrome-shot.mjs` | `scripts/build-icons.mjs`, `scripts/bench-youtube.mjs` (not in CI) |
| `gh` CLI | No pin | The release workflow |

Remote module: four test files import `jsr:@std/assert@1`. Deno must download it one time. `--no-lock` means that no lockfile pins it.

## 6. Scripts

| Script | Runtime | Function | Network |
|---|---|---|---|
| `scripts/pack-filter-lists.py` | Python 3; starts Deno | Downloads the eight lists, packs the files in `src/rules/`, then runs the next three scripts. Cache: `scripts/.list-cache/`. | Yes |
| `scripts/merge-dnr-rules.py` | Python 3 | Merges the stream-site allow rules and the list block rules into `src/rules/general-network.json`. | No |
| `scripts/pack-cosmetic.mjs` | Deno | Builds `src/rules/cosmetic-rules.json` from the list cache. | No |
| `scripts/build-threat-rules.mjs` | Deno | Builds the three `threat-*` files from the list cache with the runtime parser. It stops if a list hash does not agree with `meta.json`. | No |
| `scripts/build-psl-subset.mjs` | Deno | Builds `src/threat/psl.js` and one data block in `src/guards/popups.js` from a local Public Suffix List file. | No |
| `scripts/sync-ubo-youtube.mjs` | Deno; starts `git` | Writes the five uBlock Origin YouTube files. It runs upstream code from a pinned commit. | Yes |
| `scripts/update-twitch-vendor.mjs` | Deno, limited permissions | Replaces the vendored Twitch file and writes `scripts/vendor-pins.json`. | Yes |
| `scripts/feed-keygen.mjs`, `scripts/feed-sign.mjs` | Deno | Key pair and signature for the signed feed. | No |
| `scripts/pack-zip.sh` | Bash, Python 3, `zip` | Packs `adgecko-<version>.zip` from the derived file list. The Info-ZIP path gives a reproducible zip. | No |
| `scripts/release-gate.sh` | Bash, Deno, Python 3, `rg`, `unzip`, `git` | Release checks on a directory or a zip. | No |
| `scripts/privacy-check.py` | Python 3; starts `git` | Scans a diff, changed files and commits for forbidden strings. | No |
| `scripts/release-notes.py` | Python 3 | Prints the `CHANGELOG.md` section for one version. | No |
| `scripts/build-icons.mjs` | Node.js | Renders `icons/*.png` from `icons/source/*.svg` with a local Chrome or with Playwright. | No |
| `scripts/bench-youtube.mjs` | Node.js with Puppeteer | YouTube page-load benchmark for the unpacked extension. | Yes |

Libraries in `scripts/lib/`: `package_files.py` (the one derived list of package files; checks a zip), `curben_check.py` (list source rule), `feed-tools.mjs` (key and signature helpers), `twitch-vendor.mjs` (helpers and pin sites of the Twitch update), `ubo-commit-pin.mjs` (which uBlock Origin commit the sync can run), `youtube-local-patches.mjs` and `youtube-expire-window.mjs` (local YouTube changes that the sync applies), `chrome-shot.mjs` (HTML to PNG with a local Chrome).

Each script starts with a header that gives its purpose and its command line. Read the header before you run a script.

## 7. Vendored dependencies and pins

| Dependency | Files | Version and pin | Pin record |
|---|---|---|---|
| TwitchAdSolutions `video-swap-new` (MIT) | `src/vendor/video-swap-new.user.js` | Userscript 1.55, conflict version 23, upstream commit `cebf3d73f0743f99708812dfeb946be701f1a97f`, 51,556 bytes, SHA-256 `ef804d16e4d7623554aec59b1608097b5059ac7a337ee4e22120efb955c3b6f4` | `scripts/vendor-pins.json` and `scripts/frozen-pins.json`; `test/vendor-pin.test.js`, `test/release-tooling.test.js` |
| `src/kick.js` (frozen project file) | `src/kick.js` | 28,148 bytes, SHA-256 `b0683dee5599c6f3f148f3e0d8e1240c93721756e9d0075cdee83d9a95a80a60` | `scripts/frozen-pins.json` |
| uBlock Origin scriptlets (GPLv3) | `src/vendor/ubo-youtube.js`, `ubo-youtube-isolated.js` | Tag 1.75.0, commit `21f0e686506bb21b514b451c8c6cb9bf8c82d232` | `src/vendor/ubo-youtube-meta.json`; the default tag in `scripts/sync-ubo-youtube.mjs` |
| uAssets YouTube filters (GPLv3) | The two files above, `src/vendor/ubo-youtube.css`, `src/rules/ubo-youtube-network.json` | uAssets commit `e140ffc75aee8c1af136f579126389d6defae5ed`, generated 2026-11-15 | `src/vendor/ubo-youtube-meta.json` |
| Public Suffix List subset (MPL 2.0) | `src/threat/psl.js` | List version `2026-11-15_20-28-43_UTC`, commit `fd22c6c8b3fd7e854c1eff2194cfd4ebc9854b88`; 5,497 ICANN and 3,185 private suffixes; 120 hand-kept platform parents; 12 exact shared service hosts | Header of `src/threat/psl.js` |
| Packed filter lists (data) | `src/rules/*.json` | Packed 2026-11-14T22:00:32Z; one SHA-256 for each of eight sources | `src/rules/meta.json`, `threat-meta.json`, `dnr-merge-meta.json` |

- The uBlock Origin port covers `www.youtube.com`, `m.youtube.com` and `youtube.com`. The meta file lists the ported filters, the skipped filters with a reason, and the local additions.
- Licence files: `LICENSE`, `src/LICENSE-EasyList.txt`, `src/rules/CREDIT-EasyList.txt`, `src/rules/LICENSES.md`, `src/vendor/LICENSE-uBlock.md`, `src/vendor/LICENSE-uBlock-GPLv3.txt`, `src/vendor/LICENSE-TwitchAdSolutions`.
- Rules for these files: `CONVENTIONS.md` sections 8 and 9. Update procedures: `docs/UPDATING-DEPENDENCIES.md`.

## 8. Configuration files

| File | Content |
|---|---|
| `manifest.json` | The extension manifest. |
| `.gitattributes` | `* text=auto eol=lf`. `*.png`, `*.ico` and `*.zip` are binary. |
| `.gitignore` | `.DS_Store`, `Thumbs.db`, `*.zip`, the two packer caches, Python cache files, `.playwright-mcp/`. |
| `scripts/vendor-pins.json`, `scripts/frozen-pins.json` | Pin records (section 7). |
| `src/rules/never-block-captcha.json` | Source list of captcha host suffixes. Not in the zip. |
| `src/feed/config.js`, `src/feed/keys.js` | Feed origin and public keys. Both are empty. |

Run-time settings are not in a file. They are in `chrome.storage.local` (`ARCHITECTURE.md` section 9).

## 9. Platform notes (Windows)

- `docs/UPDATING-DEPENDENCIES.md` gives all maintainer commands for PowerShell 5.1. It runs the Bash scripts with the Bash of Git for Windows.
- `.gitattributes` forces LF line ends, because generated files are compared byte for byte.
- The Bash scripts remove CR characters from Python output, because Python on Windows prints CRLF.
- `scripts/pack-zip.sh` uses the Windows `tar.exe` when `zip` is absent, and converts paths with `cygpath`. That path does not give a reproducible zip.
- Tests look for Python as `py -3`, `python` or `python3` on Windows. One test is ignored on Windows.
- The release gate writes scratch files with fixed names to the POSIX temp directory.
