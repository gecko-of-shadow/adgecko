# YouTube: the wait before a video plays

When you open a YouTube watch page directly, a video can show a loading spinner for 4 to 12 seconds before it plays. This page explains why. The owner decided on 2026-11-27 to accept this wait and not to change the code.

## What happens

1. Adgecko removes the ad from the player data, with the uBlock Origin YouTube layer.
2. About 1 second after the page loads, the player asks YouTube for the first part of the video.
3. YouTube sends a short "wait" reply (104 to 105 bytes). The reply tells the player to wait 4,000, 8,800 or 12,000 ms before it asks again.
4. The player shows the spinner until the wait ends. The video plays about 1 second after that.

The wait is set by YouTube's server. It is probably the time that the removed ad would have played (UNVERIFIED). Without an ad blocker, the same time is used to play the ad.

## What does not cause the wait

The browser console shows blocked requests to `googleads.g.doubleclick.net` and blocked `googlevideo.com/videoplayback?expire=...` links. Both are blocked on purpose:

- The `doubleclick.net` requests are ad requests.
- The `videoplayback` links with an expiry far in the future (for example the year 2100) are decoys. YouTube sends them to find out if an ad blocker is active. Rule 3 in `src/rules/ubo-youtube-network.json` blocks them. See `docs/youtube-expire-window.md`.

These requests come after the wait reply, so they do not cause the wait.

## Measurement (2026-11-27)

Headless Chrome for Testing 155, not signed in, `scripts/bench-youtube.mjs`, 8 direct watch-page loads for each variant:

| Variant | Median time to playing | Loads with a wait reply |
|---|---|---|
| No extension | 2.3 s | 0 of 8 |
| Adgecko (`main`) | 6.3 s | 6 of 8 |

The times with Adgecko were in groups near 2.5, 6 and 10.7 s. These groups agree with the three wait values. The loads with no extension had no ad, so 2.3 s is not a fair base: in one load with no extension, a 4,000 ms wait ran while an ad played.

The raw data is not in the repository, because it holds video links with network addresses.

## Fixes that were examined and not made

| Fix | Why it was not made |
|---|---|
| Change the wait value in the video stream to 0 or to a small value | This was shipped before and reverted: the player then asked for video in a fast loop, and starts became slower (5 to 9 s). The 2026-11-27 bench showed the same loop again. It also needs our fetch and XHR hooks, which cost 2 to 3 s for each start when the uBlock Origin layer runs. |
| Do not let the stall watchdog reload during a wait | The gain is 0.2 to 0.5 s in a few loads. It would bring back the 0.2.21 bug in which a video stays at 0:00. |
| Port the uBlock Origin "Experimental" YouTube filters | Upstream suggests them for "fake buffering". In all our tests, the recovery steps never ran out, so a longer list of steps has no proven gain. |
| Unblock the decoy links | The decoys exist to detect ad blockers, and they are not the cause of the wait. |

## Not checked

- The behaviour in the owner's signed-in Chrome.
- That the wait equals the length of the removed ad.
- Which signal makes YouTube send the wait.
