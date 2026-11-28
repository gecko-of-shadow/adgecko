# Testing

Analysis date: 2026-11-16
Commit: 5cd4ab6 (version 0.3.6)

This document tells you how to run the checks, how the tests operate, and how to add a test.
Checked in the session of the analysis date (Linux container, Deno 2.9.8): 884 tests passed, 0 failed, 9 ignored.
UNVERIFIED: no CI test loads the extension in Chrome. The fake models are approximations. `scripts/chrome-smoke.mjs` (section 1) loads it in Chrome for Testing by hand, offline.

## 1. Commands

Run these commands from the repository root, before each push. They need `deno`, `python3`, `bash`, `rg`, `git` and `zip`.

```bash
deno test --no-lock --allow-read --allow-run --allow-env test/
```

```bash
bash scripts/release-gate.sh
```

```bash
python3 -I scripts/privacy-check.py
```

- The last line of the gate must start with `VERDICT: CLEAN`. The gate with `--zip` also needs `unzip`. The gate runs the tests again (section 5 of the gate).
- The serial test run takes approximately 4.5 minutes. CI adds `--parallel`. The gate stays serial.
- The test command gives no network permission and no write permission. Child processes that a test starts do not have these limits.
- There is no `deno.json`, no lock file and no package manifest. Four test files import `jsr:@std/assert@1`, which Deno downloads one time.
- The privacy check compares `origin/main` with `HEAD`. Thus run it after the commit and before the push. `BASE_SHA` and `HEAD_SHA` change the range (section 9).
- After a change that can have an effect on a site, load the unpacked extension in Chrome and test the site by hand. No test in CI plays a real stream; `scripts/chrome-live.mjs` does, on live sites (optional, below).
- Optional, not in CI: `CHROME_PATH=<Chrome for Testing> node scripts/chrome-smoke.mjs [--shots DIR]` (Node 22 or later). It loads the repository root as an unpacked extension in headless Chrome for Testing, sends every host name to a local server, and checks seven things: the service worker starts, the packed hide rules are installed, 4 ad and tracker scripts are blocked and 2 ordinary scripts load, 2 ad boxes are hidden, leftover `#AdContent` in a same-origin iframe is hidden (a longer `#Ad-Container` and the article stay visible), the toolbar popup names the page and offers Fix this site and Allow this site, and the clipboard guard refuses a PowerShell command on a real click and lets plain text through. No request leaves the machine. Google Chrome 137 and later ignores `--load-extension`; then the first check fails with that reason. About 11 s.
- Optional, not in CI, live network: `CHROME_PATH=<Chrome for Testing> node scripts/chrome-live.mjs [--dir <extension folder>] [--out DIR] [--only A,B] [--headful]` (Node 22 or later). It replaces the manual Chrome test list and needs no input. Two headless browsers run side by side, each with a new throwaway profile in the OS temp folder (removed at the end, also on Ctrl+C): one loads the extension, the baseline does not. Both send a normal Chrome user agent (not `HeadlessChrome`) and `navigator.webdriver` is false, so sites do not treat the baseline as a bot. The checks compare the same page in both. A: the toolbar popup opens on cnn.com, foxnews.com and nbcnews.com, after load and while the page loads on a slow network (SKIP when the page finished first), and the worker answers in under 2 s while cnn.com runs its request loop (time to the popup, to the host name and to enabled buttons; popup.js errors fail). B: requests to well-known ad and tracker hosts that load, visible ad boxes (also in cross-origin frames) and the article on one article of each news site (SKIP when the baseline makes no ad request, for example behind a consent banner), and a blocked request that the page repeats in a loop. C: GitHub, react.dev, Wikipedia and a shop show their main content, with no extension errors and a page height near the baseline. D: a YouTube watch page plays without an ad within 30 s and keeps playing for 15 s without the "Experiencing interruptions" toast; five related videos one after the other each play within 12 s; Share and Copy link, More and Save work (not signed in). E: a live Twitch and Kick channel plays (a channel behind an age gate is not used; the line says when the baseline showed no ad marker, so the ad part was not tested). F: Allow this site and Block again on foxnews.com, the two-step Fix this site (No, No) on foxnews.com and cnn.com, and Fix this site (Yes) and Undo fix on foxnews.com, with reloads and request counts; the site state is reset before and after each try. G: the clipboard guard on a live page: a PowerShell download command is refused; plain text, a `ping -w 1` command and the Poetry and get-pip install lines on python-poetry.org are written; Ctrl+C copies a selection. X: no service worker errors. Extension errors in the console fail B to F. Each check has a time limit and one retry; a try that reaches its limit is stopped, and a retried check says so in its line. A bot wall, a consent banner or a baseline that also fails gives SKIP, never a click. Output: `report.md` (one line per check: PASS, FAIL or SKIP with the numbers, and a list of what the run does not cover), `report.json` and `shots/`. Exit code: 1 when a check fails, no check ran or a profile was not removed; 2 for a bad option; 130 after Ctrl+C. About 10 minutes. The popup is opened with `chrome.action.openPopup()`, not a toolbar click. Live sites change, so a FAIL needs a look at the screenshot first.

