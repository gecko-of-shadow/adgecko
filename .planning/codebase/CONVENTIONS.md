# Coding conventions

Analysis date: 2026-11-16
Commit: 5cd4ab6 (version 0.3.6)

This document gives the rules that the code obeys now. The release gate or a test enforces most of them.
UNVERIFIED: the effect of these rules in a real Chrome page.

## 1. The most important rules

- `src/` contains classic scripts only. There are no ES modules, no bundler and no build step.
- Each module sets one global object, or exports through an `install...(target)` function.
- Page-world (MAIN world) files of the project are one IIFE each. They add no global to the page.
- Names that a web page can see are neutral (`gk-*`, `gk.*`). They do not contain the product name.
- Logic that a test must run does not call `chrome.*`. The caller injects the dependencies.
- Two playback files are frozen: `src/vendor/video-swap-new.user.js` and `src/kick.js` (section 9).
- Do not edit a generated file by hand. Change the source and run the generator (section 8).
- All text files use LF line ends and UTF-8.
- Do not write absolute paths, e-mail addresses, real IP addresses, tokens or names of persons in a file or a commit message. `scripts/privacy-check.py` rejects them.

## 2. Module patterns in `src/`

| Pattern | Form | Files |
|---|---|---|
| A: one global | `(function (root) { ... root.<Global> = ...; })(typeof self !== "undefined" ? self : globalThis);` | `settings/features.js`, `general-settings.js`, `general/filter-options.js`, `general/cosmetic-parse.js`, `general/never-block-captcha.js`, `threat/*.js`, `feed/*.js` |
| B: install function | `function installX(target) { ... }` puts constants and pure functions on `target`. The end of the file starts the feature only when the environment has the necessary objects. | `general/update.js`, `cosmetic.js`, `twitch-directory-ads.js`, `kick.js`, `youtube.js`, `guards/clipboard.js`, `guards/popups.js` |
| C: page script | `(function () { ... })();` with no global. It reads the globals of pattern A. | `popup.js`, `settings.js`, `settings/flags.js` |
| Worker file | Not in an IIFE. Top-level aliases for the globals: `TC`, `FC`, `CP`, `GU`, `GS`, `KEYS`, `FEAT`. | `general-background.js` |

- The load sequence is part of the contract: `src/settings/features.js` is first in each ISOLATED `js` array that uses it, and `ARCHITECTURE.md` section 3 gives the worker sequence.
- The `importScripts` call contains string literals only. The package tool fails on a different argument.
- A module gets a different module through its global, at the time of use.
- The scripts in `scripts/` use the runtime parser and compiler from `src/`, not a copy.

## 3. Naming

| Item | Convention | Examples |
|---|---|---|
| Globals | `Gecko*` (settings, threat tier, feed), `General*` (list tier), `GeneralAdblock*` (install modules of the list tier) | `GeckoFeatures`, `GeneralSettings`, `GeneralAdblockUpdate` |
| Constants | `UPPER_SNAKE_CASE` | `REFRESH_ALARM`, `LIST_RULE_ID_BASE` |
| Functions, variables, feature ids, storage keys | `camelCase`. A key for each list or host has a prefix that ends in a colon. | `listData:`, `cosS:` |
| Files in `src/` and `scripts/` | `kebab-case`. One directory for each subsystem. Scripts: `.mjs` for Deno or Node, `.py` for Python 3, `.sh` for Bash. | `src/threat/protected-hosts.js`, `scripts/pack-zip.sh` |
| Tests | `test/<subject>.test.js`, all in one directory. The prefixes `nightly-`, `final-`, `wave2-` and `pr12-` are records of past reviews. Do not use them for a new file. | `test/settings.test.js` |
| Docs | `kebab-case.md` for current pages. Capitals for owner-facing notes. | `docs/how-it-works.md`, `docs/STORE-REVIEW-NOTES.md` |
| Ids in extension pages | `kebab-case`. They are not neutral, because a web page cannot read them. | `fix-site`, `allow-domain` |

Names that a web page can see. `test/hardening.test.js` enforces the rule for `Symbol.for` ids, DOM ids and marker properties.

