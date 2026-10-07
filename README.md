# twitch-adblock

<p align="center">
  <img src="media/readme-hero.jpg" alt="twitch-adblock — always-on ad blocking for Twitch and YouTube" width="900">
</p>

**[Download twitch-adblock-0.1.15.zip](https://github.com/gecko-of-shadow/twitch-adblock/releases/download/v0.1.15/twitch-adblock-0.1.15.zip)** · Always on · No popup · Twitch live + YouTube

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

1. Download the [release zip](https://github.com/gecko-of-shadow/twitch-adblock/releases/download/v0.1.15/twitch-adblock-0.1.15.zip) (not a random git checkout).
2. Unzip → `chrome://extensions` → Developer mode → **Load unpacked** → pick the folder with `manifest.json`.
3. While this is loaded, turn off uBlock’s `twitch.tv##+js(twitch-videoad)` / video-swap-new (and any other YouTube-player patcher). **One ad script per page.**

---

## What’s new in 0.1.15

Recommended build. Restores the simpler **0.1.12** player reload handoff so streams are less likely to stick on a spinner or mute latch. Keeps post-ad chat and **Blocking ads** label recovery. Prefer this zip over older builds.

<p align="center">
  <img src="media/whats-new.jpg" alt="v0.1.15 recommended restore of 0.1.12 reload handoff" width="900">
</p>

---

## Notes

- Twitch: live midrolls only (VODs/clips pass through). Player may hitch once at midroll start/end.
- YouTube: player ads + home Sponsored cards. Ads already muxed into the file still play (fail open).
- Dev: `deno test --no-lock test/` · `bash scripts/release-gate.sh` · `bash scripts/pack-zip.sh`