## 2. How tests load source code

The source files are not ES modules. Thus the tests cannot import functions from `src/` directly.

| Method | Use |
|---|---|
| Text import + `new Function` | The test imports a source file as text (`with { type: "text" }`), appends `return <installer>;` and runs the text with `new Function`. Fake globals are the function parameters. |
| Side-effect import | The test imports a file that sets a global (`import "../src/general/filter-options.js"`), then reads the global. |
| JSON import | `manifest.json` or a packed rule file (`with { type: "json" }`). |
| Source text assertion | The test checks that the source text includes or does not include a string. A change of wording in a source line can fail such a test. |
| Python child process | The test runs a Python snippet that imports a packer script. A helper tries `python3`, then `python` (on Windows: `py -3` first). |
| Deno child process | The test runs a fixture `.mjs` file in a new process with `--location` and reads the printed result. |
| Worker model | `loadWorker()` from `test/fixtures/fake-chrome-worker.js` runs the real worker text with a fake Chrome. |

- The MAIN-world files have one IIFE wrapper. Tests remove it with `unwrapMain()` (`test/fixtures/main-source.mjs`).
- `withYtOpts()` and `withUboOpts()` (`test/fixtures/source-opts.mjs`) write test options into the source text.
- The gate refuses `new Function` in `src/`. It is a test method only.

Style: most files define a local `function assert(c, l) { if (!c) throw new Error(l); }`. The label is the failure message, with the actual value in it. Tests are flat `Deno.test("name", fn)` calls with full-sentence names. The object form `Deno.test({ name, ignore, fn })` is for a test with an `ignore` condition or with sanitizer options.

## 3. Fixtures in `test/fixtures/`

| File | Purpose |
|---|---|
| `fake-chrome-worker.js` | Model of the Chrome service-worker environment for `src/general-background.js`. |
| `feed-world.js` | Fake storage, session rules, fetch and in-memory Ed25519 keys for the feed client tests. |
| `dnr-matcher.js` | Small declarativeNetRequest matcher: priority, action rank, frame inheritance, domain, type, method, `urlFilter` and `regexFilter`. |
| `main-source.mjs`, `source-opts.mjs` | `unwrapMain()`, `withYtOpts()`, `withUboOpts()`. |
| `memory-storage.mjs` | In-memory `localStorage` for fixture processes. |
| `filter-options-cases.json`, `merge-scope-cases.json` | Case tables that the JavaScript runtime and the Python packer share. |
| `stream-hosts.txt` | Hosts that Twitch, YouTube and Kick need. No threat rule can match them. |
| `png-reader.js` | Minimal PNG reader for the icon tests. |
| `threat-cache-mismatch/` | Three list files whose bytes differ from `src/rules/meta.json` on purpose. |
| `twitch-*.m3u8` (4 files), `youtube-*.json` (2 files) | Synthetic or redacted playlists and responses. |
| `ubo-youtube-run.mjs`, `ubo-youtube-edge.mjs`, `youtube-layers-run.mjs`, `youtube-ubo-sweep-run.mjs`, `youtube-decoy-run.mjs`, `youtube-clock-run.mjs`, `youtube-sim.mjs` | Runners that load the YouTube scripts under a page shim or a virtual clock. |

