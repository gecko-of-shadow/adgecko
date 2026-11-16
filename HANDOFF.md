# Handoff

Last update: 2026-11-16.

## State

- `main` holds version 0.3.6 (commit `5cd4ab6`, pull request 14, squash-merged on 2026-11-16).
- 0.3.6 is not released. The last release is v0.3.5. The release workflow did not run.
- The next work and the open owner decisions are in `TODO.md`.
- The record of the 0.3.6 work session (findings, work packages, release checks) is in `docs/review-2026-11-16/RESULTS.md`.

## Work done in the last session (clean-up of the instruction documents)

The session changed documents only. It changed no file in `src/`, `scripts/`, `test/`, `.github/` or `icons/`, and not `manifest.json`.

| File | Change |
|---|---|
| `.planning/codebase/` (8 files) | Written again for 0.3.6. The size went from 328 KB to 125 KB. No line numbers. Each fact has one owner document. |
| `CLAUDE.md` | Now the entry point: what to read, the hard rules, the commands before a push. |
| `HANDOFF.md` | Short. The 0.3.6 record (21 KB) moved to `docs/review-2026-11-16/RESULTS.md` with no change to its text. |
| `TODO.md` | Current state, the manual tests for the 0.3.6 release, one table of the open owner decisions. |
| `README.md` | Shorter. The release link goes to the latest release page, thus it is correct before and after a release. |
| `docs/threat-tier.md` | Written again with the current numbers (15,865 hosts in 199 rules, pack of 2026-11-14). |
| `docs/UPDATING-DEPENDENCIES.md` | Two wrong line numbers removed. The uBlock Origin sync commands and the steps for a new tag agree with 0.3.6. |
| `docs/permissions-and-privacy.md`, `docs/how-it-works.md` | The second alarm and the plain-text copy of 0.3.6. |

Not changed, on purpose:

- `CHANGELOG.md`, `docs/review-2026-11-16/PLAN.md`, the old release pages and notes: they are records.
- `docs/allow-a-page.md`, `docs/feed-setup.md`, `docs/STORE-REVIEW-NOTES.md`, `docs/youtube-expire-window.md`, `docs/credits.md`: they are current for 0.3.6.
- `docs/design/`: a dated decision record.
- `src/rules/README.md`, `src/rules/LICENSES.md`, `src/vendor/README.md`, `src/vendor/LICENSE-uBlock.md`: generated or shipped in the zip. A change belongs to a release (`CONCERNS.md`, L4 and L5).

## Checks

PENDING

## Next steps

1. Release 0.3.6: `TODO.md`, section 1. The manual tests on the owner's PC come first.
2. The owner decisions in `TODO.md`, section 2.
3. Deletions that wait for the owner's approval: the old documents and image folders in `docs/` (`CONCERNS.md`, L2).
