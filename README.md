# twitch-adblock

<p align="center">
  <img src="media/readme-hero.jpg" alt="twitch-adblock — always-on ad blocking for Twitch and YouTube" width="900">
</p>

**[Download twitch-adblock-0.1.16.zip](https://github.com/gecko-of-shadow/twitch-adblock/releases/download/v0.1.16/twitch-adblock-0.1.16.zip)** · Always on · No popup · Twitch live + YouTube

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

1. Download the [release zip](https://github.com/gecko-of-shadow/twitch-adblock/releases/download/v0.1.16/twitch-adblock-0.1.16.zip) (not a random git checkout).
2. Unzip → `chrome://extensions` → Developer mode → **Load unpacked** → pick the folder with `manifest.json`.
3. While this is loaded, turn off uBlock’s `twitch.tv##+js(twitch-videoad)` / video-swap-new **and any other Twitch ad extension** (purple lightning icons included). **One ad script per page.**

---

## What’s new in 0.1.16

Recommended build. When no clean backup exists, **fail open** like Firefox video-swap-new: pass the real midroll through and force a player reload instead of stripping ads into a permanent spinner. After the break, another reload clears stuck loading. Still includes the 0.1.15 reload handoff restore.

<p align="center">
  <img src="media/whats-new.jpg" alt="v0.1.16 fail-open midroll recovery" width="900">
</p>

---

## Notes

- Twitch: live midrolls only (VODs/clips pass through). Player may hitch once at midroll start/end.
- YouTube: player ads + home Sponsored cards. Ads already muxed into the file still play (fail open).
- Dev: `deno test --no-lock test/` · `bash scripts/release-gate.sh` · `bash scripts/pack-zip.sh`