The worker model `loadWorker(opts)`:

- It simulates `chrome.runtime`, `chrome.storage.local` (with `opts.quotaBytes` and `opts.setError`), `chrome.storage.session`, `storage.onChanged`, `declarativeNetRequest` (dynamic rule updates are atomic and need unique ids), `chrome.action`, `chrome.alarms`, `importScripts` and `fetch`.
- `fetch` serves the packed files of `src/rules/` for extension URLs. `opts.listFetch` supplies all other responses.
- `dnr.staticOn`, `dnr.threatOn` and `dnr.uboYoutubeOn` hold the static ruleset state. `dnr.rulesetCalls` logs each `updateEnabledRulesets` call. `opts.rulesetError(o)` can make a call fail with `lastError`.
- It returns `chrome`, `store`, `dnr`, `send` (a message from the popup), `fireAlarm`, `install`, `startup` (fires `onStartup`), `fetched`, `warnings` and byte counters. The file also exports `settle(ms)`.
- It does not simulate real request matching, tabs, content-script injection, the network, a worker stop by Chrome, or real quota accounting.

## 4. Test inventory

`test/` has 146 test files, all in one directory, and 26 fixture files.

| Subject | Test files (each name has the suffix `.test.js`) |
|---|---|
| Twitch vendor script | `playlist`, `fixtures`, `twitch-playlist`, `vendor-pin` |
| Twitch directory, Kick | `twitch-directory-ads`, `stream-hygiene`, `kick` |
| YouTube script | `youtube`, `youtube-sim`, `youtube-decoy`, `youtube-decoy-nav`, `youtube-error-flash`, `youtube-fallback`, `youtube-layers`, `youtube-watchdog-playability`, `youtube-start-times`, `stall`, `stall-decoy`, `race`, `stealth` |
| uBlock Origin YouTube port | `ubo-youtube`, `ubo-youtube-edge`, `ubo-rpnt-payload` |
| Network rules and packer | `dnr`, `filter-options`, `packer-options`, `navigation-scope`, `meta-counts`, `hcaptcha-never-block`, `imasdk-never-block`, `final-dnr-fields`, `final-lists-*` (6 files), `wave2-lists-network-options` |
| Cosmetic filtering | `cosmetic`, `cosmetic-filters`, `cosmetic-adopted-sheet`, `cosmetic-feature-gate`, `cosmetic-generichide`, `cosmetic-parse-nesting`, `cosmetic-resync-cost`, `cosmetic-unscoped-root`, `pr12-cosmetic-parent-child-exclusion`, `wave2-lists-cosmetic-pack`, `wave2-perf-cosmetic-index`, `cosmetic-frame-generics`, `cosmetic-grouped-sheet` |
| Worker and list refresh | `background-message`, `dnr-queue`, `general-race`, `list-guard`, `list-refresh`, `list-toggle-threat`, `storage-alarm`, `worker-restart`, `no-background-fetch`, `final-storage-budget`, `list-exception-allow-rules`, `packed-exception-allows` |
| Settings and registry | `settings`, `settings-page`, `settings-page-writes`, `flags-port-window`, `wave2-perf-features-idempotent`, `wave2-ux-settings`, `final-upgrade-*` (2 files), `storage-keys` (each storage key literal is in one known list), `settings-narrow-layout` |
| Popup | `popup-allow-page`, `popup-design`, `popup-general`, `popup-ui-review`, `wave2-ux-popup`, `site-test-scope` (what the second test of "Something broke?" leaves on), `list-test-expiry` (an unanswered second test ends after 24 hours), `popup-disabled-button` |
| Page guards | `guards`, `clipboard-0.3.6`, `popup-guard-keydown`, `final-clipboard-8-9-cross-realm-and-nested-copy` |
| Threat tier, public suffixes | `threat-tier`, `psl`, `no-openphish` |
| Signed feed | `feed-core`, `feed-client`, `feed-robustness`, `feed-serial-recovery` |
| Hardening, design | `hardening`, `art-rules`, `contrast`, `icons` |
| Package, licence, docs, tools | `packaging`, `license`, `final-chrome-utf8`, `docs-claims`, `release-tooling`, `gitignore-metadata` |
| Privacy checker and CI | `privacy-generic`, `privacy-mask` |
| One bug for each file (0.3.5 bug hunt, and two 0.3.6 files) | `nightly-<area>-<number>-<short title>` (40 files). Areas: `cosmetic`, `feed`, `guards`, `manifest-scripts`, `site-scripts`, `threat`, `ui`, `worker-refresh`. |

