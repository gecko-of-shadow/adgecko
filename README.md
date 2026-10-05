# twitch-adblock

A Chrome extension that blocks video ads on Twitch. When a live playlist contains stitched ads, it asks Twitch for a mobile-web stream and then an embed stream. The page's own token is requested as the popout player. If those streams still contain ads, the ad segments are removed from the playlist.

Twitch inserts the ads into the live playlist, so this is not a request blocklist. During an ad break the picture can pause, repeat briefly, or drop to another quality. When the main stream is clean again, the player reloads.

Run this by itself. Turn off the uBlock `twitch-videoad` filter first. Two Twitch ad scripts on the same page fight over the player.

## Load it

1. Open `chrome://extensions`.
2. Turn on Developer mode.
3. Choose **Load unpacked** and select this folder.
4. Open a live Twitch channel.

The toolbar icon says the filter is active. A small "Blocking ads" label appears on the player while an ad break is being skipped.

Playlist checks:

```
deno test --no-lock test/playlist.test.js test/page.test.js
```