| Name | Use |
|---|---|
| `gk-c1` | `<style>` id of the cosmetic fallback sheet (`src/cosmetic.js`). The adopted sheet has no id. |
| `gk-t1` | `<style>` id of the Twitch directory hide. |
| `gk-n1` | Id of the YouTube notice element. |
| `gk-p1`, `gk-r1` | Event names of the private flag channel (`ARCHITECTURE.md` section 12). |
| `Symbol.for("gk.y")` | Guard against a second start of `src/youtube.js`. |
| `Symbol.for("gk.u")`, `Symbol.for("gk.ui")` | Markers of the uBlock Origin MAIN bundle and ISOLATED bundle. |

Messages, alarms, storage keys and rule id ranges: `ARCHITECTURE.md` sections 4, 6, 7 and 9.

## 4. Dependency injection for tests

| Mechanism | Where | What the caller injects |
|---|---|---|
| `deps` object | `src/general/update.js`, `src/feed/client.js` | `fetch`, `now`, storage getters and setters, DNR functions, `exclusive`, loaders. The worker makes the real objects in `listDeps()` and `feedDeps()`. |
| `env` object | `src/guards/clipboard.js`, `src/guards/popups.js` | `window`, `document`, `navigator`, `location`, `flagOn`, `now`, `notify` or `signal`. |
| `api` or `target` object | All `install...` functions | An empty object. The function fills it. |

`src/general/update.js`, `src/general/filter-options.js`, `src/threat/*.js` and `src/feed/*.js` contain no `chrome.` or `browser.` call. Gate section 4 enforces this.

## 5. Comments and tags

- A source file starts with a comment block. It tells what the file does and what it does not do. A content script also tells where it runs (world, `run_at`, frames).
- Comments give the reason and frequently the history of a bug. They name the related file and the test that keeps a rule.
- Comments use the words "fail-open" and "fail-closed" for the error policy, and `UNVERIFIED` for a statement that was not proven in Chrome.
- The worker logs with the prefix `adgecko:`.

A tag in a comment means: this code is the correction of that finding, do not remove it. The same tag is frequently in the test that proves the correction. To find all code for one finding, search for the tag.

| Tag form | Meaning |
|---|---|
| `H-n`, `M-n`, `L-n`, `I-n` | Finding of an earlier security review. The report is not in the repository. |
| `review 2026-11-16 WP-nn` | Work package of the 0.3.6 code review. The plan and the results are in `docs/review-2026-11-16/`. |
| `nightly 0.3.5`, `final review n` | Findings of the 0.3.5 bug hunt and final review. See `CHANGELOG.md`, 0.3.5. |
| `Block B` to `Block K` and others | Work packages of an older build plan. The plan is not in the repository. |
| `D-n`, `#n`, "owner decision <date>" | A decision of the owner. |
| `NEEDS OWNER`, `OWNER DECISION` | A question that is open, or a gate failure that is by design. |

Tags that limit typical changes:

| Tag | Rule |
|---|---|
| H-2 | Filter options are converted exactly. A filter is never widened to a block of a full domain. |
| M-1 | Feature flags go through a private `MessagePort`, not `window.postMessage`. |
| M-6 | Pull request code does not run with the CI secret. |
| L-5 | All DNR writes go through one queue. |
| L-6 | One stream-host list. Copies must not drift. |
| L-13 | GitHub Actions are pinned to full commit SHAs. |
| L-18 | MAIN-world files are one IIFE with no page globals. |
| D-1, D-7 | The feed host and the signer of the feed are open decisions. The feed is dormant. Do not invent a domain. |
| D-3 | Vendored Twitch and uBlock Origin scripts are always on. They get no flags. |
| D-4 | Guard defaults: clipboard on, pop-ups off. |
| #13, #18b | No phishing-feed data. One exception: the `urlhaus_hosts` list from one URL. |
| #17 | The code is GPLv3. The brand has separate terms. |

## 6. Rules for page-world code

These rules apply to `src/youtube.js`, `src/kick.js`, `src/guards/clipboard.js` and `src/guards/popups.js`.

