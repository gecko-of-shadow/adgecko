# Handoff

Last updated: 2026-11-16.

## State

- Branch `claude/festive-dirac-a043po` starts at `main` (aa5f5af, version 0.3.5).
- A general code review was done on 2026-11-16 (11 review lenses, each finding checked by an adversarial verifier).
  - 64 findings are confirmed. The `findings.json` severity counts are: 2 critical, 9 high, 25 medium, 28 low. (An older note said 3 high, 17 medium, 44 low. That note was wrong; `findings.json` is the source of truth.)
  - 15 findings are rejected.
- The correction plan is in `docs/review-2026-11-16/PLAN.md` (25 work packages, WP-01 to WP-25).
- All finding data is in `docs/review-2026-11-16/findings.json`.
- Reproduction scripts from the review are in `docs/review-2026-11-16/repros/`.
- The 0.3.6 session did all 25 WPs and the release steps. The branch holds version 0.3.6. It is pushed. It is not merged, not tagged, and the release workflow did not run.

## Baseline (0.3.5)

- Checked in this session: `deno test --no-lock --allow-read --allow-run --allow-env test/` gave 776 passed, 0 failed, 9 ignored (4 min 44 s, Deno 2.9.6).
- `main` got two docs commits after the review (README restructure, CHANGELOG in Added/Changed/Fixed form, b01e6a5). This branch merged `main` (16d9d60).

## Coverage map: confirmed findings to work packages

The index is the position in `findings.json` key `confirmed` (starts at 0).

| Index | Finding (short) | WP |
|---|---|---|
| 0 | Lists off/on: threat ids counted as list ids | WP-06 |
| 1 | Retry after a failed refresh comes after about 3.5 h | WP-16 |
| 2 | Future lastRunAt / lastAttemptAt stops refreshes | WP-16 |
| 3 | Nested :is()/:where() exponential parse | WP-07 |
| 4 | $generichide exceptions ignored | WP-14 |
| 5 | Unscoped-selector guard bypass | WP-17 |
| 6 | Cross-list unconditional @@ does not lift a parent-domain or scoped block | Not in a WP. Owner decision 8 (PLAN section 3). Recommendation: keep the documented same-host rule and add a doc note. |
| 7 | Hide style breaks React 18 hydration | WP-15 |
| 8 | Lists switch off also stops hide boxes | WP-08 |
| 9 | onChanged floods every frame | WP-17 (item 2, cheap part); storage layout is owner decision 9 |
| 10 | Inline script can get a flags port | WP-18 |
| 11 | Toast stays hidden under uBO | WP-10 |
| 12 | Watchdog reloads pages that must not play | WP-19 |
| 13 | "Blocking ads" chip under uBO | WP-19 |
| 14 | Copy listener changes the selection after the check | WP-02 |
| 15 | Selection.toString() misses alt text and field values | WP-02 |
| 16 | setData / items.add / execCommand fail open | WP-01 |
| 17 | clipboard.write() fails open | WP-03 |
| 18 | Page-made selection plus Ctrl+C | WP-05 |
| 19 | Missed ClickFix patterns | WP-04 |
| 20 | Popup guard: anchor and form target=_blank | WP-24 (Option B docs); Option A is owner decision 10 |
| 21 | Popup guard: same-origin child frame | WP-24 (Option B docs); Option A is owner decision 10 |
| 22 | Popup guard: Enter after a click in a text field | WP-24 |
| 23 | Feed serial lock after key rotation | WP-11 |
| 24 | Feed cache write failure after the rule swap | WP-20 |
| 25 | Kill serial step limit | WP-11 |
| 26 | Threat tier off: feed snapshot installs threat list | WP-20 |
| 27 | Re-served rollback document: false warning | WP-20 |
| 28 | Each worker start re-verifies the feed | WP-20 |
| 29 | Platform protection covers only the apex name | WP-13 |
| 30 | PSL subset drops IDN suffixes | WP-21 |
| 31 | Private PSL wildcard children not protected | WP-21 |
| 32 | Popup drops clicks while busy | WP-23 |
| 33 | Focus lost after Undo fix | WP-23 |
| 34 | Settings page loses an overlapping change | WP-23 |
| 35 | "Protected" while the lists are off | WP-23 |
| 36 | "Allowed – not blocking here" on YouTube and Twitch | WP-23 |
| 37 | Stale "Did that fix it?" after a settings Undo | WP-23 |
| 38 | aria-pressed with a changing label | WP-23 |
| 39 | Row buttons have no domain in their name | WP-23 |
| 40 | Frozen-file gate cannot fail on main | WP-22 (item 1); owner decision 2 |
| 41 | Gate ignores update_url, CSP, sandbox | WP-22 |
| 42 | Packer accepts an empty or HTML list body | WP-22 |
| 43 | feed-sign signs an expired feed | WP-22 |
| 44 | --zip compares file names only | WP-22 |
| 45 | Zip not reproducible | WP-22 |
| 46 | uBO sync runs upstream code with -A | WP-22 |
| 47 | Dead rg glob in the gate | WP-22 |
| 48 | Docs say permissions are "exactly" 3 APIs | WP-12 |
| 49 | False statements in shipped licence files | WP-12 |
| 50 | EasyList stated as CC BY-SA 3.0 | Not a WP fix. Owner decision 5 (licence option). WP-12 corrects only factual errors. |
| 51 | No project LICENSE in the zip | Not a WP fix. Owner decision 7. |
| 52 | how-it-works.md out of date | WP-12 |
| 53 | First download timing in the privacy doc | WP-12 |
| 54 | README "Off" | WP-12 (Option B); Option A is owner decision 3 |
| 55 | Embedded YouTube players get no scriptlets | WP-12 (docs); owner decision 4 |
| 56 | hCaptcha scan cannot fail | WP-09 |
| 57 | No test for the listDue expiry branch | WP-09 |
| 58 | Popup tests use hand-copied siteInfo fakes | WP-09 |
| 59 | no-background-fetch scans dead modules | WP-09 |
| 60 | dnr.test.js oracle is a dead module | WP-09 |
| 61 | Twitch string tests duplicate the pin; no playlist test | WP-25 |
| 62 | No CGNAT test | WP-09 |
| 63 | Tests not in parallel | WP-25 |

