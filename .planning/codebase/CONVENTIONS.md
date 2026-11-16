# Coding conventions

Analysis date: 2026-11-16
Commit: b01e6a5 (`git rev-parse --short HEAD`)

This document tells you the conventions that the code uses now. It does not tell you what the conventions should be. Each statement comes from a file that was read for this analysis. Statements about behaviour in Chrome come from comments or docs only. They have the mark UNVERIFIED.

## 1. Summary of the most important rules

- `src/` contains classic scripts only. There are no ES modules, no bundler and no build step.
- Each module sets one global object, or exports through an `install...(target)` function.
- Page-world (MAIN world) files of the project are one IIFE each. They add no globals to the page.
- Names that a web page can see are neutral (`gk-*`, `gk.*`). They do not contain the product name.
- Logic does not call `chrome.*` directly where a test must run it. The caller injects dependencies (`deps`, `env`, `api`).
- `scripts/release-gate.sh` enforces the security and packaging rules. Read section 7 before you change a file in `src/` or `manifest.json`.
- Two playback files are frozen: `src/vendor/video-swap-new.user.js` and `src/kick.js`. A change needs an owner decision.
- Generated files have a `GENERATED` header. Change the source and run the generator. Do not edit the file by hand.
- All text files use LF line endings and UTF-8. Write Unicode noncharacters as `\uXXXX` escapes.

## 2. Module patterns in `src/`

### 2.1 Classic scripts

`src/` has no `import` statement and no `export` statement (a grep for `^import ` and `^export ` in `src/*.js` and the subdirectories found nothing, vendor files not included). The service worker loads its modules with one `importScripts(...)` call (`src/general-background.js:7` to `8`). Extension pages load modules with `<script src>` tags (`src/settings.html:112` to `115`). Content scripts get their modules from the `js` arrays in `manifest.json`.

The load sequence is part of the contract. Examples:

- `src/settings/features.js` is first in each isolated-world `js` array that uses it (`manifest.json`; `test/settings.test.js:40` to `45` checks this).
- `src/general/never-block-captcha.js` loads before `src/threat/protected-hosts.js` and `src/general/update.js` (`src/general/never-block-captcha.js:3` to `6`).
- `scripts/feed-sign.mjs:23` to `25` and `scripts/build-threat-rules.mjs:20` to `28` import `src/` files with `src/threat/psl.js` first. The two lists of files are not the same.

The `importScripts` call contains string literals only. `scripts/lib/package_files.py` (docstring, used by gate section 1) and gate section 3 enforce this.

### 2.2 Pattern A: IIFE that sets one global

The file is `(function (root) { ... root.<Global> = ...; })(typeof self !== "undefined" ? self : globalThis);`. Most globals are frozen with `Object.freeze`.

| File | Global | Frozen |
|---|---|---|
| `src/settings/features.js:11`, `:201` | `GeckoFeatures` | yes |
| `src/general-settings.js:6`, `:64` | `GeneralSettings` | no |
| `src/general/filter-options.js:21`, `:446` | `GeneralFilterOptions` | no |
| `src/general/cosmetic-parse.js:10`, `:467` | `GeneralCosmeticParse` | no |
| `src/general/never-block-captcha.js:7`, `:8` | `GeckoNeverBlockCaptcha` | yes |
| `src/threat/psl.js:21`, `:104` | `GeckoPublicSuffix` | yes |
| `src/threat/protected-hosts.js:25`, `:99` | `GeckoProtectedHosts` | yes |
| `src/threat/compile.js:9`, `:140` | `GeckoThreatCompile` | yes |
| `src/feed/config.js:7`, `:11` | `GeckoFeedConfig` | yes |
| `src/feed/keys.js:9`, `:12` | `GeckoFeedKeys` | yes |
| `src/feed/canonical.js:9`, `:69` | `GeckoFeedCanonical` | yes |
| `src/feed/schema.js:32`, `:195` | `GeckoFeedSchema` | yes |
| `src/feed/verify.js:10`, `:63` | `GeckoFeedVerify` | yes |
| `src/feed/compile.js:6`, `:48` | `GeckoFeedCompile` | yes |
| `src/feed/client.js:11`, `:311` | `GeckoFeedClient` | yes |

`src/settings/features.js:12` to `18` has a guard against a second injection into one frame. The guard checks the shape of the first registry, not only that a value is there. The comment gives the reason: a page element with `id="GeckoFeatures"` is a named property of `window`.

A module gets a different module through the global, at the time of use. Example: `src/general/update.js:137`, `:182`, `:556`, `:671`.

### 2.3 Pattern B: `install...(target)` function

The file declares `function installX(target) { ... target.name = name; ... }`. The function puts constants and pure functions on `target`. Code at the end of the file starts the feature only when the environment has the necessary objects.

| File | Install function | What the end of the file does |
|---|---|---|
| `src/general/update.js:16` | `installGeneralAdblockUpdate` | Sets `globalThis.GeneralAdblockUpdate` (`:1343`) |
| `src/general/toggles.js:4` | `installGeneralAdblockToggles` | Sets `globalThis.GeneralAdblockToggles` (`:112`) |
| `src/general/exclusions.js:3` | `installGeneralAdblockExclusions` | Sets `globalThis.GeneralAdblockExclusions` (`:132`) |
| `src/general/cosmetic.js:3` | `installGeneralAdblockCosmetic` | Sets `globalThis.GeneralAdblockCosmetic` (`:74`) |
| `src/general-exclude-hosts.js:9` | `installGeneralExcludeHosts` | Puts the install function itself on `globalThis` (`:115`) |
| `src/cosmetic.js:4` | `installCosmeticHide(api)` | Starts when `document` and `chrome.storage` are there (end of file) |
| `src/twitch-directory-ads.js:3` | `installTwitchDirectoryAds` | `startTwitchDirectoryAds()` when `document` and `location` are there (`:150` to `152`) |
| `src/kick.js:7` | `installKickAdblock` | `api.startKickAdblock()` when `window` and `document` are there (`:764` to `768`) |
| `src/youtube.js:20` | `installYoutubeAdblock` | `startYoutubeAdblock()` when `document` and `window` are there (`:2215`) |
| `src/guards/clipboard.js:84` | `installClipboardGuard` | `target.install(env)` (`:202`) wraps the page APIs |
| `src/guards/popups.js:39` | `installPopupGuard` | `target.install(env)` (`:153`) |

### 2.4 Pattern C: page scripts in an anonymous IIFE

`src/popup.js:1`, `src/settings.js:6` and `src/settings/flags.js:22` are `(function () { ... })();` without a global. They read the globals of Pattern A (`src/settings.js:7` to `8`, `src/settings/flags.js:28`).

### 2.5 Service worker

`src/general-background.js` is not in an IIFE. It has top-level `const` aliases with short capital names for the globals: `TC`, `FC`, `CP`, `GU`, `GS`, `KEYS` (`src/general-background.js:9` to `15`). Asset paths are relative to `src/` (`../icons/...`), and the comment at `:17` to `18` gives the reason.

### 2.6 Modules that nothing loads

`scripts/lib/package_files.py:44` to `57` records that `src/general-exclude-hosts.js`, `src/general/toggles.js`, `src/general/exclusions.js` and `src/general/cosmetic.js` are packed but not loaded. The comments call them dead modules and have the mark `NEEDS OWNER` (`:16`, `:54`). Do not remove them without an owner decision.

## 3. Naming

### 3.1 Globals

| Prefix | Use | Examples |
|---|---|---|
| `Gecko*` | Newer modules (settings, threat tier, feed, captcha list) | `GeckoFeatures`, `GeckoThreatCompile`, `GeckoFeedClient` |
| `General*` | List tier ("general adblock") modules | `GeneralSettings`, `GeneralFilterOptions`, `GeneralCosmeticParse` |
| `GeneralAdblock*` | `install...` modules of the list tier | `GeneralAdblockUpdate`, `GeneralAdblockToggles` |

Constants are `UPPER_SNAKE_CASE` (`REFRESH_ALARM`, `LIST_RULE_ID_BASE` in `src/general/update.js:17` to `27`). Functions and variables are `camelCase`. Feature ids are `camelCase` strings (`src/settings/features.js:40` to `52`).

### 3.2 Names that a web page can see (neutral ids)

The rule: no product name in a place that a page script can read. `test/hardening.test.js:37` to `46` enforces it for `Symbol.for` ids, DOM ids and marker properties.

