# twitch-adblock

<p align="center">
  <img src="media/readme-hero.jpg" alt="twitch-adblock — always-on ad blocking for Twitch and YouTube" width="900">
</p>

**Stable:** [twitch-adblock-0.1.18.zip](https://github.com/gecko-of-shadow/twitch-adblock/releases/download/v0.1.18/twitch-adblock-0.1.18.zip) · **Beta:** [twitch-adblock-0.1.19.zip](https://github.com/gecko-of-shadow/twitch-adblock/releases/download/v0.1.19/twitch-adblock-0.1.19.zip) · Twitch live + YouTube

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

1. Download a [release zip](https://github.com/gecko-of-shadow/twitch-adblock/releases) (not a random git checkout). Use **0.1.18** for stable playback. Use the **0.1.19 beta** only when you want the temporary debug popup.
2. Unzip → `chrome://extensions` → Developer mode → **Load unpacked** → pick the folder with `manifest.json`.
3. While this is loaded, turn off uBlock’s `twitch.tv##+js(twitch-videoad)` / video-swap-new **and any other Twitch ad extension** (purple lightning icons included). **One ad script per page.** Two scripts on the same Twitch tab can freeze video while chat still moves.

---

## What’s new in 0.1.19 (beta)

**Beta prerelease.** Temporary debug build. **v0.1.18 stays the stable playback release.**

Debug is **off** until the popup is switched on. With debug off, playback follows the 0.1.18 path: clean backups swap, dirty backups fail open, and a long midroll is not stripped into a frozen live-hold.

- Popup: **ON**, **OFF**, and **Copy debug**.
- ON keeps a short in-memory ring of playback decisions (backup, fail-open, reload). Nothing is uploaded.
- Copy stays on this device. Token and auth query values are stripped before they are stored.
- A debug failure cannot change the response. The player still fail-opens.

<p align="center">
  <img src="media/whats-new.jpg" alt="Playback stays up through long midrolls" width="900">
</p>

---

## Notes

- Twitch: live midrolls only (VODs/clips pass through). Backup swap may change quality briefly; playback should keep going.
- YouTube: player ads + home Sponsored cards. Ads already muxed into the file still play (fail open).
- Dev: `deno test --no-lock test/` · `bash scripts/release-gate.sh` · `bash scripts/pack-zip.sh`