Result: 61 findings are in a WP. 3 findings (6, 50, 51) are owner decisions only, as PLAN section 3 already says. No finding is missing.

## WP status

Status values: done, changed, discarded, owner decision, open. All behavior is UNVERIFIED until a run on the owner's PC proves it.

| WP | Status | Commit | Notes |
|---|---|---|---|
| WP-01 | done | see `git log --grep WP-01` | setData, items.add and execCommand rethrow a conversion error. Chrome repro t8 clean after the fix (headless). UNVERIFIED on the owner's PC. |
| WP-02 | done (cut changed) | see `git log --grep WP-02` | Trusted copy on a non-safe host: native preventDefault, then native setData of the checked text (text/plain only). CHANGE for the visitor's own Ctrl+X: plan fallback (range clone and a last bubble recheck). Owner decisions: loss of text/html; a page-started cut no longer removes text; copying a selected image copies nothing. Headless Chrome repros t2, t3, t4 clean. UNVERIFIED. |
| WP-03 | done | see `git log --grep WP-03` | No await; native then; any error blocks the write while the guard is on. Image-only write still passes. UNVERIFIED. |
| WP-04 | done | see `git log --grep WP-04` | 11 missed forms now match; 9 near-miss benign strings do not. Timing limit 500 ms for 100 KB (old patterns already took 65-95 ms; owner decision 50 ms vs 500 ms). |
| WP-05 | done | see `git log --grep WP-05` | (a), (b) and (c): the selection must come from a visitor gesture within 500 ms and be visible. Drag-select, Ctrl+A and textarea copies still work (headless Chrome). Limits: a page click handler within 500 ms; visible but disguised text. UNVERIFIED. |
| WP-06 | done | see `git log --grep WP-06` | dynamicLooksActive counts only list and kept ids. refresh() also rebuilds when ruleCount > 0 and no list rule is installed (repairs a 0.3.5 install). New `test/list-toggle-threat.test.js`. UNVERIFIED. |
| WP-07 | done | see `git log --grep WP-07` | Memo per branch; selectors with more than 8 nested parentheses are rejected. Same decisions for all 31,105 bundled selectors and 200,000 fuzz selectors. No PARSER_VERSION change for WP-07. |
| WP-08 | done | see `git log --grep WP-08` | With settings present, only F.resolve(...).cosmetic decides. Legacy keys only before migration. UNVERIFIED. |
| WP-09 | done (items 1, 4, 5 changed) | see `git log --grep WP-09` | Test-only; each new test failed on a temporary mutant (recorded in the commits). Item 4: owner decision: `ubo-youtube-network.json` rule 1 blocks ads.youtube.com, which isStreamHost marks as a stream host; that ruleset is not in the new oracle test. Item 3: shared popup harness not done (optional). |
| WP-10 | done | see `git log --grep WP-10` | Under uBO the toast sweep only restores. The CSS hides the interruptions toast. Gap: a toast with the text only in plain textContent is not hidden under uBO (owner decision). UNVERIFIED. |
| WP-11 | changed | see `git log --grep WP-11` | Serial bound to its signing key; a key removed from the pin list resets the serial. Expiry escape needs a stored file that lived 24 h. No step limit for kill serials. CHANGE: no serial reset on kill release (it would let pre-kill files back with the same key). Owner decision: accept this. UNVERIFIED (feed is dormant). |
| WP-12 | done | see `git log --grep WP-12` | Docs, README (new structure from main), licence and credit files, LICENSES.md writer text, settings note. New `test/docs-claims.test.js`. Option B for "Off"; embedded players documented only. Owner decisions 3, 4, 5 and 7 stay open. |
| WP-13 | done | see `git log --grep WP-13` | SERVICE_PLATFORMS (33) and SERVICE_HOSTS (12) are refused by the threat tier and the allow box. PSL refreshed to 2026-11-15 (download, no cache existed). Packed threat set: 0 hosts refused, no rebuild. UNVERIFIED. |
| WP-14 | done (no repack) | see `git log --grep WP-14` | $generichide/$ghide/$specifichide/$shide/$elemhide/$ehide parsed into small `cosNoG:<host>` keys. PARSER_VERSION 4 -> 5 (src/general/update.js), so every stored list is fetched and parsed again once. No list cache exists here, so `cosmetic-rules.json` was not repacked: the exceptions apply after the first successful EasyList and EasyPrivacy refresh. Storage budget with real lists NOT MEASURED (test skips without the cache). Owner decision: repack and measure. UNVERIFIED. |
| WP-15 | done | see `git log --grep WP-15` | Adopted constructed sheet, re-adopted at DOMContentLoaded and load; `<style>` fallback with an observer. Headless Chromium check of a full re-render passed. React 18 check NOT DONE (React not available offline). UNVERIFIED. |
| WP-16 | done (Option A) | see `git log --grep WP-16` | One-shot alarm `gecko-refresh-retry` 31 min after a failed run; a failed retry makes no new retry. Stored times more than 5 min in the future are ignored. The gate and two tests now allow exactly this second alarm. Owner check: the 2026-11-02 decision named one alarm. UNVERIFIED. |
| WP-17 | done (item 2 changed) | see `git log --grep WP-17` | 5 page-hiding selectors dropped; `.ad *` kept. Equal CSS not written again; frames re-read only when their own result changes. Storage layout is owner decision 9. UNVERIFIED. |
| WP-18 | changed | see `git log --grep WP-18` | CHANGE: no handshake count (headless Chromium showed the guard scripts run before flags.js, so a count would give the slots to the page). The request window closes when the parser inserts the first `<script>`, on the first readystatechange, or at setTimeout(0). kick.js not changed. Owner decision: script order is measured only in headless Chromium. UNVERIFIED. |
| WP-19 | done | see `git log --grep WP-19` | Watchdog stops on non-playable statuses. No "Blocking ads" chip from DOM removal under uBO (Option B). UNVERIFIED. |
| WP-20 | done (item 4 changed) | see `git log --grep WP-20` | Cache write failure restores the saved file's rules; tier off removes feed rules; same file again is "unchanged"; the wake fast path also compares a fingerprint of the saved file. New feedState fields. UNVERIFIED. |
| WP-21 | changed | see `git log --grep WP-21` | IDN suffixes kept as punycode. CHANGE: a hand-kept REGIONAL_WILDCARD_BASES list (12) instead of every private wildcard base, because the full set refused 3 packed malware hosts (single EC2 machines). Owner decision: check that list. psl.js 117,094 bytes (budget 120,000). UNVERIFIED. |
| WP-22 | done (item 1 changed) | see `git log --grep WP-22` | 8 items. CHANGE item 1: content pins in a new `scripts/frozen-pins.json` (the Twitch updater rewrites vendor-pins.json). Owner decisions: accept the pins (decision 2); the Windows tar.exe zip is not reproducible (decision 12). Not run in GitHub Actions. |
| WP-23 | done | see `git log --grep WP-23` | 8 items. Double-click protection kept. aria-pressed removed; the look uses data-allowed. Kick keeps "Allowed – not blocking here". Settings page writes go through one queue. UNVERIFIED. |
| WP-24 | done (items 1-2 Option B) | see `git log --grep WP-24` | A trusted keydown starts a new gesture. Anchor, form and child-frame coverage documented as out of scope; Option A is owner decision 10. UNVERIFIED. |
| WP-25 | done | see `git log --grep WP-25` | `--parallel` in checks.yml only; the gate stays serial (owner decision 11). New `test/twitch-playlist.test.js` runs the vendor playlist code. New upstream gap: vendor 1.55 stripAdSegments tracking-URL rewrite has no effect (writes a local variable). Not run in CI. |

