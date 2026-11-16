# Adgecko 0.3.6 correction work plan

Language: ASD-STE100 Simplified Technical English.
Baseline: Adgecko 0.3.5, branch `claude/festive-dirac-a043po`, which is the same as `main`.
Target: Adgecko 0.3.6, ready to push.

## 0. Facts in this plan: what was checked and what was not

- **Repro scripts:** the review scratch scripts are copied to `docs/review-2026-11-16/repros/`. Paths inside them can point to the old scratch folder; change the paths before you run them. Large data (browser profiles, list copies) was not kept.
- **Checked by the review sessions (reported in the finding data):**
  - Scratch reproductions under `docs/review-2026-11-16/repros/` for many findings. Examples: clipboard t2, t3, t4, t7 and t8; popup p1, p3 and p5; feed repro A, C, D, F and G; toast-ubo; notice-ubo; the mutation runs; the rg glob run; two zip hashes.
  - Some findings were confirmed by code reading only. Each work package below shows which kind of proof it has.
- **Not checked by anybody:**
  - No item was tested on the owner's PC.
  - No item was tested on live sites: YouTube, React 18 sites, Gmail and GitHub with the generic sheet, or embedded YouTube players.
  - No item was tested in GitHub Actions.
- All behavior claims in this plan are **UNVERIFIED** until a run on the owner's PC proves them.

## 1. Rules for the executing session

1. Do the work packages (WP) in the order given. One WP gives one or more commits.
2. **Explore first.** Before you change the code for a WP, find out why the current code is as it is. Use these sources:
   - `git log -S '<symbol>' -- <file>` and `git log -p -- <file>`.
   - The comments near the code.
   - CHANGELOG.md, TODO.md, README.md and docs/.
   - The tests that cover the code.
   Write the reason that you find in one or two sentences in the commit message.
3. **Then decide.** Use one of these three decisions:
   - **DO:** the fix is correct. Make the fix.
   - **CHANGE:** the problem is real, but a different fix is better. Make the different fix and write the reason.
   - **DISCARD:** the current behavior is intentional and correct. Do not change the code. Write the reason in CHANGELOG 0.3.6, section "Reviewed, not changed".
4. **Regression test.** Every code fix gets a regression test. The test must fail before the fix and pass after the fix.
   - First run the new test on the old code and record that it fails.
   - For a test-only WP, show the failure with a temporary mutant of the source code. Remove the mutant before you commit.
5. **Do not delete** a file, branch, test or other item. Put deletion candidates in section "Owner decisions" and in HANDOFF.md.
6. **Do not change** `src/kick.js` or `src/vendor/video-swap-new.user.js`. The release gate freezes them. You may add a content pin for them (WP-22). A pin does not change these files.
7. Keep the release zip below the 8 MB cap. After each WP that changes `src/rules/*`, run `scripts/pack-zip.sh` and check the size.
8. **Test commands.**
   - Use Deno. If `deno` is not installed, run `npm i -g deno` (this gave Deno 2.9.6 in the review session; CI uses 2.9.8).
   - Run one test file: `deno test --no-lock --allow-read --allow-run --allow-env test/<file>`.
   - Run the full suite before the release steps:
     `cd . && deno test --no-lock --allow-read --allow-run --allow-env test/`
   - The baseline result is 776 passed, 0 failed and 9 ignored. The run takes about 5 minutes.
9. Do not stop to ask questions. When a decision is necessary, use the safer option, record it as an owner decision and continue.
10. Write commit messages and notes in ASD-STE100. End each commit message with the attribution lines that the session gives.
11. Keep HANDOFF.md up to date after each WP. Mark each item as one of: done, changed, discarded or owner decision. Mark it UNVERIFIED until a run on the owner's PC proves it.
12. Do not write a token or a password in output.
13. **Coverage check first.** `findings.json` is the source of truth. This plan was written from it without reading the code. Before WP-01, make sure that each confirmed finding (64) is in a WP. Put each missing finding in a WP, or record it as DISCARD with a reason. Write the map in HANDOFF.md.

## 2. Work packages

The order is by severity, then by risk: high severity first, and low risk first within a severity.

---

### WP-01 Clipboard guard: a conversion error must not fail open (setData, items.add, execCommand)

- **Severity:** high. **Risk:** low.
- **Files:**
  - `src/guards/clipboard.js` (about lines 514-529, 584-592 and 612-620).
  - `test/guards.test.js`.
- **Problem:**
  - Each wrapper converts its argument to a string inside a try block that fails open.
  - When `toString` throws one time, the catch block sends the original object to the native method.
  - The native method then converts the object again, and the command goes to the clipboard without a check.
- **Evidence (Chrome repro t8.mjs):** `setData(throw-once object)` and `items.add(throw-once object)` both print "COMMAND ON CLIPBOARD". The control `setData(CMD)` is blocked. The `writeText` wrapper (lines 409-418) handles this case correctly.
- **Why it may be intentional:** The header says that "an error in the guard lets the original call through". That rule is for errors in the guard itself. Here the error comes from page code.
- **Proposed fix:**
  - Move the `StringFn` conversion out of the fail-open try block.
  - If the conversion throws, throw the error again and do not call the native method.
  - Only the `allowed()` check may stay fail-open. The native method then gets the converted strings.
- **Test to add:** In `test/guards.test.js`, use fake `DataTransfer`, `DataTransferItemList` and `Document` objects. For each of the three wrappers, pass an object whose `toString` throws on the first call and returns CMD on the second call. Expect these results:
  - The wrapper throws.
  - The fake native method is not called, or never gets CMD.
- **Acceptance:** The new tests pass. All guard tests pass. A normal `setData('text/plain', 'hello')` still works.

---

### WP-02 Clipboard guard: the checked text must be the copied text

- **Severity:** high (two findings with one fix). **Risk:** medium.
- **Files:**
  - `src/guards/clipboard.js` (`onCopy` about lines 369-401, `selectionText` about 256-264, the execCommand wrapper about 511-529).
  - A new Chrome test.
- **Problem:**
  1. `onCopy` checks the selection in the first capture listener. A page copy listener that runs later can change the selection or call `setSelectionRange`. Chrome then copies the new selection, and no wrapper sees it.
  2. `Selection.toString()` leaves out `<img alt>` text and the values of `<textarea>` and `<input>` in the range. Chrome's text/plain copy includes them.
- **Evidence:**
  - Chrome repro t2.mjs: cases D, E and F print "COMMAND WRITTEN".
  - Chrome repro t3.mjs: cases g1 (img alt), g3 (textarea) and g4 (input value) print "COMMAND WRITTEN".
  - Chrome repro t4.mjs: a real Ctrl+C on a line with a 1px `<img alt=CMD>` puts the command on the clipboard.
