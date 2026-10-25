# twitch-adblock

![Gecko Adblocker](docs/gecko-avatar.jpg)

**Watch the live stream. Ads stay off your screen.**

A free Chrome extension that blocks ads on Twitch, YouTube, Kick, and other sites. It runs only in your browser. Nothing leaves your computer.

## Quick Install (Chrome on Windows)

1. **Download** the latest zip from [Releases](https://github.com/gecko-of-shadow/twitch-adblock/releases/latest)  
   → [Direct download v0.2.21](https://github.com/gecko-of-shadow/twitch-adblock/releases/download/v0.2.21/twitch-adblock-0.2.21.zip)

2. **Unzip** the file. In File Explorer, right-click the downloaded ZIP, choose **Extract All**, and keep the extracted folder.

3. **Open Chrome** and go to `chrome://extensions`

4. **Turn on Developer mode** with the toggle in the top right of the Extensions page.

5. **Click "Load unpacked"** and pick the extracted folder (the one with `manifest.json`).

Done. The gecko icon appears in your toolbar. Eyes glow when general blocking is on.

> Turn off other ad blockers on the same pages so the video does not freeze.

## What it does

- **Twitch live** — switches to a clean stream copy during ads, then back. Browse page ads are hidden.
- **YouTube** — removes player ads and sponsored cards. Hides the interruptions toast.
- **Kick** — skips short ad breaks when safe.
- **Other sites** — blocks many known ad servers and hides leftover ad boxes.
- VODs and clips are left alone.

General blocking starts **on**. You can turn it off in the popup or allow a page.

## Current version

**v0.2.21** — one zip for Twitch, YouTube, Kick, and ordinary sites.

If you have an older version loaded, remove it first.

## Is this safe?

Yes. It runs inside Chrome. No program is installed on your computer. No account. No data is collected or sent anywhere.

## Notes

- Picture quality may dip briefly on Twitch during an ad break. Playback continues.
- Ads baked into a YouTube video file still play.
- Development: `deno test --no-lock test/` · `bash scripts/release-gate.sh` · `bash scripts/pack-zip.sh`

---

[View all releases →](https://github.com/gecko-of-shadow/twitch-adblock/releases)
