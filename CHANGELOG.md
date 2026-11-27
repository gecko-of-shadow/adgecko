# Changelog

All notable changes to Adgecko, newest first. Each released version matches a GitHub release tagged `v<version>` (v0.3.0 and later); the release workflow copies a version's section into its release notes.

Dates in this file are the owner's local date (UTC-6). The dates stored on packed files and filter lists (`src/rules/meta.json`, `threat-meta.json`, the list `! Expires` headers) are UTC.

## Unreleased

Five owner decisions of 2026-11-20. Not tested in real Chrome: the Kick and Twitch changes are UNVERIFIED until a run on the owner's PC proves them.

### Changed

- Kick: the corrections in `docs/proposals/kick-0.3.5-fixes.patch` are applied to `src/kick.js` (owner decision 1). The banner path does not collapse a box that holds the video player. A box that the banner path collapsed is shown again when its ad frame goes or when the Kick switch goes off. While a cover or a box is hidden, a removed node also starts a new pass. The pin of `src/kick.js` in `scripts/frozen-pins.json` is updated. Three Kick tests that were ignored now run.
- Twitch: the ad host `ads.twitch.tv` and its subdomains are blocked by the extra tracker rule of the list merge. Two tests that were ignored now run.
- Licence: for EasyList, the chosen option of its dual licence is now GPL-3.0-or-later (owner decision 5). The project `LICENSE` now ships in the zip as `src/LICENSE.txt` (owner decision 7).
- Package: `src/rules/cosmetic-sample.json` (172,666 bytes, read by no code) is removed from the repository and the zip.

### Fixed

- Repository: `.gitignore` now has `_metadata/`. Chrome writes this folder (indexed rule sets) into the repository root when it loads the unpacked extension, and `git status` showed it as a new folder.
- Settings page: Enter in the Allow this domain box now adds the domain, the same as the button. Before, Enter did nothing (proven in Chrome for Testing 155). Enter during IME composition does not add.
- Popup and settings page: the list status names each failed host once. Lists that share a host (EasyList and EasyPrivacy and their mirrors) repeated the same "host: reason" text. Offline in Chrome for Testing 155: 14 parts and 852 characters before, 8 parts and 509 characters after.
- Hide sheet memory: the content script kept the whole page sheet text (about 535,000 characters) only to skip an equal rewrite. When the frame is idle it now keeps a fingerprint (length and two 32-bit hashes) instead. Chrome for Testing 155, top frame of an ordinary page, after garbage collection: 2,097 KB script heap before, 1,085 KB after (no extension: 631 KB). An equal sheet is still not written again.
- Clipboard guard: PowerShell commands that use `/`, `--` or a Unicode dash (en dash, em dash, horizontal bar) before a switch, any prefix of a switch name (`-EncodedC`, `-WindowS`), or `-w 1` (WindowStyle 1 is Hidden) now match, as do `cmd` commands with other switches before `/c` (`cmd /q /c`, `cmd.exe /v:on /c`, `cmd/c`). powershell.exe accepts all of these (PowerShell `CommandLineParameterParser`). In Chrome for Testing 155 a click that wrote `powershell /enc <base64>`, `powershell \u2013enc <base64>`, `powershell -w 1 ...` or `cmd /q /c curl ...` was written before and is refused now; `powershell -WindowStyle Normal -Command Get-Date` is still written.
- Settings page: after Allow this domain, the status line names the domain ("Allowed shop.example.com. Reload the blocked page.") instead of "Saved.", and a domain that is already on the list gives "… is already allowed." with no storage write.
- Clipboard guard: the "Blocked: this page tried to put a command into your clipboard" notice opens in the browser's top layer (a manual popover), so a page covered by a modal dialog or its own popover, the usual fake "verify you are human" screen, can no longer hide it. Before, the notice sat under the dialog and was not visible.
- Settings page: list rows no longer split ordinary words at narrow widths. `word-break: break-all` broke "boxes" into "box" and "es" and "site" into "s" and "ite" at 360 px; `overflow-wrap: anywhere` wraps at spaces and still breaks a long domain name where it would overflow (Chrome for Testing 155, 360 px: 1 split word in the empty lists and 2 in two site rows before, 0 after; no horizontal scroll either way).
- Settings page: on narrow screens the Allow this domain button wraps below the box instead of squeezing it, so the placeholder "example.com or paste the address" is no longer cut off (Chrome for Testing 155: box content 84 / 124 / 184 px at 320 / 360 / 420 px wide before, 240 / 280 / 340 px after; the placeholder needs 227 px; 1280 px unchanged).
- Toolbar dot: when page guards blocked something in several tabs at the same moment, only one or a few tabs kept the stored event, so the popup of the others showed the dot but no "Blocked: …" line. The worker now changes the stored events one at a time (Chrome for Testing 155, 6 tabs blocked together, 5 rounds: 8 of 30 events kept before, 30 of 30 after).
- Clipboard guard: three more ClickFix forms match: the DNS form (an `nslookup` reply piped into `cmd`/PowerShell or written to a `%TEMP%` script), a download piped into `python`, `perl` or `ruby` with no script argument, and a download into `%TEMP%`/`%APPDATA%` that is started on the same line after `&` or `;`. `| python3 -m json.tool`, a plain `nslookup` and a `%TEMP%` download with `&` in its URL still pass. In Chrome for Testing 155 three such writes went through before and are refused now; two near misses are still written.

### Documentation

- YouTube: the 4 to 12 s spinner before a video plays is documented in `docs/youtube-slow-start.md` and in the README limits. YouTube's server sets this wait when the ad is removed. The owner accepted it on 2026-11-27; no code changed.
- The `localStorage["twitch-adblock-yt-opts"]` settings named in sections 0.2.21 and 0.2.19 no longer work. The YouTube start switches are built-in defaults only (Block I hardening).

### Tests

- Owner decision 16: `src/rules/ubo-youtube-network.json` blocks `ads.youtube.com` on purpose. The stream-host oracle test now also checks that ruleset, with a named exception for this one host. A test fails if the exception goes stale.
- New maintainer script `scripts/chrome-smoke.mjs` (not in CI): loads the unpacked extension in headless Chrome for Testing, offline, and checks the service worker, the packed hide rules, the network rules, the hide sheet, the toolbar popup and the clipboard guard (6 checks, about 11 s). A copy without the clipboard guard fails its check.

## 0.3.7 (2026-11-20)

A YouTube update. Tested on 2026-11-20 in the owner's Chrome (signed in) and in Chrome for Testing 155 (not signed in), on youtube.com watch pages only. Known, not fixed: on a signed-in account YouTube can still hold a video on a black screen for 6 to 21 s when it refuses all fallback steps. Twitch, Kick and ordinary sites are unchanged from 0.3.6.

### Fixes

- YouTube: the uBlock Origin YouTube filters are synced to uAssets `900a2a3` (was `e140ffc`). uBlock Origin scriptlet code stays at tag 1.75.0.
- YouTube: a possible cause of a long black screen at the start of a video is removed. In 0.3.6, uBlock Origin's start recovery could discard all its fallback steps after the first reload, and then wait with no second reload. uAssets `1fbf62c` (2026-11-17) guards this. `test/ubo-rpnt-payload.test.js` has a test that fails on the 0.3.6 payload. Seen on a live page on 2026-11-20: the 0.3.6 code skipped the `inline` step and gave up; the new code tries each step.
- YouTube: uBlock Origin's start recovery starts its list of fallback steps again on the next video, when all steps failed on the video before. Upstream keeps the empty list; in a live test (2026-11-20) each later video in that tab then waited 5 to 14 s with no recovery attempt. This is a local change to the upstream code (`ARG_PATCHES` in `scripts/sync-ubo-youtube.mjs`). Seen to work on a live page; it does not remove the waits.
- YouTube: the "Experiencing interruptions?" popup at the bottom left is hidden again. YouTube now shows it in a new element (`snackbar-container`) that the CSS rules did not match. The new element has the same markup as "Link copied to clipboard", so `src/youtube.js` reads the text and hides only that message; other messages stay. Limits: it works only when YouTube is in English, and it hides the message only, not the wait. Tested in Chrome for Testing 155 (not signed in): without the change the popup was visible in 3 of 3 sessions, with it in 0 of 5, and "Link copied to clipboard" still showed after it. The popup's markup was read in the owner's signed-in Chrome; the hide was not measured there.
- YouTube: the new upstream filters for embedded players do not add work to each `JSON.stringify` call. The local root-key guard now reads a dotted filter (`[?.a.b.c]`).

### Changed

- YouTube: on a `www.youtube.com/embed/` page in its own tab, uBlock Origin's start recovery now runs (upstream change). Before, it stepped aside there.
- `scripts/sync-ubo-youtube.mjs`: the first local payload patch follows the renamed upstream variables. The `#masthead` patch is removed, because upstream guards that read again.

## 0.3.6 (2026-11-16)