- **Why it may be intentional:** The design assumes that the capture-time selection is the copied text. The CHANGELOG 0.3.3 claim covers only the 1.5 s key-window text. No comment covers a change made later in the same dispatch, or the alt and field-value case.
- **Proposed fix:**
  1. At load, capture the native `DataTransfer.prototype.setData` and `Event.prototype.preventDefault`.
  2. In `onCopy`, check the flag and the safe hosts. On a non-safe host, call the native `preventDefault`.
  3. Write the checked text with the native `setData('text/plain', checkedText)`. For a field selection, write the checked field slice.
  4. Page listeners that run later and call `setData` still go through the wrapped `setData` check.
  5. Optional: write `text/html` from a clone of the checked ranges, but only after `allowed()` passes on the full text of that clone (including alt text and field values). If this is not simple, leave out text/html and record the loss in CHANGELOG.
- **Fallback (CHANGE) if the session finds that the copy rewrite breaks normal copy:**
  - Before `allowed()`, walk the ranges with captured `getRangeAt` and `cloneContents`.
  - Add the alt text and field values to the checked text.
  - Check the selection again in a bubble-phase listener that the guard adds last on `window`.
- **Tests to add:** Chrome or Playwright tests that follow the t2, t3 and t4 repros:
  - (a) A document copy listener calls `selectAllChildren` on a hidden command span after `execCommand('copy')`.
  - (b) The same as (a), after a real Ctrl+C on harmless text.
  - (c) A listener calls `setSelectionRange` on a textarea and moves the selection to a command line.
  - (d) A range over `<img alt=CMD>`.
  - (e) A range over `<textarea>CMD</textarea>`.
  - (f) A range over `<input value=CMD>`.
  - (g) A normal Ctrl+C of plain text still copies that text.
  If the suite cannot run Chrome, add the test under the existing browser-test convention. Also add a Deno unit test with fake events that asserts `preventDefault` and native `setData` are called with the checked text.
- **Acceptance:**
  - Cases (a) to (f) leave no command on the clipboard.
  - Case (g) copies the text.
  - CHANGELOG states any copy behavior change, for example text/html.
  - UNVERIFIED on the owner's PC.

---

### WP-03 Clipboard guard: clipboard.write() fails closed

- **Severity:** medium. **Risk:** low to medium.
- **Files:** `src/guards/clipboard.js` (`run()` about lines 466-485, header lines 53-55).
- **Problem:** `run()` uses `await`. A page can put a throwing getter on `Promise.prototype.constructor`. The throw goes to `catch { verdict = true }`, and the native write then puts the command on the clipboard.
- **Evidence:** t7.mjs prints "write resolved" and "COMMAND ON CLIPBOARD". t2.mjs case A2 gives the same result.
- **Why it may be intentional:** Header lines 53-55 list this as a known UNVERIFIED limit. The catch comment says "the native call decides". The repro now proves the attack and shows that it is easy.
- **Proposed fix:**
  - In the catch block, set `verdict = false` when `flagOn()` is true and the host is not a safe host. The write then rejects with `NotAllowedError`.
  - Optional: remove `await` and chain with a captured native `Promise.prototype.then` through `Reflect.apply`.
  - Update the header comment.
- **Test to add:**
  - Unit test: make the type read (`getType`) throw, and expect a reject with no native write.
  - Chrome test from t7.mjs.
  - An image-only `ClipboardItem` must still pass, because the guard never reads it.
- **Acceptance:** The new tests pass. The image-write test passes.

---

### WP-04 Clipboard patterns: add the missed ClickFix forms

- **Severity:** medium. **Risk:** low (watch for false positives).
- **Files:** `src/guards/clipboard.js` (PATTERNS, about lines 85-105) and `test/guards.test.js`.
- **Problem:** The patterns do not match these strings:
  - `| /bin/bash` and `| nohup bash`
  - `bash <(curl ...)`
  - `/bin/bash -c "$(echo <b64> | base64 -d)"`
  - `finger x@host | cmd`
  - a WebDAV UNC path such as `\\host@SSL\DavWWWRoot\x.exe`
  - msiexec and regsvr32 with a UNC path
  - `powershell -f \\host\a.ps1`
- **Evidence:** `docs/review-2026-11-16/repros/pat.mjs` runs the real PATTERNS. It prints "MISSED" for each of these strings.
- **Why it may be intentional:** The list is narrow on purpose, to avoid false positives. 0.3.5 extended the list, so to extend it is the intended way.
- **Proposed fix:** Use the regexes in the finding's fix_notes:
  - widen curl-pipe-shell to accept an optional path and the prefixes sudo, nohup and env
  - add a process-substitution rule
  - add a base64 rule inside `$(...)`
  - add finger-pipe-cmd
  - add a WebDAV UNC rule that needs `@ssl`, `@port` or `davwwwroot`
  - let msiexec, regsvr32 and `powershell -f` accept UNC paths
  Keep each gap bounded, so that the regexes stay linear.
- **Test to add:**
  - Each missed string is a positive case.
  - These are negative cases: `cat file | bash-completion`, `\\fileserver\share\doc.pdf` and the existing safe install commands.
  - A timing test: a 100 KB input finishes in less than 50 ms.
- **Acceptance:** All the cases pass. The existing negative tests pass.

---

### WP-05 Clipboard key path: a page-made selection is not the visitor's copy

- **Severity:** medium. **Risk:** medium (it can block real copies).
- **Files:** `src/guards/clipboard.js` (keydown listener about lines 330-340, `deliberateCopy` about 169-180).
- **Problem:**
  - A page can select a hidden off-screen command and ask the visitor to press Ctrl+C. The command is then copied.
  - After that, page writes of a substring of that selection pass for 1.5 s.
- **Evidence:** t4.mjs: "page pre-selects hidden span, user presses Ctrl+C" gives "COMMAND ON CLIPBOARD". The same write in a clean page (t6.mjs) is rejected. The project already fixed the same attack for the right-click path (nightly-guards-6).
- **Why it may be intentional:** A visitor's Ctrl+C is treated as consent, and README line 71 tells users to select the text and press Ctrl+C.
- **Proposed fix:**
  - (a) Track a flag `userSelected`. Set it on a trusted pointerup, dblclick or shift+arrow keydown. Clear it on a `selectionchange` that has no trusted input in the last 500 ms.
  - (b) Open the 1.5 s page-write window only when `userSelected` is true.
  - (c) In `onCopy`, block a dangerous selection that no trusted gesture made, or whose ranges have zero size or are outside the viewport. Use the captured `Range.prototype.getBoundingClientRect`.
  - Do (a) and (b) first. Do (c) only if the drag-select test still passes.
- **Tests to add:**
  - `selectAllChildren` on an off-screen command span, then a real Ctrl+C: no command on the clipboard.
  - The visitor drag-selects a visible command, then presses Ctrl+C: the command is copied.
- **Acceptance:** Both tests pass. README line 71 stays true.

---

### WP-06 List switch off and on loses the refreshed list rules (threat ids counted as list ids)