## 5. Ignored tests

Always ignored (`ignore: true`), 1 test. It describes the correct behaviour. Remove `ignore: true` when the owner approves the related change.

| File | Tests | Reason |
|---|---|---|
| `nightly-manifest-scripts-2-every-exception-is-dropped-so-hosts-that` | 1 | Known issue: exceptions below a parent-domain block or with a type scope are not obeyed. |

Ignored on a condition:

| File | Tests | Condition |
|---|---|---|
| `final-storage-budget` | 1 | No full list cache in `scripts/.list-cache/`. CI has no cache. |
| `packaging` | 1 | No `zip` (or Windows `tar.exe`) and `bash`. |
| `privacy-generic` | 2 | The `PRIVACY_PATTERNS` variable is not set. |
| `release-tooling` | 2 | No `rg` and `python3` on the path. |
| `release-tooling` | 1 | No Info-ZIP `zip`. |
| `release-tooling` | 1 | The operating system is Windows. |

A usual local run shows 4 ignored tests: the 1 above, the storage budget test and the 2 privacy tests.

## 6. Tests that need tools, secrets or caches

| Need | Tests |
|---|---|
| `python3` | 20 files start Python (packer, privacy checker, parity and tooling tests). Only `release-tooling` has an ignore condition for Python. |
| `git` | `privacy-generic`, `privacy-mask`. A full git checkout is necessary. |
| `bash`, `zip`, `rg` | `packaging`, `release-tooling` |
| Child `deno` | `ubo-youtube`, `ubo-youtube-edge`, `youtube-layers`, `youtube-decoy-nav`, `youtube-watchdog-playability`, `feed-client`, `feed-serial-recovery`, `wave2-lists-cosmetic-pack` |
| Network, one time | The four files that import `jsr:@std/assert@1` |
| `PRIVACY_PATTERNS` (secret) | Two tests in `privacy-generic`. CI gives the secret to the `tests` job only on a push to `main`. |
| `scripts/.list-cache/` | `final-storage-budget` |

No test needs a browser.

## 7. Tests that read documents, versions, pins or generated files

These tests do not check runtime behaviour. They can fail after an edit of a document, a version, a generated file or a workflow.

