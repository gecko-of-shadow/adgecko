# To do

Last update: 2026-11-17. Version 0.3.6 is the last release. An Android plan was added.

## Where it stands

- **Last release:** [v0.3.6](https://github.com/gecko-of-shadow/adgecko/releases/tag/v0.3.6), published 2026-11-16 by the release workflow from commit `5cd4ab6`. Assets: `adgecko-0.3.6.zip` (2,508,034 bytes) and `adgecko-0.3.6.zip.sha256`.
- **Checks on 0.3.6:** the release workflow passed the release gate on the checkout and on the zip. CI on `main` was green (tests with `--parallel`, privacy, release gate). The package has 64 files and 7,862,441 bytes; the cap is 8,000,000.
- **UNVERIFIED:** all behaviour of 0.3.6 in Chrome. The release was published before a manual test, at the owner's request. No run on the owner's PC or on live sites was done.

## Next steps

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
| 1 | Apply the Kick corrections in `docs/proposals/kick-0.3.5-fixes.patch`? | Not applied. `src/kick.js` is frozen. Three tests are ignored. |
| 2 | Accept the content pins in `scripts/frozen-pins.json`. | Done in 0.3.6. Confirm. |
| 3 | Master switch: must it also stop the `ubo-youtube` ruleset? | The docs say what keeps running. A code change is open. |
| 4 | YouTube players that are embedded in other websites. | Documented as not covered. |
| 5, 7 | EasyList licence option (CC BY-SA 3.0 or GPL-3.0-or-later). The project `LICENSE` in the zip. | Not changed. Recommendation: GPL-3.0-or-later, and add the `LICENSE`. |
| 6 | Peter Lowe list terms ("non-commercial"). | Open since 0.3.4. |
| 8 | Cross-list `@@` exceptions. | Recommendation: keep the same-host rule and add a note to the docs. |
| 9, 19 | Cosmetic storage layout. Repack `cosmetic-rules.json` and measure the storage budget. | The budget was measured: see item 3 below. The repack is not committed. |
| 10 | Pop-up guard for links, forms and child frames. | Not changed. Documented as out of scope. |
| 11, 12 | Release gate tests in parallel. A reproducible zip with Windows `tar.exe`. | The gate stays serial. Only the Info-ZIP path is reproducible. |
| 13, 14, 15 | Clipboard guard: plain-text copies on ordinary sites, the 500 ms timing limit, the two limits that stay. | In 0.3.6. Accept or change. |
| 16 | `ubo-youtube-network.json` blocks `ads.youtube.com`, which the stream-host registry lists. | Add a named exception, or change the registry. |
| 17, 22 | YouTube with the uBlock Origin layer: a toast with plain text is not hidden; CSS rules for more ad nodes. | Open. |
| 18 | Feed: no serial reset when a kill is released. | Accept. |
| 20 | The second, one-shot alarm `gecko-refresh-retry`. The 2026-11-02 decision named one alarm. | In 0.3.6. Confirm. |
| 21 | The order of `document_start` scripts was measured only in headless Chromium. | Measure in Chrome on the PC. |
| 23 | The list `REGIONAL_WILDCARD_BASES` (12 entries) in `scripts/build-psl-subset.mjs`. | Check. |
| 24 | Upstream defect in TwitchAdSolutions 1.55: the ad tracking-URL rewrite has no effect. | Recorded by a test. No action is possible in the frozen file. |
| 25 | `src/vendor/LICENSE-uBlock.md` shows `deno run -A` for the sync. | Not changed, because the file ships in the zip. |

Older decisions that are open:

- [ ] Block the Twitch ad host `ads.twitch.tv`? Two tests are ignored until this decision.
- [ ] The vendored Twitch script has an archived upstream: stay, move to a maintained fork, or own the code (`CONCERNS.md`, H3). Research of 2026-11-17: the upstream was archived on 2026-03-05; a maintained fork (`ryanbr/TwitchAdSolutions`, vaft v68.5.7) says that only the 360p backup stays clean during ad breaks (`docs/android/research-2026-11-17.md`, not checked on a live ad break).
- [ ] The signed threat feed: the feed host (D-1) and the signer (D-7), or a record that the feed stays off.
- [ ] Ideas that are not built: **Allow this site** also allows third-party frames on that page; a default allow list for checkout and login helpers; path filters and generic URL filters.
- [ ] Remove `src/rules/cosmetic-sample.json` (172,666 bytes, no reader) from the zip (`CONCERNS.md`, H2).

### 3. Before the next list repack

- [x] Storage budget measured on 2026-11-16 (lists downloaded at 20:28 UTC, scratch repack, not committed): peak 8,155,204 bytes. The test limit is 9,000,000 bytes (headroom 844,796) and the quota is 10,485,760 bytes (headroom 2,330,556). The test passed.
- [ ] Before each later repack: run `python3 scripts/pack-filter-lists.py`, then run `test/final-storage-budget.test.js` with the full list cache, and record the peak here.
- [ ] Refresh the public-suffix data with `scripts/build-psl-subset.mjs` (now: Public Suffix List of 2026-11-15).
- [ ] Look at the package size after each repack. Now: 7,862,441 bytes (headroom 137,559). The scratch repack of 2026-11-16 gave 7,859,984 bytes (headroom 140,016).

### 4. Keep an eye on

- [ ] The weekly uBlock Origin YouTube drift check (Mondays 06:00 UTC). A red run means that the upstream filters changed. Then follow `docs/UPDATING-DEPENDENCIES.md`.
- [ ] Twitch ad changes. No upstream correction will come for the vendored script.

### 6. Android ("Adgecko Shield")

The plan is `docs/android/PLAN.md`. All phone behaviour is UNVERIFIED.

- [ ] Owner, no code (plan section 5): give the phone facts (brand, model, Android version, daily browser, other VPN apps, Private DNS mode, country).
- [ ] Owner, no code (plan section 5, track B0): load the unchanged extension in Vivaldi for Android (Load unpacked) and report what works.
- [ ] Milestone 1 (DNS shield): a cloud build session does it in its own draft pull request. Then install the debug APK with adb and do the checks O1 to O7 (plan section 6.11).
- [ ] Owner decisions OD-1 to OD-25 (plan section 9). Milestone 1 uses the recommendations of the plan under the owner's standing approval. Change any of them in the pull request review.
- [ ] Later milestones: link and text gates (M2), list refresh on the phone (M3), signed list (M4). Optional: in-app browser (M6), stream helpers (M7).

### 5. Later

- [ ] **Chrome Web Store:** nothing was submitted. Read [docs/STORE-REVIEW-NOTES.md](docs/STORE-REVIEW-NOTES.md) first.
- [ ] Not covered today: YouTube Music, YouTube Kids, YouTube players in other websites, and ads that are part of the video.
- [ ] Work through `.planning/codebase/CONCERNS.md`. It is sorted by impact.