- **Severity:** medium. **Risk:** low.
- **Files:**
  - `src/general/update.js` (`dynamicLooksActive` about lines 1102-1110, `applyEnabled` about 1221-1241, `refresh` about 853-862).
  - `test/list-refresh.test.js`.
- **Problem:**
  - `dynamicLooksActive` counts any id in the range 100000 to 799999 as a list rule. The threat rule ids (600000 to 609999) are in that range.
  - After the lists switch goes off and on, `applyEnabled(true)` returns "dynamic" with 0 list rules.
  - `refresh()` then returns "unchanged", and the refreshed list rules do not come back.
- **Evidence:** `docs/review-2026-11-16/repros/toggle_threat_test.js` shows list+kept rules 2355 after the refresh, then 0 after off/on, and 0 after the next automatic and manual refreshes.
- **Why it may be intentional:** Nothing found. The comment at update.js lines 28-30 says that the lists switch must not touch the threat range. The range test was not updated to agree.
- **Proposed fix:**
  - Count only `isOurRule(r.id) && r.id < KEPT_RULE_ID_BASE`. A stricter check also compares the count with `state.ruleCount`.
  - Second guard: in `refresh()`, set `changed = true` when `dynamicActive` is true but no list rules are installed. Optionally, also clear `dynamicActive` in `applyEnabled(false)`.
- **Test to add:** In `list-refresh.test.js`, load `src/threat/compile.js` with `psl.js` and `protected-hosts.js`. Then do this:
  1. Run `refresh`.
  2. Run `applyEnabled(false)`, then `applyEnabled(true)`.
  3. Assert that the list rule count is the same as after the refresh.
  4. Assert that the threat rules did not change.
- **Acceptance:** The test fails before the fix and passes after it. The existing toggle test passes.

---

### WP-07 Exponential parse time for nested :is() and :where() selectors

- **Severity:** medium. **Risk:** low.
- **Files:**
  - `src/general/cosmetic-parse.js` (`reduceSelector` about lines 129-155, `isUnscopedBranch` about 157-167, `sanitizeSelector` about 23-53).
  - `scripts/pack-cosmetic.mjs` uses the same code.
- **Problem:**
  - Each nesting level calls `reduceSelector` two times, so the time is O(2^depth).
  - A depth of 24 takes 14 s. A depth of 118 is accepted by the sanitizer and never ends.
  - The parse runs before `checkListChange`, so the list-change guard cannot stop it.
- **Evidence:** `redos.mjs` gives these times: depth 20 = 920 ms, depth 22 = 3394 ms, depth 24 = 14190 ms.
- **Why it may be intentional:** Nothing found. The double call is one call for the check and one call for the output.
- **Proposed fix:**
  - Reduce each branch only one time, or memoize per call with a Map keyed by `forSubject + "\0" + text`.
  - Make `isUnscopedBranch` compute the reduced form one time.
  - Add a nesting-depth limit (8 to 10 levels) to `sanitizeSelector`.
  - Increase `PARSER_VERSION` only if the output changes for selectors that are kept. Compare the packed `cosmetic-rules.json` before and after.
- **Test to add:**
  - `parseCosmetic('##' + ':is('.repeat(118) + '.a' + ')'.repeat(118))` finishes in less than 100 ms.
  - A depth-30 selector is rejected.
  - All existing cosmetic parse tests pass.
- **Acceptance:** The tests pass. `scripts/pack-cosmetic.mjs` output does not change, or the change is explained.

---

### WP-08 Filter-lists switch off also stops "Hide leftover ad boxes"

- **Severity:** medium. **Risk:** low.
- **Files:**
  - `src/cosmetic.js` (`applyState` about lines 135-149).
  - `src/settings/features.js` (`legacyMirror` lines 188-198, for reference only).
- **Problem:**
  - The content script gates on `generalEnabled` and on `generalAllowedOrigins`.
  - `legacyMirror` sets both from `network`. So `network:false` with `cosmetic:true` removes the hide style.
  - `F.resolve()` reports `cosmetic` as on, and the settings page shows two separate switches.
- **Evidence:** `net_off_test.js` fails with `{applied:false, resolvedCosmetic:true}`. The Chrome repro (run.cjs net) shows that `#AdBar` becomes visible.
- **Why it may be intentional:** This is left over from the settings migration. No document says that the lists switch also stops hiding.
- **Proposed fix:**
  - When `stored.settings` exists and `GeckoFeatures` is loaded, decide only from `F.resolve(stored.settings, stored.siteOverrides, hostname).cosmetic`.
  - Use `generalEnabled` and `generalAllowedOrigins` only before migration, when no settings key exists.
- **Tests to add:**
  - (a) Global `network:false`, `cosmetic:true`: the style is injected.
  - (b) A site override `{features:{network:false}}`: the style is injected.
  - (c) A site override `{enabled:false}`: the style is removed.
  - (d) Master switch `enabled:false`: the style is removed.
- **Acceptance:** The 4 tests pass. The existing cosmetic and popup tests pass.

---

### WP-09 Test-quality fixes that hide real gaps

- **Severity:** medium. **Risk:** low (tests only, plus one oracle).
- **Files:**
  - `test/hcaptcha-never-block.test.js` (lines 241-243)
  - `test/list-refresh.test.js`
  - `test/settings.test.js`
  - `test/dnr.test.js` (lines 87-99)
  - `test/no-background-fetch.test.js` (lines 28-34)
  - `test/fixtures/dnr-matcher.js` (export `urlFilterToRegExp` if necessary)
- **Problems and evidence:**
  1. **hCaptcha scan cannot fail.** The test first removes the backslashes. The next regex then needs a backslash. `h.mjs` shows that 4 of the 5 bad rules are not caught.
  2. **No test covers the expiry branch of `listDue`.** A mutant `return false` survives: 742 passed, and 206 passed in a second run.
  3. **No worker test for `siteInfo.overrideHost` on a subdomain.** The popup tests use 4 to 5 hand-made fakes. A mutant survives.
  4. **The `dnr.test.js` oracle is the dead `general-exclude-hosts.js`.** It does not have ext-twitch.tv, twitchcdn.com, kickusercontent.com or kick-streamer.com.
  5. **no-background-fetch scans 3 dead modules** and none of the live content scripts.
  6. **No test covers the update.js CGNAT range (100.64.0.0/10).** A mutant survives.
