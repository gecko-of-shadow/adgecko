# Instructions for coding agents

## Read first

1. `HANDOFF.md`: the current state and the last session.
2. `TODO.md`: the next work and the open owner decisions.
3. The codebase map in `.planning/codebase/`. Read only the documents that your task needs:

| Task | Read |
|---|---|
| Each code change | `ARCHITECTURE.md`, `CONVENTIONS.md` |
| Find a file, add a file | `STRUCTURE.md` |
| Filter lists, downloads, the signed feed, CI | `INTEGRATIONS.md` |
| Tools, scripts, Chrome APIs, vendored code | `STACK.md` |
| Add or change a test, a check fails, edit a document | `TESTING.md` |
| Select the next work | `CONCERNS.md` |
| Android Shield (`android/`, `scripts/*android*`) | `ARCHITECTURE.md` section 18, `docs/android/PLAN.md`, `docs/android/shield.md` |

If the code and the map disagree, the code is correct. Then correct the map in the same pull request.

## Rules of this repository

- There is no build step. Chrome loads the repository root.
- Do not edit the frozen files `src/vendor/video-swap-new.user.js` and `src/kick.js`, the pins in `scripts/frozen-pins.json` or the release gate without the owner's approval.
- Do not edit generated files by hand. `CONVENTIONS.md` section 8 names each generator.
- Do not write absolute paths, e-mail addresses, real IP addresses, tokens or names of persons in a file or a commit message. `scripts/privacy-check.py` scans each change, and a commit message cannot be corrected after a push.
- Tests read some sentences in `README.md` and `docs/`. Read `TESTING.md` section 7 before you edit a document.
- Mark each claim about behaviour in Chrome as UNVERIFIED until a run on the owner's PC proves it.
- Do not delete a file without the owner's approval.

## Before each push

Run these commands from the repository root. All three must pass.

```bash
deno test --no-lock --allow-read --allow-run --allow-env test/
```

```bash
bash scripts/release-gate.sh
```

```bash
python3 -I scripts/privacy-check.py
```

After a change below `android/`, in `scripts/*android*`, in `test/fixtures/android/` or in `src/rules/`, also run the Android build (JDK 21, Deno and the Android SDK with `ANDROID_HOME`; details in `docs/android/shield.md`):

```bash
./android/gradlew -p android --no-daemon :shield-core:test :app:testDebugUnitTest :app:lintDebug :app:verifyManifestPolicyDebug :app:assembleDebug :app:assembleDebugAndroidTest :probe:assembleDebug :probe:assembleDebugAndroidTest
```

The last line of the gate must be `VERDICT: CLEAN`. The privacy check compares `origin/main` with `HEAD`, thus run it after the commit. Details and necessary tools: `TESTING.md` section 1.

## At the end of each session

- Update `HANDOFF.md`: state, what was checked, what was not checked, next steps. Keep it short. Long records go to `docs/`.
- Update `TODO.md` and `CHANGELOG.md` if your work changes them.
