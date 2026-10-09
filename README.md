# twitch-adblock

**Watch the live stream. The ad does not get the screen.**

- The stream keeps playing. No black screen, no reload loop.
- Works with several live tabs open.
- Free. No account. Nothing is sent off your computer.

<img src="docs/what-it-is.png" width="800" alt="Watch the live stream. The ad does not get the screen. The stream keeps playing, several live tabs can stay open, and nothing is sent off your computer.">

A Chrome extension that blocks ads on Twitch live streams and YouTube. It is free, runs only in your browser, and sends nothing anywhere.

## What it does

- **Twitch live:** uses the upstream TwitchAdSolutions video-swap-new script (unmodified). During a midroll it switches to an ad-free backup of the same stream and switches back when the break ends. If no clean backup is available, it lets the ad play instead of freezing your video.
- **YouTube:** removes player ads and the Sponsored cards on the home page.
- VODs and clips pass through untouched.

## Current stable build: v0.2.1

<img src="docs/whats-new.png" width="800" alt="Current stable build v0.2.1. The toolbar icon is a gecko head. Twitch live uses video-swap-new. YouTube player ads and home Sponsored cards stay. Debug popup is on for now.">

The toolbar icon is a gecko head. Twitch live still uses video-swap-new. YouTube blocking and the temporary debug popup are the same as before.

A small debug popup is **on by default for now (temporary)** for YouTube and the popup log. It keeps a short log in memory on your device, hides login tokens, and sends nothing out. Open the extension popup to turn it off or to copy the log if you need to report a problem.

Details are in the [v0.2.1 release notes](https://github.com/gecko-of-shadow/twitch-adblock/releases/tag/v0.2.1).

## Install

<img src="docs/install-steps.png" width="800" alt="Install the current stable zip: download twitch-adblock-0.2.1.zip, unzip it, open chrome://extensions, turn on Developer mode, and Load unpacked the folder with manifest.json.">

**[Download twitch-adblock-0.2.1.zip](https://github.com/gecko-of-shadow/twitch-adblock/releases/download/v0.2.1/twitch-adblock-0.2.1.zip)**

1. Download the zip above and unzip it.
2. Open `chrome://extensions` and turn on **Developer mode**.
3. Click **Load unpacked** and pick the folder that holds `manifest.json`.
4. Turn off other Twitch or YouTube ad blockers and scripts while this is loaded. Two ad scripts on one page can freeze the video.

## Found a problem?

<img src="docs/found-a-problem.png" width="800" alt="Found a problem? Open the extension popup, check that Debug is ON, click Copy debug, and paste it into a GitHub issue.">

## Notes

- Backup swaps can change the picture quality briefly. Playback should keep going.
- Ads already baked into a YouTube video file still play.
- Older builds stay on the [releases page](https://github.com/gecko-of-shadow/twitch-adblock/releases) if you need to go back.
- Development: `deno test --no-lock test/` · `bash scripts/release-gate.sh` · `bash scripts/pack-zip.sh`
