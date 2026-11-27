# Handoff

Last update: 2026-11-27.

## State

- Last release: [v0.3.7](https://github.com/gecko-of-shadow/adgecko/releases/tag/v0.3.7), from commit `cc3e764`.
- `main` has five changes after v0.3.7 (PRs 22 to 26, merged on 2026-11-20). They are not released. See `CHANGELOG.md`, section "Unreleased".
- The local folder is on the branch `docs/youtube-slow-start` (this session). Local `main` is one commit behind `origin/main`. Untracked `_metadata/` is made by Chrome; do not commit it.
- UNVERIFIED: the behaviour of 0.3.7 in the owner's signed-in Chrome, and the Kick and Twitch changes in any real Chrome.

## Last session (2026-11-27): YouTube slow start, documented

The owner reported a long spinner before YouTube videos play. Result: YouTube's server sends a "wait" reply (4,000, 8,800 or 12,000 ms) on a direct watch load when the ad is removed. The blocked decoy and doubleclick requests in the console are not the cause. The owner chose to accept the wait and document it. Details and the rejected fixes: `docs/youtube-slow-start.md`.

Changed: `docs/youtube-slow-start.md` (new), one limit line in `README.md`, `CHANGELOG.md` (Unreleased, Documentation), `TODO.md`, this file. No code changed.

Checked: a headless bench, signed out, n=8 per variant (no extension 2.3 s, `main` 6.3 s median; wait replies in 6 of 8 loads with Adgecko, 0 of 8 without). Three skeptic agents rejected each code fix. The raw data is in `adgecko-ab/slow-start-2026-11-27`, outside the repository; it holds video links with network addresses, so do not copy it into the repository.

Not checked: the owner's signed-in Chrome; that the wait equals the ad length; which signal makes YouTube send the wait.

Follow-up, needs owner approval: the header comment of `src/youtube.js` (lines 4 to 8) says the waits are cleared. That code is off when the uBO layer runs. `src/youtube.js` is a gated playback file, so the comment was not changed.

## Session before (2026-11-20): five owner decisions built

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

## Open

- Scratch items made by this session, outside the repository: the folder `adgecko-ab` and the two git worktrees in it (`v036`, `v037`), and the Chrome for Testing profiles `yt-bench-none`, `yt-bench-v036`, `yt-bench-v037`, `yt-bench-noA` in the user's temporary folder. Remove them only with the owner's approval: `git worktree remove` for each worktree, then the folders.
- The old branch `docs/cleanup-2026-11-16` of the closed pull request 16 is not deleted.
- The merged branches of PRs 21 to 26 are not deleted on GitHub. The five session worktrees in `.claude/worktrees/wf_15df4964-f50-*` and the docs worktree `adgecko-docs-wt` next to the repository folder are not removed. Remove them only with the owner's approval.

## Next steps

1. The owner: the signed-in YouTube test in `TODO.md`, section 0.
2. The owner: test Kick and Twitch in real Chrome with `main` (`TODO.md`, section 1).
3. Release 0.3.8 from `main` when the tests are done.
4. The owner decisions that stay open: `TODO.md`, section 2.
