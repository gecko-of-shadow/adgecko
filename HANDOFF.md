# Handoff

Last update: 2026-11-27 (second session of the day).

## State

- Last release: [v0.3.7](https://github.com/gecko-of-shadow/adgecko/releases/tag/v0.3.7), from commit `cc3e764`.
- `main` has the changes of PRs 22 to 26 after v0.3.7 (merged on 2026-11-20). They are not released. See `CHANGELOG.md`, section "Unreleased".
- Five pull requests wait for the owner's merge: #30 to #34. Merge order: #31, #30, #33, #32, #34. A trial merge of all five on `origin/main` in that order had no conflict, and the Deno suite on it gave 936 passed, 0 failed.
- #33 has the base `api-job/site-breakage` and #34 has the base `docs/youtube-slow-start`. Before you merge them, change their base to `main` (or merge their base first and let GitHub retarget). Else they merge into the old branch, not into `main`.
- UNVERIFIED: the behaviour of 0.3.7 in the owner's signed-in Chrome, and the Kick, Twitch, PR 30 and PR 33 changes in any real Chrome.

## Last session (2026-11-27, afternoon): three owner decisions built

The owner gave three answers on 2026-11-27:

| Item | Answer | Result |
|---|---|---|
| PR 30: an unanswered **Test with the ad lists off** | End it after 24 hours. | The code already did this (`73c462f`). The decision date is recorded (`c1365df`), and `origin/main` is merged into the branch. Not merged: the cnn.com popup failure is still open. |
| Header comment of `src/youtube.js` | The owner let the agent decide. | PR #32 corrects the comment. The SABR backoff, the start-buffer wait and the no-ad flag are off by default (`umpBackoff`, `zeroStartPolicies`, `noAdFlag` are false), with or without the uBO layer. Comment only. `src/youtube.js` is not a frozen file: it is not in `PLAYBACK_FILES` or in `scripts/frozen-pins.json`. |
| Owner decision 3: master switch | Yes (Option A). | PR #33, stacked on #30. The master switch now also disables the static `ubo-youtube` DNR ruleset. The lists switch and a per-site Allow do not change it. `onInstalled` and `onStartup` write the state again. |

Also: the fixed gate log path (`/tmp/gate-deno.txt`) has a proposed fix in `docs/proposals/gate-deno-log.patch`. It is not applied, because the gate needs the owner's approval.

Checked, on each branch: the Deno suite (PR 30: 932 passed; #32: 906 passed; #33: 936 passed; 0 failed on each), the release gate (`VERDICT: CLEAN`) and the privacy check. For #33: the new tests failed before the code change and pass after it, and three independent reviewers found no blocker. The proposal patch applies with `git apply --check`.

Not checked: any of these changes in real Chrome; the `ubo-youtube` state after a real extension update; YouTube in the mixed state (uBO scriptlets on, network rules off).

Known gap in #33: when the write of the ruleset fails, no timer retries it. The next sync (worker start, a settings change, install, update or browser start) tries again.

Flaky runs, seen under load (other Deno runs were active on the PC): one full Deno run on #33 and one on this handoff branch each had 3 failures. On #33 the build agent traced them to an uncaught timer error in `test/race.test.js`; the names of the second run's failures were not read. Each rerun passed. The 6 ignored tests depend on the environment (list cache, zip tool, gate tools, Windows).

## Session before (2026-11-27, morning): YouTube slow start, documented

YouTube's server sends a "wait" reply (4,000, 8,800 or 12,000 ms) on a direct watch load when the ad is removed. The owner accepted the wait. Details: `docs/youtube-slow-start.md` (PR #31). The raw bench data is in `adgecko-ab/slow-start-2026-11-27`, outside the repository; it holds video links with network addresses, so do not copy it into the repository.

## Open

- Scratch items outside the repository: the folder `adgecko-ab` with the worktrees `v036` and `v037`; the Chrome for Testing profiles `yt-bench-*` in the user's temporary folder; the worktrees `adgecko-wt-master`, `adgecko-wt-ytcomment` and `adgecko-wt-handoff` next to the repository folder (this session). Remove them only with the owner's approval.
- Old branches and worktrees from earlier sessions: `docs/cleanup-2026-11-16`, the merged branches of PRs 21 to 26, `.claude/worktrees/wf_15df4964-f50-*`, `adgecko-docs-wt`. Remove them only with the owner's approval.

## Next steps

1. The owner: merge #31, #30, #33, #32 and this handoff PR, or say what to change.
2. The owner: the cnn.com popup check for PR 30 (steps 5 and 6).
3. The owner: approve or reject `docs/proposals/gate-deno-log.patch`.
4. The owner: the signed-in YouTube test in `TODO.md`, section 0, and Kick and Twitch in real Chrome (`TODO.md`, section 1).
5. Release 0.3.8 from `main` when the tests are done.
