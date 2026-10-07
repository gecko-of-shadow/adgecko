# twitch-adblock

A Chrome extension that blocks video ads on Twitch and YouTube. It is always on. There is no popup and no per-site switch.

## Features

- Blocks Twitch live midrolls.
- Keeps the live video playing through the break.
- Asks Twitch for a backup stream in this order: autoplay (Android), picture-by-picture, then embed.
- Does not open a second player above chat.
- If every backup stream still has ads, strips those ads and holds the last live frame.
- Blocks YouTube pre-roll, mid-roll, Shorts, and banner and overlay ads on the watch page.
- Removes those ads from YouTube's player so the same video keeps playing.
- If a YouTube ad cannot be removed, it plays. The picture is not frozen and a blank frame is not swapped in.

## Install

1. Download [twitch-adblock-0.1.6.zip](https://github.com/gecko-of-shadow/twitch-adblock/releases/download/v0.1.6/twitch-adblock-0.1.6.zip).
2. Unzip it.
3. Open `chrome://extensions`.
4. Turn on Developer mode.
5. Choose **Load unpacked** and select the unzipped folder (the one that contains `manifest.json`).
6. Turn off the uBlock filter `twitch.tv##+js(twitch-videoad)` while this extension is loaded. If another extension is also changing the YouTube player, turn that off too.

A small "Blocking ads" label appears on the player while an ad is being blocked.

## Known limits

- The Twitch player reloads once when a midroll starts and once when it ends. The picture can hitch, and the backup stream can be a different quality.
- While a Twitch backup is playing, one preroll segment is fetched in the background so Twitch can finish the pod. Midroll segments are left alone.
- A background Twitch tab is reported as visible so Twitch does not pause the stream during the break.
- Twitch changes token and playlist shapes without notice. Playback has to go through `fetch` in the page or the player worker.
- This build blocks Twitch live streams. It does not block Twitch VODs or clips.
- YouTube ads that are already mixed into the video file still play. The extension does not replace that picture.

Playlist checks:

```
deno test --no-lock test/playlist.test.js test/page.test.js test/swap.test.js test/youtube.test.js
```
