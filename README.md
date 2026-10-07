# twitch-adblock

A Chrome extension that blocks video ads on Twitch and YouTube. It is always on. There is no popup and no per-site switch.

## Features

- Blocks Twitch live midrolls.
- Keeps the live video playing through the break.
- Asks Twitch for backup streams in parallel (picture-by-picture, embed, then autoplay/Android), then picks the clean backup that best matches the live quality ladder.
- Reloads the player only after the clean playlist is ready, and restores quality sooner after the swap.
- Does not open a second player above chat.
- If every backup stream still has ads, strips those ads and holds the last live frame.
- Shows an in-session “Blocking ads (N)” count on the Twitch player label (this tab only; not stored).
- Logs one console warning when another Twitch ad script has already patched `fetch` or `Worker` (for example uBlock’s twitch-videoad).
- Blocks YouTube pre-roll, mid-roll, Shorts, and banner and overlay ads on the watch page.
- Blocks YouTube home-feed Sponsored cards (for example hotel and other “Sponsored · …” cards with Watch / Book now).
- Removes those ads from YouTube's player so the same video keeps playing.
- If a YouTube ad cannot be removed, it plays. The picture is not frozen and a blank frame is not swapped in.

## Install

1. Download [twitch-adblock-0.1.10.zip](https://github.com/gecko-of-shadow/twitch-adblock/releases/download/v0.1.10/twitch-adblock-0.1.10.zip).
2. Unzip it.
3. Open `chrome://extensions`.
4. Turn on Developer mode.
5. Choose **Load unpacked** and select the unzipped folder (the one that contains `manifest.json`).
6. Turn off the uBlock filter `twitch.tv##+js(twitch-videoad)` while this extension is loaded. If another extension is also changing the YouTube player, turn that off too.

Install from the **release zip**, not from an arbitrary git tag checkout. The zip is the packaged extension (`manifest.json`, `src/`, `icons/` only).

A small "Blocking ads (N)" label appears on the Twitch player while an ad is being blocked. The count is for this tab session only.

## Known limits

- The Twitch player reloads once when a midroll starts and once when it ends. The picture can hitch, and the backup stream can be a different quality.
- While a Twitch backup is playing, one preroll segment is fetched in the background so Twitch can finish the pod. Midroll segments are left alone.
- A background Twitch tab is reported as visible so Twitch does not pause the stream during the break.
- Twitch changes token and playlist shapes without notice. Playback has to go through `fetch` in the page or the player worker.
- This build blocks Twitch live streams. It does not block Twitch VODs or clips.
- YouTube ads that are already mixed into the video file still play. The extension does not replace that picture.

## Testing

Logic and edge cases:

```
deno test --no-lock test/
```

Redacted HLS / YouTube fixtures live under `test/fixtures/` and are covered by `test/fixtures.test.js`.

Release smoke (package allowlist, permissions, host coverage, no phone-home / dangerous APIs, deno suite, light playlist fuzz). Requires Deno, Python 3, and ripgrep (`rg`). Does not phone home.

```
bash scripts/release-gate.sh
bash scripts/release-gate.sh --zip twitch-adblock-0.1.10.zip --expect-version 0.1.10
```

Pack a shippable zip (`manifest.json`, `src/*.js`, `icons/` only):

```
bash scripts/pack-zip.sh
```

## Changelog

### 0.1.10

- Speeds up Twitch midroll handoff: probes picture-by-picture, embed, and autoplay backups together, prefers typically clean types, and picks the closest quality match in a short grace window.
- Schedules the player reload after the clean playlist response, and restores saved quality sooner (800ms).
- Logs one console warning when another script has already patched `fetch` or `Worker` (for example uBlock twitch-videoad).
- Shows an in-session “Blocking ads (N)” count on the Twitch player label (tab memory only).
- Adds redacted `test/fixtures/` samples for stitched ads, midroll cues, live masters, and YouTube ad payloads, with `deno test` coverage.

### 0.1.9

- Adds `scripts/release-gate.sh`: local release smoke for package contents, manifest hosts/permissions, phone-home and dangerous-API scans, `deno test`, and a light playlist fuzz.
- Adds `scripts/pack-zip.sh` to build the shippable zip.
- Documents that installs should use the GitHub release zip (not a mismatched git tag tree).

### 0.1.8

- Blocks YouTube home-feed Sponsored cards on youtube.com.
- Strips those cards from the home browse response and continuations so infinite scroll keeps working.
- Hides any remaining Sponsored cards with CSS. A brief flash before hide is possible.
- Leaves normal home videos and continuation tokens in place.

### 0.1.7

- Drops a Twitch channel session once the live playlist is clean, and drops idle sessions after two minutes.
- Keeps only the recent variant URLs for a channel, and at most eight channel sessions.
- Revokes a player-worker blob URL and removes its message listener when that worker ends.
- Times out a worker GraphQL wait that never gets a reply. The ad plays if the reply does not come back.
- Leaves the player on the live stream when every backup still has ads, and holds the last live frame there.
- Still looks at later quality rungs when the first playlist request fails.
- Passes Twitch clips and VODs through unchanged.
- Drops only a picture-by-picture token, including inside a batched request, a `Request` body, and the player worker. Other playback requests in that body stay, and integrity headers from the request are kept.
- Leaves a live prefetch in place when a stitched tag has no ad segments.
- Runs one backup search when two master playlists overlap, and does not download a media playlist twice for that check.
- A reused YouTube player request returns the new video.
- The "Blocking ads" label clears on navigation and when the next player response has no ads.
- An ad-only YouTube watch or Shorts payload is left unchanged so that ad can play.

### 0.1.6

- Blocks YouTube pre-roll, mid-roll, Shorts, and banner and overlay ads on the watch page.
