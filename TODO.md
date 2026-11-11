# To do

Where Adgecko stands, and what is next. Last checked 2026-11-11 against `main` at `76f3351`.

## Where it was left off

- **Last release:** [v0.3.3](https://github.com/gecko-of-shadow/adgecko/releases/tag/v0.3.3), published 2026-11-09.
- **Last work merged:** PR #8 (2026-11-10), six fixes made *after* the v0.3.3 zip was published:
  - Settings: **Allow this site** / **Fix this site** now work on one-label hosts (`localhost`, intranet names).
  - Clipboard guard: your own cut, Ctrl+Insert and non-Latin Ctrl+C count as copying it yourself.
  - Threat lists: refreshed malware rules come back after the background worker restarts.
  - Lists: the status line keeps an error or "Reverted" message until a refresh really runs.
  - Packer: runs the rule merger after writing `meta.json`.
  - Popup: YouTube Music, Studio, TV, Kids and youtube-nocookie pages show the site and "Malware blocking only".
- **Open issues / pull requests:** none.
- **Tests on `main`:** 570 passed, 0 failed, 2 skipped (the skips need a packing tool or a private word list that this machine does not have).

**In short:** the code on `main` is ahead of the published v0.3.3 zip, but it still calls itself 0.3.3 and the changelog lists those six fixes under 0.3.3, which already shipped without them.

## Next steps

### 1. Ship the post-release fixes as 0.3.4

- [ ] Bump `"version"` in `manifest.json` to `0.3.4`, and update the version shown in `README.md` (the intro line and the install zip link).
- [ ] In `CHANGELOG.md`, move the six PR #8 entries out of `## 0.3.3` into a new `## 0.3.4` section, add "Roll back to 0.3.3" steps (same shape as the others), and drop the "Release candidate" line from 0.3.3, since it is released.
- [ ] Decide whether to repack the filter lists first (last repack 2026-11-09 09:18 UTC): `python3 scripts/pack-filter-lists.py`.
- [ ] Run the release checks:
  - `deno test --no-lock --allow-read --allow-run --allow-env test/`
  - `bash scripts/pack-zip.sh adgecko-0.3.4.zip`
  - `bash scripts/release-gate.sh` and `bash scripts/release-gate.sh --zip adgecko-0.3.4.zip`
- [ ] Load the unpacked folder in real Chrome and try Twitch, YouTube, Kick and one ordinary site (the tests model Chrome; they do not run it).
- [ ] Publish the `v0.3.4` GitHub release with `adgecko-0.3.4.zip` attached.

### 2. Keep an eye on

- [ ] The weekly uBO YouTube drift check (`.github/workflows/ubo-youtube-drift.yml`, Mondays 06:00 UTC). A red run means YouTube's upstream filters changed and `scripts/sync-ubo-youtube.mjs` needs a re-run.
- [ ] Twitch ad changes: `src/vendor/video-swap-new.user.js` is TwitchAdSolutions 1.55, vendored unchanged. Check upstream for a newer version now and then.

### 3. Later / owner decisions

- [ ] **Chrome Web Store:** nothing has been submitted. Read [docs/STORE-REVIEW-NOTES.md](docs/STORE-REVIEW-NOTES.md) first (the vendored Twitch script has an `eval` a reviewer may flag).
- [ ] Tidy `docs/`: old one-off files (`README-backup-2026-10-24.md`, `chat-2026-10-11.md`, `agent-notes/`, the `beta-0.2.x-release.md` pages and the many `cards-*` folders) could move to an archive folder or be removed.
- [ ] Not covered today, if wanted later: YouTube Music, YouTube Kids, and ads that are part of the video itself (see "What it does and doesn't do" in the README).