## Release checks for 0.3.6 (this container, 2026-11-16)

| Check | Result |
|---|---|
| `deno test --no-lock --allow-read --allow-run --allow-env test/` | 921 passed, 0 failed, 9 ignored (5 min 28 s). Baseline 0.3.5: 776, 0, 9. |
| `bash scripts/release-gate.sh` | CLEAN (package bytes 7,607,291) |
| `bash scripts/pack-zip.sh` | `adgecko-0.3.6.zip`, 68 files, 2,513,124 bytes compressed, 7,876,252 bytes unpacked (the gate cap is 8,000,000 unpacked) |
| SHA-256 of the zip | `10b2178c31a6b60f7b4c6ad551c4dd97a483a1a728b148e3464536962c8bd69a` (a second pack gave the same hash) |
| `bash scripts/release-gate.sh --zip adgecko-0.3.6.zip` | CLEAN |
| `python3 -I scripts/privacy-check.py` (BASE = merge-base with `origin/main`, HEAD) | FAILED on 2 commit messages: ae6f02d line 17 and 0308df8 line 7 (test IP addresses with no allow marker). All file content passes. A range that starts after 0308df8 passes. PRIVACY_PATTERNS was not set here, so the personal-string rows were not checked. |

The zip is not committed (`*.zip` is in `.gitignore`).

