# twitch-adblock

A Chrome extension that blocks video ads on Twitch.

## Features

- Blocks Twitch live midrolls.
- Keeps the live video playing through the break.
- Asks Twitch for a backup stream in this order: autoplay (Android), picture-by-picture, then embed.
- Does not open a second player above chat.
- If every backup stream still has ads, strips those ads and holds the last live frame.

## Install

1. Download [twitch-adblock-0.1.5.zip](https://github.com/gecko-of-shadow/twitch-adblock/releases/download/v0.1.5/twitch-adblock-0.1.5.zip).
2. Unzip it.
3. Open `chrome://extensions`.
4. Turn on Developer mode.
5. Choose **Load unpacked** and select the unzipped folder (the one that contains `manifest.json`).
6. Turn off the uBlock filter `twitch.tv##+js(twitch-videoad)` while this extension is loaded.

The toolbar icon says the filter is active. A small "Blocking ads" label appears on the player while an ad break is being skipped.

## Known limits

- The player reloads once when a midroll starts and once when it ends. The picture can hitch, and the backup stream can be a different quality.
- While a backup is playing, one preroll segment is fetched in the background so Twitch can finish the pod. Midroll segments are left alone.
- A background tab is reported as visible so Twitch does not pause the stream during the break.
- Twitch changes token and playlist shapes without notice. Playback has to go through `fetch` in the page or the player worker.

Playlist checks:

```
deno test --no-lock test/playlist.test.js test/page.test.js test/swap.test.js
```