| Test | What it reads |
|---|---|
| `license` | Root `LICENSE`. `src/LICENSE.txt` is a byte copy of it, and `scripts/lib/package_files.py` and the gate name it. In `README.md`, the text from `## License and brand` to `## Links`: "GNU General Public License version 3", `[LICENSE](LICENSE)`, `"Adgecko" and the gecko icon are gecko-of-shadow's brand`, "not covered by the code licence", "one Curben list used (curbengh's urlhaus-filter: URLhaus data, CC0)". |
| `docs-claims` | `README.md`: "Read and change all your data on all websites", "fresh install downloads the lists at once", "YouTube videos embedded in other websites are not covered", and, while the worker switches the `ubo-youtube` ruleset (Option A), one line with "stops the YouTube network rules", then "keep running", then `chrome://extensions`, and no "YouTube network rules" before "keep running" in a line. Without that code (Option B): one line with "YouTube network rules", then "keep running", then `chrome://extensions`. Not permitted: "permissions are exactly", "exactly `storage`", "The whole extension is switched off". |
| `docs-claims` | `docs/permissions-and-privacy.md`: the heading `### Site access`, the two first README sentences above. Not permitted: "5 to 30 minutes after install". |
| `docs-claims` | `docs/how-it-works.md`: the four pack numbers of `src/rules/meta.json`, in the forms "<n> whole-domain", "<n> scoped entries", "<n> list rules" and "`general-network.json` has <n> rules"; "plain `$all` filter"; "Malware blocking only". |
| `docs-claims` | `docs/STORE-REVIEW-NOTES.md`: "host permission justification". `src/settings.html`: with Option A "master switch stops the uBlock Origin YouTube network rules" and no "YouTube network rules ... also stay on"; with Option B "YouTube network rules ... also stay on". The shipped licence files. They name GPL-3.0-or-later as the chosen EasyList option and do not choose CC BY-SA. `src/rules/LICENSES.md` equals the packer output. |
| `vendor-pin` | The vendored Twitch file equals the pin. The pin sites agree with the pin: `src/vendor/README.md`, `docs/credits.md` ("video-swap-new v1.55, MIT"), `docs/how-it-works.md` (") v1.55, copied unmodified"), `docs/STORE-REVIEW-NOTES.md` ("video-swap-new 1.55, vendored unchanged", "call that runs, at line 169", "`getWasmWorkerJs` (line 208)"), `test/hardening.test.js`, and the conflict version literal in the gate. |
| `playlist` | `src/vendor/README.md` names the file and says "Do not edit it here". |
| `release-tooling` | The frozen pins, the manifest key list of the gate, the zip byte check, the uBlock Origin commit pin, the drift workflow permissions, the packer refusals, `feed-sign`. |
| `meta-counts` | `meta.json`, `dnr-merge-meta.json` and `threat-meta.json` agree with the packed rule files. |
| `packaging` | The derived package list, `REQUIRED` and `ALLOWED_RE` of the gate, the real zip. |
| `final-chrome-utf8`, `final-dnr-fields`, `dnr`, `hcaptcha-never-block` | Shipped files: UTF-8, DNR field limits, rule count, stream-site exclusions, the captcha list in each layer. |
| `no-openphish`, `no-background-fetch`, `hardening` | Forbidden list sources, the fetch policy, page-world rules, by source scan. |
| `icons`, `art-rules`, `contrast`, `popup-design` | Icon files, approved art, WCAG contrast from the CSS tokens, approved popup elements and wording. |
| `youtube-start-times` | `ARCHITECTURE.md` section 9 (a key table row for `ytStartTimes`), `docs/permissions-and-privacy.md` (`ytStartTimes` and "off by default"), and `src/settings.html` (the **YouTube start times** section, the box unchecked, and the result line `yt-start-status` inside the section). |
| `privacy-generic`, `privacy-mask` | `scripts/privacy-check.py`, the text of `checks.yml` (secret use, SHA pins, runner version), the retired workflow file. |

Rule: after a change to `manifest.json`, the gate, a file in `src/rules/`, a vendor file, a CSS token, popup text, a workflow, `README.md` or a file in `docs/`, expect failures in this table.

## 8. The release gate

