# Handoff

Last update: 2026-11-17.

## State

- Version 0.3.6 is released: [v0.3.6](https://github.com/gecko-of-shadow/adgecko/releases/tag/v0.3.6), from commit `5cd4ab6`, published 2026-11-16 by the release workflow.
- UNVERIFIED: all behaviour of 0.3.6 in Chrome. The owner asked for the release before the manual tests. The tests are the first item in `TODO.md`.
- New: a plan to put the Adgecko jobs on an Android phone: `docs/android/PLAN.md`. The evidence is in `docs/android/research-2026-11-17.md`. No Android code exists yet.
- A cloud build session does milestone 1 of the plan (the DNS shield). Its result comes in its own draft pull request.
- The next work and the open owner decisions are in `TODO.md`.
- The record of the 0.3.6 work session is in `docs/review-2026-11-16/RESULTS.md`.

## Work done in the last session (2026-11-17)

Research and documents only. No file in `src/`, `scripts/`, `test/`, `.github/` or `icons/` was changed, and not `manifest.json`.

1. The owner asked: put all Adgecko jobs on an Android phone, and "think outside the extension".
2. 12 research agents read the code and the web: browsers with extensions on Android, Android WebView, GeckoView, phone-wide DNS blocking, YouTube, Twitch and Kick on phones, native stream playback, link and text guards, and one list service for several devices.
3. 3 designers proposed plans. 2 judges scored them. 1 agent merged the winner ("Adgecko Shield") with the best parts of the others. 1 agent checked the facts of the merged plan.
4. New files:
   - `docs/android/PLAN.md`: the plan. Milestone 1 is a native Android app with a local DNS filter for all apps, built from the data in `src/rules/`. The task list for the build session is in its section 13.
   - `docs/android/research-2026-11-17.md`: the research record (a script made it from the agent results).
5. A new cloud session started to build milestone 1.

## Checks

Checked in the last session (Linux container):

- The research agents marked each fact "checked" or "not checked". The record keeps these marks.
- Build tools in the container: JDK 21 and Gradle 8.14.3 are installed. The Android SDK manager lists packages from Google's server. GeckoView, Google Maven and Firefox downloads answer. The container has no KVM, thus no Android emulator.
- YouTube, Twitch, Kick and the list hosts answer from the container.
- `deno test`, `bash scripts/release-gate.sh` and `python3 -I scripts/privacy-check.py`: see the pull request of this session.

Not checked:

- UNVERIFIED: all behaviour on a phone. No Android code was built or run.
- The phone model and the daily browser of the owner are not known. The plan assumes a modern Android phone (Android 13 to 16).

## Open from the last session

- The branch `docs/cleanup-2026-11-16` of the closed pull request 16 is not deleted. The owner can delete it on the GitHub Branches page.

## Next steps

1. Test 0.3.6 by hand on the owner's PC: `TODO.md`, section 1.
2. Android, owner tasks with no code (`docs/android/PLAN.md`, section 5): give the phone facts, and try the unchanged extension in Vivaldi for Android (Load unpacked).
3. Android milestone 1: review the draft pull request of the build session. Then install the debug APK with adb (`docs/android/PLAN.md`, section 6.10).
4. The owner decisions: `TODO.md`, section 2, and `docs/android/PLAN.md`, section 9.