A code review of 0.3.5 (2026-11-16) confirmed 64 findings. This release does the 25 work packages of that review (`docs/review-2026-11-16/PLAN.md`). Each code fix has a regression test that failed on 0.3.5. No item was tested on the owner's PC or on live sites, so all behavior below is UNVERIFIED until a run on the owner's PC proves it. The release also has the changes that were merged after 0.3.5 (PR #13).

### Security

- Clipboard guard: a value that throws while it is converted to text now makes `setData`, `items.add` or `execCommand` fail. Before, the value went to the clipboard with no check.
- Clipboard guard: on ordinary sites, a copy now writes the exact text that the guard checked. A page can no longer change the selection during the copy. Image alt text and form-field values in a selection can no longer hide a command. **Change:** copies on these sites are plain text only (no formatting, and a selected image copies nothing). A page's own "cut" command no longer removes the text. Your own Ctrl+X works as before. Trusted documentation sites do not change.
- Clipboard guard: `clipboard.write()` is blocked when the check cannot read the text. A page can no longer change Promise behavior to get past the check. Image-only writes still work.
- Clipboard guard: more ClickFix commands are detected: pipes to `/bin/bash`, `nohup` or `sudo`, `bash <(curl ...)`, base64 payloads in `sh -c "$(...)"`, `finger ... | cmd`, WebDAV paths (`\\host@SSL\DavWWWRoot\...`), and `msiexec`, `regsvr32` or `powershell -f` with a network path.
- Clipboard guard: Ctrl+C counts as your own copy only for text that you selected yourself and that is visible. A page can no longer pre-select a hidden command and wait for you to press Ctrl+C.
- Page settings channel: a page's first inline script can no longer get the private settings channel (it could read the guard switches and fake a "blocked" dot).
- Malware blocking: one bad list line can no longer block the hosts that run a big platform (`www.facebook.com`, `login.live.com`, `cdn.jsdelivr.net`, `raw.githubusercontent.com`, `js.stripe.com` and more). Internationalized public suffixes (`公司.cn`, `政府.hk` and about 290 more) and cloud region names (`us-west-1.compute.amazonaws.com`) are no longer blocked as a whole. **Allow this domain** for the malware list refuses these names too. The public-suffix data is from the Public Suffix List of 2026-11-15.

### Fixes

- Filter lists: switching the lists off and on keeps the refreshed list rules when malware rules exist. The next refresh repairs a set that 0.3.5 lost.
- List updates: after a failed refresh, one retry comes about 31 minutes later (a second, one-shot alarm). If it also fails, the next try is the normal 3-hour alarm. A stored time in the future (the clock was ahead once) no longer stops automatic refreshes.
- Hidden ad boxes: **Block ads and trackers** off no longer also stops **Hide leftover ad boxes**.
- Hidden ad boxes: EasyList `$generichide`, `$specifichide` and `$elemhide` page exceptions now apply (for example on Gmail, GitHub, localhost and router pages). They apply after the first successful list refresh. The hide-rule parser version changed, so every list is downloaded and parsed again once after the update.
- Hidden ad boxes: the hide rules go into an adopted style sheet, not a `<style>` element. This stops a conflict with React whole-document hydration, and the rules stay after a full page re-render. A `<style>` element is still the fallback.
- Hidden ad boxes: a deeply nested `:is()` / `:where()` hide rule can no longer freeze the list refresh. Hide rules with more than 8 nested brackets are dropped. More whole-page hide rules from a broken list (`html:has(.x) > *`, `:root:has(.x) > *`, `&:has(.x)` and namespaced forms) are dropped. Frames no longer rewrite an unchanged sheet, and a site switch re-reads storage only in frames whose result changes.
- YouTube: with the uBlock Origin layer, "Saved to Watch later" and "Link copied" toasts show again after an "Experiencing interruptions?" toast. The CSS alone hides that toast now.
- YouTube: the start watchdog no longer reloads upcoming premieres or live streams, sign-in or age-check pages, or unplayable videos. With the uBlock Origin layer, the "Blocking ads" chip no longer shows for leftover sidebar ad nodes.
- Popup: clicks on **No** and **Block again** are no longer lost while the extension is busy. Keyboard focus stays on the next button after **Fix this site**, **No** and **Undo fix**. The status line says **Ad lists off – turned off in settings** when the lists are off. On YouTube and Twitch, an allowed site shows **Allowed – built-in YouTube ad blocking still runs** (or Twitch). No old "Did that fix it?" shows after an Undo on the settings page. The Allow button no longer has a changing label together with `aria-pressed`.
- Settings page: two quick switch changes are both saved. List buttons name their domain for screen readers.
- Pop-up guard (off by default): Enter in a search box can open results in a new window again.
- Signed threat feed (dormant; no feed is configured): a key rotation now recovers a feed whose serial reached the cap. A file with a short life no longer opens a large serial jump (24 h minimum). Kill serials can be any increasing number. A failed cache write no longer leaves rules that differ from the saved file. With **Block known malware hosts** off, the feed fallback no longer installs the packed malware list again. A rollback file that is served again no longer shows a false replay warning. A worker wake no longer rewrites unchanged feed rules.

### Tests

- New regression tests for each fix above (for example `test/clipboard-0.3.6.test.js`, `test/list-toggle-threat.test.js`, `test/cosmetic-generichide.test.js`, `test/feed-robustness.test.js`, `test/popup-ui-review.test.js`, `test/nightly-threat-4-*.test.js`, `test/nightly-threat-5-*.test.js`).
- Tests that could not fail now can: the hCaptcha shipped-rule check, the list-fetch scan of the live scripts, the stream-host oracle for the shipped block rules (`GeckoFeatures.isStreamHost`), the list expiry branch, the worker `siteInfo` parent override, and the CGNAT range.
- `test/twitch-playlist.test.js` runs the vendored Twitch playlist code on the m3u8 fixtures (the vendored file does not change). It records one upstream gap: in TwitchAdSolutions 1.55 the ad tracking-URL rewrite in `stripAdSegments` has no effect.
- `test/docs-claims.test.js` checks the shipped licence text and the doc numbers against the code.

### Docs and licences

- The docs and the README now say that the content scripts run on all http(s) websites (Chrome shows "Read and change all your data on all websites"), and what happens with limited site access.
- The licence and credit files in the zip no longer say "Updates are manual", "No background auto-fetch" or "not shipped". `LICENSES.md` names `threat-network.json`.
- The privacy doc and the README say that a fresh install downloads the lists at once.
- The README and the settings note say what keeps running when the master switch is off. The README says that YouTube players embedded in other websites are not covered. `docs/how-it-works.md` has the current pack numbers and the plain `$all` page block. `docs/threat-tier.md` describes the new host protection.

### Release tooling

- Release gate: `src/kick.js` and the vendored Twitch script are checked against SHA-256 content pins (`scripts/frozen-pins.json`) on every branch and in the release job. Only the current top-level manifest keys are allowed. The rules data is excluded from the secret scan again (the old glob had no effect). A zip with the checkout's version must match the checkout byte for byte.
- List packer: it refuses an empty, HTML or very short list body, and a list that shrinks by more than 25% (`--accept-shrink` overrides). On a refusal it writes nothing.
- `feed-sign`: it refuses a feed whose `notAfter` has passed, warns when less than 24 h is left, and warns near the serial cap.
- The release zip is reproducible with Info-ZIP (fixed times and modes, sorted names). The release workflow attaches `adgecko-<version>.zip.sha256`.
- The uBlock Origin YouTube sync stops when the cloned commit is not the recorded `ublock_commit`, and the drift workflow runs it with explicit permissions instead of `-A`.
- CI runs the tests with `--parallel`. The release gate stays serial.
- None of this was run in GitHub Actions.

### Removed

The owner approved these deletions (2026-11-16).

- Dead modules that nothing loaded: `src/general/toggles.js`, `src/general/exclusions.js`, `src/general/cosmetic.js` and `src/general-exclude-hosts.js`. They are no longer in the zip. The release gate and `scripts/lib/package_files.py` no longer list them.
- Their tests: `test/toggles.test.js`, `test/exclusions.test.js` and `test/general-cosmetic-contract.test.js`. The one test of live files ("master toggle is the only popup switch") moved to `test/popup-general.test.js`. `test/dnr.test.js` keeps the stream-host lists as fixed constants and still checks the packed allow rules and the block rules against them.
- 21 Twitch tests that only checked strings in the vendored file, which the SHA-256 pin already covers: `test/page.test.js` (7), `test/swap.test.js` (5), `test/reload.test.js` (4), `test/bug.test.js` (3) and `test/memory.test.js` (2). `test/twitch-playlist.test.js` runs the vendored playlist code instead. The conflict-version check stays in `test/hardening.test.js` and the release gate.
- `docs/cards2/` and `docs/cards-main/` (copies of `docs/cards/`).

### Merged after 0.3.5 (PR #13)

- Added: `scripts/update-twitch-vendor.mjs` updates `src/vendor/video-swap-new.user.js` in one command, with a SHA-256 pin in `scripts/vendor-pins.json`. `test/vendor-pin.test.js` fails when the file and the pin do not agree. Since 0.3.6, `scripts/frozen-pins.json` must also be updated by hand (see `docs/UPDATING-DEPENDENCIES.md`).
- Added: `docs/UPDATING-DEPENDENCIES.md` gives the PowerShell 5.1 commands for both vendored dependencies.
- Changed: the uBlock Origin YouTube filters are synced to uAssets `c7e01d3` (files carry `e140ffc`). uBlock Origin scriptlet code stays at tag 1.75.0. Not tested in Chrome.
- Fixed: a third local patch in the uBO sync restores the optional chaining on the `#masthead` logo-type read.

### Reviewed, not changed

- WP-11: the feed serial is not reset when a kill is released. With the same key still pinned, a reset would let files signed before the kill come back. A key rotation resets the serial instead.
- WP-14: `src/rules/cosmetic-rules.json` was not repacked, because no list cache was available in the build container. The exceptions apply after the first list refresh.
- WP-18: the plan's handshake count was not used. In headless Chromium the guard scripts take their channel before `flags.js` runs, so a count would give the free slots to the page. The request window closes at the first page script instead.
- WP-21: not every private wildcard base is protected. Most children of private wildcard rules are one customer or one machine (for example `ec2-*.compute-1.amazonaws.com`, which has 3 hosts in the packed malware set). A hand-kept list of 12 regional bases is protected instead.
- WP-24: the pop-up guard still checks `window.open` only. Links and forms with `target=_blank`, and gesture state across frames, are documented as out of scope.
- Findings 6, 50 and 51 (cross-list `@@` semantics, the EasyList licence option, the project LICENSE in the zip) are owner decisions, not code fixes.
- The 15 findings that the review rejected (PLAN section 4) are not changed.

### Owner decisions open

- Kick fixes (`docs/proposals/kick-0.3.5-fixes.patch`); `src/kick.js` stays frozen.
- Accept the frozen-file content pins (`scripts/frozen-pins.json`).
- Master switch and the ubo-youtube ruleset: the docs say what keeps running (Option B). Option A (a code change) is open.
- Embedded YouTube players: documented only.
- EasyList licence option (CC BY-SA 3.0 or GPL-3.0-or-later) and the project LICENSE in the zip.
- Peter Lowe list terms ("non-commercial"), open since 0.3.4.
- Cross-list `@@` exceptions: keep the documented same-host rule.
- Cosmetic storage layout; repack `cosmetic-rules.json` from a list cache and measure the storage budget.
- Pop-up guard coverage of links, forms and child frames.
- Release gate tests in parallel; reproducible zip with Windows `tar.exe`.
- Clipboard: plain-text copies on ordinary sites; the 500 ms timing limit for 100 KB pattern inputs.
- `ubo-youtube-network.json` blocks `ads.youtube.com`, which the stream-host registry lists.
- A second (one-shot) alarm for the refresh retry.
- The `REGIONAL_WILDCARD_BASES` list in `scripts/build-psl-subset.mjs`.

## 0.3.5 (2026-11-14)

A bug hunt found 38 bugs, each proven by a failing test (`test/nightly-*.test.js`), and a final review of this release found 10 more (`test/final-*.test.js`). 45 are fixed here; 3 are held back (see "Not in this release"). Also: more blocking, easier recovery from a broken site, lighter page frames, and freshly packed lists.

### Added

- Filter lists: site-scoped filters (`||host^$domain=site.com`, `$from=`) now block on the listed sites instead of being dropped. `$method`, `$denyallow` and a plain `$all` are converted exactly too. A filter that cannot be expressed exactly is still dropped, and a `$domain=` filter never blocks opening a page. To stay safe, a `$domain=` filter is dropped when any list has a path or option exception for its host (for example `@@||adobedtm.com/launch-$script`, which keeps Adobe Launch working on bank and shop sites), and filters that only exclude sites (`$domain=~site.com`) stay dropped, as in 0.3.4.
- Filter lists: a `$badfilter` in one list (for example AdGuard's fix for totaladblock.com) now cancels the same filter in every other list (a `$badfilter` with `$domain=` removes only those sites), and an unconditional exception such as `@@||content.ingbank.pl^` lifts another list's block of that same host. Both work in the packed rules and in list refreshes, also when the list that carries them fails to download (the packer stores each list's full `$badfilter`, `@@` and path-exception data in `src/rules/packed-cross.json`, so it also covers filters that other lists add after the pack).
- Popup: a **Reload page** button in "Did that fix it?", and after **Allow this site**, **Block again**, **No** and **Undo fix**. It reloads only when you click it.
- Popup: on a page Chrome shows as blocked, a "Chrome says the page is blocked? Allow its domain" link opens the settings page with the cursor in the **Allow this domain** box.

### Changed

- Hidden ad boxes: the bundled hide sheet (EasyList + EasyPrivacy) is now rebuilt with every list pack (it was a month old). Hide rules still come only from EasyList and EasyPrivacy: AdGuard Base's site hide rules were tried on this branch but held back, because a list refresh with them needed 12.9 MB of the 10 MB `chrome.storage.local` quota. AdGuard Base's network rules still apply. A refresh on an install that stored AdGuard hide data drops it from the saved AdGuard copy, and the old hide keys are cleaned up when EasyList next parses.
- Storage: a fresh-install refresh of the real lists now peaks at about 8.1 MB of the 10 MB quota (`test/final-storage-budget.test.js` checks it stays under 9 MB when the list cache is present).
- Settings: the per-site list says "Allowed – not blocking here" or "Fixed – hidden ad boxes and page guards off" instead of raw switch names. **Remove** and **Reset** keep keyboard focus.
- Speed: every page frame now reads a hide-rule index record of under 300 bytes instead of about 185 KB (the full key list moved to a worker-only record). Upgrades from 0.3.4 move it on the first start.
- Speed: the worker no longer fetches and parses the 0.8 MB bundled hide sheet on every 3-hour alarm, only on install or a new version.
- Speed: `features.js` keeps its first registry when it is injected twice into one frame.
- Filter lists repacked 2026-11-14 22:00 UTC: 195,069 whole-domain and 18,422 site-scoped entries in 2,851 list rules (2,856 rules in `general-network.json`), and 574 URLhaus threat hosts. The bundled hide sheet: 13,635 generic and 7,841 site rules.
- Release gate: the package size cap is now 8 MB (was 7.5 MB); the site-scoped filters add about 0.4 MB and the zip is about 7.82 MB. `src/rules/packed-cross.json` (about 60 KB) keeps `$all` page-block hosts only when some list has an `@@` exception for them, which keeps the zip under the cap. Checkouts keep LF line endings (`.gitattributes`), so the captcha parity test passes on Windows too.

### Fixed

- Popup: a site with a kept Fix now says "Protected – some filters off here (Fix this site)" and offers **Undo fix**. Before, it said "✅ Protected" while the extra filters stayed off.
- Popup: **Allow this site** and **Fix this site** on a subdomain now change only that subdomain, not its parent domain. An Allow on a parent domain now shows on a subdomain that has its own Fix. A Fix on a parent domain does not turn filters off on a subdomain that has its own site settings (as in 0.3.4), and an unanswered Fix that 0.3.4 saved on a parent domain still asks on the subdomain after the upgrade. A double click on **Fix this site** no longer loses the earlier switch state, and an unanswered Fix is no longer lost when you act on another site.
- Settings: **Allow this domain** accepts Unicode (IDN) domain names, for ad lists and for the malware list.
- Clipboard guard: closes four ways a page could still put a command on the clipboard (a custom iterator or an item swap during `clipboard.write`, `clipboardData.items.add` in a copy handler, and 20,000 characters of padding before the command). It now also catches `irm URL | iex` (PowerShell) and `bash -c "$(curl ...)"` (macOS). A right-click no longer lets the page write for 30 seconds; only the browser's own Copy of your selection counts, also when a page starts a copy through a frame or a nested copy event. A command written into drag-and-drop data is now blocked too; ordinary dragged text is not.
- Popup guard (off by default): a pop-under opened on mousedown or pointerdown, up to 5 s after the click, or behind a stopped click event is now judged by what was clicked. In `about:blank`, `srcdoc` and `blob:` frames, relative addresses resolve against the frame's real address. A site reached with a trailing dot (`news.example.`) counts as the same site.
- Malware blocking: switching **Block known malware hosts** (or the whole extension) off and on no longer drops a refreshed malware set that was already accepted.
- Malware blocking: with the ad lists off, a list refresh still installs freshly downloaded malware rules.
- Malware blocking: the public-suffix subset now has three-label suffixes (`k12.ca.us`, `act.edu.au`), the children of wildcard suffixes and regional Amazon S3 endpoints, so one list line can no longer block all of them as a whole; the packer now uses the same suffix rules as the extension. A malware list can no longer block a parent domain of a captcha host.
- Threat feed: an unchanged feed no longer shows a false replay warning, and the last-check time moves again.
- List updates: a refresh where no list reached its server (offline, captive portal) is now a failure: "Update lists" says so, and the retry comes after 30 minutes instead of 12 hours.
- List updates: a manual **Update lists** click during an automatic refresh now waits for it, then runs its own update.
- List updates: allowed sites use one allow rule each (not two), and the rule range is capped, so **Block again** keeps working with very many allowed sites.
- YouTube: menus, Share, Save and other dialogs open again after the "Experiencing interruptions?" toast has appeared once (they stayed hidden until a reload), and the "Saved" / "Link copied" toasts show again.
- YouTube: when one video server fails and another is available, Adgecko no longer reports that all servers failed, which caused a needless reload.
- Hidden ad boxes (rules): a `~host` exclusion now stops only that rule on that host; `~host#@#selector` is no longer a global exception; a generic `#@#` exception in one list now cancels the same rule from the other lists; a Unicode host in a rule's domain list no longer drops the whole rule; generic rules that would hide the whole page (`body:has()`, selector lists) are dropped; a late fallback style sheet no longer overwrites newer rules. Two generic hide rules for the same selector, one excluding a site (`~example.com`) and one a subdomain of it (`~shop.example.com`), now both leave that subdomain alone (found in the PR #12 review).

### Not in this release (owner decision)

- Twitch: blocking Twitch's own ad host `ads.twitch.tv` (fix 36). `test/dnr.test.js` keeps every Twitch host off the block rules, and the player could not be tested live. Its tests are kept, ignored, in `test/nightly-manifest-scripts-1-*.test.js`.
- Kick: two fixes (a post-roll cover that stays hidden, a banner collapse that can hide the player). `src/kick.js` is a frozen playback file in the release gate. The fix is kept in `docs/proposals/kick-0.3.5-fixes.patch`; its tests are kept, ignored.

### Roll back to 0.3.4

1. Download `adgecko-0.3.4.zip` from the existing v0.3.4 release: <https://github.com/gecko-of-shadow/adgecko/releases/download/v0.3.4/adgecko-0.3.4.zip>
2. Unzip it to a folder. In Windows PowerShell 5.1:

```powershell
Expand-Archive -LiteralPath "$env:USERPROFILE\Downloads\adgecko-0.3.4.zip" -DestinationPath "$env:USERPROFILE\Downloads\adgecko-0.3.4" -Force
```

3. In Chrome, open `chrome://extensions`, turn on **Developer mode**, **Remove** (or turn off) Adgecko 0.3.5, click **Load unpacked**, and pick the 0.3.4 folder.

## 0.3.4 (2026-11-11)

Fixes made after the 0.3.3 zip was published (merged in PR #8), and freshly packed filter lists.

### Changed

- Filter lists repacked 2026-11-11 22:41 UTC: 193,100 whole-domain and 5,329 scoped entries in 2,513 list rules (2,518 rules in `general-network.json`), and 15,844 threat hosts in 199 rules. YouTube keeps 4 rules.

### Fixed

- Settings: **Allow this site** and **Fix this site** now take effect on a host with one label (`localhost`, an intranet name). The override was saved and shown, but the hide rules and the page guards never looked it up there.
- Clipboard guard: your own cut (Ctrl/Cmd+X, Shift+Delete), Ctrl+Insert, and Ctrl+C on a keyboard layout where that key is not "c" (Russian, Greek and others) count as copying it yourself. They were cancelled with the "this page tried to put a command into your clipboard" notice. Only text that was selected when the key went down is let through, as before.
- Threat lists: switching **Block known malware hosts** (or the whole extension) off and back on now brings the refreshed threat rules back even when the background worker had gone to sleep in between. Before, only the packed threat list came back until a later refresh downloaded a changed list.
- Lists: the status line keeps a storage error, and the "Reverted to the packed lists" message, until a refresh really runs. A background check that had nothing to do used to wipe the error and, after a revert, show the discarded lists' "Last update" time again.
- Packer: `scripts/pack-filter-lists.py` runs the rule merger after it writes `src/rules/meta.json`, so a repack keeps `general_network_rules_total` instead of needing a second merger run by hand.
- Popup: on YouTube Music, YouTube Studio, YouTube TV, YouTube Kids and youtube-nocookie pages the popup now shows the site and says "Malware blocking only – ad scripts don't run on this site", with **Allow this site** and **Fix this site** greyed out, instead of "No web page" and a hint to reload. The YouTube ad scripts still run on `www`, `m` and the bare domain only; those other hosts get just the small script that tells the popup which page it is on. The popup lists a switch only where its script is really injected. `manifest.json` adds those hosts (`*.youtube.com`, `youtubekids.com`, `youtube-nocookie.com` and their subdomains) to the matches of that one small script; `permissions` and `host_permissions` are unchanged.

### Roll back to 0.3.3

1. Download `adgecko-0.3.3.zip` from the existing v0.3.3 release: <https://github.com/gecko-of-shadow/adgecko/releases/download/v0.3.3/adgecko-0.3.3.zip>
2. Unzip it to a folder. In Windows PowerShell 5.1:

```powershell
Expand-Archive -LiteralPath "$env:USERPROFILE\Downloads\adgecko-0.3.3.zip" -DestinationPath "$env:USERPROFILE\Downloads\adgecko-0.3.3" -Force
```

3. In Chrome, open `chrome://extensions`, turn on **Developer mode**, **Remove** (or turn off) Adgecko 0.3.4, click **Load unpacked**, and pick the 0.3.3 folder.

## 0.3.3 (2026-11-09)

### Added

- Lists: `src/rules/meta.json` now records the rule count of the shipped `general-network.json` after the merge (`general_network_rules_total`, written by `scripts/merge-dnr-rules.py`) next to the packer's list-rule count, and a test checks every packed total (list rules, whole-domain and scoped entries, threat rules and hosts) against the files. 0.3.2 had meta 2,536 list rules next to 2,541 rules in the file with nothing tying the two together.
- CI: a weekly workflow (`.github/workflows/ubo-youtube-drift.yml`, Mondays 06:00 UTC and on demand) runs `scripts/sync-ubo-youtube.mjs` against current uAssets with the local-patch layer and fails when the sync errors, a local patch no longer finds its upstream shape, or the shipped `src/vendor/ubo-youtube.js`, `ubo-youtube-isolated.js`, `ubo-youtube.css` or `src/rules/ubo-youtube-network.json` would change (the generated files' one banner line naming the uAssets commit is ignored, so a new upstream commit with unchanged YouTube filters passes). It commits nothing, opens nothing, and uses no secret (read-only token).

### Changed

- Lists: the captcha never-block hosts have one source, `src/rules/never-block-captcha.json`. The packer, the rule merger and the YouTube sync read it, and the packer writes `src/general/never-block-captcha.js` from it for the service worker (list refresh and threat tier), so a new captcha vendor is one edit plus `python3 scripts/pack-filter-lists.py --never-block-captcha-js`. The parity test checks every layer, the generated file and the packed `_ad_` media rule's exclusion in `src/rules/ubo-youtube-network.json` against that JSON. Packed rules are unchanged; lookalike hosts are still blocked.
- Lists: a fresh install fetches the lists right away from `runtime.onInstalled`, the same refresh as the settings page's "Update lists", instead of running on the packed lists until the first alarm 5 to 30 minutes later. Updates and reloads keep their saved lists and wait for the alarm as before.
- Lists: the HaGeZi Pro mini protected-host cap adapts instead of being fixed at 64. A refresh is accepted when it names at most `last accepted count + 10` protected hosts, and never more than `2 x last accepted count` (when that count is at least 1), so a poisoned copy is still caught even inside the margin. The count of the last accepted copy is stored with that list's refresh state (`protectedHits`, written only when a refresh is accepted; a rejected refresh leaves it unchanged). With no stored count yet (a first load, or an install upgraded from 0.3.2) the cap is the seed 64, the old fixed value. Every other list keeps its fixed cap of 25. The packer applies no cap; it only skips never-block hosts.
- Tests: the two storage tests that provoke a `QUOTA_BYTES` write failure on purpose now capture and assert the worker's warning instead of printing it, so the run shows no quota noise; the production warning is unchanged.
- Filter lists repacked 2026-11-09 09:18 UTC: 192,715 whole-domain and 5,345 scoped entries in 2,508 list rules (2,513 rules in `general-network.json`), and 15,827 threat hosts in 198 rules. YouTube keeps 4 rules.

### Fixed

- Lists: `imasdk.googleapis.com` (the IMA ad SDK) stays blocked by the refreshed rules as well as by the packed ruleset. The packer and the list refresh share one exception list under the broad `googleapis.com` never-block suffix; the player API hosts (`youtubei`, `play`, `fonts`) stay never-blocked, and the threat tier is unchanged. A test keeps the packer, the refresh, the merger and the packed file in agreement.

### Roll back to 0.3.2

1. Download `adgecko-0.3.2.zip` from the existing v0.3.2 release: <https://github.com/gecko-of-shadow/adgecko/releases/download/v0.3.2/adgecko-0.3.2.zip>
2. Unzip it to a folder. In Windows PowerShell 5.1:

```powershell
Expand-Archive -LiteralPath "$env:USERPROFILE\Downloads\adgecko-0.3.2.zip" -DestinationPath "$env:USERPROFILE\Downloads\adgecko-0.3.2" -Force
```

3. In Chrome, open `chrome://extensions`, turn on **Developer mode**, **Remove** (or turn off) Adgecko 0.3.3, click **Load unpacked**, and pick the 0.3.2 folder.

## 0.3.2 (2026-11-09)

### Changed

- Docs: the 0.3.1 repack date below is the UTC date stored on the packed files.
- Release gate: `scripts/pack-zip.sh` and `scripts/release-gate.sh` were run against this release, on the checkout and with `--zip` on the packed `adgecko-0.3.2.zip`; every check passed, and the zip holds exactly the 66 files `scripts/lib/package_files.py` derives from `manifest.json`, the worker's `importScripts(...)` and the page script tags. The gate in `--zip` mode now also checks that exact list (the allow-list alone accepts the optional files whether or not the checkout has them), prints the deno summary without colour codes, and no longer mistakes "0 failed (3m)" for a failure. A new `release-gate` job in `.github/workflows/checks.yml` packs the zip and runs the gate in both modes on every push to main and every pull request.
- Filter lists repacked 2026-11-09 03:01 UTC: 194,896 whole-domain and 5,350 scoped entries in 2,536 list rules (2,541 rules in `general-network.json`), and 15,827 threat hosts in 198 rules. YouTube keeps 4 rules.

### Fixed

- Lists: a HaGeZi Pro mini refresh is accepted when it names the protected hosts that list really carries (about 30, mostly under googleapis.com). The same check stays at 25 hosts for every other list, and a larger HaGeZi jump is still rejected.
- Lists: hcaptcha.com is in the packed never-block list, matching the packer and the list updater. The threat tier refuses those same captcha hosts. Lookalike names are still blocked.
- YouTube: the `_ad_` media rule no longer matches an hCaptcha address. Player responses also drop `playerAds`, which had left one placement in the player after the other ad fields were removed.

### Roll back to 0.3.1

1. Download `adgecko-0.3.1.zip` from the existing v0.3.1 release: <https://github.com/gecko-of-shadow/adgecko/releases/download/v0.3.1/adgecko-0.3.1.zip>
2. Unzip it to a folder. In Windows PowerShell 5.1:

```powershell
Expand-Archive -LiteralPath "$env:USERPROFILE\Downloads\adgecko-0.3.1.zip" -DestinationPath "$env:USERPROFILE\Downloads\adgecko-0.3.1" -Force
```

3. In Chrome, open `chrome://extensions`, turn on **Developer mode**, **Remove** (or turn off) Adgecko 0.3.2, click **Load unpacked**, and pick the 0.3.1 folder.

## 0.3.1 (2026-11-07)

### Added

- Tests: a regression test for the hCaptcha hosts, and the OpenPhish guard records which approved list supplied each sentinel host in the general rules; threat files stay strict.

### Changed

- Filter lists repacked 2026-11-08 02:42 UTC (the time in `src/rules/meta.json`; the earlier note said 2026-11-07): 2,534 rules in general-network.json and 200 threat rules.

### Fixed

- Filter lists: hCaptcha checkboxes show again. hcaptcha.com and its subdomains are never blocked, in the packed lists and in list updates; lookalike hosts are still blocked.

## 0.3.0 (2026-11-06)

- Renamed to Adgecko: the name in Chrome, the toolbar tooltip, the popup, the settings page, the docs and the release zip (`adgecko-<version>.zip`). The repository is now gecko-of-shadow/adgecko.
- New icon (concept E, picked 2026-11-02): a neon purple gecko head on a dark rounded square, snapping its tongue at a pixel "ad". Hand-drawn SVG sources with a separate 16 px pixel cut; the toolbar icon lights the pixel "ad" while blocking is on and turns grey when it is off. `scripts/build-icons.mjs` can render with a local Chrome / Chrome for Testing (`CHROME_PATH`). How the art was chosen: `docs/design/README.md`.
- Popup aligned with the picked mockups: larger header icon and text, purple-bordered "Something broke?" card, "Block again" outlined in purple, "Show more" with a chevron; high contrast shows the gecko white and rings the yellow buttons. The settings page now uses the same purple / high-contrast / forced-colours themes. Review screenshots in `docs/design/screenshots/`.
- Toolbar icon: it now really changes. Every `setIcon` call had been failing silently since the icon switch was added (the paths resolved against `src/`), so the icon stayed on its default even with blocking off. The popup header now follows the same switch as the toolbar icon, and the icon is repainted whenever the worker starts, so disabling and enabling the extension keeps it right.
- Popup: when the dot is up, opening the window unfolds Show more once so the reason can be read, and a block on the previous page is no longer reported on the next one. A block right after navigating still gets its dot. A failed save no longer shows a change that was not stored, and says "Could not save. Try again." Show more no longer says the packed threat list is on when it is off, the "You're protected" card waits until the extension is on, and the "Already allowed: nothing is blocked here." note is gone (malware rules and stream-site code outrank Allow). The list status no longer prints its date twice.
- Accessibility: hover colours in the popup and settings meet AA (were 3.80:1 and 4.49:1), text box edges and placeholder text in settings too, the theme list no longer makes settings scroll sideways at 320 px, the settings switches keep keyboard focus when they change, and the Fix question is tied to its Yes / No buttons for screen readers.
- Filter lists: a `$document` filter now blocks opening that site even when another list also blocks it as a whole domain (about 500 ad servers such as a-ads.com opened when visited directly).
- Filter lists: filters with only negated types (`$~script`, `$~stylesheet,third-party`, ...) no longer block opening the site (e.g. prime.rambler.ru, or eloqua.com / exacttarget.com links followed from another site); they still block the page parts they name.
- Filter lists: Twitch / YouTube / Kick and their player hosts, and five redirectors people click on purpose (affiliate links: Skimlinks redirectingat.com, impact.com ojrq.net, Involve Asia invol.co, Adtraction; deal links: linksprf.com), never get a "block opening this site" rule from the ordinary lists; their other rules stay.
- Settings: "Allow this domain" now also opens a page the filter lists block (the way out of Chrome's "blocked by an extension" page for a site you trust).
- Filter lists repacked again on 2026-11-03 (20:37Z) with these fixes: 187,014 whole-domain + 5,480 scoped entries in 2,439 list rules (2,444 rules in `general-network.json`).
- Allow this site no longer turns off the clipboard guard (ClickFix), owner decision: the guard stays on on an allowed ordinary site. The pop-up guard still goes off there. Fix this site and the settings switches can still turn the clipboard guard off. Allow on Twitch, YouTube and Kick is unchanged.
- Filter lists: the `! openphish` section of uBO badware is gone, owner decision: 12 hosts out of the threat rules, 11 out of the general rules (the twelfth, `vzla-qr.com`, is also in HaGeZi and stays there). The packer and the list refresh skip that section, and the refresh parser version moved to 3 so saved lists are rebuilt. Now 187,003 whole-domain + 5,480 scoped entries in 2,439 list rules, and 15,901 threat hosts in 199 rules. Curben's urlhaus-filter stays.
- Rules: every writer of blocking rules (list refresh, the lists switch and Allow this site, Revert lists, the malware-tier switch, Allow this domain, the threat feed) now takes turns in one queue, so two of them can no longer write the same rule ids at once; that used to make Chrome reject the second write and drop refreshed lists back to the packed ones. List downloads do not hold the queue, so a click never waits for the network.
- Filter lists repacked on 2026-11-03: the packed general ruleset no longer holds the public suffix `pisz.pl` or the address `0.0.0.1`. Now 186,987 whole-domain + 4,035 scoped entries in 2,421 list rules; the packed threat ruleset holds 15,913 hosts in 199 rules.
- Kick: the post-roll ad cover is hidden and its clip paused only when nothing in it could be the live player (a stream source, an endless length, or a video whose source or length is not known yet keeps it visible); the decision is made again when a video's source or length changes, a hide is undone if the live player turns up, and turning Kick help off shows the covers again. The stylesheet no longer hides post-roll covers.
- Docs: README (what it does, how to use the new popup, troubleshooting a copy button, the list sites contacted every 3 hours, clipboard text checked only in the browser), `docs/how-it-works.md` (page guards, new popup), `docs/allow-a-page.md` (Fix this site first, Allow this site / Block again), `docs/permissions-and-privacy.md` (what stays local), `docs/threat-tier.md` (no phishing list of its own; Safe Browsing is the backstop).
- New popup (Adgecko design): icon, name and a gear for the settings page; the site; one plain status line ("✅ Protected" or "Allowed – not blocking here"); a "Something broke?" card whose **Fix this site** button turns off the hide rules and page guards (on YouTube and Twitch: the sponsored-tile and banner hiding; never the stuck-start reload or Kick's ad skip) for that site only and then asks "Did that fix it?" (Yes keeps it; No puts back exactly what it changed and points to Allow this site; the question survives closing the popup for a day); **Allow this site** / **Block again**; and a folded "Show more" with the list and feed status and the version. A one-time "You're protected" card on the first open. The master switch, the per-feature list and "Update lists" moved to the settings page. Quiet alerts: when a page guard blocks something, a small magenta dot appears on that tab's toolbar icon (no pop-ups, no counters); opening the popup says what was blocked and clears it. Purple theme plus a high-contrast theme that turns on by itself with high-contrast settings, or by the new theme switch on the settings page; system colours with Windows high contrast; visible keyboard focus; no animation. No new permission.
- Licence: the project is now explicitly GPLv3 (root `LICENSE`: copyright notice, list of third-party notices, and the unmodified GPLv3 text from gnu.org). The README has a "License and brand" section: the name "Adgecko" and the gecko icon are the owner's brand and are not covered by the code licence. TwitchAdSolutions (MIT), uBlock Origin/uAssets (GPLv3), EasyList credit and the other list notices are unchanged.
- Pop-up guard (off by default): "same site" now compares registrable domains (a small copy of the public-suffix data), so `a.co.uk` and `evil.co.uk`, or `x.github.io` and `y.github.io`, count as different sites; clicks inside shadow DOM are judged by the real clicked element; the built-ins it relies on are captured before the page runs.
- Clipboard guard, after a multi-agent review: a button labelled "Copy" no longer lets a command through outside the documentation/code hosts (a page can hide or fake what it shows); only your own Ctrl/Cmd+C or context-menu copy of the selected text does, and the notice now says so. `navigator.clipboard.write()` is checked too; the browser's own copy is cancelled when the page swapped the selection for a command after you pressed Ctrl+C; `setData` is checked only on a copy/cut event's clipboard data (drag-and-drop works as before); the built-ins the guard relies on (regex, string methods, Promise.reject, key-event and selection getters) are captured before the page runs, so a page that replaces them later cannot blind it; switches are read from the private port through captured getters, so a page cannot rewrite or read them.
- Licence record (`src/rules/LICENSES.md`, generated by the packer's writer): each list now names its upstream terms as checked on 2026-11-02: HaGeZi, uBO uAssets and AdGuard Base GPL-3.0, Dandelion Sprout's list Dandelicence v1.4 with a link to its text, EasyList/EasyPrivacy GPL-3.0-or-later or CC BY-SA 3.0-or-later. Peter Lowe's line is unchanged for now (its terms are an open question).
- Signed threat feed (still dormant): a kill-key document is now a latch until the next extension version (a feed-key document can no longer switch a killed feed back on; nothing is fetched meanwhile); the 14-day lifetime is also measured from `notBefore`, `notBefore` may not be more than 1 h before `createdAt`, and `createdAt` may not be more than 1 h in the future, so a future `createdAt` cannot stretch a document's life; serials are capped at 2^31-1 and may not jump more than 1,000,000; the feed body is read as a stream and cut at the 512 KB cap even without `Content-Length`; a rollback to a `killFeed` document reports "killed". `scripts/feed-keygen.mjs` resolves the real path ("..", links) before refusing a key file inside the repo, and `scripts/build-threat-rules.mjs` writes nothing when a cached list's bytes do not match `src/rules/meta.json`.
- Privacy check (`scripts/privacy-check.py`): now also finds, without any secret, public IP addresses (documentation, private and loopback ranges excepted; blocklist data files skip this), e-mail addresses (noreply and example domains excepted), home-directory paths, Google API keys, Slack tokens and JSON web tokens, metadata in changed images (EXIF, XMP, comments, PNG text), and the author/committer names, e-mails and messages of the commits in range; `--all` scans the whole tree; a line can carry `privacy-check: allow` for IPs, e-mails or paths (never for secrets). CI (`.github/workflows/checks.yml`): a push to `main` fails when the `PRIVACY_PATTERNS` secret is missing, pull requests run the checker from the base commit (not their own copy) in Python isolated mode, actions are pinned to commit SHAs, and checkouts no longer keep credentials. Personal machine references were removed from code and tests; a captured test URL now uses a documentation IP.
- Threat tier: a small Public Suffix List subset plus a list of shared-hosting and big-platform parents (`src/threat/psl.js`) keeps one bad list line from blacking out a whole country domain or platform: `co.uk`, `github.io`, `pages.dev`, `amazonaws.com`, `blogspot.com`, `docs.google.com` and their parents are never threat-blocked (a customer's own host such as `evil.github.io` still can be), nor are private, loopback or link-local IPv4 addresses. The signed feed and the "Allow this domain" box use the same check (the box now refuses `github.io`, accepts `me.github.io`, and says why). One refresh may add at most 2,500 new threat hosts and 20% of the previous set; a bigger jump keeps the previous rules unless it repeats on the next refresh. The ordinary lists skip public suffixes and non-public IPv4 addresses too (refresh and packer). The packed threat ruleset was rebuilt offline from the same list download (15,925 hosts; `pisz.pl`, a Polish public suffix, dropped).
- Clipboard guard (ClickFix) bypasses closed: each value is turned into text once and that exact text is checked and written (an object returning harmless text first and a command second no longer gets through); `execCommand` is wrapped where it really lives (`Document.prototype`, so `Document.prototype.execCommand.call(...)` is checked) and `cut` is checked like `copy`; the selection and form-field text are read through browser getters saved before the page runs; a "copy" label alone no longer counts as a deliberate copy (the text must also be visible next to the clicked button), and a copy shortcut only allows text that was selected when the key was pressed (a copy handler cannot swap in a command); an error while judging a click now means "not deliberate". `readthedocs.io` / `.org` are no longer trusted (anyone can publish there). The guards and their switch script now also run in `about:blank`, `srcdoc` and `blob:` frames of ordinary sites (`match_about_blank`, `match_origin_as_fallback`), still never on Twitch, YouTube or Kick. The extension's own page-world scripts (`youtube.js`, `kick.js`, both guards) are each wrapped in one function and no longer add global names to the page; the Kick style element no longer carries an id.
- Feature switches for the page guards and the YouTube/Kick page scripts no longer travel as `window.postMessage` messages, which any page could fake (a page could switch the clipboard guard off on itself) or ask for. `src/settings/flags.js` now hands each page-world script its own `MessageChannel` port at document_start through a synchronous event, before any page script runs; flags come only over that port, later window messages are ignored, and the old `"?"` request is gone. Kick frames now get the switch too (flags.js runs in every Kick frame, like `kick.js`). If no port arrives, the built-in defaults stay (clipboard guard on, popup guard off). No new permission.
- Packaging: `scripts/pack-zip.sh` now builds its file list from `manifest.json` (service worker, content scripts, rulesets, popup and settings pages, icons), the worker's `importScripts(...)`, the pages' `<script>` tags and the files the code fetches (`scripts/lib/package_files.py`), then checks the zip holds exactly that list. Before, the settings page, the page guards, the threat tier, the signed-feed client and the threat rulesets were left out, so a packed zip would not have started. `scripts/release-gate.sh` knows the new files, checks every manifest/importScripts path is in the package, and refuses any `optional_permissions` / `optional_host_permissions`.
- Curben's urlhaus-filter (abuse.ch URLhaus malware hosts) is kept as the one documented Curben exception (owner decision #18b): only source `urlhaus_hosts`, only from `malware-filter.gitlab.io/malware-filter/urlhaus-filter-hosts-online.txt`; his phishing list and every OpenPhish source stay out. New `scripts/lib/curben_check.py` enforces it in the release gate (new section 2c) and in `test/no-openphish.test.js` (with a negative case for each forbidden source). Its licence line is corrected to upstream's terms (URLhaus data CC0 1.0; urlhaus-filter repository CC0 1.0 + MIT; it was wrongly listed as CC BY-NC-SA 4.0), and the garbled characters in the licence file are gone.
- (Superseded before release by the concept E icon above.) New gecko icon: a green gecko with a blue "no ads" shield on a round teal badge. The eye glows amber while list blocking is on and the icon goes grey with a sleepy eye when it is off. Sources in `icons/source/`, rebuilt with `node scripts/build-icons.mjs`. The popup icon glow is round to match.
- Ordinary sites: switching lists off and on again (or a quick "Allow this page" and undo) no longer drops the refreshed lists back to the packed ones. Switching lists off while a list refresh is running now leaves them off.
- YouTube: going back to a video that already played (A, then B or the home page, then A) and getting stuck at 0:00 now gets the same automatic reload as any other stuck start.
- YouTube (only with the extra fetch hooks on): `fetch(new URL(...))` is filtered too, and a failed request is no longer sent twice.
- Tests: the uBO fixture runs no longer share Deno's on-disk localStorage, which made "uBO risky groups are individually switchable" fail under load.
- "Allow this page" works again. Chrome hides tab addresses from extensions without the `tabs` permission, so the button was always greyed out ("Open a normal http(s) page"). The popup now asks the page's own content script for its address. No new permission.
- After the first list refresh, the YouTube doubleclick block is kept. The refresh copied only the allow rules and the extra tracker rule into the new rule set, so `doubleclick.net` loaded on YouTube (and in YouTube embeds on other sites) once the packed rules were switched off.
- If EasyList fails to download on a refresh, the hide list is left as it was. Before, EasyPrivacy alone replaced it (a couple of selectors instead of about 13,600) and it stayed that way until EasyList came back.
- YouTube: the bundled uBO `videoplayback?expire=` decoy rule would have started blocking every normal YouTube video (and embeds) on 2027-01-15. `scripts/sync-ubo-youtube.mjs` now widens its allowed window locally (allow-only) to cover real links up to 2033-05-18, and stops with an error if upstream changes the rule's shape. A plain re-sync is not enough because upstream widens the window only after links break. The guard test now checks every day through 2033-05-01 instead of 30 days ahead. See `docs/youtube-expire-window.md`.
- New threat tier: known-bad hosts from URLhaus, uBO badware and Dandelion Sprout's Anti-Malware List are blocked at priority 2,000,010, above the stream-site allows, so they are blocked on YouTube, Kick and Twitch pages and in embeds too, and as page navigations. "Allow this page" no longer lets them through; a user "Allow this domain" override (2,000,020) does. Twitch, YouTube and Kick servers and player hosts can never be blocked (`src/threat/protected-hosts.js`). Packed as static ruleset `threat` (15,926 hosts, 200 rules) and refreshed as dynamic rules. See `docs/threat-tier.md`.
- Twitch: the directory ad sweep now runs only on directory and home pages and at most every 250 ms (it ran on every page change of every Twitch page, including busy chat on channel pages); the CSS hide rule is unchanged. Kick: the MediaTailor session listener wrapper no longer breaks `removeEventListener` and no longer fires a listener twice when it is added twice.
- Page guards on ordinary sites (never on Twitch, YouTube or Kick; their exclusions come from the registry): "Stop pages from copying shell commands" (on by default) blocks a page from putting a ClickFix-style command (encoded or downloading PowerShell, `cmd /c` chains, `mshta`, `bitsadmin`, `certutil -urlcache`, `curl ... | sh`, ...) into the clipboard through `navigator.clipboard.writeText`, `execCommand("copy")` or a copy handler, unless the visitor pressed a copy shortcut or clicked something labelled "copy", or the site is a known documentation/code host; a small notice explains it. "Block pop-ups opened without a click" (off by default) stops `window.open` without a gesture, a second window per click and pop-unders from clicks on plain page content; sign-in and share pages still open. Both fail open and can be switched per site. Threat lists' `$popup`-only hosts would become navigation-only threat rules (none in the current lists).
- Hardening: the YouTube script and the generated uBO bundle no longer read option overrides from `localStorage` (the page itself can write it); built-in defaults only, and the uBO group defaults are set in `scripts/sync-ubo-youtube.mjs` (bundle regenerated at the same uAssets/uBO commits). `src/cosmetic-hide.css` is no longer a web-accessible resource (pages could probe it to detect the extension); the content script gets it from the service worker. Page-visible markers use neutral ids (`Symbol.for("gk.u")`, `"gk.y"`, style ids `gk-*`, no marker properties on page objects), and page-console logging from the YouTube and Kick scripts is off by default.
- Switches for every feature: one registry (`src/settings/features.js`) lists the 13 features (filter lists, threat tier, threat feed, hide rules, Twitch player swap, Twitch directory banners, uBO YouTube scriptlets, YouTube stuck-start reload, YouTube sponsored-tile removal, Kick ad skip, and the clipboard, popup and miner guards that come later) and is the only copy of the Twitch/YouTube/Kick site list (the manifest's exclusions are checked against it). Settings live in two small keys, `settings` (global) and `siteOverrides` (per site); the old `generalEnabled` / `generalAllowedOrigins` are migrated once and kept as derived copies. The popup shows the current site, its own on/off switch ("Allow this page") and that site's features; the new settings page (All settings) lists every feature, the feed status with "Pause threat feed", "Update lists", "Revert lists", an "Allow this domain" box for the threat tier, and the per-site switches. List and threat switches and the hide rules apply at once; the YouTube and Kick page scripts get their switches from a small ISOLATED script and check them before each action (on until told otherwise; nothing is unpatched and no tab is reloaded). The vendored Twitch swap and uBO YouTube scriptlets stay always on (owner decision D-3; only turning the extension off in Chrome stops them). No new permission.
- Signed threat feed client, dormant until configured (`src/feed/config.js` `FEED_ORIGIN` is empty, no key is pinned, no feed host in the manifest): when set up it checks every 3 hours on the `gecko-refresh` alarm (signature first, HTTPS only, no redirects, 15 s timeout, 512 KB cap), replaces its session rules in one step, keeps the last two verified files for rollback, re-applies the saved file on browser start and after updates (or the packed `src/rules/threat-snapshot.json` when it has expired), and honours kill documents and a local "Pause threat feed" switch (storage key `feedPaused`). The popup shows the feed status. New `scripts/feed-keygen.mjs` (private key only to a path outside the repo, never printed) and `scripts/feed-sign.mjs`; steps in `docs/feed-setup.md`. `scripts/release-gate.sh` now allows the `alarms` permission and, once configured, the one feed host.
- Signed threat feed library (`src/feed/`): Ed25519 signature over the exact bytes of `feed.json` checked before anything is parsed, strict format-1 schema (unknown keys rejected, block-only entries, fixed priority, protected stream hosts reject the whole feed, 512 KB cap, serial must increase, 14-day lifetime), a separate kill key that can sign only a kill document, rollback to the stored previous payload, compiled to session rules at 2,000,010. Pinned key lists ship empty. `minimum_chrome_version` is now 137 (Ed25519 in WebCrypto).
- Filter lists protect themselves: a downloaded list is rejected (and its last good copy kept) when it grows or shrinks by more than 25% in one refresh (not on first load), names more than 25 protected stream hosts, or carries an abnormal hide list (more than 30,000 generic rules, a 25% jump, or more than 100 whole-page site rules). Generic hide rules that name no class, id, attribute or custom element (`*`, `body`, `div`) are dropped. The reason shows in the list status. New worker action "Revert lists" goes back to the packed lists and hide rules (button comes with the settings page).
- The packed `general` ruleset now stays enabled after a list refresh (it is the offline floor and holds the stream-site allows); only the lists switch turns it off.
- Filter lists: options are converted faithfully instead of being widened into whole-domain blocks (H-2). `$third-party`/`$first-party` become `domainType`, request types (`$script`, `$ping`, `$subdocument`, ...) become `resourceTypes`, `~type` becomes `excludedResourceTypes`, `$doc` blocks navigations only, `$badfilter` cancels its filter, and anything that cannot be represented (`$domain=`, `$redirect`, `$csp`, ...) drops the filter. Example: `||soundcloud.com^$ping` no longer blocks all of soundcloud.com and its embeds; `s1.wp.com` and `onetrust.com` are no longer whole-domain blocks. One table (`src/general/filter-options.js`) is used by both the packer and the runtime refresh, with a shared JS/Python test fixture. Lists cached by the old parser are refetched; the packed rules stand in until then. Packed at the time: 185,816 whole-domain + 4,030 scoped entries in 2,406 list rules (see the 2026-11-03 repack above).
- Removed: Curben phishing-filter list (OpenPhish-derived), owner decision. Gone from the packed rules, the list refresh, the licence file and the docs; existing installs drop its cached copy and rebuild their rules on the next start or refresh. curbengh's separate urlhaus-filter (URLhaus data) stays. Packed rules re-generated on 2026-11-02: 189,845 domains in 2,374 list rules (was 211,995 in 2,650; Curben was 30,391). Phishing coverage is smaller; Chrome Safe Browsing remains the backstop. Eight lists are downloaded now, not nine.
- Filter lists: refreshed by a `gecko-refresh` alarm every 3 hours (new `alarms` permission) instead of once per browser session; a real download still happens at most every 12 hours. An interrupted or failed refresh no longer blocks the next one for 12 hours (`lastRunAt` is written only after success, `lastAttemptAt` separately; retry after 30 minutes).
- Storage: list run state (`listState`, small) is now separate from each list's parsed payload (`listData:<name>`). Existing data moves over on first start, one list at a time, and the old key is deleted only after the new copy reads back. A 304 no longer rewrites megabytes. Storage write failures (for example the 10 MB quota) are recorded and shown in the popup's list status instead of being dropped.
- YouTube: uBO filters re-synced to uAssets@205b212 (was 69831a8; scriptlets still uBO 1.75.0). Picks up the comment-posting user-agent cleanup and newer inline/prefetch ad edits.

## 0.2.21

- YouTube: a video stuck at 0:00 after its blocked ad (decoy) streams failed recovers sooner. When those streams failed and no video data has loaded, the one automatic reload now comes 7s after the last sign of progress instead of 15s. In replays of a real stuck start, the reload came at about 9s (about 12s when YouTube also sent its usual early "retry later" reply) instead of about 17s, and playback resumed about 2s later.
- A start that has loaded some video data keeps the full 15s wait.
- On those stuck starts, each YouTube "retry later" reply holds the reload for at most 10s, and all such holds end 8s after the first one began, so a steady stream of them can no longer keep the video at 0:00. Elsewhere a recent reply still holds the reload for up to 20s, and the reply watcher now runs whichever order the scripts load in.
- A "retry later" reply from the previous video no longer delays the next video's reload.
- Trade-off: a start that shows no progress for 7s after its ad streams failed is reloaded even if YouTube would have started it by itself a few seconds later.
- Settings in `localStorage["twitch-adblock-yt-opts"]`: `decoyGentleMs` (7000; `0` turns the faster reload off), `decoyWaitHoldMs` (10000), `decoyWaitCapMs` (8000).
- Twitch, Kick, and ordinary-site playback and blocking are unchanged.

## 0.2.20

- Ordinary-site blocking adds five network lists: HaGeZi Pro mini, uBO badware, Dandelion Sprout's Anti-Malware, Curben phishing, and AdGuard Base (EasyList already removed). About 212,000 domains in 2,655 rules.
- List packing no longer turns `$removeparam`, popup-only, redirect, CSP, or site-scoped rules into full domain blocks. `live-video.net` and the other player frame hosts stay off the block list.
- The 12-hour refresh downloads the same nine lists. A failed, empty, or garbage download keeps that list's last good copy.
- Twitch, YouTube, and Kick playback are unchanged.

## 0.2.19

- YouTube: the brief grey player error that flashed on some watch starts (a blocked decoy stream, before the real one plays) is held back. Only an error that appears before playback, within 5s of the start, is hidden, until playback starts or 5s pass. Errors after playback show at once. Turn it off with `{"errorFlash":"off"}` in `localStorage["twitch-adblock-yt-opts"]`.

## 0.2.18

- YouTube starts faster. Clicking to a new video starts in about 0.7-1.0s instead of 1.3-1.6s. Remaining cold-start delay is YouTube's own server-side wait.
- Lighter uBO layer payload: its page observer no longer polls the player on every DOM change, and skips non-watch pages. The duplicate feed/toast style is no longer injected next to youtube-ads.css.
- Twitch: the Browse (/directory) page no longer goes blank when an Ad feedback button has no card around it.
- `scripts/sync-ubo-youtube.mjs` runs on Windows and keeps its local patches on CRLF checkouts. New `scripts/bench-youtube.mjs` load benchmark.

## 0.2.17 (beta)

- YouTube: uBlock Origin's own YouTube filters (uAssets@69831a8, scriptlets from uBO 1.75.0, GPLv3) ported via `scripts/sync-ubo-youtube.mjs`: MAIN-world scriptlets (json-prune*, rpfr/replace-xhr, set-constant, nano-stb, trusted-edit-inbound-object, prevent-dom-bypass), isolated rpnt/rmnt, 2 CSS hides, 4 DNR rules (incl. the decoy `videoplayback?expire=` block). Homemade player ad-field strip and ytInitialPlayerResponse trap stand down when this layer is present; stall reload and doubleclick block kept. Attribution: src/vendor/LICENSE-uBlock.md.
- YouTube: stall reload sooner (~2s, quiet 1.5s, 2nd after 3.5s); doubleclick.net blocked for YouTube initiators.
- YouTube: progress-aware start-stall watchdog (500ms polls; reload only after >=4s from navigation and 3s with no progress; stops permanently once playback starts; 2nd reload >=6s after the 1st; max 2).
- Filter lists: quiet refresh ~5s after browser start (once per session, at most every 12h, per-list `! Expires` respected, ETag/If-Modified-Since), swapped into dynamic DNR rules; bundled ruleset restored on any error. "Update lists" runs the same refresh. New host permissions: easylist.to, pgl.yoyo.org, malware-filter.gitlab.io (list downloads only).
- Cosmetic filtering: EasyList `##`/`#@#` generic + site-specific (incl. `name.*`) element hiding via one `<style>`; procedural/scriptlet rules skipped; selectors sanitized; bundled snapshot refreshed with the lists.

## 0.2.16

- YouTube starts faster. Player requests are no longer marked "no ad". uBlock Origin keeps that switch off too. Ads are still removed from the player response, so the same video plays.
- The page-wide Object.assign hook is gone. It ran on every call YouTube made.
- When a YouTube video server cannot be reached (a name that does not resolve, a 403, or a 5xx), the same request moves to the next server YouTube lists for that video, then to its redirector. A dead server is skipped for 10 minutes. A failed answer is never read or held.
- If every server fails and the video is still at 0:00, the video is reloaded once, and a second time if needed. Never more than twice per video.
- The console says which server failed, which one worked, and how long the start took.
- Twitch, Kick, and ordinary-site blocking are unchanged.

## 0.2.15

- The YouTube start wait on the playback policy is cleared. That wait is how long the picture stays black after the length is already known. The audio target and the request keepalive stay. The server start switch stays on. Nothing seeks or pauses.

## 0.2.14

- The debug switch, Copy debug, and the in-page debug log are removed. Twitch, YouTube, and Kick playback are unchanged.

## 0.2.13

At release this was the only current build: Twitch, YouTube, Kick and ordinary-site blocking were in one zip, with no separate beta download.

- Includes the 0.2.12 work: packed EasyList, EasyPrivacy, Peter Lowe, and urlhaus lists, leftover-box hiding, IMDb sponsored billboards, Twitch directory ads, and Kick in-player skip.
- YouTube's server start switch stays on. Turning it off left the black spinner up. Server ABR stays on, so a video that only has a SABR address still has a stream.
- The "Experiencing interruptions?" toast is hidden in place. Deleting it made YouTube open it again and again. Saved and clipboard toasts stay.
- A paused start that already has picture data is still asked to play once. Nothing seeks or pauses.
- Update lists still only remembers the ask. It does not download a new list. Nothing fetches on its own.

## 0.2.12 (beta)

- EasyList, EasyPrivacy, Peter Lowe, and the urlhaus malware list were packed again. The full uBO stack was not added.
- Stream allows are unchanged: YouTube and Kick stay allow-all frames, Twitch stays a plain allow, video CDNs stay allowed.
- The Update lists button still only remembers the ask. It does not download a new list.
- Stable Latest stays v0.2.3. This beta replaces the 0.2.11 try.

## 0.2.11 (beta)

- IMDb sponsored banners, including the large name-page billboard, are hidden. The slot is on IMDb itself. Amazon’s ad host was already blocked. Posters stay.
- This hide runs with the ordinary-site sheet. Twitch, YouTube, and Kick playback are unchanged.
- Stable Latest stays v0.2.3. This beta replaces the 0.2.10 try.

## 0.2.10 (beta)

- Twitch Browse directory ads (the top banner slot and in-grid Ad cards) are hidden. The player, usher, and gql are not rewritten.
- Amazon’s ad host is no longer let through on Twitch pages. gql.twitch.tv and the video CDNs, including usher on ttvnw.net, stay allowed.
- Stable Latest stays v0.2.3. This beta replaces the 0.2.9 try.

## 0.2.9 (beta)

- Some other videos still sat on a black loading screen after 0.2.8, with the length already known and the player already trying to play. One well-known video was often ready in a couple of seconds on 0.2.8. This beta also clears the video start-buffer target in the playback response, and turns off the server start-buffer switch, including when that switch’s policies arrive as a list. When that switch is present, the player is told not to wait on the server’s bandwidth pick. The video address stays. Nothing seeks or pauses.
- Stable Latest stays v0.2.3. This beta replaces the 0.2.8 try.

## 0.2.8 (beta)

- YouTube’s “Experiencing interruptions?” toast is removed when it appears, including when YouTube puts it back. Other toasts stay. This does not start the picture by itself.
- Some starts still sat on a black loading screen for about 11 seconds after the backoff clear, with the length already known and the player already trying to play. The start-buffer wait in that playback response, and the same wait in the player response, is cleared. A newer playback part no longer hides a later backoff. A paused start that already has picture data is asked to play once. Nothing seeks or pauses.
- Stable Latest stays v0.2.3. This beta replaces the 0.2.7 try.

## 0.2.7 (beta)

- Copy debug prints the loaded extension version. It no longer always says 0.2.3.
- A later YouTube playback policy, and a backoff that arrives before the rest of that part, is still cleared. Picture bytes stay the same length.
- Stable Latest stays v0.2.3. This beta replaces the 0.2.6 try.

## 0.2.6 (beta)

- YouTube search results drop sponsored cards (`searchPyvRenderer`) the same way Home does. The video results stay.
- Leftover ad boxes on ordinary sites can load their hide stylesheet. The file is listed as a web-accessible resource so Chrome can fetch it.
- The YouTube black-spinner fix from stable main is in this beta. A short “Blocking ads” chip shows once per video, then stays hidden until you open another video.
- Three more tracker hosts are blocked on ordinary sites: facebook.net, imasdk.googleapis.com, and fundingchoicesmessages.google.com. Twitch, YouTube, and Kick frames are still allowed through.
- Kick’s own player try is still included. The general list still skips Twitch, YouTube, and Kick. Update lists still only remembers the ask. This does not block every ad. Stable Latest stays v0.2.3.

## 0.2.5 (beta)

- On ordinary websites, many ad servers are blocked and leftover ad boxes are hidden. This does not block every ad.
- Twitch and YouTube playback scripts match stable and were not edited for general blocking. Kick in-player ad skip from v0.2.4 is included; the general list still skips Kick.
- General blocking starts on. The popup can turn it off, allow the open page, or update the lists by hand. Nothing updates in the background.
- The gecko’s eyes glow while general blocking is on.
- This is a new beta. The stable download stays v0.2.3.

## 0.2.3

- On a Twitch tab, the popup answers correctly when the extension is on. Copy debug includes the log from that tab, including the on-screen blocking label when it is showing.
- Debug stays off until you turn it on. Opening the popup does not turn it on.
- Twitch live still uses upstream video-swap-new. YouTube ad stripping stays.

## 0.2.2

- Debug stays off until you turn it on in the popup. Copy debug is still there.
- Twitch live still uses upstream video-swap-new. YouTube ad stripping stays.

## 0.2.1

- The toolbar icon is a gecko head.
- Twitch live still uses upstream video-swap-new. YouTube ad stripping and the temporary debug popup stay.

## 0.2.0

- Twitch live midrolls use the upstream TwitchAdSolutions **video-swap-new** userscript (v1.55), copied unmodified into `src/vendor/` and run as the MAIN-world `document_start` script.
- The hand-written Twitch playlist rewrite (`src/page.js` / `src/playlist.js`) is removed.
- YouTube player/home ad stripping and the temporary debug popup are unchanged.
- MIT license for the vendored script is included in the zip.

## 0.1.22 (beta)

- Live client-side ad cues (a `twitch-maf-ad` marker on a playlist whose segments stay live) now hide that ad player and resume the live video. The player is not reloaded for this, and it does not start a backup swap. If hiding the ad would take the only picture, the ad plays.
- VODs and clips are unchanged.
- The Save your Streak side-nav row is hidden by one stylesheet rule. The rule does not apply when that row contains the video.
- The reload ceiling (2 player reloads in any 60 seconds) and the false-alarm hold are unchanged.
- Debug stays on by default (temporary).

## 0.1.21 (beta)

- Fixes a reload loop on high-resolution (1440p60 source) channels where the player kept going black every few seconds during a midroll. After a swap, the new master was checked on the first rung only. That rung could look clean while the rung the player was on still had the ad, so the swap was undone and redone over and over. The check now follows the rung the ad was seen on.
- A swap that is undone within 15 seconds is treated as a false alarm. The ad then plays on main for 60 seconds, doubling on repeats up to 240 seconds, instead of swapping again. This applies to both ways of leaving the backup.
- Hard ceiling: the player is reloaded at most twice in any rolling 60 seconds, whatever the cause. The ceiling lives in the page's single reload path, so every guard shares it. A reload to leave the backup that the ceiling holds back goes out first once there is room. If the page refuses a reload that a player worker allowed, the worker is told and retries once there is room, so the player is never left on a backup.
- Debug log shows why an ad was detected (`ad-seen`), when the hold applies (`hold`) and when the ceiling blocks a swap (`reload-ceiling`).
- Debug stays on by default (temporary).

## 0.1.20 (beta)

- Midrolls that start after a normal page load are swapped to the backup stream. A clean probe no longer drops the channel session, and a master response that already serves the main stream no longer arms the moving-off guard.
- Backup first: when the adopted backup's playlist is dirty or missing, the next clean backup type is tried before real ads pass through.
- At most two player reloads per break: enter and leave. A backup that gets its own ad plays it through instead of hopping to another type.
- Twitch "maf" ad breaks (one `twitch-maf-ad` DATERANGE on playlists whose segments stay live) lose only that line. Segments and numbering are untouched, and they never start a backup swap or a reload. Debug mode logs "maf-ad tag removed".
- The moving-off guard expires after 10 seconds when no master fetch clears it.
- A stitched ad range that starts just past the newest segment counts as an ad break.
- `stripAds` drops ad slots that live video follows, never lists a live segment twice, and keeps segment numbers steady across refreshes. A break at the live edge passes through until it ends.
- Stream display ad wrappers are hidden unless they hold the video.
- Debug on by default (temporary): a fresh install records the in-memory debug log with no user action. Token redaction and local-only copies are unchanged, and OFF in the popup still turns it off for that tab. The version stays 0.1.20.
- The debug popup moved into `src/`. Copy reads the top frame, and longer token and session query names are redacted.

Earlier versions: see the [releases page](https://github.com/gecko-of-shadow/twitch-adblock/releases) and the git tags.