- **Why it may be intentional:** Items 1, 2, 3, 5 and 6: nothing found. Item 4: the dead modules are kept until the owner decides ("NEEDS OWNER"), but the oracle choice is not part of that decision.
- **Proposed fix:**
  1. Compile each `regexFilter` and test it against probe URLs (hcaptcha.com, sentry., imgs., newassets.). Use the matcher for `urlFilter`. Add positive self-tests.
  2. Add an automatic refresh test with expired lists (expect a fetch) and lists that are not expired (expect no fetch).
  3. In `settings.test.js`, store `{'example.com':{enabled:false}}`, call the real worker `siteInfo` for `shop.example.com`, and assert `overrideHost === 'example.com'`, `siteEnabled === false` and the feature fields `global`, `on` and `site`. A shared popup harness is optional.
  4. Use `GeckoFeatures.isStreamHost` as the oracle for general-network.json, threat-network.json and ubo-youtube-network.json. Do not remove the old check without owner approval.
  5. Build the scanned file list from `manifest.content_scripts[].js`, the HTML script tags and the worker imports. Leave out only update.js and general-background.js. Assert that `src/cosmetic.js` is in the list.
  6. Through the parser, assert that 100.64.0.1 and 100.127.255.255 are rejected, and that 100.63.255.255 and 100.128.0.1 are kept. <!-- privacy-check: allow (CGNAT boundary test addresses) -->
- **Test proof:** For each test, run a temporary mutant and record the failure in the commit message. Remove the mutant before you commit.
- **Acceptance:** All the new tests pass on the current code, and each one fails on its mutant. The shipped rules still pass item 1 and item 4. If a shipped rule fails, stop that WP and record an owner decision.

---

### WP-10 YouTube toast: no inline hide under the uBO layer

- **Severity:** medium. **Risk:** low.
- **Files:**
  - `src/youtube.js` (`removeInterruptionsToast` about lines 937-956, `cosmeticSweep` about 2084, the handler about 2202)
  - `test/youtube-layers.test.js`
  - the nightly test that calls `removeInterruptionsToast` two times by hand
- **Problem:**
  - Under uBO there is no MutationObserver.
  - The inline hide on `yt-navigate-finish` keeps a reused `#toast` hidden ("Saved to Watch later", "Link copied") until the next navigation.
- **Evidence:** `toast-ubo.mjs` shows 0 observers, `hidden=true` after the content changes, and the toast shows only after nav 2. `docs/how-it-works.md:22` says that youtube.js does not sweep under uBO.
- **Why it may be intentional:** The observer is left out on purpose (the homepage freeze guard). The in-place hide exists because node removal made the toast open again. Nothing says that the inline hide is wanted under uBO.
- **Proposed fix:**
  - Add a `restoreOnly` mode. When `uboLayerPresent()` is true, only undo earlier hides.
  - The CSS rules at `src/youtube-ads.css:34-43` continue to hide the interruptions toast.
- **Test to add:** In the layers harness, load the uBO bundle first. Then do this:
  1. Put stale interruptions text in `#toast` and fire `yt-navigate-finish`. Assert that the toast is not hidden inline.
  2. Change the text to "Saved to Watch later" and fire nothing more. Assert that the toast is visible.
  Update the nightly test.
- **Acceptance:** The tests pass. Live behavior is UNVERIFIED (TODO.md:16).

---

### WP-11 Feed: serial lock after key rotation, and the kill serial step limit

- **Severity:** medium and low. The feed is dormant (FEED_ORIGIN is empty). **Risk:** low.
- **Files:**
  - `src/feed/schema.js` (about lines 72-108 and 190)
  - `src/feed/client.js` (about lines 152 and 250)
  - `scripts/feed-sign.mjs`
  - `docs/feed-setup.md`
  - `test/feed-client.test.js`
- **Problem:**
  1. A document with a short life opens an "any jump" to serial 2^31-1. The serial is never reset, so a new key cannot recover the feed.
  2. The kill serial has a permanent step limit of 1,000,000. With date-like kill serials, a second kill is refused for ever.
- **Evidence:** repro.test.mjs test A ("serial 2147483647 is not newer than 2147483647" after a kill and a new key) and test C ("kill serial jumps ... more than 1000000").
- **Why it may be intentional:**
  - The expiry escape exists on purpose, so that a publisher can change the serial scheme.
  - The step limit was applied to both document types in the same way.
  - Nothing shows that key rotation was considered.
- **Proposed fix:**
  - Store `serialKeyId`, the key that verified the stored feed. Reset `serial`, `notAfter` and `appliedSerial`, and clear the cache, when that key is no longer pinned or when `RELEASED` follows a kill.
  - Allow the expiry escape only when the stored document lived at least 24 h.
  - For kill documents, remove the step limit. Keep the cap and the "must increase" rule.
  - In `feed-sign.mjs`, warn when a serial is near the cap.
  - In `docs/feed-setup.md`, write "kill serials: any increasing number".
- **Tests to add:**
  - (a) Kill, then a new pinned key, then serial 1 signed with the new key is accepted.
  - (b) A stored document with a 60 s life that expires does not open a 2^31-1 jump.
  - (c) Stored kill serial 2026111001, then kill serial 2027121501 is accepted.
- **Acceptance:** The tests pass. The existing feed tests pass.

---

### WP-12 Documentation and licence text in the zip that contradicts the code

- **Severity:** medium and low. **Risk:** low.
- **Files:**
  - `README.md` (lines 12, 29, 47, 59, 69 and 85)
  - `docs/permissions-and-privacy.md` (lines 9 and 47)
  - `docs/STORE-REVIEW-NOTES.md`
  - `docs/how-it-works.md` (lines 21-25, 40, 41 and 64)
  - `src/rules/CREDIT-EasyList.txt`
  - `src/LICENSE-EasyList.txt`
  - `scripts/pack-filter-lists.py` (LICENSES.md writer about lines 1110-1127)
  - `src/rules/LICENSES.md`
  - `src/settings.html:66`
- **Problems:**
  1. **No site-access disclosure.** The docs say the permissions are "exactly" 3 APIs plus the list hosts. They do not say that content scripts run on all http(s) sites, which Chrome shows as "Read and change all your data on all websites".
  2. **Wrong statements in shipped files.** CREDIT-EasyList.txt says "No background auto-fetch" and "Updates are manual". LICENSE-EasyList.txt says "Network filter lines are not shipped". LICENSES.md:86 leaves out threat-network.json.
  3. **Wrong install timing.** The privacy doc says the first download comes 5 to 30 minutes after install. A fresh install downloads at once.
  4. **how-it-works.md is out of date.** The pack numbers are old. It says that only `$document` blocks a page, but `$all` does too. It describes the YouTube Music popup wrongly.
  5. **README "Off".** README says "Off" switches the whole extension off. The ubo-youtube ruleset, youtube-ads.css and the vendored scripts stay on.
  6. **Embedded YouTube.** README does not say that embedded YouTube players get no scriptlets.
- **Evidence:** See the findings. Code references: `general-background.js:931` and `:990`, `meta.json` sources.easylist kept 43868, `filter-options.js:352-363`, `manifest.json` content_scripts.
- **Why it may be intentional:** These are mostly early-beta text that was not updated. "Permissions" in the docs means the manifest keys. The install refresh is intentional, according to its code comment.
- **Proposed fix:**
  - Rewrite the text so that it agrees with the code.
  - Make the LICENSES.md change in the packer writer. Then regenerate only LICENSES.md, or edit it to match exactly. Do not repack the lists for this.
  - For README "Off", use the Option B text. Option A (the code change) is an owner decision.
