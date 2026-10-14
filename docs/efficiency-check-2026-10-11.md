# Efficiency check — twitch-adblock 0.2.12

Measured 2026-10-11 against beta tip `5b9ac39` (tag `v0.2.12`) in headless Chrome 154.0.8037.92. The extension was loaded unpacked. Pages were local fixtures served over HTTPS so the real content scripts ran (`cosmetic.js`, directory hide, YouTube `JSON.parse` hook). This was not a live Twitch or YouTube session.

## Result

Pages stayed responsive. Nothing hung, and nothing leaked across reloads or tab close. The standing cost is about **125 MB** of Chrome memory and one extra process. The only main-thread tax that shows up is the YouTube response walk: a **1.2 MB** ad-bearing payload peaked at **29 ms**. Ordinary sites pick up the cosmetic stylesheet in about **20 ms**.

## Load time

| Surface | Without extension | With 0.2.12 |
|---|---|---|
| Ordinary page, DOMContentLoaded | 12 ms | 14 ms |
| Ordinary page, load | 13 ms | 16 ms |
| Cosmetic stylesheet applied (63,872 chars) | — | 20 ms |
| 12 iframes, each with the stylesheet | — | 100 ms for all 13 documents |
| Twitch directory fixture, DOMContentLoaded | 10 ms | 21 ms |
| Service worker visible after load | — | 195 ms |
| Ruleset `general` enabled | — | yes, 0 dynamic allows |
| V8 compile of each script | — | 0.1–0.5 ms |
| Parse of `general-network.json` (2.2 MB, 1,251 rules) | — | 9 ms, 4.6 MB retained in V8 |

Cosmetic CSS is 4,004 selectors, almost all IDs. It has no `:has()`, no universal selector, and 3 attribute selectors. That is why a 1,500-node page does not stall when it lands.

YouTube's home-feed hide rule uses 10 `:has()` selectors. Those run only on YouTube. This fixture's DOM was too small to time them on their own.

## Drag on the system

Idle Chrome RSS was **1,083 MB** without the extension and **1,208 MB** with it (**+125 MB**, **+1 process**). The gap stayed in the same band after a page open, 12 iframes, and six reloads (about 115–130 MB). It did not climb.

Main thread, same fixture with and without the extension:

| Work | Without | With | What it means |
|---|---|---|---|
| YouTube `JSON.parse`, 1.16 MB, no ad markers, 3 runs | 2.4–3.1 ms | 8.0–8.9 ms | Hook scans the text. About +6 ms. |
| YouTube `JSON.parse`, 1.16 MB, ads present, 3 runs | 2.1–2.8 ms | 17.2 / 29.1 / 17.2 ms | Clone and walk. Peak **29 ms**. No 50 ms long task. |
| YouTube `JSON.parse`, 294 KB, ads present | 0.6 ms mean | 8.8 ms mean, max 11.5 ms | Same path, smaller body. |
| Twitch directory, 12,000 cards, 25 mutation bursts | steady ~4.2 ms, one 80 ms first layout | steady ~4.2 ms, one 68 ms first layout | Directory script was live: banner `display` became `none`, hide stylesheet present. The full-document observer did not add time. |
| Smaller directory, 1,800 cards, 40 bursts | mean 3.8 ms, max 11.4 ms, 0 long tasks | mean 4.0 ms, max 11.4 ms, 0 long tasks | Same. |
| React-tree walk model, 21,845 fibers (video-swap's uncached player search) | — | mean 0.2 ms, max 0.7 ms | The 1-second live monitor is this walk. Cheap at this size. |
| DNR block of `101com.com`, 20 fetches | fail in 141 ms mean (network) | fail in **0.6 ms** mean, max 2.2 ms | Block list is faster than a dead connection. |
| Allowed request to the local server | 1.2 ms mean | 1.3 ms mean | Allowed traffic is unchanged. |

Rules are `requestDomains` only: 99,745 domain entries, 80 per rule, **zero** `regexFilter` and **zero** `urlFilter`. Matching stays on Chrome's domain path.

A 294 KB bench that parsed 26 bodies back-to-back in one turn produced a single **105 ms** long task. Split apart, each parse stays in the times above. One real player response is one parse.

## Memory leaks

Ordinary-page JavaScript heap after garbage collection:

- Without extension, six reloads: **456,660 bytes** every time.
- With extension, six reloads: **809,348 → 811,396 → 809,348 → 809,348 → 811,396 → 809,348**. Flat. The extra ~350 KB is the page plus the 64 KB stylesheet (`backingStorageSize` 71,042).

Process RSS after those reloads did not rise above the single-page cost. Closing the worker-test tab returned RSS to the pre-tab level on both sides (within 2 MB).

Eight Twitch-origin `Worker`s were constructed and then dropped:

- The video-swap hook was installed (`Worker` was no longer the native function).
- Process count went up by 1 for the tab, then back down when the tab closed. Same shape with the extension off.
- Those fixture workers exited. This run did not keep eight live threads.

The vendor script still pushes every wrapped worker onto `twitchWorkers` and never removes it, and it never revokes the blob URL. `AdSegmentCache` does expire entries after 120 seconds. That worker array is the retain to remember if a real Twitch worker stays alive after the page drops it. It did not show up as leftover RSS here. `video-swap-new.user.js` is the upstream file the gate keeps aligned with `main`; this check did not edit it.

## Hangs

No busy-wait and no stuck load turned up.

- Partial UMP input returns in 0.3 ms. The parser's read loop stops when it needs more bytes.
- A 2,000-deep ad JSON walks in 8 ms and strips. An 8,000-deep JSON throws `RangeError` in 6 ms. The page hook catches that and leaves the original value. It does not spin.
- Directory and YouTube observers did not push a mutation burst over the 50 ms long-task line. YouTube's observer is already tied to one animation frame. The directory observer is not; on this 12,000-node DOM that still cost nothing measurable.
- Kick's cover observer is coalesced to one frame and only reacts to added iframes, video, and ad controls. It was not given its own timing pass.
- Debug's banner observer watches the whole Twitch tree, including attributes, and only while debug is on. Default is off. That mode was not timed.

The known black start on some YouTube titles is the player waiting on media (`readyState` 0). The nudge only runs once `readyState` is at least 2, so that stall is not a main-thread spin in this extension.

## What this does not cover

Live `twitch.tv` / `youtube.com` pages, shadow DOM, and a real multi-megabyte browse response. A 3 MB ad-bearing JSON body would scale past the 29 ms measured at 1.2 MB and could cross into one long task. The directory observer is still uncoalesced; a heavier live directory than 12,000 plain nodes could show up even though this fixture did not.