| Name | Type | Where |
|---|---|---|
| `gk-c1` | `<style>` id of the cosmetic hide sheet | `src/cosmetic.js:5` |
| `gk-t1` | `<style>` id of the Twitch directory hide | `src/twitch-directory-ads.js:6` |
| `gk-n1` | id of the YouTube notice element | `src/youtube.js:1255`, `:1277` |
| `gk-p1` | Event name: the flags script gives a private `MessagePort` | `src/settings/flags.js:23`, `src/youtube.js:1050`, `src/kick.js:680`, `src/guards/clipboard.js:661`, `src/guards/popups.js:288` |
| `gk-r1` | Event name: a page-world script requests its port | `src/settings/flags.js:24`, `src/youtube.js:1087`, `src/kick.js:719`, `src/guards/clipboard.js:693`, `src/guards/popups.js:320` |
| `Symbol.for("gk.y")` | Guard against a second start of `src/youtube.js` | `src/youtube.js:1021` |
| `Symbol.for("gk.u")` | The uBO MAIN-world bundle is there | `src/vendor/ubo-youtube.js:8`, `src/youtube.js:14` |
| `Symbol.for("gk.ui")` | The uBO isolated-world bundle | `src/vendor/ubo-youtube-isolated.js:8` to `9` |

The Kick hide style has no id. The code keeps a reference to the element (`src/kick.js:11` to `12`).

Ids in the extension pages are not neutral, because a web page cannot read them. They are `kebab-case` (`fix-site`, `allow-site`, `lists-status` in `src/popup.html`; `allow-domain`, `update-lists`, `h-features` in `src/settings.html`).

### 3.3 Storage keys

All keys are in `chrome.storage.local`, but `tabSignals` is in `chrome.storage.session`.

| Key | Owner / source |
|---|---|
| `settings`, `siteOverrides` | `src/settings/features.js:6` to `8` (shape documented there) |
| `generalEnabled`, `generalAllowedOrigins` | Legacy keys, kept as derived mirrors (`src/settings/features.js:9` to `10`, `src/general-settings.js:7` to `13`) |
| `generalListUpdatedAt`, `generalListStatus`, `generalListUpdateRequestAt` | `src/general-settings.js:7` to `13` |
| `listState`, `listData:<name>` | `src/general-background.js:456` to `457` |
| `generalListRefresh` | Old list state key, read for migration (`src/general-background.js:458`) |
| `threatAllowDomains` | `src/general-background.js:216` |
| `tabSignals` | `src/general-background.js:1084`. This key is in `chrome.storage.session` (`:1077`, `:1089` to `1091`) |
| `feedState`, `feedCache`, `feedPaused` | `src/feed/client.js:14` to `16` |
| `cosG`, `cosMeta`, `cosKeys`, `cosS:<host>`, `cosE:<host>` | `src/general/cosmetic-parse.js:418` to `426` |
| `popupFix`, `popupWelcomed`, `uiTheme` | `src/popup.js:10` to `23` |
| `general-adblock` | `src/general/toggles.js:5`. This module is not loaded (section 2.6) |

Conventions for keys:

- Keys are `camelCase`. A record for each list or host uses a prefix that ends in a colon (`listData:`, `cosS:`).
- A file that uses a key of a different file repeats the string and adds a comment. Example: `src/cosmetic.js:6` says "do not rename without coordinating".
- Small state and large payloads have different keys (`src/general/update.js:11` to `15`).

### 3.4 Messages, alarms, rule ids

- Runtime messages have `source: "adgecko-general"` and a `type` (`src/popup.js:363`, `src/settings.js:25`, `src/cosmetic.js:86`, `src/settings/flags.js:56`). The worker ignores a message with a different `source` (`src/general-background.js:1163`). The worker handles the types `cosmeticCss`, `guardEvent`, `applyGeneralState`, `updateLists`, `revertLists`, `tabSignal`, `siteInfo` (`src/general-background.js:1170` to `1211`). `cosmeticCss` is a message type, not a storage key.
- There is one alarm, `gecko-refresh` (`src/general/update.js:18`). Gate section 4 permits no second alarm.
- Each group of DNR rules has its own id range with a named constant. See the table below.
- Static ruleset ids are `general`, `ubo-youtube`, `threat` (`manifest.json`).

| Constant | Value | Where |
|---|---|---|
| `LIST_RULE_ID_BASE` | 100000 | `src/general/update.js:25` |
| `THREAT_RULE_ID_BASE`, `THREAT_RULE_ID_END` | 600000, 610000 | `src/general/update.js:31` to `32`; `docs/threat-tier.md:16` gives ids 600000 to 609999 |
| `FEED_RULE_ID_BASE`, `FEED_RULE_ID_END` | 700000, base + 4501 | `src/feed/compile.js:7` to `8` |
| `KEPT_RULE_ID_BASE` | 800000 | `src/general/update.js:26` |
| `ALLOW_RULE_ID_BASE` | 900000 | `src/general/update.js:27` |
| `THREAT_ALLOW_ID_BASE` | 950000 | `src/general-background.js:217` |
| `LIST_ALLOW_RULE_ID` | 990001 | `src/general/update.js:96` |

### 3.5 Files

| Area | Convention | Examples |
|---|---|---|
| `src/` | `kebab-case.js`; one directory for each subsystem | `src/general/filter-options.js`, `src/threat/protected-hosts.js`, `src/feed/client.js` |
| `src/vendor/` | Upstream file names; a licence file for each dependency | `src/vendor/video-swap-new.user.js`, `src/vendor/LICENSE-uBlock.md` |
| `src/rules/` | Packed data (`*.json`), metadata (`*-meta.json`, `meta.json`), licence text | `src/rules/threat-meta.json` |
| `scripts/` | `kebab-case`. Most names start with a verb (`pack-`, `build-`, `sync-`, `update-`, `merge-`). `.mjs` for Deno or Node, `.py` for Python 3, `.sh` for Bash | `scripts/pack-zip.sh`, `scripts/build-threat-rules.mjs`, `scripts/sync-ubo-youtube.mjs`; not verb first: `scripts/release-gate.sh`, `scripts/privacy-check.py`, `scripts/feed-keygen.mjs` |
| `scripts/lib/` | Helpers that scripts and tests import | `scripts/lib/package_files.py`, `scripts/lib/twitch-vendor.mjs` |
| `docs/` | `kebab-case.md` for current pages; capitals for owner-facing notes | `docs/how-it-works.md`, `docs/STORE-REVIEW-NOTES.md` |

The scripts that were read start with a header comment or docstring that gives the purpose and the command line. Some also give the exit codes (for example `scripts/update-twitch-vendor.mjs:1` to `21`, `scripts/lib/curben_check.py:26`, `scripts/lib/package_files.py:18` to `24`).

### 3.6 Tests

There are 121 `test/*.test.js` files with 768 `Deno.test(` calls (counts from `ls` and `grep -o`). Tests run with `deno test --no-lock --allow-read --allow-run --allow-env test/` (`.github/workflows/checks.yml:46`). There is no `deno.json` and no `package.json`.

| Name pattern | Meaning | Source |
|---|---|---|
| `test/<topic>.test.js` | Tests for a subsystem (`settings`, `guards`, `dnr-queue`, `packaging`) | file list |
| `test/nightly-<area>-<n>-<short text>.test.js` (38 files) | One bug from the 0.3.5 bug hunt, proven by a test that failed first | `CHANGELOG.md` section 0.3.5 |
| `test/final-<area>-<n>-<short text>.test.js` (12 files) | One finding of the final review of 0.3.5 | `CHANGELOG.md` section 0.3.5 |
| `test/wave2-<area>-<topic>.test.js` (6 files) | "Wave 2" features of 0.3.5 | commit `20ef8e7` subject |
| `test/pr12-*.test.js` (1 file) | Review feedback on pull request 12 (inference from the file name) | file name |
| `test/fixtures/*` | Fake Chrome model, DNR matcher, source helpers, sample data | `test/fixtures/fake-chrome-worker.js:1` to `4` |

Conventions inside a test file:

