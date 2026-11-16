# Handoff

Last update: 2026-11-16.

## State

- Version 0.3.6 is released: [v0.3.6](https://github.com/gecko-of-shadow/adgecko/releases/tag/v0.3.6), from commit `5cd4ab6`, published 2026-11-16 by the release workflow.
- UNVERIFIED: all behaviour of 0.3.6 in Chrome. The owner asked for the release before the manual tests. The tests are the first item in `TODO.md`.
- The next work and the open owner decisions are in `TODO.md`.
- The record of the 0.3.6 work session (findings, work packages, release checks) is in `docs/review-2026-11-16/RESULTS.md`.

## Work done in the last session

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

## Checks

Checked in the last session (Linux container, Deno 2.9.8):

- `bash scripts/release-gate.sh`: `VERDICT: CLEAN`, with 884 tests passed, 0 failed, 9 ignored.
- `python3 -I scripts/privacy-check.py`: passed. It used only the generic checks, because the secret pattern list is not available in the container.
- CI was green on pull request 17 and on `main` at `5cd4ab6`. The release workflow passed.
- `test/final-storage-budget.test.js` with the full list cache: passed.
- Four independent agents compared the new documents with the code. They found 24 wrong or weak statements. All are corrected.

Not checked:

- UNVERIFIED: all behaviour in Chrome. No run on the owner's PC or on live sites was done.
- The uBlock Origin sync commands in `docs/UPDATING-DEPENDENCIES.md` were not run.

## Open from the last session

- The branch `docs/cleanup-2026-11-16` of the closed pull request 16 is not deleted. The session could push only to its own branch. The owner can delete it on the GitHub Branches page.

## Next steps

1. Test 0.3.6 by hand on the owner's PC: `TODO.md`, section 1.
2. The owner decisions: `TODO.md`, section 2.
