# twitch-adblock

<p align="center">
  <img src="media/readme-hero.jpg" alt="twitch-adblock — always-on ad blocking for Twitch and YouTube" width="900">
</p>

**[Download twitch-adblock-0.1.12.zip](https://github.com/gecko-of-shadow/twitch-adblock/releases/download/v0.1.12/twitch-adblock-0.1.12.zip)** · Always on · No popup · Twitch live + YouTube

---

## What it does

<p align="center">
  <img src="media/readme-features.jpg" alt="Twitch live and YouTube features" width="900">
</p>

---

## Install

<p align="center">
  <img src="media/readme-install.jpg" alt="Install in 5 steps" width="900">
</p>

1. Download the [release zip](https://github.com/gecko-of-shadow/twitch-adblock/releases/download/v0.1.12/twitch-adblock-0.1.12.zip) (not a random git checkout).
2. Unzip → `chrome://extensions` → Developer mode → **Load unpacked** → pick the folder with `manifest.json`.
3. While this is loaded, turn off uBlock’s `twitch.tv##+js(twitch-videoad)` (and any other YouTube-player patcher).

---

## What’s new in 0.1.12

Fixes the post-ad freeze: video spinner + stuck **Blocking ads** label, and chat stopping after a midroll. Returns to the live stream when the ad ends (or fails open instead of freezing). Reload the extension after installing this zip.

---

## What’s new in 0.1.11

<p align="center">
  <img src="media/whats-new.jpg" alt="v0.1.11 leaner Twitch playlist probes, GQL gate, YouTube buffer skip" width="900">
</p>

---

## Notes

- Twitch: live midrolls only (VODs/clips pass through). Player may hitch once at midroll start/end.
- YouTube: player ads + home Sponsored cards. Ads already muxed into the file still play (fail open).
- Dev: `deno test --no-lock test/` · `bash scripts/release-gate.sh` · `bash scripts/pack-zip.sh`