### Ignored tests

- Here: 9 ignored, the same as the 0.3.5 baseline. They are 1 storage-budget test (no list cache), 3 owner-decision Twitch and list tests, 3 known-issue Kick tests (`src/kick.js` is frozen), and 2 privacy tests that need the `PRIVACY_PATTERNS` secret.
- CI on 0308df8 showed 11 ignored. The 2 extra are the two release-gate tests in `test/release-tooling.test.js` (WP-22). They skip when `rg` is missing, and the CI tests job did not install ripgrep. Commit "CI: install ripgrep in the tests job" adds the same step that the gate job has. UNVERIFIED in CI until the next run.
- CI on 0308df8 also had 1 failed test (the parser-version pin). Commit ef90dda fixed it before this note.

### Privacy check: open item

- The two commit messages name test addresses (the CGNAT test and the `192.168.` boundary test). The checker honors the allow marker per line, and these lines have none.
- The fix is a reword of the two messages and a force push of this branch. The session's permission check denied the history rewrite. The owner must choose:
  1. Approve a history rewrite of `claude/festive-dirac-a043po` (reword ae6f02d and 0308df8, then `git push --force-with-lease`), or
  2. Use a squash merge for PR 14, so that the messages do not reach `main`, or
  3. Accept the failed check on the PR.

## Owner decisions open

From PLAN section 3, with the results of this session:

