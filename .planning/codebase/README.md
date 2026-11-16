# Codebase map

Analysis date: 2026-11-16
Commit: b01e6a5

This directory holds a map of the Adgecko code. It is for persons and coding agents who plan work in this repository.

## Documents

| File | Subject |
|---|---|
| `STACK.md` | Languages, Chrome APIs, tools, vendored code and pins |
| `INTEGRATIONS.md` | Filter list sources, fetch policy, signed feed, CI, storage |
| `ARCHITECTURE.md` | Rule layers, priorities, rule id ranges, worker, messages, data flow |
| `STRUCTURE.md` | File inventory, and where to add new code |
| `CONVENTIONS.md` | Module patterns, naming, rules that the release gate enforces |
| `TESTING.md` | Test method, fixtures, ignored tests, CI jobs |
| `CONCERNS.md` | Technical debt, risks and stale items, sorted by impact |

## How the map was made

One agent wrote each document from the source files. A second, independent agent then compared each claim with the source and corrected the document. No test ran and the extension was not loaded. Each document ends with a "Checked and not checked" section. Statements about behaviour in Chrome are UNVERIFIED.

## How to keep the map correct

- The map describes the commit that is given above. Line references become wrong when the files change.
- If the code and the map disagree, the code is correct.
- When a pull request changes a fact in the map, correct that document in the same pull request.
- After a large change or a release, make the map again. Update the date and the commit in each document.
- These files are not in the release zip. `scripts/pack-zip.sh` packs only `manifest.json`, `src/` and `icons/`.
