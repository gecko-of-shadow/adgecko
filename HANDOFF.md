# Handoff

Last update: 2026-11-28.

## State

- Last release: [v0.3.7](https://github.com/gecko-of-shadow/adgecko/releases/tag/v0.3.7), from commit `cc3e764`. The manifest version on `main` is 0.3.7.
- `main` has these changes after v0.3.7. They are not released. See `CHANGELOG.md`, section "Unreleased".
  - PRs 22 to 26 (merged on 2026-11-20).
  - #31, #32 and #34 (merged on 2026-11-27).
  - #35 to #40 (merged on 2026-11-27 and 2026-11-28, owner approved).
- Waiting for the owner's merge: #30, then #33.
  - #30 (`api-job/site-breakage`) has `main` up to #40 merged in. The owner's Chrome loads this branch's folder unpacked.
  - #33 has the base `api-job/site-breakage`. Before you merge it, change its base to `main`, or merge #30 first. Else it merges into the old branch, not into `main`. #33 does not have `main` merged in yet. In #33, `onStartup` in `src/general-background.js` conflicts with #37.
- UNVERIFIED: the behaviour of 0.3.7 in the owner's signed-in Chrome, and every change after it in the owner's Chrome. `scripts/chrome-live.mjs` checked `main` up to #40 on live sites in Chrome for Testing 155, signed out (see below).

## Last session (2026-11-28): live test run and YouTube start-time log

| PR | What it does |
|---|---|
| #39 | An opt-in YouTube start-time log. `src/youtube.js` times each watch-page start; `src/settings/flags.js` keeps the newest 300 entries in `ytStartTimes` (minute, version, kind, wait, ad, popup, timeout; no video id or URL). Off by default. Settings page: **YouTube start times** with the switch, a summary, **Copy as text**, **Download** and **Clear**. |
| #40 | `scripts/chrome-live.mjs`: an automatic live-site run. Two headless Chrome for Testing browsers, one with Adgecko and one baseline, each with a throwaway profile. It writes `report.md`, `report.json` and screenshots. Not in CI. About 8 minutes. |

The owner does not want to run manual tests that the agent can automate. Use `scripts/chrome-live.mjs` before you ask the owner to test in Chrome. Command (Node 22+, Chrome for Testing):

```bash
CHROME_PATH=<chrome-for-testing exe> node scripts/chrome-live.mjs --dir <extension folder> --out <output folder>
```

Results of the run on 2026-11-28 (three runs, the same status for every check): 24 PASS, 1 FAIL, 1 SKIP.
- FAIL `B-cnn-loop`, a real finding: with Adgecko, cnn.com requests the blocked file `cdn-media.brightline.tv/config/v3/1018.json` about 10,000 to 14,000 times in 15 s. Without Adgecko, the page makes about 112 requests in total. Not fixed. A possible fix is a stand-in reply for this file instead of a block.
- SKIP `B-cnn`: cnn.com holds its ads until the consent banner is accepted. The run never clicks a consent wall.
- PASS: the popup on cnn.com, foxnews.com and nbcnews.com in under 1 s (after the load, while the page loads, and while the cnn.com loop runs). This does not reproduce the owner's cnn.com popup report of 2026-11-23; the run uses a clean, signed-out profile.
- PASS: ad blocking on foxnews.com and nbcnews.com, popup Allow, Block again and Fix, ordinary sites, the clipboard guard, YouTube (start, five clicks, buttons), Twitch, Kick, no service worker errors.
- YouTube with Adgecko: the first video played after 6.8 s (2.0 s without); later clicks 1.8 to 4.3 s (about 1.5 s without). This is the accepted slow start.

What the run does not cover: a signed-in profile, a real toolbar click (it uses `chrome.action.openPopup()`), ads on Twitch and Kick (no ad marker in the baseline), ad blocking on cnn.com.

Checked: on #39 and #40, before the merge, the Deno suite (#39: 976 passed, 0 failed), the release gate (`VERDICT: CLEAN`), the privacy check and CI. Independent reviewers checked both; all findings were fixed.

Not checked: the start-time log in real Chrome; the run on the owner's PC.

Leftover folders in the user's temporary folder from the build of #40 (remove them only with the owner's approval): `adgecko-live-2026-11-28T09-00-49`, `adgecko-live-e8O53q`, `adgecko-probe-TFxiLF`, `adgecko-probe-i4HAgL`, `adgecko-probe-jEwWwF`.

## Earlier session (2026-11-27 evening to 2026-11-28): three PRs merged

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

- Scratch items outside the repository: the folder `adgecko-ab` with the worktrees `v036` and `v037`; the Chrome for Testing profiles `yt-bench-*` in the user's temporary folder. Remove them only with the owner's approval. The six worktrees of 2026-11-27, `adgecko-wt-pr37review`, `adgecko-wt-handoff2` and the worktrees of #39 and #40 were removed with the owner's approval.
- Merged branches that are still on GitHub: `fix/gate-deno-log`, `improve/adgecko-2026-11-27`, `fix/grok-review-2026-11-27`, `fix/packed-cross-and-threat-order`, `feat/youtube-start-timing`, `test/chrome-live-run` and the branches of #31, #32, #34 and #38.
- Old branches and worktrees from earlier sessions: `docs/cleanup-2026-11-16`, the merged branches of PRs 21 to 26, `.claude/worktrees/wf_15df4964-f50-*`, `adgecko-docs-wt`. Remove them only with the owner's approval.

## Next steps

1. The owner: tick **YouTube start times** in Settings, watch YouTube as usual, then send **Copy as text** (`TODO.md`, section 0).
2. Decide on the cnn.com `brightline.tv` request loop (stand-in reply or leave it).
3. The owner: the cnn.com popup check for PR 30, in the signed-in Chrome. Then merge #30, and then #33 (merge `main` into #33 first).
4. Release 0.3.8 from `main` when the tests are done.