| Rule | Enforced by |
|---|---|
| The file is one `(() => { ... })();`. No new global name. | `test/hardening.test.js` |
| No `chrome.*` or `browser.*`. | Gate section 4 |
| No product name in `Symbol.for` ids, DOM ids or style ids. | `test/hardening.test.js` |
| No marker property on page objects. Use a `WeakSet` or `WeakMap`. | `test/hardening.test.js` (old marker names only) |
| No output to the page console unless a debug switch is on. | `test/hardening.test.js` |
| No options from `localStorage` or other storage that the page can write. | `test/hardening.test.js` |
| No `.innerHTML =`, `eval(`, `document.write(`, `new Function(`. Make DOM with `createElement` and `textContent`. | Gate section 3 |
| Flags come only through the private port. A feature stays on until a flag says off. | `test/settings.test.js`, `test/guards.test.js`, `test/flags-port-window.test.js` |
| Capture built-ins and getters at the top of the file, before page scripts run. Call them with `Reflect.apply`. | `test/guards.test.js` |
| Fail-open: an internal error lets the page call continue. Exceptions are in `ARCHITECTURE.md` section 16. | - |

Related rules:

- `src/popup.js` and `src/settings.js` use no `innerHTML` and no remote code. `src/popup.html` loads only `popup.js` and has no inline handler.
- The manifest has no web-accessible resources.
- The stream-site host list exists only in `src/settings/features.js`. Other files get it from `GeckoFeatures`.
- `test/fixtures/source-opts.mjs` edits the `const OPTS = {...};` line of `src/youtube.js`. That line must stay on one line with two spaces of indent.
- Many tests read source text with a regular expression. A change of wording in a source line can fail such a test.

## 7. Rules that `scripts/release-gate.sh` enforces

How to run the gate: `TESTING.md` section 8. The owner must approve each change to the gate.

