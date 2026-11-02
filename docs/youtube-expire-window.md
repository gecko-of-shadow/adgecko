# YouTube `videoplayback?expire=` window

uBlock Origin's YouTube filters include a decoy rule (it ends up as rule 3 in
`src/rules/ubo-youtube-network.json`). It blocks
`*.googlevideo.com/videoplayback?expire=<n>&...` requests made from
`www.youtube.com` whenever `<n>` (an expiry time in epoch seconds) falls outside a
small allowed window. Real video links expire about 6 hours after they are issued,
so the window must always include "now".

## Why a plain re-sync is not enough

Upstream (uAssets) only moves the window after real links start failing. The last
bump (2026-05-30) landed about 34 hours after the crossing. The window shipped up to
uAssets@205b212 is:

```
(?:[02-9]\d+|1[1-68-9]\d+|17[1-7]\d+)
```

It blocks every real link from `expire=1800000000` (2027-01-15 08:00 UTC; links
issued from about 02:00 UTC that day). Re-running the sync on that day would still
ship the broken window.

## What the generator does

`scripts/sync-ubo-youtube.mjs` passes the converted rules through
`widenYoutubeExpireWindow()` in `scripts/lib/youtube-expire-window.mjs` before it
writes the rule file:

- Known upstream window: rewritten to `(?:[02-9]\d+|1[1-6]\d+|17[1-7]\d+)`. Values
  starting 0, 2-9, 11-16 and 171-177 stay blocked (the decoys); 10, 170, 178, 179,
  18 and 19 are allowed, i.e. real expiries up to 1999999999 (2033-05-18).
- Already widened: left alone (idempotent).
- Upstream moved its window: whichever of the two blocks a subset of the other is
  kept (the more permissive one).
- Anything else (a new regex shape, two expire rules, a non-block rule, a window
  that is not comparable): the generator stops with an error. Update the module by
  hand; do not ship the rule unchecked.

The change can only allow more requests, never block more.

## Tests

`test/ubo-youtube.test.js` checks the shipped rule for every day from today
through 2033-05-01 (expiry = that day + 6 h must not be blocked), that the decoys
`0123456789`, `1234567890`, `1750000000` and `2500000000` are still blocked, that
the post-processing is idempotent and allow-only, and that unrecognised shapes
throw.

Not verified: whether stock youtube.com playback over SABR (POST requests) is
affected by this rule at all; it only matches GET requests.