- The first comment gives the "Block" or the review tag that the file covers (`test/settings.test.js:1`, `test/dnr-queue.test.js:1`).
- A test loads a classic script with `import "../src/<file>.js";` and then reads the global (`test/settings.test.js:3` to `8`, `:17`).
- JSON and source text load with import attributes: `with { type: "json" }` and `with { type: "text" }` (`test/settings.test.js:9`, `test/fixtures/fake-chrome-worker.js:5`).
- Each file defines a local helper `function assert(c, l) { if (!c) throw new Error(l); }` (`test/settings.test.js:15`). The message says what was expected.
- Test names are full sentences that state the behaviour. Some start with the tag (`"L-5: ..."` in `test/dnr-queue.test.js:53`).
- A test that is held for an owner decision stays in the file with `ignore: true` (6 tests in 4 files). A test that needs a tool, a cache or a secret uses a condition (`ignore: !canPack` in `test/packaging.test.js:89`; `ignore: !haveCache` in `test/final-storage-budget.test.js:36`; `test/privacy-generic.test.js:225`, `:282`).
- Many tests read source text and check it with a regular expression (for example `test/hardening.test.js:48` to `58`). A change of wording in a source line can fail such a test.
- To reach the functions inside a MAIN-world IIFE, a test removes the wrapper with `unwrapMain` (`test/fixtures/main-source.mjs:1` to `19`; 22 test files use it).
- To change options of `src/youtube.js`, a test edits the `const OPTS = {...};` line in the source text (`test/fixtures/source-opts.mjs:5` to `13`). Thus that line must stay on one line with two spaces of indent.

## 4. Dependency injection for tests

The code separates decisions from browser APIs. A test supplies a fake object.

| Mechanism | Where | What the caller injects |
|---|---|---|
| `deps` object | `src/general/update.js` | `fetch`, `now`, `getState`, `setState`, `getListData`, `setListData`, `removeListData`, `listDataPresent`, `getDynamicRules`, `updateDynamicRules`, `setStaticEnabled`, `exclusive`, `enabled`, `threatEnabled`, `loadBundled`, `loadPackedThreatRules`, `writeCosmetic`, `revertCosmetic`, `cosmeticParse`, `fetchTimeoutMs`, `maxListBytes` |
| `deps` object | `src/feed/client.js` | `fetch`, `now`, `config`, `keys`, `manifest`, `extensionVersion`, `getState`, `setState`, `getCache`, `setCache`, `getPaused`, `getSessionRules`, `updateSessionRules`, `protectedReason`, `loadSnapshot`, `timeoutMs` |
| `listDeps()`, `feedDeps()` | `src/general-background.js:578`, `:345` | The worker makes the real `deps` from `chrome.*` calls |
| `env` object | `src/guards/clipboard.js:202`, `src/guards/popups.js:153` | `window`, `document`, `navigator`, `location`, `flagOn`, `now`, `notify` or `signal` |
| `api` / `target` object | All `install...` functions | An empty object; the function fills it. The end of the file makes its own `api` (`src/kick.js` end, `src/cosmetic.js` end) |
| Optional parameters with a global fallback | `src/general/cosmetic.js:4` to `5`, `src/cosmetic.js:155` | `exclusions`, `toggles`, `api.parse` |

Rules that follow from this:

- `src/general/update.js`, `src/general/filter-options.js`, `src/threat/*.js` and `src/feed/*.js` contain no `chrome.` or `browser.` call. Gate section 4 enforces this.
- Only `refreshLists()` in `src/general-background.js` passes `exclusive` in `deps` (`:841`). Code inside a DNR section must not wait for a second `dnrExclusive()` call (`src/general-background.js:37` to `39`).
- `src/general-background.js:581` to `584` wraps `fetch` so that only list URLs are possible.
- The scripts in `scripts/` use the runtime parser and compiler from `src/`, not a copy (`scripts/build-threat-rules.mjs:10` to `13`).

## 5. Comment style

### 5.1 General style

- A source file starts with a comment block that says what the file does and what it does not do. A content script also says where it runs (world, `run_at`, frames). See `src/guards/clipboard.js:1` to `60` and `src/general/update.js:1` to `15`. `src/popup.js` has this comment inside its IIFE (`:2` to `9`).
- Comments give the reason and frequently the history of a bug ("used to ...", "was ...").
- Comments name the related file and the test that keeps a rule ("`test/psl.test.js` keeps the copies equal", `src/guards/popups.js:11` to `12`).
- Comments use the words "fail-open" for the error policy of page code (`src/guards/clipboard.js:55` to `56`, `src/settings/flags.js:17` to `18`).
- Comments mark statements that were not proven in Chrome with `UNVERIFIED` (`src/guards/clipboard.js:45`, `:50`, `:53`; `src/settings/flags.js:19`).
- A `catch` block that does nothing usually contains a short comment that gives the result (`// no dot`, `// guard not installed`, `// no live updates`). Exceptions: `src/youtube.js:1140` and `:2125` have an empty `catch {}`.
- `src/general-background.js:1` and `src/general-settings.js:1` use a `/** ... */` block. Most other files use `//` lines.
- `src/general-exclude-hosts.js:3` and `:10` contain damaged characters (mojibake) in comments where a dash was. This is a fact of the file, not a convention.

### 5.2 Security review tags (`H-n`, `M-n`, `L-n`, `I-n`)

A grep found the tags below in `src/`, `scripts/`, `test/` and `.github/`. `docs/threat-tier.md:86` and `:115` and `CHANGELOG.md:226` also use tags. The letter gives the class of a finding in a security review and the number identifies the finding. The first letters agree with High, Medium, Low and Informational, but no file in the repository defines the letters. The review report is not in the repository (a search of `docs/` found no definition). Thus the meaning of the letters is an inference.

A tag in a comment means: "this code is the fix for that finding; do not remove it". The same tag is in the test that proves the fix. To find all code for one finding, search for the tag.

