# To do

Last update: 2026-11-20, after PRs 22 to 26 (five owner decisions). Android milestone 1 (Adgecko Shield) is built in a draft pull request. The optional DoH upstream for the Shield is in a second draft pull request on top of it.

## Where it stands

- **Last release:** [v0.3.7](https://github.com/gecko-of-shadow/adgecko/releases/tag/v0.3.7), from commit `cc3e764`. Assets: `adgecko-0.3.7.zip` and `adgecko-0.3.7.zip.sha256`. The release before: v0.3.6 (`5cd4ab6`).
- **A/B test on 2026-11-20 (signed out, Chrome for Testing):** no YouTube regression of 0.3.7 against 0.3.6 was found. The numbers are in `docs/youtube-ab-test-2026-11-20.md`.
- **UNVERIFIED:** the behaviour of 0.3.7 in the owner's signed-in Chrome.
- **Not released:** `main` has five changes after v0.3.7 (PRs 22 to 26). See `CHANGELOG.md`, section "Unreleased".

## Next steps

### 0. Test 0.3.7 on YouTube, signed in (only the owner can do this)

The automatic test was not signed in. The black screen of 6 to 21 s (`CHANGELOG.md`, section 0.3.7) was seen on a signed-in account; no click in the automatic chain test had it. The suspect that the automatic test could not reach (A) acts only after all recovery steps fail on one video.

- [ ] In your own Chrome, signed in: open a video, then click 5 related videos one after the other in the same tab. For each click, write down the seconds of black screen.
- [ ] Do this 4 times and change the version each time: 0.3.7, 0.3.6, 0.3.7, 0.3.6. For 0.3.6 load the `v036` folder in `adgecko-ab` (or `adgecko-0.3.6.zip`). Load only one Adgecko card at a time. Use the same Chrome profile. The stall rate of one profile changed a lot within one hour in the automatic test, so one block of 0.3.7 and then one block of 0.3.6 would measure the time, not the version.
- [ ] If 0.3.7 is clearly longer: test the `noA` folder in `adgecko-ab` the same way. If noA is as fast as 0.3.6, suspect A is the cause. Record the result here.
- [ ] Check that the "Experiencing interruptions?" popup does not show in 0.3.7, and that "Link copied to clipboard" still shows after Share, Copy link.

### 1. Test 0.3.6 by hand

- [ ] Test in your own Chrome, with `adgecko-0.3.6.zip` or the unpacked `main`:
  - YouTube: a video starts; menus, Share and Save open after an "Experiencing interruptions?" toast; a premiere page is not reloaded.
  - Twitch (live stream) and Kick.
  - One news site, Gmail, GitHub and one React site: the page is complete and ad boxes are hidden.
  - Clipboard guard: a copy on an ordinary site gives plain text; Ctrl+C on your own selection works.
  - Popup: **Fix this site**, **Allow this site**, **Block again**, **Undo fix**.
- [ ] If a test fails: roll back to v0.3.5 (`CHANGELOG.md`, section 0.3.5, "Roll back") and record the failure here.
- [ ] After the tests, remove the UNVERIFIED marks that the tests proved.
- [ ] The weekly uBlock Origin drift job runs for the first time with explicit permissions on Monday. Look at its result.

### 2. Owner decisions

The numbers are the numbers in `docs/review-2026-11-16/RESULTS.md`, section "Owner decisions open". That file has the details.

| No. | Decision | State |
|---|---|---|
| 1 | Apply the Kick corrections in `docs/proposals/kick-0.3.5-fixes.patch`? | Done on 2026-11-20 (PR 26). Test on kick.com in real Chrome. |
| 2 | Accept the content pins in `scripts/frozen-pins.json`. | Done in 0.3.6. Confirm. |
| 3 | Master switch: must it also stop the `ubo-youtube` ruleset? | The docs say what keeps running. A code change is open. |
| 4 | YouTube players that are embedded in other websites. | Documented as not covered. |
| 5, 7 | EasyList licence option (CC BY-SA 3.0 or GPL-3.0-or-later). The project `LICENSE` in the zip. | Done on 2026-11-20 (PR 23): GPL-3.0-or-later; `LICENSE` ships as `src/LICENSE.txt`. |
| 6 | Peter Lowe list terms ("non-commercial"). | Open since 0.3.4. |
| 8 | Cross-list `@@` exceptions. | Recommendation: keep the same-host rule and add a note to the docs. |
| 9, 19 | Cosmetic storage layout. Repack `cosmetic-rules.json` and measure the storage budget. | The budget was measured: see item 3 below. The repack is not committed. |
| 10 | Pop-up guard for links, forms and child frames. | Not changed. Documented as out of scope. |
| 11, 12 | Release gate tests in parallel. A reproducible zip with Windows `tar.exe`. | The gate stays serial. Only the Info-ZIP path is reproducible. |
| 13, 14, 15 | Clipboard guard: plain-text copies on ordinary sites, the 500 ms timing limit, the two limits that stay. | In 0.3.6. Accept or change. |
| 16 | `ubo-youtube-network.json` blocks `ads.youtube.com`, which the stream-host registry lists. | Done on 2026-11-20 (PR 22): a named exception in the test. |
| 17, 22 | YouTube with the uBlock Origin layer: a toast with plain text is not hidden; CSS rules for more ad nodes. | Open. |
| 18 | Feed: no serial reset when a kill is released. | Accept. |
| 20 | The second, one-shot alarm `gecko-refresh-retry`. The 2026-11-02 decision named one alarm. | In 0.3.6. Confirm. |
| 21 | The order of `document_start` scripts was measured only in headless Chromium. | Measure in Chrome on the PC. |
| 23 | The list `REGIONAL_WILDCARD_BASES` (12 entries) in `scripts/build-psl-subset.mjs`. | Check. |
| 24 | Upstream defect in TwitchAdSolutions 1.55: the ad tracking-URL rewrite has no effect. | Recorded by a test. No action is possible in the frozen file. |
| 25 | `src/vendor/LICENSE-uBlock.md` shows `deno run -A` for the sync. | Not changed, because the file ships in the zip. |

Older decisions that are open:

- [x] Block the Twitch ad host `ads.twitch.tv`. Done on 2026-11-20 (PR 24). Test Twitch in real Chrome.
- [ ] The vendored Twitch script has an archived upstream: stay, move to a maintained fork, or own the code (`CONCERNS.md`, H3). Research of 2026-11-17: the upstream was archived on 2026-03-05; a maintained fork (`ryanbr/TwitchAdSolutions`, vaft v68.5.7) says that only the 360p backup stays clean during ad breaks (`docs/android/research-2026-11-17.md`, not checked on a live ad break).
- [ ] The signed threat feed: the feed host (D-1) and the signer (D-7), or a record that the feed stays off.
- [ ] Ideas that are not built: **Allow this site** also allows third-party frames on that page; a default allow list for checkout and login helpers; path filters and generic URL filters.
- [x] Remove `src/rules/cosmetic-sample.json` (172,666 bytes, no reader) from the zip (`CONCERNS.md`, H2). Done on 2026-11-20 (PR 25).

### 3. Before the next list repack

- [x] Storage budget measured on 2026-11-16 (lists downloaded at 20:28 UTC, scratch repack, not committed): peak 8,155,204 bytes. The test limit is 9,000,000 bytes (headroom 844,796) and the quota is 10,485,760 bytes (headroom 2,330,556). The test passed.
- [ ] Before each later repack: run `python3 scripts/pack-filter-lists.py`, then run `test/final-storage-budget.test.js` with the full list cache, and record the peak here.
- [ ] Refresh the public-suffix data with `scripts/build-psl-subset.mjs` (now: Public Suffix List of 2026-11-15).
- [ ] Look at the package size after each repack. Now (2026-11-20, `main` at `40948cc`, after the removal of `cosmetic-sample.json`): 7,646,955 bytes (headroom 353,045).

### 4. Keep an eye on

- [ ] The weekly uBlock Origin YouTube drift check (Mondays 06:00 UTC). A red run means that the upstream filters changed. Then follow `docs/UPDATING-DEPENDENCIES.md`.
- [ ] Twitch ad changes. No upstream correction will come for the vendored script.

### 6. Android ("Adgecko Shield")

The plan is `docs/android/PLAN.md`. All phone behaviour is UNVERIFIED.

- [ ] Owner, no code (plan section 5): give the phone facts (brand, model, Android version, daily browser, other VPN apps, Private DNS mode, country).
- [ ] Owner, no code (plan section 5, track B0): load the unchanged extension in Vivaldi for Android (Load unpacked) and report what works.
- [x] Milestone 1 (DNS shield) is built: draft pull request 19 from `claude/android-shield-m1`. CI is green (build job, emulator API 33 and API 36). The build job makes the APK artifact `adgecko-shield-debug`.
- [ ] Owner: install the debug APK with adb and do the checks O1 to O7 (`docs/android/shield.md`, sections 4 and 5). Report each result. Then remove the UNVERIFIED marks that the checks prove.
- [x] Owner, on the phone (2026-11-20): the DoH upstream with NextDNS works on mobile data: 459 queries via DoH, 0 via network DNS (`HANDOFF.md`).
- [x] Owner, on the phone (2026-11-20): the NextDNS query log shows the phone's queries.
- [ ] Owner, on the phone: check DoH on Wi-Fi and after a network change.
- [x] Owner decision (2026-11-20): keep the fallback to network DNS after DoH failures (no "DoH only" mode for now). "DoH only" would give SERVFAIL instead: more private, but no DNS when the DoH server is not reachable (for example a captive portal). The owner can change it later.
- [ ] Merge order: the DoH pull request (base `claude/android-shield-m1`) after the milestone 1 pull request.
- [ ] Owner decision OD-3 (APK signing) before milestone 2. With the CI debug key, each update needs an uninstall.
- [ ] Check on a phone: Android accepts the foreground service type `systemExempted` for the VPN with no alarm permission (lint finding, `HANDOFF.md`).
- [ ] Check on a phone: the time from the shield start to "Lists: active" in the Self-test (0.4 to 3.0 s on the CI emulators).
- [x] Owner decision OD-new-2 (2026-11-17): accepted. The Gradle cache and the HTTP 429 retry stay in `android.yml`.
- [ ] Owner decision OD-new-1: `specialUse` as a fallback service type (a sixth permission). The owner waits for check O2 on the phone (decision of 2026-11-17). Decide it after O2: if Android refuses `systemExempted`, add `specialUse`.
- [ ] Owner decisions OD-1 to OD-25 (plan section 9). Milestone 1 uses the recommendations of the plan under the owner's standing approval. Change any of them in the pull request review.
- [ ] Later milestones: link and text gates (M2), list refresh on the phone (M3), signed list (M4). Optional: in-app browser (M6), stream helpers (M7).

### 5. Later

- [ ] **Chrome Web Store:** nothing was submitted. Read [docs/STORE-REVIEW-NOTES.md](docs/STORE-REVIEW-NOTES.md) first.
- [ ] Not covered today: YouTube Music, YouTube Kids, YouTube players in other websites, and ads that are part of the video.
- [ ] Work through `.planning/codebase/CONCERNS.md`. It is sorted by impact.
