# Handoff

Last update: 2026-11-16.

## Work done in this session

- A codebase map is in `.planning/codebase/`. It has seven documents: `STACK.md`, `INTEGRATIONS.md`, `ARCHITECTURE.md`, `STRUCTURE.md`, `CONVENTIONS.md`, `TESTING.md` and `CONCERNS.md`.
- The map describes commit `b01e6a5` (version 0.3.5 plus the unreleased changes of PR #13).
- One agent wrote each document. A second, independent agent then compared each claim with the source files and corrected the document.
- No file in `src/`, `scripts/`, `test/`, `docs/` or `icons/` was changed. The release zip does not contain `.planning/` or this file.

## State of the checks

- Checked: `scripts/privacy-check.py` passed on the new files (generic checks only; the `PRIVACY_PATTERNS` secret was not available).
- Not checked: the Deno tests and `scripts/release-gate.sh` did not run. Deno was not installed in the session.
- UNVERIFIED: all statements in the map about behaviour in Chrome. No run on the owner's PC proved them. Each document has a "Checked and not checked" section.

## Next steps

1. Read `.planning/codebase/CONCERNS.md`. Its items are sorted by impact.
2. Decide which stale documents to correct (`docs/how-it-works.md`, `src/rules/README.md`, `TODO.md`).
3. The open owner decisions are in `TODO.md`.
