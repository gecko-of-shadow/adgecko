# To do

Where Adgecko stands, and what is next. Last updated 2026-11-11, when 0.3.4 was prepared.

## Where it was left off

- **Last release:** [v0.3.3](https://github.com/gecko-of-shadow/adgecko/releases/tag/v0.3.3), published 2026-11-09.
- **Last work merged:** PR #8 (2026-11-10), six fixes made *after* the v0.3.3 zip was published:
  - Settings: **Allow this site** / **Fix this site** now work on one-label hosts (`localhost`, intranet names).
  - Clipboard guard: your own cut, Ctrl+Insert and non-Latin Ctrl+C count as copying it yourself.
  - Threat lists: refreshed malware rules come back after the background worker restarts.
  - Lists: the status line keeps an error or "Reverted" message until a refresh really runs.
  - Packer: runs the rule merger after writing `meta.json`.
  - Popup: YouTube Music, Studio, TV, Kids and youtube-nocookie pages show the site and "Malware blocking only".
- **Open issues / pull requests:** none, apart from the release-workflow PR.
- **Tests on `main`:** 570 passed, 0 failed, 2 skipped (the skips need a packing tool or a private word list that this machine does not have).

**In short:** the code on `main` was ahead of the published v0.3.3 zip but still called itself 0.3.3. Release 0.3.4 is now prepared to ship those fixes.

## Next steps

### 1. Ship the post-release fixes as 0.3.4

- [x] Bump `"version"` in `manifest.json` to `0.3.4` and update the version and zip link in `README.md` (plus the two tests that check the version).
- [x] `CHANGELOG.md`: the six PR #8 entries moved into a new `## 0.3.4` section with "Roll back to 0.3.3" steps; the "Release candidate" line is gone from 0.3.3.
- [x] Filter lists repacked 2026-11-11 22:41 UTC (`python3 scripts/pack-filter-lists.py`): 2,518 rules in `general-network.json`, 15,844 threat hosts in 199 rules.
- [x] Release checks: `deno test` 570 passed / 0 failed / 2 ignored; `scripts/pack-zip.sh` packed 67 files; `scripts/release-gate.sh` CLEAN on the checkout and with `--zip`; privacy check passed.
- [x] Smoke test of the packed zip in headless Chromium: the worker starts, the `general`, `threat` and `ubo-youtube` rulesets are on, the refresh alarm is set, and the popup and settings pages open with no errors.
- [x] Release PR merged into `main` (#9).
- [x] Live check in headless Chromium, with and without the extension: Twitch (page works, 5 requests blocked), Kick (video plays), the Guardian (649 requests down to 136) and weather.com (905 down to 191).
- [ ] Try YouTube by hand in your own Chrome: YouTube refused the build machine (HTTP 429, a bot check), so it was not tested live.
- [ ] Publish the release: after the release-workflow PR is merged, on GitHub open **Actions** -> **release** -> **Run workflow** (branch `main`). It checks, packs, gates and publishes `v0.3.4` with the zip and the changelog notes. Until then the README's zip link does not work.

### 2. Keep an eye on

- [ ] The weekly uBO YouTube drift check (`.github/workflows/ubo-youtube-drift.yml`, Mondays 06:00 UTC). A red run means YouTube's upstream filters changed and `scripts/sync-ubo-youtube.mjs` needs a re-run.
- [ ] Twitch ad changes: `src/vendor/video-swap-new.user.js` is TwitchAdSolutions 1.55, vendored unchanged. Check upstream for a newer version now and then.

### 3. Later / owner decisions

- [ ] **Chrome Web Store:** nothing has been submitted. Read [docs/STORE-REVIEW-NOTES.md](docs/STORE-REVIEW-NOTES.md) first (the vendored Twitch script has an `eval` a reviewer may flag).
- [ ] Tidy `docs/`: old one-off files (`README-backup-2026-10-24.md`, `chat-2026-10-11.md`, `agent-notes/`, the `beta-0.2.x-release.md` pages and the many `cards-*` folders) could move to an archive folder or be removed.
- [ ] Not covered today, if wanted later: YouTube Music, YouTube Kids, and ads that are part of the video itself (see "What it does and doesn't do" in the README).
