# Handoff

Last update: 2026-11-28.

## State

- Last release: [v0.3.7](https://github.com/gecko-of-shadow/adgecko/releases/tag/v0.3.7), from commit `cc3e764`. The manifest version on `main` is 0.3.7.
- `main` has these changes after v0.3.7. They are not released. See `CHANGELOG.md`, section "Unreleased".
  - PRs 22 to 26 (merged on 2026-11-20).
  - #31, #32 and #34 (merged on 2026-11-27).
  - #35, #36 and #37 (merged on 2026-11-27 and 2026-11-28, owner approved). See the next section.
- Waiting for the owner's merge: #30, then #33. Both wait for the cnn.com popup check.
  - #33 has the base `api-job/site-breakage`. Before you merge it, change its base to `main`, or merge #30 first. Else it merges into the old branch, not into `main`.
  - After #36 and #37, both #30 and #33 have merge conflicts with `main` (a `git merge-tree` check on 2026-11-28). They need `main` merged into them, with the tests and the gate run again, before the merge. In #33, `onStartup` in `src/general-background.js` conflicts with #37.
- UNVERIFIED: the behaviour of 0.3.7 in the owner's signed-in Chrome, and every change after it in any real Chrome.

## Last session (2026-11-27 evening to 2026-11-28): three PRs merged

| PR | What it does |
|---|---|
| #35 | The release gate writes the Deno log of section 5 to its own temporary file for each run (owner approved the gate change). The proposal file `docs/proposals/gate-deno-log.patch` stays as the record. |
| #36 | The 26 commits of a bot branch (`improve/adgecko-2026-11-27`): list exceptions become allow rules, hide rules in frames, clipboard guard patterns, settings and popup changes, a Chrome smoke script. Plus 5 fix commits from a multi-agent review: no allow rule under a `$important` block or for an exception that `$badfilter` withdraws; the frame hide sheet follows the top site's Allow and `$generichide`; fewer clipboard false blocks (`ping -w 1`, Poetry, get-pip); two timing tests wait on a condition; the version is 0.3.7 again (the bot had set 0.3.8 without a release decision). |
| #37 | The packer writes `importantScoped` and `cancelAllow` into `src/rules/packed-cross.json` (8 new AdGuard Base hosts). `applyGeneralState` writes the user's threat allow-domain override first, before the packed ruleset load. `@@||host^$badfilter` also stops the same-host lift. |

Checked: on each PR, before the merge, the Deno suite (#36: 953 passed; #37: 962 passed; 0 failed), the release gate (`VERDICT: CLEAN`), the privacy check and CI. Independent reviewers checked #36 and #37; for #37 they found only nits.

Not checked: any of this in real Chrome; CI on `main` after the last merge.

Known nits (not fixed):
- `onInstalled` writes the threat override two times. This is harmless.
- The `onInstalled` test in `test/threat-allow-before-packed-allows.test.js` also passes with the old order.
- `@@||host^$important,badfilter` also withdraws a plain `@@||host^`, because `$important` is an ignored option. No current list has such a line.
- `scripts/pack-filter-lists.py` has no `--help` and no offline check mode. Any run, also with `--help`, downloads the lists and rewrites `src/rules/`. A review agent did this by mistake in a review worktree and restored the files.

## Earlier session (2026-11-27, afternoon): three owner decisions built

The owner gave three answers on 2026-11-27:

| Item | Answer | Result |
|---|---|---|
| PR 30: an unanswered **Test with the ad lists off** | End it after 24 hours. | The code already did this (`73c462f`). The decision date is recorded (`c1365df`), and `origin/main` is merged into the branch. Not merged: the cnn.com popup failure is still open. |
| Header comment of `src/youtube.js` | The owner let the agent decide. | PR #32 corrects the comment. The SABR backoff, the start-buffer wait and the no-ad flag are off by default (`umpBackoff`, `zeroStartPolicies`, `noAdFlag` are false), with or without the uBO layer. Comment only. `src/youtube.js` is not a frozen file: it is not in `PLAYBACK_FILES` or in `scripts/frozen-pins.json`. |
| Owner decision 3: master switch | Yes (Option A). | PR #33, stacked on #30. The master switch now also disables the static `ubo-youtube` DNR ruleset. The lists switch and a per-site Allow do not change it. `onInstalled` and `onStartup` write the state again. |

Also: the owner approved `docs/proposals/gate-deno-log.patch` on 2026-11-27, and it is applied to the gate. Each gate run now writes its Deno log to its own temporary file.

Checked, on each branch: the Deno suite (PR 30: 932 passed; #32: 906 passed; #33: 936 passed; 0 failed on each), the release gate (`VERDICT: CLEAN`) and the privacy check. For #33: the new tests failed before the code change and pass after it, and three independent reviewers found no blocker. The proposal patch applies with `git apply --check`.

Not checked: any of these changes in real Chrome; the `ubo-youtube` state after a real extension update; YouTube in the mixed state (uBO scriptlets on, network rules off).

Known gap in #33: when the write of the ruleset fails, no timer retries it. The next sync (worker start, a settings change, install, update or browser start) tries again.

Flaky runs, seen under load (other Deno runs were active on the PC): one full Deno run on #33 and one on this handoff branch each had 3 failures. On #33 the build agent traced them to an uncaught timer error in `test/race.test.js`; the names of the second run's failures were not read. Each rerun passed. The 6 ignored tests depend on the environment (list cache, zip tool, gate tools, Windows).

## Earlier session (2026-11-27, morning): YouTube slow start

YouTube's server sends a "wait" reply (4,000, 8,800 or 12,000 ms) on a direct watch load when the ad is removed. The owner accepted the wait. Details: `docs/youtube-slow-start.md` (PR #31). The raw bench data is in `adgecko-ab/slow-start-2026-11-27`, outside the repository; it holds video links with network addresses, so do not copy it into the repository.

## Open

- Scratch items outside the repository: the folder `adgecko-ab` with the worktrees `v036` and `v037`; the Chrome for Testing profiles `yt-bench-*` in the user's temporary folder; the review worktree `adgecko-wt-pr37review` and this handoff worktree `adgecko-wt-handoff2` next to the repository folder. Remove them only with the owner's approval. The six worktrees of 2026-11-27 were removed with the owner's approval.
- Merged branches that are still on GitHub: `fix/gate-deno-log`, `improve/adgecko-2026-11-27`, `fix/grok-review-2026-11-27`, `fix/packed-cross-and-threat-order` and the branches of #31, #32 and #34.
- Old branches and worktrees from earlier sessions: `docs/cleanup-2026-11-16`, the merged branches of PRs 21 to 26, `.claude/worktrees/wf_15df4964-f50-*`, `adgecko-docs-wt`. Remove them only with the owner's approval.

## Next steps

1. The owner: the cnn.com popup check for PR 30 (steps 5 and 6). Then merge #30, and then #33.
2. The owner: the signed-in YouTube test in `TODO.md`, section 0, and Kick and Twitch in real Chrome (`TODO.md`, section 1). Also the new hide rules in frames and the clipboard guard changes of #36.
3. Release 0.3.8 from `main` when the tests are done.
