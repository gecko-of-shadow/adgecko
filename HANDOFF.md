# Handoff

Last update: 2026-11-20.

## State

- Last release: [v0.3.7](https://github.com/gecko-of-shadow/adgecko/releases/tag/v0.3.7), from commit `cc3e764`.
- `main` has five changes after v0.3.7 (PRs 22 to 26, merged on 2026-11-20). They are not released. See `CHANGELOG.md`, section "Unreleased".
- The local folder is on `main`. Untracked `_metadata/` is made by Chrome; do not commit it.
- UNVERIFIED: the behaviour of 0.3.7 in the owner's signed-in Chrome, and the Kick and Twitch changes in any real Chrome.
- New: a plan to put the Adgecko jobs on an Android phone: `docs/android/PLAN.md`. The evidence is in `docs/android/research-2026-11-17.md`. No Android code exists yet.
- A cloud build session does milestone 1 of the plan (the DNS shield). Its result comes in its own draft pull request.

## Last session (2026-11-20): five owner decisions built

The owner approved five items. Each one was built on its own branch, reviewed by an independent agent and by Greptile, and merged:

| PR | Change |
|---|---|
| #22 | Owner decision 16: a named exception for `ads.youtube.com` in the stream-host oracle test. No runtime change. |
| #23 | Owner decisions 5 and 7: EasyList under GPL-3.0-or-later. The project `LICENSE` ships in the zip as `src/LICENSE.txt`. |
| #24 | `ads.twitch.tv` and its subdomains are blocked by the extra tracker rule. A second named exception in `test/dnr.test.js` allows only that rule. |
| #25 | `src/rules/cosmetic-sample.json` is deleted (owner approved). |
| #26 | Owner decision 1: `docs/proposals/kick-0.3.5-fixes.patch` is applied to the frozen `src/kick.js`. The pin is updated. The Kick switch-off test was made stricter after a Greptile comment. |

The A/B test of 0.3.6 against 0.3.7 (earlier the same day) is in `docs/youtube-ab-test-2026-11-20.md`.

## Checks

Checked in this session:

- Each branch: the full Deno suite (0 failed), the release gate and the privacy check, before the merge. CI on GitHub passed on each PR.
- #26: the gate failed on the branch only in section 1b ("playback files must not change"). This is by design for an approved change of `src/kick.js` (`CONVENTIONS.md` section 9).
- The new Kick tests fail on the old `kick.js` and pass on the new one. The Twitch exception is necessary: without it the oracle test fails on the extra tracker rule.
- After the merges, on `main` (`40948cc`): the release gate on this PC gave `VERDICT: CLEAN` (907 passed, 0 failed, 5 ignored; package 7,646,955 bytes; storage budget peak 8,152,711 bytes). CI on `main` passed.

Not checked:

- Kick on kick.com and Twitch (live, VOD, clips) in real Chrome with the new changes.
- A real release zip of these changes in Chrome.

Found: `scripts/release-gate.sh` writes the Deno log to a fixed path, `/tmp/gate-deno.txt`. Two gate runs at the same time on one PC can mix their logs, and the gate can then report "deno reported failures" although the tests passed. This happened once in this session. Not fixed (the gate needs owner approval).

## Android plan session (2026-11-17)

Research and documents only. No file in `src/`, `scripts/`, `test/`, `.github/` or `icons/` was changed, and not `manifest.json`.

1. The owner asked: put all Adgecko jobs on an Android phone, and "think outside the extension".
2. 12 research agents read the code and the web: browsers with extensions on Android, Android WebView, GeckoView, phone-wide DNS blocking, YouTube, Twitch and Kick on phones, native stream playback, link and text guards, and one list service for several devices.
3. 3 designers proposed plans. 2 judges scored them. 1 agent merged the winner ("Adgecko Shield") with the best parts of the others. 1 agent checked the facts of the merged plan.
4. New files:
   - `docs/android/PLAN.md`: the plan. Milestone 1 is a native Android app with a local DNS filter for all apps, built from the data in `src/rules/`. The task list for the build session is in its section 13.
   - `docs/android/research-2026-11-17.md`: the research record (a script made it from the agent results).
5. A new cloud session started to build milestone 1.

### Checks of that session

Checked in that session (Linux container):

- The research agents marked each fact "checked" or "not checked". The record keeps these marks.
- Build tools in the container: JDK 21 and Gradle 8.14.3 are installed. The Android SDK manager lists packages from Google's server. GeckoView, Google Maven and Firefox downloads answer. The container has no KVM, thus no Android emulator.
- YouTube, Twitch, Kick and the list hosts answer from the container.
- `deno test`, `bash scripts/release-gate.sh` and `python3 -I scripts/privacy-check.py`: see the pull request of this session.

Not checked:

- UNVERIFIED: all behaviour on a phone. No Android code was built or run.
- The phone model and the daily browser of the owner are not known. The plan assumes a modern Android phone (Android 13 to 16).

## Open

- Scratch items made by this session, outside the repository: the folder `adgecko-ab` and the two git worktrees in it (`v036`, `v037`), and the Chrome for Testing profiles `yt-bench-none`, `yt-bench-v036`, `yt-bench-v037`, `yt-bench-noA` in the user's temporary folder. Remove them only with the owner's approval: `git worktree remove` for each worktree, then the folders.
- The old branch `docs/cleanup-2026-11-16` of the closed pull request 16 is not deleted.
- The merged branches of PRs 21 to 26 are not deleted on GitHub. The five session worktrees in `.claude/worktrees/wf_15df4964-f50-*` and the docs worktree `adgecko-docs-wt` next to the repository folder are not removed. Remove them only with the owner's approval.

## Next steps

1. The owner: the signed-in YouTube test in `TODO.md`, section 0.
2. The owner: test Kick and Twitch in real Chrome with `main` (`TODO.md`, section 1).
3. Release 0.3.8 from `main` when the tests are done.
4. The owner decisions that stay open: `TODO.md`, section 2, and `docs/android/PLAN.md`, section 9.
5. Android, owner tasks with no code (`docs/android/PLAN.md`, section 5): give the phone facts, and try the unchanged extension in Vivaldi for Android (Load unpacked).
6. Android milestone 1: review the draft pull request of the build session. Then install the debug APK with adb (`docs/android/PLAN.md`, section 6.10).
