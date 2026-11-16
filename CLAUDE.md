# Instructions for coding agents

Read these files before you plan or change code in this repository.

## Codebase map

The map is in `.planning/codebase/`. Start with `.planning/codebase/README.md`.

| Task | Read first |
|---|---|
| Any change | `ARCHITECTURE.md`, `CONVENTIONS.md` |
| Find a file, or add a new file | `STRUCTURE.md` |
| Filter lists, downloads, CI, the signed feed | `INTEGRATIONS.md` |
| Tools, Chrome APIs, vendored code | `STACK.md` |
| Add or change a test | `TESTING.md` |
| Select the next work | `CONCERNS.md`, then `TODO.md` |

The map describes one commit. The commit is on the third line of each document. If the code and the map disagree, the code is correct. Then correct the map in the same pull request.

## Rules of this repository

- There is no build step. Chrome loads the repository root.
- Do not edit `src/vendor/video-swap-new.user.js` or `src/kick.js` without the owner's approval. `scripts/release-gate.sh` section 1b fails if they change.
- Do not edit generated files by hand. Their first lines name the generator.
- Before a push, run the tests and the release gate. The commands are in `.planning/codebase/TESTING.md`.
- `scripts/privacy-check.py` scans each change. Do not write absolute paths, e-mail addresses or names of persons.
- Keep `HANDOFF.md` up to date at the end of each session.