1. Kick fixes (`docs/proposals/kick-0.3.5-fixes.patch`). Not applied. `src/kick.js` is not changed.
2. Frozen-file content pins (WP-22 item 1). Done in a new file `scripts/frozen-pins.json`. Confirm. After a Twitch vendor update, update this file by hand (`docs/UPDATING-DEPENDENCIES.md`).
3. Master switch and the ubo-youtube ruleset. Option B (docs) done. Option A open.
4. Embedded YouTube players. Documented only.
5. EasyList licence option (finding 50). Not changed. Recommendation: GPL-3.0-or-later.
6. Peter Lowe list terms. Open since 0.3.4.
7. Project LICENSE in the zip (finding 51). Not changed. Recommendation: yes.
8. Cross-list `@@` exceptions (finding 6). Not changed. Recommendation: keep the same-host rule, add a doc note.
9. Cosmetic storage layout (WP-17 item 2). Not changed.
10. Pop-up guard coverage of links, forms and child frames (WP-24 Option A). Not changed.
11. Release-gate tests in parallel. The gate stays serial; CI uses `--parallel`.
12. Reproducible zip with Windows `tar.exe`. The Info-ZIP path is reproducible; the `tar.exe` path is not.

New in this session:

13. WP-02: copies on ordinary sites are plain text only (no text/html); a page-started cut does not remove the text; copying a selected image copies nothing.
14. WP-04: timing limit 500 ms (plan: 50 ms) for 100 KB pattern inputs. The old patterns already took 65-95 ms.
15. WP-05: limits that stay: a page click handler within 500 ms; visible but disguised text.
16. WP-09 item 4: `ubo-youtube-network.json` rule 1 blocks `ads.youtube.com`, which `isStreamHost` lists. That ruleset is not in the new oracle test. Add a named exception, or change the registry.
17. WP-10: under uBO, a toast with the interruptions text only in plain textContent is not hidden (the CSS matches only the split-lines attribute and the help links).
18. WP-11: no serial reset on kill release. With two pinned keys, removing the key that signed the stored serial lets valid files from the other key apply one more time.
19. WP-14: repack `cosmetic-rules.json` from a list cache and run `test/final-storage-budget.test.js` with the cache (not measured here). PARSER_VERSION 5 makes every list download once after the update.
20. WP-16: a second (one-shot) alarm `gecko-refresh-retry`. The 2026-11-02 decision named one alarm.
21. WP-18: the order of document_start scripts was measured only in headless Chromium.
22. WP-19: Option A (CSS rules for the DOM selectors that the CSS does not cover).
23. WP-21: check the `REGIONAL_WILDCARD_BASES` list (12 entries) in `scripts/build-psl-subset.mjs`; the non-AWS URL forms are not checked live.
24. WP-25: upstream gap in TwitchAdSolutions 1.55: the ad tracking-URL rewrite in `stripAdSegments` writes a local variable and has no effect.
25. `src/vendor/LICENSE-uBlock.md` still shows `deno run -A` for the sync. It ships in the zip, so it was not changed.
26. Privacy check on two commit messages (see above).

## Deletion candidates (the owner must approve; nothing was deleted)

- `src/general/toggles.js`, `src/general/exclusions.js`, `src/general/cosmetic.js` and `src/general-exclude-hosts.js` (dead modules, "NEEDS OWNER").
- Their tests: `test/toggles.test.js`, `test/exclusions.test.js` and `test/general-cosmetic-contract.test.js` (rename them instead, if the modules stay).
- The string-presence Twitch tests that the SHA pin covers. `test/twitch-playlist.test.js` now exists, so they can be merged.
- `docs/cards2/` and `docs/cards-main/` (the same as `docs/cards/`; TODO.md:41).
- Local only, not in git: the 9 agent worktrees under `.claude/worktrees/` (excluded in `.git/info/exclude`) and their branches `worktree-agent-*`.

## Facts

Checked in this session (Linux container, Deno 2.9.6):
- The baseline and final test counts, the two gate runs, the zip size, the zip SHA-256 and its reproducibility, and the privacy check results above.
- Each regression test failed on the old code (or on a temporary mutant for test-only items) and passes now. The commit messages record each proof.
- Headless Chromium checks (scratch only): clipboard repros t2, t3, t4, t7 and t8; the flags port; the pop-up guard Enter case; the hide sheet after a full page re-render.

Not checked:
- No run on the owner's PC, in a real (headed) Chrome, or on live sites (YouTube, Twitch, Kick, Gmail, GitHub, React 18 sites). All behavior is UNVERIFIED until a run on the owner's PC proves it.
- No GitHub Actions run (parallel tests, the release job with the `.sha256` asset, the uBO drift job grants).
- The storage budget with the real lists (no list cache), a React 18 hydration check, a real uBO sync, Windows and Git Bash runs of the new tests and of `pack-zip.sh`.