- **Test to add:** A doc test that fails on these strings in the shipped licence files: "No background auto-fetch", "Updates are manual" and "not shipped". Optional: a test that `permissions-and-privacy.md` names "all websites" while the manifest has all-http(s) matches.
- **Acceptance:** The tests pass. `scripts/privacy-check.py` passes.

---

### WP-13 Threat tier: protect the hosts that serve a platform, not only the apex name

- **Severity:** medium. **Risk:** medium (it changes the generator output, and maybe the packed threat set).
- **Files:**
  - `scripts/build-psl-subset.mjs` (PLATFORMS about lines 39-61)
  - `src/threat/psl.js` (`table`/`suffixReason`)
  - `src/rules/threat-network.json` and `threat-meta.json`, only if a rebuild is necessary
  - threat and psl tests
- **Problem:**
  - Only the apex name and its parents are protected.
  - The threat tier accepts www.facebook.com, cdn.jsdelivr.net, raw.githubusercontent.com, login.live.com and www.amazon.com.
  - These rules have priority 2,000,010, so "Allow this page" cannot override them.
- **Evidence:** `verify-threat/v.mjs` and `p3.mjs` show "BLOCKED at 2000010" for these hosts.
- **Why it may be intentional:** The apex-plus-parents rule is correct for per-customer hosting (github.io). It is not correct for single-service sites.
- **Proposed fix:**
  - Split PLATFORMS into per-customer parents and SERVICE_PLATFORMS.
  - For SERVICE_PLATFORMS, protect the name and every host under it.
  - Add an exact SERVICE_HOSTS list: cdn.jsdelivr.net, raw.githubusercontent.com, objects.githubusercontent.com, cdn.discordapp.com, media.discordapp.net, dl.dropboxusercontent.com, firebasestorage.googleapis.com, challenges.cloudflare.com, www.recaptcha.net and js.stripe.com.
  - Regenerate psl.js from the cached PSL if it is present.
  - Check that the packed threat-network.json has none of the newly protected hosts. If it has one, rebuild from the cached lists and record the counts.
- **Test to add:**
  - `compileThreatRules` rejects www.facebook.com, cdn.jsdelivr.net, raw.githubusercontent.com and login.live.com.
  - It still accepts evil.github.io.
- **Acceptance:** The tests pass. The packed set is consistent. The zip is below 8 MB. The CHANGELOG says that the allow box now refuses these names.

---

### WP-14 Cosmetic: the $generichide and $elemhide exceptions

- **Severity:** medium. **Risk:** medium to high (new storage key, PARSER_VERSION, packer).
- **Files:**
  - `src/general/cosmetic-parse.js` (`parseCosmetic`, `mergeCosmetic`, `toStorage`, `keysForHost`, `buildPageCss`)
  - `scripts/pack-cosmetic.mjs`
  - `src/rules/cosmetic-rules.json`
- **Problem:**
  - No code reads `@@||host^$generichide`.
  - The full generic sheet (about 13.6k selectors) applies on mail.google.com, github.com, docs.google.com, adsmanager.facebook.com and localhost, which EasyList exempts.
- **Evidence:** `generichide.mjs`. The comment at cosmetic-parse.js lines 218-221 uses this same gap as the reason for the AdGuard "sites only" choice.
- **Why it may be intentional:** It is a known gap for AdGuard. It is not a decision for EasyList.
- **Proposed fix:**
  - Parse `$generichide`, `$ghide`, `$elemhide` and `$ehide`, the `domain=` form, and the localhost and private-IP forms.
  - Store `cosNoG:<host>` (and an elemhide marker).
  - In `buildPageCss`, leave out the generic sheet and the fallback for a listed candidate host. With elemhide, also leave out the site selectors.
  - Make the same change in pack-cosmetic.mjs. Increase PARSER_VERSION.
  - Repack the cosmetic rules only from the cached lists. Check the zip size.
- **Tests to add:**
  - `##.ad-banner` plus `@@||mail.google.com^$generichide` gives empty CSS for mail.google.com and its subdomains, and full CSS for example.com.
  - The `domain=` form works.
  - `checkCosmeticChange` still accepts the list.
- **Acceptance:** The tests pass. The storage budget test passes. If the storage layout cost is too high, use DISCARD and make this an owner decision.

---

### WP-15 Cosmetic: the hide style breaks React 18 whole-document hydration

- **Severity:** medium. **Risk:** medium to high (all pages get a new style path).
- **Files:** `src/cosmetic.js` (`injectStyle` and `removeStyle`, about lines 69-78).
- **Problem:**
  - `<style id=gk-c1>` is the first child of `<html>`.
  - React 18 `hydrateRoot(document)` gives errors #418 and #423 and renders the full document again.
  - The style is then lost, and nothing puts it back.
- **Evidence:** The Chrome repro run.cjs react shows the errors and `AdBar display=block`. The control run without the extension has no errors. The adoptedStyleSheets prototype gives no errors and `display=none`.
- **Why it may be intentional:** The style goes in early to stop an ad flash, before `<head>` exists. Nobody considered hydration.
- **Proposed fix:**
  - Use a constructable sheet in `document.adoptedStyleSheets`. Use `replaceSync` for updates. Remove the sheet with a filter.
  - Keep the `<style>` path as a try/catch fallback, with a childList MutationObserver that adds the style again when it is disconnected.
  - Check at DOMContentLoaded that the sheet is still adopted.
- **Tests to add:**
  - Unit test: `applyState` uses `adoptedStyleSheets` when it is available, and still hides.
  - Optional browser test with React 18.2 `hydrateRoot(document)`.
- **Acceptance:** The tests pass. The existing cosmetic and privacy tests pass. The neutral-id rules still hold. UNVERIFIED on live sites.

---

### WP-16 List refresh timing: the retry after a failure, and clock skew

- **Severity:** low. **Risk:** low.
- **Files:**
  - `src/general/update.js` (lines 3-4, 19-21, 620-638 and 842-844)
  - `src/general-background.js` (alarm about lines 930-990)
  - `test/storage-alarm.test.js`
- **Problems:**
  1. The documented 30-minute retry never occurs. The first alarm after an offline install is always throttled, so the real retry comes after about 3 h.
  2. A `lastRunAt`, `lastAttemptAt` or `fetchedAt` time in the future stops automatic refreshes until the clock reaches that time.
- **Evidence:** `throttle_test.js` output.
- **Why it may be intentional:** The tests treat 30 minutes as a floor ("next 3 h alarm retries"). Nothing covers clock skew.
- **Proposed fix:**
  - Item 1: Option A. After a run with `ran:true` and `ok:false`, create a one-shot alarm "gecko-refresh-retry" (31 minutes) and handle it in `onAlarm`. If that is too risky, use Option B and correct the docs only.
  - Item 2: treat stored times later than now + 5 minutes as invalid in `shouldRun` and `listDue`.