| Section | Rules |
|---|---|
| 1. Package | The manifest version equals the expected version. Each file in `REQUIRED` exists. With `--zip`: each file agrees with `ALLOWED_RE`, the zip holds exactly the derived file list, and a zip with the version of the checkout holds the same bytes as the checkout. `src/popup.html` loads only `popup.js`. The package size is 8,000,000 bytes or less. |
| 1b. Frozen files | `src/vendor/video-swap-new.user.js` and `src/kick.js` have no content difference from `origin/main` (or `main`). Each file also equals its SHA-256 pin in `scripts/frozen-pins.json`, in repository mode and in zip mode. No debug file is in the package. |
| 2. Manifest and DNR | Only the 13 known top-level manifest keys. `host_permissions` is exactly the list of filter-list hosts, or that list plus the one feed host when `FEED_ORIGIN` is set. Permissions: `declarativeNetRequest` and `storage` are necessary, `alarms` is permitted, nothing else. No optional permissions. The shapes of the Twitch, YouTube and Kick content-script entries are fixed. The stream scripts do not match YouTube Music, Studio or Kids. The cosmetic script excludes the stream sites. Each ruleset has unique ids and only `block`, `allow`, `allowAllRequests` or `upgradeScheme` actions. The enabled rulesets together have 30,000 rules or fewer. |
| 2c. List sources | `scripts/lib/curben_check.py` must pass: only the `urlhaus_hosts` source from one fixed URL (#13, #18b). |
| 3. Dangerous APIs | No `eval(`, `.innerHTML =`, `document.write(`, `importScripts(`, identity APIs, `sendBeacon`, geolocation or WebRTC in `src/**/*.js`. Three exceptions: `eval(workerString)` and one `innerHTML` write in the vendored Twitch file, and the one `importScripts` line of the worker. No `new Function(`. No secret patterns in `manifest.json` and `src/` (not `src/rules/`). Tracker names only in `src/rules/`. Each `http(s)://` URL in a JS code line has a host from the permitted list. |
| 4. Extension API scope | See the table below. No `setInterval` in the worker. Only the `gecko-refresh` alarm and the one-shot `gecko-refresh-retry` alarm. |
| 5. Tests | The gate runs the Deno tests when `test/` is next to the package. Not with `--zip`. |
| 6. Vendored userscript | The Twitch file contains `ourTwitchAdSolutionsVersion = 23`, and its body parses. The number is a literal in the gate. `test/vendor-pin.test.js` compares it with `scripts/vendor-pins.json`. |

Permitted `chrome.*` namespaces for each file (`browser.*` is not permitted):

| File | Namespaces |
|---|---|
| `src/general-background.js` | `runtime`, `storage`, `action`, `declarativeNetRequest`, `alarms` |
| `src/popup.js` | `runtime`, `tabs`, `storage` |
| `src/cosmetic.js`, `src/settings.js`, `src/settings/flags.js`, `src/twitch-directory-ads.js` | `runtime`, `storage` |
| `src/general-settings.js`, `src/settings/features.js`, `src/general/cosmetic-parse.js` | none |
| `src/vendor/*.js`, `src/youtube.js`, `src/kick.js`, `src/guards/*.js`, `src/threat/*.js`, `src/feed/*.js`, `src/general/update.js`, `src/general/filter-options.js` | none |

When you add a shipped file, add its path to `REQUIRED` and to `ALLOWED_RE` in the gate. `test/packaging.test.js` compares them with the derived list. When you add a manifest key, add it to `ALLOWED_MANIFEST_KEYS` in the gate. `test/release-tooling.test.js` compares that list with the manifest.

## 8. Generated files

| File | Source | Generator |
|---|---|---|
| `src/general/never-block-captcha.js` | `src/rules/never-block-captcha.json` | `python3 scripts/pack-filter-lists.py --never-block-captcha-js` (writes only this file) |
| `src/threat/psl.js`, and the `POPUP-PSL` data block in `src/guards/popups.js` | A Public Suffix List file that you download, and the hand-kept lists in the script | `deno run --allow-read --allow-write scripts/build-psl-subset.mjs --psl <file>` |
| `src/vendor/ubo-youtube.js`, `ubo-youtube-isolated.js`, `ubo-youtube.css`, `ubo-youtube-meta.json`, `src/rules/ubo-youtube-network.json` | uBlock Origin scriptlets at a release tag, uAssets filters, local patches | `scripts/sync-ubo-youtube.mjs` (command in `docs/UPDATING-DEPENDENCIES.md`) |
| `src/rules/general-network.json`, `dnr-merge-meta.json`, `meta.json`, `packed-cross.json`, `cosmetic-sample.json`, `LICENSES.md`, `README.md` | Downloaded filter lists | `python3 scripts/pack-filter-lists.py` (runs `scripts/merge-dnr-rules.py`) |
| `src/rules/threat-network.json`, `threat-snapshot.json`, `threat-meta.json` | Threat lists in the packer cache | The packer runs `scripts/build-threat-rules.mjs` at its end |
| `src/rules/cosmetic-rules.json` | EasyList and EasyPrivacy in the packer cache, extras from `src/cosmetic-hide.css` | The packer runs `scripts/pack-cosmetic.mjs` |
| `src/vendor/video-swap-new.user.js`, `scripts/vendor-pins.json` | Upstream userscript at a pinned commit | `scripts/update-twitch-vendor.mjs`. `--check` writes nothing. |
| `icons/icon{16,48,128}{,-working,-off}.png` | `icons/source/*.svg` | `node scripts/build-icons.mjs` |

- A generated JS or CSS file names its generator in line 1. Generated JSON has a UTC time field (`*_at_utc`). The vendored Twitch file is an upstream copy with no added header.
- Tests compare generated files with the generator output (for example `test/hcaptcha-never-block.test.js`, `test/meta-counts.test.js`, `test/docs-claims.test.js` for `LICENSES.md`).
- `scripts/pack-filter-lists.py` and `scripts/sync-ubo-youtube.mjs` download from the network. `scripts/build-threat-rules.mjs`, `scripts/pack-cosmetic.mjs` and `scripts/build-psl-subset.mjs` read local files only.
- The packer refuses an empty, HTML or very short list body, and a list that shrinks by more than 25 % (`--accept-shrink` overrides). On a refusal it writes nothing.
- The packer caches `scripts/.list-cache/` and `scripts/.dnr-cache/` are in `.gitignore`. `*.zip` is also in `.gitignore`.
- UNVERIFIED: the origin of `src/cosmetic-hide.css`. Its header says "Generated", but no script in `scripts/` writes it.

Line ends and encoding:

- `.gitattributes` sets `* text=auto eol=lf`. Generated files are compared byte for byte, and a CRLF checkout on Windows failed that comparison.
- Each `.js`, `.css`, `.html` and `.json` file below `src/` must be valid UTF-8 (`test/final-chrome-utf8.test.js`).
- Do not put a raw Unicode noncharacter (U+FDD0 to U+FDEF, U+xFFFE, U+xFFFF) or a lone surrogate in a file below `src/`. Write it as a `\uXXXX` escape. Chrome refused to load the extension because of one raw U+FFFF.

## 9. Frozen files and owner decisions

| File | How it is frozen |
|---|---|
| `src/vendor/video-swap-new.user.js` | Gate section 1b (difference from `origin/main`, and the pin in `scripts/frozen-pins.json`). SHA-256 pin in `scripts/vendor-pins.json`, checked by `test/vendor-pin.test.js`. |
| `src/kick.js` | Gate section 1b (the same two checks). |
| `scripts/frozen-pins.json` | A change is an owner decision, because it releases a frozen file. |
| `scripts/release-gate.sh` | By convention. The update scripts do not edit it. |

A change to a frozen file fails the gate on a branch until the change is on `origin/main` and the pin agrees. This is by design.

The owner-decision process, as the files show it:

1. Work that changes a frozen file, a permission, a list source or a default is not merged as a usual correction. It is recorded as an owner decision.
2. A proposed change for a frozen file is kept as a patch in `docs/proposals/`.
3. The tests for the held change stay in `test/` with `ignore: true` and a comment that gives the reason.
4. `CHANGELOG.md` records the held items. `TODO.md` lists the open decisions.
5. After the decision, the code comment, the test, the docs and the changelog get the tag or the date of the decision.
6. Open questions in code have the mark `NEEDS OWNER`. Do not invent a value.

Limits that came from owner decisions and that code enforces: only the two alarms; vendored scripts always on (D-3); the clipboard guard stays on for an allowed site; no private key in the repository.

## 10. Documentation conventions

- `CHANGELOG.md`: newest version first. A released version has the heading `## <version> (<date>)`. `scripts/release-notes.py` finds a section by the text `## <version> (`. The release workflow copies that section into the GitHub release notes. Dates are the local date of the owner. Dates in packed files are UTC.
- Changelog bullets start with the area and a colon ("Popup:", "Filter lists:"). UI labels are bold. File names and identifiers are in backticks.
- `docs/` reference pages start with a link back to the README. Procedures for the owner give PowerShell 5.1 commands, one command in each code block.
- Tests and scripts read some sentences in `README.md` and `docs/`. The list is in `TESTING.md` section 7. Do not change those sentences without a look at that list.
- The word UNVERIFIED marks a claim that no run on the owner's PC proved.
- The codebase map has no line numbers. Refer to a name that a text search finds.

## 11. Commits and pull requests

- The subject is one sentence in the imperative, or a statement of the new behaviour. No Conventional Commits types.
- Many subjects start with an area prefix and a colon: `Lists:`, `TODO:`, `Tests:`, `Docs:`, `CI:`, `Worker:`, `Settings:`, `Popup:`, `Packer:`.
- The body, when there is one, has short paragraphs or `-` bullets. It names the files and the tests. It says what was not tested.
- Work is on a branch, then a pull request goes to `main`. Each pull request and each push to `main` runs the jobs `tests`, `privacy` and `release-gate`.
- The privacy job also scans commit messages and author data. A bad commit message stays in the branch history. A squash merge keeps it out of `main`.
- A release is not a tag push. The owner starts the `release` workflow by hand, on `main`.

## 12. GitHub Actions conventions

- Each action is pinned to a full 40-character commit SHA, with the version in a comment. Only `actions/checkout` and `denoland/setup-deno` are used.
- A new third-party action must be added to the permitted patterns of the repository before use (UNVERIFIED: repository settings, from a workflow comment).
- Minimum token permissions: `contents: read`, or `contents: write` only on the release job. `persist-credentials: false` on each checkout.
- The runner (`ubuntu-24.04`) and the Deno version (`v2.9.8`) are pinned.
- Values from the `github` context go into `env:` first. Then the script reads the variable.
- A pull request does not run its own code with the secret (M-6). Python runs in isolated mode (`python3 -I`).
- A retired workflow stays as a stub with a comment and `permissions: {}`.
