# Handoff

Last update: 2026-11-20.

## State

- Version 0.3.7 is the last release. The tag `v0.3.7` is on commit `cc3e764`, which is `main`. The changes are in `CHANGELOG.md`, section 0.3.7.
- The 0.3.7 session did not update this file or `TODO.md`. The section "Session of 2026-11-16" below is from before 0.3.7.
- Open question from the owner (2026-11-20): "YouTube is maybe worse in 0.3.7." There is no answer yet. No fix and no new release were made.
- UNVERIFIED: all behaviour of 0.3.7 in Chrome, except the live tests that `CHANGELOG.md` section 0.3.7 records.

## Session of 2026-11-20 (cloud, stopped early)

The owner asked: find out if YouTube is worse in 0.3.7 than in 0.3.6, and push a release if necessary. The owner stopped the session before a browser test. Do the test on the owner's PC.

### What changed for YouTube from v0.3.6 to v0.3.7

From `git diff v0.3.6 v0.3.7 -- src/ scripts/`. In `src/`, only YouTube files changed.

1. uBlock Origin filters: uAssets `e140ffc` to `900a2a3` (`src/vendor/ubo-youtube*.js`, `ubo-youtube-meta.json`).
   - The start recovery payload (`rpnt`, in `src/vendor/ubo-youtube-isolated.js`) has a new upstream guard (`!r&&`) in its stall check.
   - The payload now also runs on `www.youtube.com/embed/` pages, with the step list `channel, eafg`.
   - Three new `trusted-edit-inbound-object` filters for embedded players.
2. Local patch (`ARG_PATCHES[0]` in `scripts/sync-ubo-youtube.mjs`): when the step list is empty and the address shows a different video, the list starts again.
3. Local patch in `editInboundObjectFn`: the root-key guard reads a dotted filter (`[?.a.b.c]`). This code runs on each `JSON.stringify` call.
4. `src/youtube.js`: a new snackbar guard. It hides the "Experiencing interruptions?" message in `snackbar-container` with `visibility: hidden`. It adds two `MutationObserver`s: the direct children of `ytd-app`, and `snackbar-container`.

### Suspects (UNVERIFIED: from code reading only, no test)

1. Item 2 (the step list starts again). After all four steps fail on one video, each later video in the same tab can get up to four more `loadVideoById` reloads. In 0.3.6 it got none. More reloads can make a longer black screen. `CHANGELOG.md` 0.3.7 says about this change: "it does not remove the waits".
2. Item 1 (upstream payload). The `!r&&` guard changes when a stall is recorded, and thus when a reload occurs.
3. Item 4 (snackbar guard). It hides the message, not the wait. A stall can now look like a black screen with no message. This can feel worse with no change in the wait.
4. Item 3 (work on each `JSON.stringify` call). Not likely, but measure the long tasks.
5. YouTube changed on its side. Only an A/B test of 0.3.6 and 0.3.7 at the same time, on the same account, can separate this from items 1 to 4.

### How to test on the owner's PC

1. Ask the owner what is worse: ads, a black screen at the start, a slow start, the popup, or a different problem.
2. Manual A/B test in the owner's Chrome (signed in): v0.3.6 and v0.3.7, in turn, at the same time of day. For each version: open 10 videos, then click 5 related videos in the same tab (this is the path of item 1). Record the time to the first frame, ads, the black-screen time, the number of reloads and the popup.
3. Automatic A/B test (not signed in): `scripts/bench-youtube.mjs` with Chrome for Testing (branded Chrome ignores `--load-extension`). Use `--variant before=<v0.3.6 folder> --variant after=. --runs 10`. Get the v0.3.6 folder from `adgecko-0.3.6.zip` of the v0.3.6 release, or with `git worktree add`.
4. To test item 1 alone: in a scratch copy, remove the `gk`/`gkv` code from the `rpnt` payload in `src/vendor/ubo-youtube-isolated.js`, then compare. Do not commit a hand edit of that file. It is generated: change `ARG_PATCHES` and run the sync.

### If 0.3.7 is worse