- **Tests to add:**
  - A failed run schedules the retry alarm.
  - `shouldRun({lastRunAt: now + 365 days})` is true.
  - `listDue` with `fetchedAt` in the future is true.
- **Acceptance:** The tests pass. The CHANGELOG text agrees with the behavior.

---

### WP-17 Cosmetic: guard bypass by an unscoped selector, and the onChanged cost

- **Severity:** low. **Risk:** low.
- **Files:** `src/general/cosmetic-parse.js` (`isUnscopedBranch`) and `src/cosmetic.js` (`injectStyle`, the onChanged handler about lines 240-246).
- **Problems:**
  1. These generic rules are kept, and they hide the whole page: `html:has(.x) > *`, `:root:has(.x) > *`, `&:has(.x)`, `*|html:has(.x)` and `*|body:has(.x)`.
  2. Every frame writes `textContent` again with identical CSS. An Allow on site A rewrites the sheet in other tabs.
- **Evidence:**
  - Item 1: bypass.mjs and bypasscheck.cjs (headless Chrome).
  - Item 2: run.cjs probe and resync measurements.
- **Why it may be intentional:**
  - Item 1: the `compounds.length === 1` limit keeps `.ad *`. The rest is an oversight.
  - Item 2: cosMeta is the change trigger on purpose.
- **Proposed fix:**
  - Item 1: remove namespace prefixes. Treat `&` as `:root`. When the first compound is html, `:root` or `&`, require a later compound to have its own scope.
  - Item 2: do the cheap part only. Skip a write when the text is equal. For settings changes, call `sync()` again only when this frame's resolve result changes. The storage layout change is an owner decision.
- **Tests to add:**
  - The 5 selectors are rejected. `.ad *` and `div:has(.x) > *` are kept.
  - A second `applyState` with the same CSS does not write again.
- **Acceptance:** The tests pass. The nightly-cosmetic tests pass.

---

### WP-18 Flags port: a page inline script can get a port

- **Severity:** low. **Risk:** medium (the order of document_start scripts).
- **Files:** `src/settings/flags.js` (lines 8-21 and 111-118).
- **Problem:**
  - Requests are answered until `setTimeout(0)` fires.
  - A `<head>` inline script can get a port in that time. It can read 5 flags and fake guard pings.
- **Evidence:** run.cjs port (Chrome).
- **Why it may be intentional:** The setTimeout window handles both script orders. The header marks the ordering as UNVERIFIED.
- **Proposed fix:**
  - Close the window after the expected number of extension page-world handshakes for this frame type. Derive that number from the manifest.
  - Also close on the first `readystatechange`.
  - Correct the header comment.
  - Do not touch `src/kick.js`. If kick.js needs a port and the count logic must change kick.js, use DISCARD and make it an owner decision.
- **Test to add:**
  - A fixture with an inline `<head>` script gets no port.
  - The guard scripts still get their flags.
- **Acceptance:** The tests pass. The guard and Kick flag tests pass.

---

### WP-19 YouTube watchdog: unplayable pages, and the "Blocking ads" chip under uBO

- **Severity:** low. **Risk:** low.
- **Files:**
  - `src/youtube.js` (`checkStall` about lines 1423-1507, `removeDomAds` about 1290-1302, `notify` about 1247-1288)
  - `src/youtube-ads.css`
  - `docs/how-it-works.md:22`
  - `test/fixtures/youtube-clock-run.mjs`
- **Problems:**
  1. The watchdog reloads upcoming premieres and pages with LOGIN_REQUIRED, UNPLAYABLE or ERROR status.
  2. Under uBO, `removeDomAds` adds `#gk-n1` "Blocking ads". This disagrees with the docs.
- **Evidence:**
  - Item 1: the clock fixture no-reply scenario.
  - Item 2: notice-ubo.mjs.
- **Why it may be intentional:**
  - `.ytp-error` shows for a short time on decoy starts. So do not stop on `.ytp-error` alone.
  - The chip is a feature.
  - Some DOM selectors are not in the CSS.
- **Proposed fix:**
  - Item 1: before `reloadVideo`, read `getPlayerResponse().playabilityStatus` in a try block. Stop on LIVE_STREAM_OFFLINE, LOGIN_REQUIRED, UNPLAYABLE, ERROR, AGE_CHECK_REQUIRED or an offlineSlate.
  - Item 2: Option B. Under uBO, do not call `notify(true)` from DOM removal. Update docs line 22 so that it agrees.
- **Tests to add:**
  - Clock-fixture scenarios for each status give `reloads=[]`. The existing no-reply scenario keeps 1 reload.
  - A layers test (uBO first): no `#gk-n1` after the sweep.
- **Acceptance:** The tests pass.

---

### WP-20 Feed robustness: cache write failure, threat tier switched off, rollback noise, start cost

- **Severity:** low. The feed is dormant. **Risk:** low.
- **Files:**
  - `src/feed/client.js` (about lines 186-195, 239-244, 274-293)
  - `src/general-background.js` (about lines 315 and 968-970)
  - `test/final-storage-budget.test.js`
- **Problems:**
  1. When `setCache` throws after `replaceRules`, a worker restart puts the old rules back.
  2. With threatTier off, the snapshot fallback installs the packed threat list again.
  3. A rollback document that is served again gives a false "replay" warning.
  4. Each worker wake verifies and rewrites the feed rules again.
- **Evidence:** repro2 tests F and G, repro tests D and E, perf.test.mjs.
- **Why it may be intentional:**
  - The "rules first" order was chosen for a `replaceRules` failure.
  - The snapshot is the feed's fallback.
  - The "on every start" choice is for robustness.
- **Proposed fix:**
  1. When `setCache` throws, set the rules from the cached document again.
  2. Give the threatTier state to the feed deps. With no valid cache and the snapshot not allowed, remove the feed rules. Call `applyCachedFeed` when threatTier changes.
  3. Store `lastDocHash` and return "unchanged" when the same bytes and sig come again.
  4. Skip `replaceRules` and `setState` when the session rules already match.
  - Add the feed cache to the storage budget test.
- **Tests to add:** One test for each item, as given in the finding fix_notes.
- **Acceptance:** The tests pass.

---

### WP-21 Threat PSL: IDN suffixes and private wildcard regions

- **Severity:** low. **Risk:** medium (it regenerates psl.js).
- **Files:** `scripts/build-psl-subset.mjs` (about lines 80, 113 and 117), `src/threat/psl.js`.
- **Problems:**
  1. All Unicode PSL lines are dropped, so psl.js has 0 xn-- names.
  2. `<region>.compute.amazonaws.com` is not protected.
- **Evidence:** idn.mjs and v.mjs: `userDomainReason('公司.cn')` gives reason null. p4.mjs: the EC2 regions give null.
- **Why it may be intentional:**
  - The comment says "Keep ASCII only".
  - The children of private wildcards are left out on purpose for size. But privateDeep makes an exception for S3.
