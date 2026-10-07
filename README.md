# twitch-adblock

A Chrome extension that blocks video ads on Twitch. When a live playlist contains stitched ads, it asks Twitch for an autoplay stream (Android platform), then a picture-by-picture stream, and then an embed stream. The page's own token is requested as the popout player. A picture-by-picture token from the page is dropped so a second player does not open above chat. Backup tokens use the original fetch.

Twitch stitches ads into the HLS playlist the player is already reading. During the break this extension answers that playlist with the parallel ad-free stream at the same quality, so the live video keeps playing. When the main stream is clean again, the player reloads onto it. If every backup stream still contains ads, the ad segments are removed and the last live frame is repeated.

## Known limits

- The player reloads once when a midroll starts and once when it ends. The picture can hitch, and the backup stream can be a different quality.
- While a backup is playing, one preroll segment is fetched in the background so Twitch can finish the pod. Midroll segments are left alone.
- A background tab is reported as visible so Twitch does not pause the stream during the break.
- Run this by itself. Turn off the uBlock `twitch-videoad` filter first. Two Twitch ad scripts on the same page fight over the player.
- Twitch changes token and playlist shapes without notice. Playback has to go through `fetch` in the page or the player worker.

## Load it

1. Open `chrome://extensions`.
2. Turn on Developer mode.
3. Choose **Load unpacked** and select this folder.
4. Open a live Twitch channel.

The toolbar icon says the filter is active. A small "Blocking ads" label appears on the player while an ad break is being skipped.

Playlist checks:

```
deno test --no-lock test/playlist.test.js test/page.test.js test/swap.test.js
```
