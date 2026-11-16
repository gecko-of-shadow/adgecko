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
- The 0.3.6 session does the plan now. This file shows the status of each WP.

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
| WP-01 | open | | |
| WP-02 | open | | |
| WP-03 | open | | |
| WP-04 | open | | |
| WP-05 | open | | |
| WP-06 | open | | |
| WP-07 | open | | |
| WP-08 | open | | |
| WP-09 | open | | |
| WP-10 | done | see `git log --grep WP-10` | Under uBO the toast sweep only restores. The CSS hides the interruptions toast. Gap: a toast with the text only in plain textContent is not hidden under uBO (owner decision). UNVERIFIED. |
| WP-11 | open | | |
| WP-12 | open | | |
| WP-13 | open | | |
| WP-14 | open | | |
| WP-15 | open | | |
| WP-16 | open | | |
| WP-17 | open | | |
| WP-18 | open | | |
| WP-19 | done | see `git log --grep WP-19` | Watchdog stops on non-playable statuses. No "Blocking ads" chip from DOM removal under uBO (Option B). UNVERIFIED. |
| WP-20 | open | | |
| WP-21 | open | | |
| WP-22 | open | | |
| WP-23 | open | | |
| WP-24 | open | | |
| WP-25 | open | | |

## Facts

- Checked in the review session: `deno test` on 0.3.5 gave 776 passed, 0 failed, 9 ignored (Deno 2.9.6, Linux container). The privacy check passed on the review files.
- Not checked: no finding was tested on the owner's PC or on live sites. All findings are UNVERIFIED until a run on the owner's PC proves them.

## Owner decisions open

- See section 3 of `docs/review-2026-11-16/PLAN.md`.

## Deletion candidates (the owner must approve; nothing was deleted)

- See section 3 of `docs/review-2026-11-16/PLAN.md`.