- **Proposed fix:**
  - Convert each Unicode rule with `new URL('http://' + rest).hostname` and keep the prefix.
  - Emit `privateWildcardBases` and use them in `suffixReason` only.
  - Use the cached PSL. If no cached PSL exists, download it one time and record the PSL date.
  - Do this WP after WP-13, in the same generator run.
- **Tests to add:**
  - `suffixReason('xn--55qx5d.cn')` is not null. `userDomainReason('公司.cn')` is refused.
  - us-west-1.compute.amazonaws.com is refused.
  - ec2-54-177-49-112.us-west-1.compute.amazonaws.com is still accepted.
- **Acceptance:** The tests pass. The psl.js size stays acceptable. The zip is below 8 MB.

---

### WP-22 Release tooling and gate

- **Severity:** low. **Risk:** low.
- **Files:**
  - `scripts/release-gate.sh` (section 1b about lines 258-283, section 2 line 310, line 601)
  - `scripts/vendor-pins.json`
  - `test/vendor-pin.test.js`
  - `scripts/lib/package_files.py` (lines 201-213)
  - `scripts/pack-filter-lists.py` (`fetch` about 609-622, `main`)
  - `scripts/feed-sign.mjs:36`
  - `scripts/pack-zip.sh`
  - `.github/workflows/release.yml`
  - `scripts/sync-ubo-youtube.mjs` (lines 25-44) and its workflow
- **Problems:**
  1. On `main`, the frozen-file check compares with `origin/main`, so it can never fail. kick.js has no content pin.
  2. Section 2 does not check `update_url`, `content_security_policy`, `sandbox` or `web_accessible_resources`.
  3. The rg glob `!src/rules/*` has no effect with absolute paths.
  4. `--check-zip` compares only the file names.
  5. The packer accepts an empty or HTML list body.
  6. `feed-sign` signs an expired feed.
  7. The zip is not reproducible, and the sha256 is only in the job log.
  8. The uBO sync runs upstream code with `-A` from a tag and does not verify the recorded commit.
- **Evidence:** The repros in the findings (clone and gate run, sec2.py, the rg run, stale.zip, packer_empty.py, the feed-sign run, two zip hashes).
- **Why it may be intentional:** Each item was written for a narrower case: a PR diff, forbidden keys added one by one, a set-only check, an attended packer, signing ahead of time, convenience. No document makes any of these a design rule.
- **Proposed fix (all in the gate and the scripts, not in the frozen files):**
  1. Add `frozen` sha256 pins for kick.js and the Twitch file. Section 1b compares the content with the pin in repo mode and zip mode. Keep the diff check. Written reason for the gate change: "freeze must hold on main and in the release job".
  2. Use an allow-list of top-level manifest keys, taken from the current manifest.json.
  3. Use the glob `!**/rules/*.json`, or run rg after `cd "$PKG"` with relative paths. Check the other `--glob` uses for the same problem.
  4. Add a byte check when the zip version equals the checkout version.
  5. Refuse an empty or HTML body. Compare the counts with the committed meta.json, and refuse a shrink of more than 25% unless `--accept-shrink` is given. Write nothing on a refusal.
  6. Add a check against the real time: refuse a past `notAfter`, and warn when less than 24 h is left.
  7. Optional: fixed mtimes, sorted names, `zip -X -D`, and a `.sha256` release asset. Keep the Windows `tar.exe` fallback working, or record it as an owner decision.
  8. Check the cloned HEAD against `ublock_commit`. Replace `-A` with explicit grants.
- **Tests to add:** One test for each item:
  - a scratch manifest with a forbidden key gives FAIL
  - a changed kick.js against the pin gives FAIL
  - `password=` in `src/rules/x.json` gives PASS, and in `src/x.js` gives FAIL
  - a zip with one changed byte gives FAIL
  - a packer with a stub empty source exits non-zero
  - feed-sign with a past `notAfter` exits non-zero
  - optional: pack two times and get the same hash
  - the meta commit is the same as the pin
- **Acceptance:** The release gate is CLEAN on the checkout and with `--zip`. The new tests pass.

---

### WP-23 Popup and settings UI

- **Severity:** low. **Risk:** low.
- **Files:**
  - `src/popup.js` (lines 216-220, 279-315, 443-455, 468, 506-509 and 571-576)
  - `src/popup.css`
  - `src/settings.js` (lines 44-49, 145-161, 190-191, 214-226 and 284-286)
- **Problems and fixes:**
  1. **Clicks are lost while busy waits for the worker.** Do not `await applyRules()` inside `guarded()`, or disable all action buttons while busy.
  2. **Focus is lost after Undo fix.** Move focus in the `finally` block after `render()`.
  3. **The settings page loses a change when two writes overlap.** Chain the writes in a promise queue and read fresh state in each step.
  4. **The popup shows "✅ Protected" while the lists are off.** Add a status branch for that state.
  5. **"Allowed – not blocking here" is false on YouTube and Twitch.** Use the `stream` field and a correct text.
  6. **A stale "Did that fix it?" shows after a settings Undo.** Treat the entry as stale in `pendingFix`, and clear `popupFix` from the settings page.
  7. **`aria-pressed` with a label that changes.** Remove `aria-pressed` and move the CSS selector to a class.
  8. **Row buttons have no domain in their name.** Set `aria-label` to the words plus the domain.
- **Evidence:** busy-drop, undo-focus, settings-race and status test files.
- **Why it may be intentional:**
  - The busy guard is deliberate (CHANGELOG 0.3.5, double click).
  - The status line is short on purpose.
  - The rest has no recorded reason.
- **Tests to add:** One harness test for each item, as given in the finding fix_notes.
- **Acceptance:** The tests pass. The existing popup and settings tests pass.

---

### WP-24 Popup guard gaps (an opt-in feature)

- **Severity:** low. **Risk:** medium (false positives).
- **Files:** `src/guards/popups.js` (lines 45, 181, 241-276 and 287), `docs/how-it-works.md:52`.
- **Problems:**
  1. A pop-under is not checked when it uses `<a target=_blank>.click()` or a form with `target=_blank`.
  2. `window.open` in a same-origin child frame skips the pop-under check.
  3. A keyboard Enter within 5 s of a click in a text field is blocked.
- **Evidence:** p1.mjs, p3.mjs and p5.mjs.
- **Why it may be intentional:** The documented scope is `window.open` only. The feature is off by default.
- **Proposed fix:**
  - Item 3: do it. Make a trusted keydown start a new gesture.
  - Items 1 and 2: Option B. Document the scope. Option A (the full coverage) is an owner decision.
- **Test to add (item 3):** A click in an input, then Enter, then a cross-site `window.open`: the open is allowed. A click on plain text, then `window.open`: the open is still blocked.
- **Acceptance:** The tests pass. The docs give the correct scope.

---

### WP-25 Optional efficiency: tests in parallel, and a Twitch playlist harness