Command: `bash scripts/release-gate.sh [--expect-version X.Y.Z] [--dir PATH | --zip PATH.zip]`.

- The default is the repository root. The expected version comes from that `manifest.json`.
- The gate prints `PASS`, `FAIL` or `SKIP` for each check, then `VERDICT: CLEAN` or `VERDICT: FAIL`. The exit code is 0 for CLEAN, 1 for a failed check, 2 for a usage error or a missing tool.
- With `--zip`, the gate extracts the zip, uses the strict file allow-list, and does not run the Deno tests.
- CI and the release workflow run the gate two times: on the checkout and on the packed zip.
- The rules of each gate section are in `CONVENTIONS.md` section 7.

## 9. Privacy check (`scripts/privacy-check.py`)

What it scans: the diff between `BASE_SHA` and `HEAD_SHA`, the full content of each changed file, each changed file path, the commit messages and author data of the range, printable runs in binary files, and the metadata of changed images. With `--all` it scans each tracked file and no commits.

| Kind | Needs the secret | Detail |
|---|---|---|
| Forbidden personal strings | Yes | One regular expression for each line of `PRIVACY_PATTERNS`. Joined words (camelCase, underscore, hyphen, letter-digit) are split first. |
| Obvious secrets | No | Private-key blocks, common API token shapes, JSON web tokens. |
| IP addresses | No | Public IPv4 and IPv6 literals outside the documentation ranges. Private and loopback addresses are not reported. `src/rules/*.json` files skip this check. |
| E-mail addresses | No | All addresses but noreply addresses and example, test and invalid domains. |
| Home-directory paths | No | Linux, macOS and Windows home paths with a name that looks real. |
| Image metadata | No | EXIF, XMP, comments, PNG text chunks. |

- If `PRIVACY_PATTERNS` is empty, the personal-string check is skipped with a warning. On a push to `main` (`REQUIRE_PATTERNS`), the job fails.
- The marker `privacy-check: allow` on a line permits a generic value. It does not apply to secrets, personal strings or paths.
- The output gives file paths and line numbers only.
- For agents: tests build fake values at run time. Use only synthetic hosts (for example `*.example`). A commit message is also scanned, and it cannot be changed after a push without a history rewrite.

## 10. What automated tests do not cover

- No test loads the extension in Chrome or plays a real stream. YouTube, Twitch and Kick tests use synthetic payloads and DOM fakes. A change of the live sites does not make them fail.
- The DNR matcher follows the documented precedence. It is not the Chrome code.
- No test downloads a real filter list. The storage budget test reads a local cache, and CI ignores it.
- The one test in section 5 is a known gap.
- The signed feed is dormant. Its tests use keys made in memory.
- The 0.3.6 corrections were checked in headless Chromium only in part. No run on the owner's PC or on live sites was done (`HANDOFF.md`).

## 11. How to add a test

1. Add `test/<subject>-<short title>.test.js`. Use lower-case words with hyphens and no review prefix, unless the owner gives one.
2. Write a comment at the top: what was wrong, the correct behaviour and the correction.
3. Use a load method of section 2. For worker bugs, use `loadWorker()` and `settle()`. For rule bugs, use `evaluate()` from `test/fixtures/dnr-matcher.js` on the packed rules. For packer bugs, run a Python snippet in a child process and copy the `runPython` helper of an existing file.
4. Add the local one-line `assert` function. Put the actual value into each label.
5. Write a test that fails before the correction and passes after it.
6. If the correction is not approved, keep the test with `ignore: true` and write the reason above the test.
7. Put shared data and harness modules in `test/fixtures/`.
8. Run the commands of section 1.

Cautions:

- Do not change a frozen file for a correction (`CONVENTIONS.md` section 9).
- When a correction changes a packed file in `src/rules/`, run the packer again. The tests of section 7 compare the metadata with the files.
- When you add a shipped file, update `REQUIRED` and `ALLOWED_RE` in the gate.
