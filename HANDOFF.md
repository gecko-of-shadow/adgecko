# Handoff

Last update: 2026-11-20.

## State

- Version 0.3.7 is released: [v0.3.7](https://github.com/gecko-of-shadow/adgecko/releases/tag/v0.3.7), from commit `cc3e764` (= `main`). Assets: `adgecko-0.3.7.zip` and `adgecko-0.3.7.zip.sha256`.
- The local branch `main` is old (`6e0caf8`) and can fast-forward to `origin/main`. Before new work, run `git fetch origin main:main` and then `git switch main`. Untracked `_metadata/` is made by Chrome; do not commit it.
- UNVERIFIED: the behaviour of 0.3.7 in the owner's signed-in Chrome.
- The record of the 0.3.6 work session is in `docs/review-2026-11-16/RESULTS.md`.

## Last sessions (2026-11-20): is YouTube worse in 0.3.7 than in 0.3.6?

The owner asked this question. A cloud session read the code and listed the changes and the suspects, but stopped before a browser test. A session on the owner's PC then did the A/B test.

Result: no regression was found. All differences on the agreed metric were inside the noise. No 0.3.8 fix was made.

### What changed for YouTube from v0.3.6 to v0.3.7

From `git diff v0.3.6 v0.3.7 -- src/ scripts/`. In `src/`, only YouTube files changed.

1. uBlock Origin filters: uAssets `e140ffc` to `900a2a3` (`src/vendor/ubo-youtube*.js`, `ubo-youtube-meta.json`). The start recovery payload (`rpnt`, in `src/vendor/ubo-youtube-isolated.js`) has a new upstream guard (`!r&&`) in its stall check. The payload now also runs on `www.youtube.com/embed/` pages, with the step list `channel, eafg`. There are three new `trusted-edit-inbound-object` filters for embedded players.
2. Local patch (`ARG_PATCHES[0]` in `scripts/sync-ubo-youtube.mjs`): when the step list is empty and the address shows a different video, the list starts again (the "gk"/"gkv" code).
3. Local patch in `editInboundObjectFn`: the root-key guard reads a dotted filter (`[?.a.b.c]`). This code runs on each `JSON.stringify` call.
4. `src/youtube.js`: a new snackbar guard hides the "Experiencing interruptions?" message in `snackbar-container` with `visibility: hidden`. It adds two `MutationObserver`s.

Suspects A to E below: A = item 2, B = the `!r&&` guard in item 1, C = item 4, D = item 3 (CPU), E = a change on the YouTube side.

### A/B test on the owner's PC

The full record with all numbers is in the scratch folder `adgecko-ab`, next to the repository folder (not in the repository): `RESULTS.md`, the raw data (`bench.json`, `chain.json`, `chain-persist.json`, `chain-swap.json`), and the scripts `chain.mjs` and `analyze.mjs` (`node analyze.mjs --bench bench.json --chain chain.json`).

Test set-up: Chrome for Testing 155, headless, not signed in. Four variants: no extension, v0.3.6, v0.3.7, and "noA" (v0.3.7 without the "gk"/"gkv" restart of the recovery list, suspect A).

| Test | Metric | v0.3.6 | v0.3.7 | noA | v0.3.7 - v0.3.6 (95 % interval) |
|---|---|---|---|---|---|
| `scripts/bench-youtube.mjs`, 12 runs | watch page to playing, median | 10,632 ms | 6,163 ms | 6,137 ms | -4,469 ms (-8,164 to +4,031), p = 0.26 |
| same | one related click to playing, median | 2,314 ms | 2,361 ms | 2,506 ms | +47 ms (-586 to +1,194), p = 0.85 |
| Chain test: 5 related clicks in one tab, 10 valid runs | median of clicks 1 to 5, median over runs | 1,655 ms | 1,683 ms | 1,646 ms | +27 ms (-136 to +150), p = 0.77 |
| same | timeouts | 0 | 0 | 0 | |
| same | recovery reloads (`loadVideoById`) | 59 | 61 | 67 | |
| same | interruptions popup: in the page / visible | 17 / 17 | 19 / 0 | 12 / 0 | |
| Chain test, one persistent visitor profile per variant, 12 runs | median of clicks 1 to 5 | 1,084 ms | 1,204 ms | 1,319 ms | +120 ms (-96 to +228), p = 0.14 |
| Profile swap: each version on each of two visitor profiles, 8 runs per arm | same metric, same profile | | | | +113 ms (-120 to +283) and -242 ms (-539 to +226) |

The persistent-profile test cannot separate the version from the visitor. On the same visitor profile, the swap test showed no consistent effect of the version on time to play. The stall rate of one profile changed by a large amount within one hour (a reload in 8 of 12 runs, then in 3 of 8). The evidence for an equal stall rate in all versions is the fresh-profile test (59, 61 and 67 reloads). The p-values are permutation tests on the difference of medians.

What the tests showed about the suspects:

- A (the "gk" restart): not reached in any chain run. The recovery list never became empty, so v0.3.7 and noA behaved the same. These tests cannot show the effect of A. A tab where all recovery steps fail is necessary, and a signed-out session did not give one. UNVERIFIED, from code reading: when all steps fail on one video, v0.3.7 starts the list again on each new video (up to 4 more reloads, approximately +1.7 s per video), and then stops as v0.3.6 does.
- B (upstream `!r&&` guard): on the first stalled video after a fresh list, v0.3.7 makes one more reload than v0.3.6 (marker order `channel, yahi, inline, oaeb` against `channel, yahi, oaeb`; v0.3.6 skips `inline`). That video took approximately 0.5 s longer (noA - v0.3.6: +561 ms, interval +260 to +938; v0.3.7 - v0.3.6: +510 ms, interval -774 to +1,035). UNVERIFIED: from the code, this cost comes again after each return from a non-watch page. It is an upstream change and was not part of the agreed metric. A revert could bring back the 0.3.6 case in which markers are dropped too fast.
- C (popup hidden): confirmed. In v0.3.7 the popup is in the page but not visible. The stall itself is the same.
- D (CPU): no difference.
- E (a change on the YouTube side): cannot be excluded for a signed-in account.

All three extension variants had a stall on most related videos in the fresh-profile test (usually 1 reload, approximately 1.6 s to playing, against 0.8 s with no extension). This is the same in v0.3.6 and v0.3.7. Direct watch-page loads with a persistent profile waited 5.7 to 14.2 s in all versions, with no recovery reload: that wait comes from YouTube. Detection limit of the fresh-profile test: approximately 0.2 s on the median click.

## Checks

Checked in this session:

- The facts in the task: v0.3.6 = `5cd4ab6`, v0.3.7 = `cc3e764` = `main`; only YouTube files changed in `src/`.
- The variant noA: the two texts were removed one time each. Two "gk" hits stay in the file: `Symbol.for("gk.ui")`, the load guard that v0.3.6 also has. `node --check` passed.
- Each reload that the chain test counted came from the inline rpnt payload (call stack). The `/player` request count agreed with the `loadVideoById` count on 171 of 180 clicks; on the other 9 YouTube sent one more request by itself.
- No consent page and no bot block. Four v0.3.6 runs (two fresh-profile, two persistent-profile) stopped at a video that needs sign-in or payment; with no extension, the same videos are not playable either. One seed video gave no plain related link in two rounds; it was removed for the later tests.
- Three independent review agents tried to refute the result. All three found that it holds. Their corrections (wording, the sum metric, the detection limit, the profile confound) are in `RESULTS.md`.

Not checked:

- Signed-in YouTube. The owner's problem (black screen of 6 to 21 s, `CHANGELOG.md`, section 0.3.7) was seen on a signed-in account. No related click in the fresh-profile chain test had it (the longest was 4.7 s, v0.3.6). In the persistent-profile tests, one v0.3.6 related click waited 8.3 s with no reload, and direct loads waited up to 14.2 s in all versions.
- Branded Chrome and a headful window.
- The three new embedded-player filters (no embedded player was tested).
- The release gate, the tests and the privacy check: nothing was committed, so they were not run.

## Open

- Scratch items made by this session, outside the repository: the folder `adgecko-ab` and the two git worktrees in it (`v036`, `v037`), and the Chrome for Testing profiles `yt-bench-none`, `yt-bench-v036`, `yt-bench-v037`, `yt-bench-noA` in the user's temporary folder. Remove them only with the owner's approval: `git worktree remove` for each worktree, then the folders.
- The old branch `docs/cleanup-2026-11-16` of the closed pull request 16 is not deleted.

## Next steps

1. The owner: the signed-in YouTube test in `TODO.md`, section 0.
2. The owner decisions: `TODO.md`, section 2.