- **Severity:** low. **Risk:** low.
- **Files:**
  - `.github/workflows/checks.yml:46`
  - `scripts/release-gate.sh:739`
  - a new `test/twitch-playlist.test.js`
- **Fix:**
  - Add `--parallel` in checks.yml only. Leave the gate serial until the CI is proven stable over 5 or more runs (owner decision).
  - Add a harness that takes `stripAdSegments` from the vendor text with `indexOf` slices and runs it on the m3u8 fixtures. Do not change the vendor file.
- **Test proof:** The playlist test fails with a mutant fixture that keeps the ad segments.
- **Acceptance:** The suite is green. If the harness cannot run the vendor code in Deno, use DISCARD and write the reason.

## 3. Owner decisions

The executor must not decide these items. Record each one in HANDOFF.md with the recommendation.

1. **Kick fixes** (`docs/proposals/kick-0.3.5-fixes.patch`). kick.js is frozen. Do not apply the patch. The owner must review it.
2. **Frozen-file gate change (WP-22 item 1).** Adding content pins changes the gate. The plan does this with a written reason. The owner must confirm it.
3. **Master switch and the ubo-youtube ruleset.** Option A: switch the ruleset off with the master switch. Option B: change the docs only. The plan does Option B.
4. **Embedded YouTube players.** Enable the scriptlets in `/embed/` frames after a live test, or document the gap only. The plan documents the gap only.
5. **EasyList licence option.** Change from CC BY-SA 3.0 to GPL-3.0-or-later in the packer text, LICENSES.md, CREDIT-EasyList.txt and LICENSE-EasyList.txt. Recommendation: GPL-3.0-or-later.
6. **Peter Lowe list terms** ("non-commercial"). This is already open (CHANGELOG line 174).
7. **Project LICENSE in the zip.** Add `src/LICENSE.txt` to EXTRA_REQUIRED, ALLOWED_RE and REQUIRED. Recommendation: yes. It is low risk, and the executor may do it if the owner already agrees in TODO or HANDOFF. If not, keep it here.
8. **Cross-list `@@` exceptions** (uBO semantics compared with the documented same-host rule). Recommendation: keep the current documented rule and add a doc note.
9. **Cosmetic storage layout** (keep the big keys out of the area that content scripts listen to). Make this change only after a measurement.
10. **Popup guard coverage of anchors, forms and child frames** (WP-24 Option A).
11. **Release-gate tests in parallel.**
12. **Reproducible zip on Windows `tar.exe`** (WP-22 item 7), if that path cannot use fixed timestamps.

### Deletion candidates (the owner must approve each one; do not delete)

- `src/general/toggles.js`, `src/general/exclusions.js`, `src/general/cosmetic.js` and `src/general-exclude-hosts.js` (dead modules, "NEEDS OWNER").
- Their tests: `test/toggles.test.js`, `test/exclusions.test.js` and `test/general-cosmetic-contract.test.js`. Rename these tests instead, if the owner keeps the modules.
- The string-presence Twitch tests that the SHA pin covers. Merge them, but only after the WP-25 harness exists.
- `docs/cards2/` and `docs/cards-main/` (the same as `docs/cards/`; already listed in TODO.md:41).

## 4. Rejected findings (for information)

These findings were rejected. Do not act on them unless new evidence comes.

| Finding | Reason for rejection |
|---|---|
| `~host` generic exclusion also removes a subdomain site rule | 0 such pairs in today's lists. Latent. |
| youtube.js fetch hook throws synchronously for a Request whose body was used | The path is not reachable. The uBO marker is always set, and the hooks stand down. |
| A stripped youtubei Response loses url and type | The same path that is not reachable. |
| The XHR json getter returns a new copy each time | The same path that is not reachable. |
| Decoy detection depends on the local clock | Under uBO it only shortens the watchdog wait. Negligible. |
| Kill latch is released by any version change | This is documented behavior. |
| An old kill document can latch a fresh install | The attacker already controls the feed host. Negligible extra harm. |
| Packed threat set blocks large-provider service hosts (daum, huaweicloud) | The curated lists name them. No false positive was shown. "Allow this domain" exists. |
| Static threat ruleset is a permanent floor | Documented design. |
| IDN hosts show as punycode in the UI | A protective choice against spoofing. |
| Gate section 4 misses some API call forms | The manifest permissions are the real limit. Latent. |
| STORE-REVIEW-NOTES does not cover the Twitch token handling | It is already disclosed in permissions-and-privacy.md:48. |
| Test DNR matcher simplifications | Documented. No wrong result today. |
| 11.2 MB of identical images in docs/ | Already in TODO.md:41. Not in the zip. |
| One known-issue test is ignored | A documented, deliberate marker. |

## 5. Release steps for 0.3.6

Do these steps after all the WPs are done, changed or discarded.

1. Run `git status` and make sure that the tree holds only the intended changes.
2. In `manifest.json`, set `"version": "0.3.6"`.
3. Run `grep -rn "0\.3\.5" README.md test/ scripts/ docs/ manifest.json`.
   - Change the README version text and the zip link to `adgecko-0.3.6.zip`.
   - Change each test that checks the current version.
   - Do not change history text in CHANGELOG or in old docs.
4. Add a CHANGELOG.md section "0.3.6" with these subsections:
   - Security (WP-01 to WP-05)
   - Fixes
   - Tests
   - Docs and licences
   - Release tooling
   - Reviewed, not changed (each DISCARD with its reason)
   - Owner decisions open
   Mark the claims UNVERIFIED where no live test was done.
5. Run the full suite:
   `cd . && deno test --no-lock --allow-read --allow-run --allow-env test/`
   - Expected result: 0 failed.
   - The passed count is higher than 776.
   - The ignored count is 9 or less. Explain any change.
6. Run `bash scripts/release-gate.sh`. The result must be CLEAN.
7. Run `bash scripts/pack-zip.sh`. Make sure that `adgecko-0.3.6.zip` is smaller than 8 MB.
8. Run `bash scripts/release-gate.sh --zip adgecko-0.3.6.zip`. The result must be CLEAN.
9. Run `python3 scripts/privacy-check.py`. The result must be a pass.
10. Do not commit the zip unless the repository already tracks release zips. Check with `git ls-files '*.zip'`.
11. Update HANDOFF.md. Give the status of each WP, the open owner decisions, the deletion candidates and the UNVERIFIED items for a run on the owner's PC.
12. Commit on the branch `claude/festive-dirac-a043po`. Use ASD-STE100 messages with the attribution lines.
13. Push the branch `claude/festive-dirac-a043po` after each finished WP and at the end (the container is temporary; unpushed commits are lost). Update the draft pull request. Do not push to `main`, do not tag, and do not run the release workflow. The work is complete when the branch holds version 0.3.6 and all the checks above pass.
14. Give the final report. Include:
    - the test counts
    - the gate results (checkout and zip)
    - the zip size and sha256
    - the privacy check result
    - the list of owner decisions and deletion candidates
    - what was checked in that session and what was not