| Tag | Subject (from the comment) | Code | Test |
|---|---|---|---|
| H-1 | No OpenPhish data (with owner decision #13) | `src/general/update.js:187`, `scripts/pack-filter-lists.py:216` | `test/no-openphish.test.js` (same subject; the tag is not in the test file) |
| H-2 | Filter options are converted exactly; a filter is not widened to a block of a full domain. Also: the package file list is derived | `src/general/filter-options.js:7`, `src/general/update.js:127`, `scripts/merge-dnr-rules.py:121`, `scripts/pack-filter-lists.py:231`, `scripts/lib/package_files.py:5` | `test/filter-options.test.js:1`, `test/packaging.test.js:1`, `test/list-refresh.test.js:18` |
| M-1 | Feature flags go through a private `MessagePort`, not `window.postMessage` | `src/settings/flags.js:8`, `src/youtube.js:1054`, `src/kick.js:684`, `src/guards/clipboard.js:665`, `src/guards/popups.js:292` | `test/settings.test.js:252`, `test/guards.test.js:319` |
| M-2 | Two findings use this tag: "the visitor copied it" in the clipboard guard, and `lastRunAt` only after a good run | `src/guards/clipboard.js:17`, `src/general/update.js:622`, `:842` | `test/guards.test.js:132`, `test/hardening.test.js:83` |
| M-3 | Public suffixes and shared platforms are never blocked; cap on new threat hosts | `src/threat/psl.js:9`, `src/threat/protected-hosts.js:19`, `src/general/update.js:517`, `scripts/build-psl-subset.mjs:3`, `scripts/build-threat-rules.mjs:22` | `test/psl.test.js:1` |
| M-4 | Feed kill latch | `src/feed/client.js:144` | `test/feed-client.test.js:135` |
| M-5 | Two uses: feed time window (`src/feed/schema.js:14`); Twitch directory sweep limits (`src/twitch-directory-ads.js:59`) | see left | `test/feed-core.test.js:203`, `test/stream-hygiene.test.js:2` |
| M-6 | Pull request code does not run with the CI secret | `.github/workflows/checks.yml:40`, `:58` | `test/privacy-generic.test.js:1` |
| M-7 | Privacy checks that need no secret | `scripts/privacy-check.py:18` | `test/privacy-generic.test.js:1` |
| M-8 | Each list names its upstream terms | - | `test/no-openphish.test.js:186` |
| M-9 | Gate checks: all rulesets, host labels, no extension API in page-world and library files | `scripts/release-gate.sh:520`, `:654`, `:684` | - |
| M-10 | Store description says what the extension does | - | `test/hardening.test.js:99` |
| M-16 | Kick listener wrapper supports removal | `src/kick.js:582` | `test/stream-hygiene.test.js:2` |
| L-1 | No references to a personal machine | - | `test/privacy-generic.test.js:224` |
| L-2 | Download timeout includes the body | `src/general/update.js:889` | `test/list-refresh.test.js:225` |
| L-3 | A list line cannot name a public suffix | `src/general/update.js:161`, `scripts/pack-filter-lists.py:647` | `test/psl.test.js:1` |
| L-5 | All DNR writes go through one queue | `src/general-background.js:30`, `src/general/update.js:1028`, `:1080` | `test/dnr-queue.test.js`, `test/general-race.test.js:80` |
| L-6 | One stream-host list; copies must not drift | `src/settings/features.js:24`, `scripts/pack-filter-lists.py:137` | `test/settings.test.js:354`, `:374` |
| L-7 | Feed serial limits | `src/feed/schema.js:17` | `test/feed-core.test.js:203` |
| L-8 | Feed body size cap | `src/feed/client.js:42` | `test/feed-client.test.js:279` |
| L-9 | Key file path must be outside the repository | `scripts/lib/feed-tools.mjs:56` | `test/feed-client.test.js:308` |
| L-10 | Cached list bytes must agree with `meta.json` | `scripts/build-threat-rules.mjs:75` | `test/feed-client.test.js:317` |
| L-13 | Actions pinned to full commit SHAs | `.github/workflows/checks.yml:12` | `test/privacy-generic.test.js:1` |
| L-14 | Kick post-roll cover obeys the `kick` switch | `src/kick.js:39`, `:290`, `:474` | `test/stream-hygiene.test.js:79`, `test/kick.test.js:185` |
| L-16 | `youtubeCosmetic` switch includes each DOM sweep | `src/youtube.js:2082` | `test/settings.test.js:343` |
| L-17 | Popup guard compares registrable domains | `src/guards/popups.js:9`, `scripts/build-psl-subset.mjs:4` | `test/psl.test.js:195` |
| L-18 | MAIN-world files are one IIFE, no page globals | `src/youtube.js:9`, `src/kick.js:5`, `src/guards/clipboard.js:60`, `src/guards/popups.js:18` | `test/hardening.test.js:65`, `test/fixtures/main-source.mjs:3` |
| I-5 | One data set for three jobs (PSL) | `src/threat/psl.js:9`, `scripts/build-psl-subset.mjs:147` | `test/psl.test.js:1` |
| I-6 | A rollback to a `killFeed` document reports "killed" | `src/feed/client.js:282` | `test/feed-client.test.js:297` |

Related phrases in comments:

- "follow-up review" and "review of M-1": a second review of a fix (17 uses of "follow-up review" in `src/`, `scripts/`, `test/` and `.github/`).
- The tag numbers have gaps. No use of M-11 to M-15, L-4, L-11, L-12, L-15, I-1 to I-4 or H-3 was found.
- "final review 8", "final review 9, round 2": findings of the final review of 0.3.5 (`src/guards/clipboard.js:31`, `:41`).
- "nightly 0.3.5": a change from the 0.3.5 bug hunt (`src/general/update.js:129`, `src/guards/popups.js:105`).
- "Block B" to "Block K", "Block 1e", "Block 1f", "Block 1h", "Block 2", "Block 3", "Block 4": work packages of a build plan (inference from the comments). Tests name their block in line 1 (`test/storage-alarm.test.js:1` Block B, `test/threat-tier.test.js:1` Block D, `test/list-guard.test.js:1` Block E, `test/feed-core.test.js:1` Block F, `test/feed-client.test.js:1` Block G, `test/settings.test.js:1` Block H, `test/hardening.test.js:1` Block I, `test/guards.test.js:1` Block J, `test/stream-hygiene.test.js:1` Block K). The plan document is not in the repository. Comments also refer to a file `BUILD-PROGRESS.md` (`scripts/lib/package_files.py:16`, `test/no-openphish.test.js:197`). That file is not in the repository.

### 5.3 Owner decision tags

| Tag | Decision | Where |
|---|---|---|
| D-1 | The feed host name is not selected; the feed is dormant | `src/feed/config.js:2`, `docs/feed-setup.md:10` |
| D-3 | Vendored Twitch and uBO scripts are always on; they get no flags | `src/settings/features.js:34`, `src/settings/flags.js:21`, `test/settings.test.js:27`, `CHANGELOG.md:221` |
| D-4 | Guard defaults: clipboard on, pop-ups off | `test/settings.test.js:29`, `test/guards.test.js:299` |
| D-7 | Who signs the feed (an open decision); the tag is also on the 14-day lifetime limit | `src/feed/schema.js:34`, `scripts/feed-sign.mjs:11`, `docs/feed-setup.md:11` |
| #13 | No phishing-feed data; one phishing list removed on 2026-11-02 | `scripts/pack-filter-lists.py:97`, `scripts/lib/curben_check.py:2`, `scripts/release-gate.sh:549`, `docs/threat-tier.md:46` |
| #17 | Code is GPLv3; the brand has separate terms | `test/license.test.js:1` |
| #18b | One exception: the urlhaus-filter list, from one URL only | `scripts/release-gate.sh:549`, `:645`, `scripts/pack-filter-lists.py:100`, `docs/permissions-and-privacy.md:23` |
| "owner decision <date>" | A decision with a date and no number | `test/no-background-fetch.test.js:54`, `test/no-openphish.test.js:1`, `:201` |
| `NEEDS OWNER` | A question that is open | `scripts/lib/package_files.py:16`, `:54`, `test/no-openphish.test.js:197` |
| `OWNER DECISION` | Printed by the Twitch update script when the gate will fail by design | `scripts/update-twitch-vendor.mjs:165`, `docs/UPDATING-DEPENDENCIES.md:86` |

`D-n` tags and `#n` tags are two different number series. Only D-1, D-3, D-4, D-7, #13, #17 and #18b were found. No file in the repository contains the full lists.

## 6. Rules for page-world code

These rules apply to the MAIN-world files of the project: `src/youtube.js`, `src/kick.js`, `src/guards/clipboard.js`, `src/guards/popups.js` (list in `test/hardening.test.js:69`).

| Rule | Evidence | Enforced by |
|---|---|---|
| The file is one `(() => { ... })();`. The first code line is `(() => {` and the last line is `})();`. No new global name. | `src/kick.js:5` to `6`, `src/youtube.js:9` to `10`, `src/guards/clipboard.js:60` to `61`, `src/guards/popups.js:18` to `19` | `test/hardening.test.js:67` to `80` |
| No `chrome.*` or `browser.*` | The files run in the page | Gate section 4 |
| No product name in `Symbol.for` ids, DOM ids or style ids | Section 3.2 | `test/hardening.test.js:37` to `46` |
| No marker property on page objects. Use a `WeakSet` or `WeakMap`. | `src/kick.js:8` to `14` (`wrapped`), `:263`, `:343`, `:389`; `src/youtube.js:311`, `:920`, `:1117`, `:1184`; `src/guards/clipboard.js:212` | `test/hardening.test.js:42` (old marker names only) |
| No output to the page console unless a debug switch is on | `src/kick.js:10` `const DEBUG = false;` and one `console.log` in the log helper (`:16`); `src/youtube.js:1031` `OPTS.diag` is false. Each `console.log` there is behind `OPTS.diag`, on the same line or by an early return in the `diag` helper (`:1093` to `1096`). The two guard files contain no `console.` call | `test/hardening.test.js:48` to `58` |
| No options from `localStorage` or other storage that the page can write | `src/youtube.js:1025` to `1027` | `test/hardening.test.js:14` to `26` |
| No `.innerHTML =`, `eval(`, `document.write(`, `new Function(` | DOM is made with `createElement` and `textContent` (`src/guards/clipboard.js:639` to `644`, `src/kick.js:517` to `518`). A grep found no such call in the project files of `src/` | Gate section 3 |
| Flags come only through the private port (`gk-p1` / `gk-r1`). A feature stays on until a flag says off. An "off" flag stops the next action; it does not remove a patch. | `src/youtube.js:1040` to `1049`, `src/settings/flags.js:8` to `21` | `test/settings.test.js:252`, `test/guards.test.js:319` |
| Capture built-ins and getters at the top of the file, before page scripts run. Call them with `Reflect.apply`. | `src/guards/clipboard.js:62` to `82`, `src/guards/popups.js:20` to `37` | `test/guards.test.js:223` |
| Fail-open: an internal error lets the page call continue | `src/guards/clipboard.js:55` to `56`, `src/guards/popups.js:8` | - |
| No web-accessible resources | `src/cosmetic.js:81` | `test/hardening.test.js:28` to `35` |

Related rules for isolated-world content scripts and extension pages:

- `src/settings.js:5`: "No remote code, no eval, text only (no innerHTML)". A grep found no `innerHTML` use in `src/popup.js` or `src/settings.js`.
- `src/popup.html` loads only `popup.js` (`src/popup.html:55`) and has no `onclick=` attribute (gate section 1).
- The worker logs with the prefix `adgecko:` through `console.warn` and `console.log` (`src/general-background.js:61`, `:788` to `790`). This output goes to the worker console, not the page console (UNVERIFIED in Chrome).
- The stream-site host list exists only in `src/settings/features.js:26` to `30`. Other files must get it from `GeckoFeatures` (`test/settings.test.js:49` to `61`).

The effect of these rules in a real Chrome page is UNVERIFIED in this analysis. No test was run.

## 7. Rules enforced by `scripts/release-gate.sh`

The gate runs on the checkout (default, or `--dir`) or on a packed zip (`--zip`). It needs `deno`, `python3` and `rg` (and `unzip` for `--zip`). It prints `PASS`, `FAIL` or `SKIP` for each check, and `VERDICT: CLEAN` or `VERDICT: FAIL` at the end. The exit code is 0 for CLEAN, 1 when a check failed, and 2 for a usage error or a missing tool (`:29`, `:42` to `50`, `:794` to `806`).

CI runs the gate two times: on the checkout and on the packed zip (`.github/workflows/checks.yml:109` to `116`, `.github/workflows/release.yml:66` to `77`).

The checks of sections 2, 3 (URL hosts) and 4 are Python programs inside the script. Section 2 stops at its first failure and counts one `FAIL`.

### Section 1: package allowlist and version (`scripts/release-gate.sh:152`)

1. The version in `manifest.json` equals `--expect-version` (default: the same manifest).
2. If the git tag `v<version>` exists locally, the manifest at that tag has the same version.
3. Each file of the `REQUIRED` array exists (`:81`).
4. With `--zip`: each file agrees with `ALLOWED_RE` (`:144`). A new shipped file must be added to this expression.
5. `scripts/lib/package_files.py` finds each path that the manifest, `importScripts` and the pages name. `importScripts` has string literals only.
6. With `--zip`: the zip contains exactly the derived file list.
7. The popup files are in `src/`, not in the repository root.
8. `src/popup.html` has no `<script>` other than `src="popup.js"`, no `onclick=`, no `javascript:`.
9. The package size is 8,000,000 bytes or less (`:254`).

### Section 1b: playback files not changed (`:256`)

1. `src/vendor/video-swap-new.user.js` and `src/kick.js` (`PLAYBACK_FILES`, `:147`) have no content difference from `origin/main` (or `main`).
2. The two files exist.
3. `src/debug.js` and `src/debug-bridge.js` are not in the package.
4. `src/popup.html` has no debug section.

### Section 2: permissions, host coverage, DNR (`:303`)

1. `host_permissions` is empty, or exactly the list of filter-list hosts in `LIST_HOSTS` (`:311`, same sequence), or that list plus the one feed host from `src/feed/config.js`.
2. `FEED_ORIGIN`, if set, is a bare `https://` origin.
3. The manifest keys `externally_connectable`, `oauth2` and `key` are not set (`:310`).
4. `permissions` contains `declarativeNetRequest` and `storage`. `alarms` is permitted. Nothing else is permitted (`:334`, `:353` to `361`).
5. `optional_permissions` and `optional_host_permissions` do not exist (`:365`).
6. `rule_resources` includes id `general`, enabled, with path `src/rules/general-network.json`. All ruleset paths are `src/rules/*.json`.
7. `background.service_worker` is `src/general-background.js`.
8. Twitch content script: the two Twitch match patterns (minimum), `js` is only the vendored file, `world` MAIN, `run_at` `document_start`, `all_frames` true.
9. YouTube content script (`src/youtube.js`): three match patterns (minimum), `world` MAIN, `all_frames` not true, `js` is only `src/youtube.js`.
10. Kick content script: two match patterns (minimum), `js` is only `src/kick.js`, `world` MAIN, `document_start`, `all_frames` true.
11. `action.default_popup` is `src/popup.html`.
12. No content script loads a debug script.
13. The stream content scripts do not match `music.youtube.com`, `studio.youtube.com` or `youtubekids.com`.
14. The cosmetic content script, if there is one, excludes eight patterns for `twitch.tv`, `youtube.com`, `youtu.be` and `kick.com` (`:466` to `471`) and is not in the MAIN world.
15. `general-network.json` is an array of 30,000 rules or fewer with unique ids (`:488`).
16. `general-network.json` names four stream sites and three video hosts (`:497` to `498`). Its allow rules with priority 9000 or more name each of them. This is a text search in the JSON.
17. Each ruleset is an array of rules with unique integer ids of 1 or more, a `condition` object and a permitted action. The permitted actions are `block`, `allow`, `allowAllRequests` and `upgradeScheme`. `redirect` and `modifyHeaders` actions are not permitted. The enabled rulesets together have 30,000 rules or fewer (tag M-9, `:520` to `:546`).

### Section 2c: threat list sources (`:549`)

`scripts/lib/curben_check.py` must pass. The gate gives it the package, the gate script and the packer script (`:555` to `559`). Only the `urlhaus_hosts` source from one fixed URL is permitted from that upstream project. No other list of the project, and no phishing-feed source, is permitted (owner decisions #13 and #18b; comment at `:550` to `554`). The code of the checker was not read.

### Section 3: dangerous APIs, identity, outbound hosts (`:565`)

1. No `eval(`, `.innerHTML =`, `document.write(`, `importScripts(`, `chrome.identity`, `browser.identity`, `navigator.sendBeacon`, `geolocation`, `RTCPeerConnection`, `webkitRTCPeerConnection` in `src/**/*.js` (`:575`).
2. Three exceptions only: `eval(workerString)` and `adBlockDiv.innerHTML = ` in the vendored Twitch file, and the one `importScripts(` line of string literals in `src/general-background.js`.
3. No `new Function(` in `src/**/*.js` (`:594`).
4. No match for the secret patterns in `manifest.json` and `src/` (`src/rules/` excluded) (`:601`). The patterns are: two `@<provider>.` strings, `api_key` or `password` before `:` or `=`, and private-key headers. The search ignores case.
5. No ad-network or tracker names in `src/**/*.js` (`:609`). They are permitted only in `src/rules/`.
6. Each `http(s)://` URL in a JS code line (not a `//` comment line) has a host from the permitted list. The check uses full host labels (tag M-9, `:654`). The host `example.invalid` is permitted as a base for relative URLs. A URL with `malware-filter` or `curben` in its host must be the one permitted list URL (`:645` to `653`, #18b).

### Section 4: extension API scope (`:674`)

1. No `chrome.` or `browser.` in `src/vendor/video-swap-new.user.js`, `src/youtube.js`, `src/vendor/ubo-youtube.js`, `src/vendor/ubo-youtube-isolated.js`.
2. No `chrome.<name>` or `browser.<name>` in code (comments removed) of `src/kick.js`, `src/guards/*.js`, `src/threat/*.js`, `src/feed/*.js`, `src/general/update.js`, `src/general/filter-options.js`.
3. Permitted `chrome.*` namespaces for each file (comments removed; `browser.*` is not permitted in these files):

| File | Permitted namespaces |
|---|---|
| `src/popup.js` | `runtime`, `tabs`, `storage` |
| `src/general-background.js` | `runtime`, `storage`, `action`, `declarativeNetRequest`, `alarms` |
| `src/cosmetic.js`, `src/settings.js`, `src/settings/flags.js`, `src/twitch-directory-ads.js` | `runtime`, `storage` |
| `src/general-settings.js`, `src/settings/features.js`, `src/general/cosmetic-parse.js` | none |

4. `src/general-background.js` does not contain `setInterval` (`:722`).
5. `chrome.alarms.create(` has `REFRESH_ALARM` as its first argument (`:724`).
6. `src/general/update.js` contains `REFRESH_ALARM = "gecko-refresh"`.

### Section 5: tests (`:735`)

The gate runs `NO_COLOR=1 deno test --no-lock --allow-read --allow-run --allow-env test/` (`:739`) when `test/` is next to the package. A non-zero exit, the word `FAILED`, or "N failed" with N of 1 or more is a failure. With `--zip` this section is skipped.

### Section 6: vendored userscript parse (`:757`)

The vendored Twitch file must contain `ourTwitchAdSolutionsVersion = 23` (`:774`), `AD_SIGNIFIER = 'stitched-ad'` and `function reloadTwitchPlayer`. The body (without the userscript header) must parse without an error. The check uses `new Function(body)` in Deno and does not run the body (`:777` to `778`).

`test/vendor-pin.test.js:39` checks that the literal at gate line 774 agrees with `scripts/vendor-pins.json`.

## 8. Generated files

Do not edit these files by hand. Change the source, then run the generator.

| File | Header or mark | Source | How to regenerate |
|---|---|---|---|
| `src/general/never-block-captcha.js` | `// GENERATED from src/rules/never-block-captcha.json ...` (lines 1 to 2) | `src/rules/never-block-captcha.json` | `python3 scripts/pack-filter-lists.py --never-block-captcha-js` (writes only this file; `scripts/pack-filter-lists.py:1168`) |
| `src/threat/psl.js` | `// GENERATED by scripts/build-psl-subset.mjs. Do not edit by hand` (line 1); data between `/*PSL-SUBSET-START*/` and `/*PSL-SUBSET-END*/` | A Public Suffix List file that you download, and the `PLATFORMS` list in the script | `deno run --allow-read --allow-write scripts/build-psl-subset.mjs --psl <file>` (`scripts/build-psl-subset.mjs:7`) |
| PSL data copy in `src/guards/popups.js` | No file header; the script finds the copy by its `POPUP-PSL` markers (`scripts/build-psl-subset.mjs:247` to `251`). `test/psl.test.js:203` compares the copy with `src/threat/psl.js` | Same PSL file | Same script; it updates the copy in `src/guards/popups.js` |
| `src/vendor/ubo-youtube.js`, `src/vendor/ubo-youtube-isolated.js` | `// GENERATED by scripts/sync-ubo-youtube.mjs. Do not edit by hand.` plus lines for the uBlock Origin tag and the uAssets commit | uBlock Origin scriptlets at a release tag; uAssets filters; local patches in `scripts/sync-ubo-youtube.mjs` and `scripts/lib/youtube-local-patches.mjs` | `deno run -A scripts/sync-ubo-youtube.mjs [--uassets <commit>] [--ubo <tag>]` |
| `src/vendor/ubo-youtube.css` | `/* GENERATED by scripts/sync-ubo-youtube.mjs. Do not edit by hand. */` | Same | Same |
| `src/rules/ubo-youtube-network.json`, `src/vendor/ubo-youtube-meta.json` | No header (JSON). The meta file has `generated_at_utc` | Same | Same |
| `src/rules/general-network.json`, `src/rules/dnr-merge-meta.json` | No header. `dnr-merge-meta.json` has `merged_at_utc` and `source_blocks` | Downloaded filter lists; stream exclusions in `scripts/merge-dnr-rules.py` | `python3 scripts/pack-filter-lists.py` (it runs `scripts/merge-dnr-rules.py`, `scripts/pack-filter-lists.py:1276`) |
| `src/rules/meta.json`, `src/rules/packed-cross.json`, `src/rules/cosmetic-sample.json`, `src/rules/LICENSES.md`, `src/rules/README.md` | No header; `src/rules/README.md:3` says "Built by `scripts/pack-filter-lists.py`" | Same | `python3 scripts/pack-filter-lists.py` |
| `src/rules/threat-network.json`, `src/rules/threat-snapshot.json`, `src/rules/threat-meta.json` | No header; `threat-meta.json` has `built_at_utc` | Threat lists in the packer cache `scripts/.list-cache/` | The packer runs `scripts/build-threat-rules.mjs` at its end (`scripts/pack-filter-lists.py:1344`). By hand: `deno run --allow-read --allow-write scripts/build-threat-rules.mjs` |
| `src/rules/cosmetic-rules.json` | No header; has `packed_at_utc` | EasyList and EasyPrivacy in the packer cache; extras from `src/cosmetic-hide.css` | The packer runs `scripts/pack-cosmetic.mjs` last (`scripts/pack-filter-lists.py:1143` to `1150`, `:1358`). By hand: see `scripts/pack-cosmetic.mjs:5` |
| `scripts/vendor-pins.json` | `"_comment": "Written by scripts/update-twitch-vendor.mjs. Do not edit by hand. ..."` | Upstream userscript | `deno run --allow-net=api.github.com,raw.githubusercontent.com --allow-read=. --allow-write=. scripts/update-twitch-vendor.mjs` |
| `src/vendor/video-swap-new.user.js` | No header added (copy byte for byte); `src/vendor/README.md` says "Do not edit it here" | Upstream userscript at a pinned commit | Same script. `--check` writes nothing |
| `icons/icon{16,48,128}{,-working,-off}.png` | Binary | `icons/source/gecko.svg`, `icons/source/gecko-16.svg` | `node scripts/build-icons.mjs` (`scripts/build-icons.mjs:4`) |

Conventions for generated files:

- A generated JS or CSS file names its generator in line 1. Exception: the vendored Twitch file is an upstream copy without an added header.
- Generated metadata has a UTC time field (`*_at_utc`).
- A test compares the generated file with what the generator would write now. `test/hcaptcha-never-block.test.js:148` to `150` does this for the captcha file.
- The packer cache directories `scripts/.list-cache/` and `scripts/.dnr-cache/` are in `.gitignore`. `*.zip` is also in `.gitignore`; `scripts/pack-zip.sh:15` writes `adgecko-<version>.zip` to the repository root by default.
- `scripts/pack-zip.sh` packs only the files that `scripts/lib/package_files.py` derives, and only `manifest.json`, `src/*` and `icons/*` (`scripts/pack-zip.sh:31` to `42`). It then checks the zip against the same list (`:75`).
- `scripts/pack-filter-lists.py` and `scripts/sync-ubo-youtube.mjs` download from the network. `scripts/build-threat-rules.mjs`, `scripts/pack-cosmetic.mjs` and `scripts/build-psl-subset.mjs` never download; they read local files (their header comments).
- The manifest `exclude_matches` lists must equal `GeckoFeatures.streamExcludeMatches()`. A test compares them (`test/settings.test.js:49` to `51`). No tool that writes the manifest was found; the lists are kept by hand.

## 9. Line endings and encoding

- `.gitattributes` sets `* text=auto eol=lf`. The comment gives the reason: generated files are compared byte for byte with the packer output, and a CRLF checkout on Windows failed the parity test. `*.png`, `*.ico` and `*.zip` are binary.
- `git ls-files --eol` shows 267 text files with LF in the index and the working tree and 149 binary files. Git gives no text class (`i/none`) to 2 files: `src/rules/cosmetic-rules.json` and `src/rules/general-network.json`. No tracked text file has CRLF.
- Scripts write with LF explicitly (`newline="\n"` in `scripts/pack-filter-lists.py:187` and `:960`; `+ "\n"` in `scripts/build-threat-rules.mjs:117` to `118`).
- Bash scripts remove CR from Python output with `tr -d '\r'` (`scripts/pack-zip.sh:31`, `scripts/release-gate.sh:204`, `:225`), because Python on Windows prints CRLF.
- The Twitch update script stops if the upstream file is not UTF-8 or contains CR bytes (`docs/UPDATING-DEPENDENCIES.md:50`).
- Each `.js`, `.css`, `.html` and `.json` file under `src/` must be valid UTF-8 (`test/final-chrome-utf8.test.js:16` to `31`).
- `src/general-exclude-hosts.js:3` and `:10` show damaged characters where a dash was (section 5.1). The file is valid UTF-8 for the test above (UNVERIFIED: the test was not run).

The U+FFFF rule: do not put a raw Unicode noncharacter (U+FDD0 to U+FDEF, U+xFFFE, U+xFFFF) or a lone surrogate in a file under `src/`. Write it as a `\uXXXX` escape. `test/final-chrome-utf8.test.js:1` to `6` records that Chrome refused to load the extension because of a raw U+FFFF in a regular expression in `src/general/cosmetic-parse.js` ("It isn't UTF-8 encoded"). The fixed line is `src/general/cosmetic-parse.js:194` (`\u0080-\uffff`). The fix is commit `bf1bf8f`. The test examines each `.js`, `.css`, `.html` and `.json` file under `src/`. The Chrome behaviour is UNVERIFIED in this analysis.

## 10. Documentation conventions

### 10.1 `CHANGELOG.md`

- Newest version first. The first section is `## Unreleased` (`CHANGELOG.md:7`).
- A released version has the heading `## <version> (<date>)`. `scripts/release-notes.py` finds a section by the text `## <version> (`, thus the space and the parenthesis are necessary.
- Subsections are `### Added`, `### Changed`, `### Fixed` (versions 0.3.1 and later). Optional subsections: `### Not in this release (owner decision)` and `### Roll back to <previous version>`.
- The rollback subsection gives numbered steps with a PowerShell 5.1 command in a fenced block (`CHANGELOG.md:69` to `79`). Versions 0.3.2 to 0.3.5 have this subsection.
- In the sections that were read (Unreleased and 0.3.5), each bullet starts with the area and a colon ("Popup:", "Filter lists:", "YouTube:", "Settings:", "Docs:"). The text is for a user: it says what changed and what the behaviour was before.
- UI labels are bold (`**Allow this site**`). File names and identifiers are in backticks.
- A repack of the lists gets a bullet with the UTC time and the rule counts (example: `CHANGELOG.md:189`).
- Dates are the local date of the owner. Dates in packed files are UTC (`CHANGELOG.md:5`).
- Sections for 0.3.0 and before are a flat list of bullets. Older headings have no date and some have "(beta)".
- The release workflow copies the section of the version into the GitHub release notes (`CHANGELOG.md:3`, `.github/workflows/release.yml`).

### 10.2 `TODO.md`

- Line 3 gives the date of the last update.
- "Where it was left off" gives the last release, work that is prepared but not pushed, and the results of the checks with numbers (tests passed, failed, ignored; gate verdict; zip size).
- "Next steps" has numbered `###` groups with checkboxes `- [ ]` and `- [x]`.
- The file says clearly what was not tested ("Not done: any live site test").
- Owner decisions that are open are items in the list.
- Four commits that update this file use the subject prefix `TODO:` (for example `cd2253f`, `f49bd6f`).

### 10.3 `docs/`

| Type | Files | Convention |
|---|---|---|
| Current reference pages | `docs/how-it-works.md`, `docs/permissions-and-privacy.md`, `docs/threat-tier.md`, `docs/allow-a-page.md`, `docs/credits.md` | Line 3 is a link back to the README (also in `docs/feed-setup.md`). File paths in backticks |
| Procedures for the owner | `docs/UPDATING-DEPENDENCIES.md`, `docs/feed-setup.md` | Commands are for PowerShell, one command in each code block (`docs/UPDATING-DEPENDENCIES.md:5`, `docs/feed-setup.md:29`). `docs/UPDATING-DEPENDENCIES.md` names PowerShell 5.1 |
| Notes before an action | `docs/STORE-REVIEW-NOTES.md` | Says what was not done or reviewed |
| Design | `docs/design/DESIGN-RULES.md`, `docs/design/screenshots/`, `docs/design/rejected/` | Rules have the date of the owner decision; "As built" notes are added below a rule and do not replace it |
| Proposals held for a decision | `docs/proposals/kick-0.3.5-fixes.patch` | A patch file for a frozen file |
| Old one-off files | `docs/beta-0.2.x-release.md`, `docs/release-notes/`, `docs/cards*/`, `docs/agent-notes/`, files with a date in the name | `TODO.md` section 3 lists them as candidates for an archive |

The Twitch update script changes version text in `src/vendor/README.md`, `docs/STORE-REVIEW-NOTES.md`, `docs/credits.md`, `docs/how-it-works.md` and four tests. It stops if a text is not found (`docs/UPDATING-DEPENDENCIES.md`). Thus do not change the wording of those version sentences without a check of `scripts/lib/twitch-vendor.mjs`.

The word UNVERIFIED is used in docs and comments for a claim that was not proven (`docs/design/DESIGN-RULES.md`, `src/guards/clipboard.js`).

## 11. Commit and pull request conventions

Source: `git log --oneline -50`, the subjects of all 99 commits, and some commit bodies. The repository has no commit template and no contribution guide file.

- The subject is one sentence in the imperative or a statement of the new behaviour. One subject of 99 ends with a full stop. No Conventional Commits types (`feat:`, `fix:`). There is no length limit of 72 characters: the longest subject has 112 characters.
- Many subjects start with an area prefix and a colon. Seen in the 99 subjects: `Lists:`, `TODO:`, `Tests:`, `Docs:`, `CI:`, `Changelog:`, `Worker:`, `Settings:`, `Popup:`, `Packer:`, `Clipboard guard:`, `privacy:`.
- Other subjects start with a verb: `Keep`, `Fix`, `Add`, `Remove`, `Move`, `Stop`, `Guard`, `Sync`, `Escape`.
- A subject can give the reason after a colon. Example: `bf1bf8f` "Escape a raw U+FFFF in cosmetic-parse.js: Chrome refused to load the extension".
- Release commits: "Prepare the Adgecko <version> release: version, changelog, rollback steps" (`31c59b7`) or "Release <version>: ..." (`cb497e1`).
- List repack commits give the UTC time: "Filter lists repacked 2026-11-11 22:41 UTC for the 0.3.4 release" (`df961c7`).
- The body, when there is one, has short paragraphs or `-` bullets wrapped at about 80 characters. It names the files and the tests. It says what was not tested ("Not tested in Chrome." in `2823515`).
- Many commits end with a `Co-Authored-By:` trailer for an AI agent (37 trailer lines in the last 60 commits). Some also have a `Claude-Session:` trailer (16 lines in the last 60 commits).
- A commit that goes directly to `main` can name its pull request in the subject: "(PR #13)" in `b01e6a5`.
- Commits that repair a privacy-check failure say so (`a344dd8`, `2f193b4`).

Pull requests:

- Work is on a branch, then a merge commit "Merge pull request #<n> from <account>/<branch>" goes to `main`. The merge body is the pull request title. Seen: #3 and #7 to #13.
- Branch names seen: `claude/<generated-name>`, `claude/adgecko-<version>`, `nightly/<version>`, `rename/adgecko`.
- Pull request titles are short statements: "Release 0.3.5", "Prepare the Adgecko 0.3.4 release (and add a TODO page)", "CI: one-click release workflow".
- A commit after a review says "Review feedback on PR 13." in its body (`56d4ef1`).
- A release is not a tag push. The owner starts the `release` workflow by hand, on `main` (`.github/workflows/release.yml`, `TODO.md`).
- Each pull request, and each push to `main`, runs three jobs: `tests`, `privacy`, `release-gate` (`.github/workflows/checks.yml:3` to `7`, `:26`, `:48`, `:90`).

The privacy job scans the diff, the changed files, file paths, commit messages and author data (`scripts/privacy-check.py:1` to `40`, docstring). It rejects secrets, IP addresses outside the documentation ranges, e-mail addresses (noreply and example domains excepted), home-directory paths and image metadata. A line can contain the marker `privacy-check: allow` (`scripts/privacy-check.py:75`). The marker does not apply to file paths.

## 12. Frozen files and the owner-decision process

### 12.1 Frozen files

| File | How it is frozen | Evidence |
|---|---|---|
| `src/vendor/video-swap-new.user.js` | Gate section 1b (no difference from `origin/main`); SHA-256 pin in `scripts/vendor-pins.json`; `test/vendor-pin.test.js` | `scripts/release-gate.sh:147` to `150`, `test/vendor-pin.test.js:20` to `28` |
| `src/kick.js` | Gate section 1b | `scripts/release-gate.sh:147` to `150`; `TODO.md:18` says "frozen by the release gate" |
| `scripts/release-gate.sh` | By convention: "The owner must approve each change to the gate." The update script does not edit it | `docs/UPDATING-DEPENDENCIES.md`, section "Text that the script does not update" |
| Generated uBO files in `src/vendor/` | Not frozen by the gate. Header "Do not edit by hand"; weekly drift job | Section 8; `.github/workflows/ubo-youtube-drift.yml` |

`src/youtube.js` is not in `PLAYBACK_FILES`. The gate comment at `:146` says that YouTube is "the beta script".

Section 1b means that each change to a frozen playback file fails the gate on a branch until the change is on `origin/main`. `docs/UPDATING-DEPENDENCIES.md` says that this is by design.

### 12.2 The owner-decision process, as seen in the files

No file defines this process. The steps below are an inference from the files.

1. Work that changes a frozen file, a permission, a list source or a default is not merged as a usual fix. It is recorded as an owner decision.
2. A proposed code change for a frozen file is kept as a patch in `docs/proposals/` (example: `docs/proposals/kick-0.3.5-fixes.patch`).
3. The tests for the held change stay in `test/` with `ignore: true` and a comment that starts "Owner decision" (example: `test/nightly-manifest-scripts-1-the-ads-twitch-tv-carve-out-in-the-merge.test.js:33`).
4. `CHANGELOG.md` records the held items in `### Not in this release (owner decision)`.
5. `TODO.md` lists the question in "Next steps" or in "Later / owner decisions".
6. After the decision, the code comment, the test, the docs and the changelog get the tag or the date of the decision (examples: `#18b` with 2026-11-02 in `docs/threat-tier.md:26` to `27`; "owner decision 2026-11-02" in `test/popup-general.test.js:27`).
7. Where possible, a script and a gate section then enforce the decision (example: `scripts/lib/curben_check.py` and gate section 2c for #13 and #18b).
8. Open questions in code have the mark `NEEDS OWNER`. Do not invent a value: `src/feed/config.js:6` says "Do not invent a domain here."

Limits that came from owner decisions and that code enforces: one alarm only (`test/no-background-fetch.test.js:54`); vendored scripts always on (D-3); clipboard guard stays on for an allowed site (`CHANGELOG.md:190`); no private key in the repository (`src/feed/keys.js:8`).

## 13. GitHub Actions conventions

Source: the four files in `.github/workflows/`.

| Convention | Evidence |
|---|---|
| Each action is pinned to a full 40-character commit SHA, with the version in a comment at the end of the line (`# v7.0.1`). Tag L-13. | `.github/workflows/checks.yml:12` to `18`, `:31`, `:36`, `:53`, `:95`, `:101` |
| The header comment gives the date and the method of the pin (`git ls-remote`), and the update procedure | `.github/workflows/checks.yml:12` to `18` |
| The repository setting `sha_pinning_required` is on. `allowed_actions` is "selected". Add a new third-party action to `patterns_allowed` before you use it. (Repository settings: UNVERIFIED, from the comment only.) | `.github/workflows/checks.yml:20` to `23` |
| Only two actions are used: `actions/checkout` and `denoland/setup-deno`. All workflows use the same pins. | all workflow files |
| Minimum token permissions: `permissions: contents: read` at the top, or `permissions: {}` with `contents: write` only on the release job | `checks.yml:9` to `10`, `ubo-youtube-drift.yml:15` to `16`, `release.yml:15`, `:27` to `28`, `refresh-release-notes.yml:8` |
| `persist-credentials: false` on each checkout | all checkout steps |
| The runner is pinned: `ubuntu-24.04` (all jobs). The Deno version is pinned: `v2.9.8` (each `Install Deno` step) | `checks.yml:28`, `:38` |
| Each step has a `name`, but not the one step of the retired stub. A comment before a step gives the reason for a non-obvious setting | `checks.yml:40` to `42`, `:58` to `61`; `refresh-release-notes.yml:14` |
| Values from the `github` context go into `env:` first, then the script reads the variable | `checks.yml:63` to `65` |
| A pull request does not run its own code with the secret (tag M-6). Tests get `PRIVACY_PATTERNS` only on a push to `main`. The privacy job takes the checker from the base commit for a pull request | `checks.yml:40` to `46`, `:58` to `71` |
| Python runs in isolated mode: `python3 -I` | `checks.yml:83`, `release.yml:49`, `:64` |
| `fetch-depth: 0` where the job needs history (privacy scan; gate section 1b) | `checks.yml:55`, `:97`; `release.yml:33` |
| The release workflow is manual (`workflow_dispatch`), runs only on `main`, has a `concurrency` group without cancel, and publishes nothing if a step fails | `release.yml:12` to `25` |
| The scheduled drift job (Monday 06:00 UTC, and by hand) only fails. It commits nothing, opens no pull request and uses no secret | `ubo-youtube-drift.yml:3` to `13` |
| A retired workflow stays as a stub with a comment and `permissions: {}` | `refresh-release-notes.yml` |
| Workflow file names are lower-case `kebab-case`. Job ids are short lower-case words (`tests`, `privacy`, `release-gate`, `release`, `drift`, `refresh`). The `name` of a workflow or job is usually the same word; exceptions: `refresh release notes`, `uBO YouTube sync drift` | all workflow files |

## Checked and not checked

### Read from the files in this session

- `git rev-parse --short HEAD`, `git log --oneline -50`, the subjects of all 99 commits, the merge commit subjects and bodies, the body of `2823515`, one line of the body of `56d4ef1`, trailer counts of the last 60 commits, `git branch -a`, `git ls-files --eol`.
- `.gitattributes`, `.gitignore`, `manifest.json` (full), `TODO.md` (full).
- `scripts/release-gate.sh` (all 806 lines), `scripts/pack-zip.sh` (all 76 lines), `scripts/release-notes.py` lines 1 to 40.
- Headers (first 20 to 60 lines) and ends of all project JS files in `src/`, `src/general/`, `src/settings/`, `src/guards/`, `src/threat/`, `src/feed/`. Full text of `src/feed/config.js`, `src/feed/keys.js`, `src/general/never-block-captcha.js`.
- Grep results over `src/`, `scripts/`, `test/`, `.github/`, `docs/*.md`, `CHANGELOG.md`, `TODO.md` for: global assignments, `install` functions, review tags, owner decision tags, `GENERATED` and "Do not edit" marks, `console.`, `DEBUG`, `WeakSet`, `WeakMap`, `Symbol.for`, `gk-` ids, storage key constants, `deps.` and `env.` names, DOM creation calls, message types, HTML ids.
- Headers of all files in `scripts/` and `scripts/lib/` that section 8 names; `scripts/pack-filter-lists.py` lines 1 to 34, 1160 to 1185, 1335 to 1362; `scripts/lib/package_files.py` lines 1 to 69; `scripts/vendor-pins.json`; part of `scripts/lib/twitch-vendor.mjs`.
- `src/vendor/README.md`, the first lines of `src/vendor/ubo-youtube.js`, `src/vendor/ubo-youtube-meta.json`, `src/rules/README.md`, `src/rules/dnr-merge-meta.json`, and the top-level keys of the small JSON files in `src/rules/`.
- Tests: `test/hardening.test.js` lines 1 to 100, `test/settings.test.js` lines 1 to 75, `test/vendor-pin.test.js` lines 1 to 40, `test/final-chrome-utf8.test.js` lines 1 to 31, `test/fixtures/main-source.mjs`, `test/fixtures/source-opts.mjs`, the start of `test/fixtures/fake-chrome-worker.js`, the list of test file names, and the `ignore:` lines.
- Docs: `docs/UPDATING-DEPENDENCIES.md` (full), `docs/STORE-REVIEW-NOTES.md`, the first 30 to 40 lines of `docs/how-it-works.md`, `docs/permissions-and-privacy.md`, `docs/threat-tier.md`, `docs/design/DESIGN-RULES.md`; `CHANGELOG.md` lines 1 to 107, 177 to 184, 232 to 236 and all its headings.
- All four files in `.github/workflows/` (full).
- An independent check read again: `manifest.json`, `scripts/release-gate.sh`, `scripts/pack-zip.sh` and the four workflow files in full. It printed each cited line of `src/`, `scripts/`, `test/` and `docs/` and compared it with this document. It made new grep counts for review tags, owner decision tags, `gk-` ids, storage keys, `deps.` names, `console.` calls, empty `catch` blocks and `Deno.test(` calls.

### Not checked

- No test was run. Deno is not installed here. All statements that a test "enforces" a rule come from the test source text.
- `scripts/release-gate.sh` was not run. The list in section 7 comes from the script text.
- The extension was not loaded in Chrome. All statements about behaviour in a browser are UNVERIFIED.
- The middle parts of the large source files were not read: `src/youtube.js`, `src/general-background.js`, `src/general/update.js`, `src/guards/clipboard.js`, `src/kick.js`, `src/popup.js`, `src/general/cosmetic-parse.js`. A convention can have an exception there.
- The large JSON files in `src/rules/` were not read (only top-level keys of the small ones).
- `src/vendor/video-swap-new.user.js` and the bodies of the generated uBO files were not read.
- `src/popup.css`, `src/cosmetic-hide.css` (after line 5), `src/youtube-ads.css` and the body of the two HTML pages were not examined for CSS naming conventions.
- The meaning of the letters H, M, L and I in the review tags, and the full lists of `D-n` and `#n` decisions, are not defined in a file of the repository. The explanation in section 5 is an inference from the comments.
- The repository settings on GitHub (`sha_pinning_required`, `allowed_actions`, branch protection) were not examined. Pull request descriptions on GitHub were not read; only merge commits were.
- `scripts/build-psl-subset.mjs` was read only at lines 1 to 12, 96 to 99 and 245 to 252. `scripts/lib/curben_check.py`, `scripts/merge-dnr-rules.py` and `scripts/privacy-check.py` (after line 80) were not read.
- The bodies of most commits were not read. The statement about wrapped bodies comes from a small sample.
- The independent check of this document compared each line reference with the file. It did not read each file in full.
- `HANDOFF.md` is not in the repository. This analysis did not create it.
- Line numbers were taken at commit b01e6a5. They can move after a change.