- Quick relief: load v0.3.6 (`adgecko-0.3.6.zip` from the v0.3.6 release), as in the "Roll back" sections of `CHANGELOG.md`.
- A fix: change the cause, set the version to 0.3.8 in `manifest.json`, add a section 0.3.8 to `CHANGELOG.md`, merge to `main`, then run Actions, release, Run workflow. The release workflow runs only by `workflow_dispatch` from `main`.

### Checks in this session (Linux container)

Checked:

- The tag `v0.3.6` is on `5cd4ab6`. The tag `v0.3.7` is on `cc3e764`. `main` is at `cc3e764`.
- The diff above, by reading.
- `.github/workflows/release.yml` starts only by `workflow_dispatch`, and only from `main`.
- `www.youtube.com` answers from the container (HTTP 200).

Not checked:

- UNVERIFIED: any behaviour in Chrome. No browser test was run on 0.3.6 or on 0.3.7.
- The 0.3.7 release page and its assets.
- If the suspects above are real.

## Session of 2026-11-16 (before 0.3.7)

### State at that time

- Version 0.3.6 is released: [v0.3.6](https://github.com/gecko-of-shadow/adgecko/releases/tag/v0.3.6), from commit `5cd4ab6`, published 2026-11-16 by the release workflow.
- UNVERIFIED: all behaviour of 0.3.6 in Chrome. The owner asked for the release before the manual tests. The tests are the first item in `TODO.md`.
- The next work and the open owner decisions are in `TODO.md`.
- The record of the 0.3.6 work session (findings, work packages, release checks) is in `docs/review-2026-11-16/RESULTS.md`.

### Work done in the last session

Documents and repository clean-up only. No file in `src/`, `scripts/`, `test/`, `.github/` or `icons/` was changed, and not `manifest.json`.

1. The instruction documents were made shorter and correct for 0.3.6 (pull request 17):
   - `.planning/codebase/` (8 files): written again. 328 KB to 125 KB. No line numbers. Each fact has one owner document.
   - `CLAUDE.md`: the entry point. `HANDOFF.md`: short. `TODO.md`: current state and one table of the owner decisions. `README.md`: shorter.
   - `docs/threat-tier.md`, `docs/UPDATING-DEPENDENCIES.md`, `docs/permissions-and-privacy.md`, `docs/how-it-works.md`: corrected for 0.3.6.
   - The long 0.3.6 record moved from `HANDOFF.md` to `docs/review-2026-11-16/RESULTS.md`, with no change to its text.
2. With the owner's approval:
   - 95 old files (approximately 30 MB) were deleted from `docs/`: the old release pages and notes, `agent-notes/`, the `cards*` folders, `install/`, `safe/`, `icon-preview/` and four loose images.
   - Pull request 16 (an older README clean-up) was closed.
   - The disabled scheduled task "Check if adgecko PR 14 is merged" was deleted.
   - The release workflow ran for 0.3.6.
3. The storage budget was measured in a scratch copy (lists downloaded 2026-11-16 20:28 UTC; the repack was not committed): peak 8,155,204 bytes. The test limit is 9,000,000 and the quota is 10,485,760. A repack would make the package 7,859,984 bytes (cap 8,000,000).

### Checks

Checked in the last session (Linux container, Deno 2.9.8):

- `bash scripts/release-gate.sh`: `VERDICT: CLEAN`, with 884 tests passed, 0 failed, 9 ignored.
- `python3 -I scripts/privacy-check.py`: passed. It used only the generic checks, because the secret pattern list is not available in the container.
- CI was green on pull request 17 and on `main` at `5cd4ab6`. The release workflow passed.
- `test/final-storage-budget.test.js` with the full list cache: passed.
- Four independent agents compared the new documents with the code. They found 24 wrong or weak statements. All are corrected.

Not checked:

- UNVERIFIED: all behaviour in Chrome. No run on the owner's PC or on live sites was done.
- The uBlock Origin sync commands in `docs/UPDATING-DEPENDENCIES.md` were not run.

### Open from the last session

- The branch `docs/cleanup-2026-11-16` of the closed pull request 16 is not deleted. The session could push only to its own branch. The owner can delete it on the GitHub Branches page.

### Next steps

1. Test 0.3.6 by hand on the owner's PC: `TODO.md`, section 1.
2. The owner decisions: `TODO.md`, section 2.
