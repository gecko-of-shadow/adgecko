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

Closer to TwitchAdSolutions video-swap-new midroll handoff: moving-off guard so leave+reload cannot re-enter backup, notice only while on backup, same backup try order. Still Chrome-safe (no visibility stopPropagation; player-worker gate).

## What’s new in 0.1.15

Smoother handoff after a midroll: delay player reload until the clean playlist arrives, always refresh source, pin quality, and nudge playback so the spinner is less likely to stick.

## What’s new in 0.1.15

Fixes the post-ad freeze: video spinner + stuck **Blocking ads** label, and chat stopping after a midroll. Returns to the live stream when the ad ends (or fails open instead of freezing).

---

## What’s new in 0.1.15

<p align="center">
  <img src="media/whats-new.jpg" alt="v0.1.15 leaner Twitch playlist probes, GQL gate, YouTube buffer skip" width="900">
</p>

---

## Notes

- Twitch: live midrolls only (VODs/clips pass through). Player may hitch once at midroll start/end.
- YouTube: player ads + home Sponsored cards. Ads already muxed into the file still play (fail open).
- Dev: `deno test --no-lock test/` · `bash scripts/release-gate.sh` · `bash scripts/pack-zip.sh`
