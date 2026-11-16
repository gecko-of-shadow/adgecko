# Codebase map

Analysis date: 2026-11-16
Commit: 5cd4ab6 (version 0.3.6)

This directory holds a map of the Adgecko code. It is for persons and coding agents who plan work in this repository.

## Documents

| File | Subject | Read it when |
|---|---|---|
| `ARCHITECTURE.md` | Parts, content scripts, DNR priorities and id ranges, worker, messages, storage keys, settings model | Before each code change |
| `CONVENTIONS.md` | Module patterns, naming, page-world rules, release gate rules, generated and frozen files | Before each code change |
| `STRUCTURE.md` | File inventory, release zip content, where to add new code | You look for a file or add a file |
| `INTEGRATIONS.md` | Filter lists, fetch policy, signed feed, vendored upstreams, GitHub Actions | You change lists, downloads, the feed or CI |
| `STACK.md` | Languages, Chrome APIs, permissions, tools, scripts, pins | You change tools, scripts or vendored code |
| `TESTING.md` | Commands, test methods, fixtures, tests that read documents, privacy check | You add or change a test, or a check fails |
| `CONCERNS.md` | Technical debt and risks, sorted by impact | You select the next work |

Each fact has one owner document. The other documents refer to it.

## How the map was made and checked

- The first map (commit `b01e6a5`, version 0.3.5) was written by one agent for each document. A second agent compared each claim with the source.
- This version describes commit `5cd4ab6` (version 0.3.6). It is a rewrite: shorter, with no line numbers and no repeated tables.
- Checked for this version: the manifest, the rule files, the pack metadata, the pins, the package list and the test inventory were read by scripts. The constants and the named functions were found again in the source. The full test suite ran: 884 passed, 0 failed, 9 ignored.
- Not checked: behaviour in Chrome. No run on the owner's PC was done. The word UNVERIFIED marks such statements.

## How to keep the map correct

- If the code and the map disagree, the code is correct.
- When a pull request changes a fact in the map, correct the owner document in the same pull request.
- Do not add line numbers. Refer to a function, a constant or a file that a text search finds.
- Do not repeat a table of a different document. Refer to it.
- After a release or a large change, read the map against the code again, and update the date and the commit in each document.
- These files are not in the release zip.
