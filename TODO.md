# To do

Where Adgecko stands, and what is next. Last updated 2026-11-14, when 0.3.5 was prepared.

## Where it was left off

- **Last release:** [v0.3.4](https://github.com/gecko-of-shadow/adgecko/releases/tag/v0.3.4), published 2026-11-12.
- **Prepared, not pushed:** 0.3.5 on the local branch `nightly/0.3.5` (folder `adgecko-nightly`). See the `## 0.3.5` section of `CHANGELOG.md`: 35 test-proven bug fixes, site-scoped filters, AdGuard site hide rules, popup Reload page / Undo fix, lighter page frames, lists repacked 2026-11-14.
- **Tests on `nightly/0.3.5`:** see the 0.3.5 checklist below.

## Next steps

### 0. Ship 0.3.5

- [ ] Review the branch, push it, open a PR and merge it.
- [ ] Try it by hand in your own Chrome: YouTube (menus, Share, Save open after an "Experiencing interruptions?" toast), Twitch, Kick, and one news site. None of these could be tested live.
- [ ] **Actions** -> **release** -> **Run workflow**. The README zip link for 0.3.5 works only after this.
- [ ] Owner decisions (held out of 0.3.5): block Twitch's own ad host `ads.twitch.tv`? Apply the Kick fixes in `docs/proposals/kick-0.3.5-fixes.patch` (`src/kick.js` is frozen by the release gate)?
- [ ] Owner decisions (ideas not built): let **Allow this site** also allow third-party frames on that page (payment, video, login frames); a default allow list for checkout and login helpers (DataDome, ThreatMetrix, Sift, Quantcast consent) - fewer broken sites, but these are trackers; path filters (`||host/ads/`) and generic URL filters for more blocking.

### 1. Ship the post-release fixes as 0.3.4

- [x] Bump `"version"` in `manifest.json` to `0.3.4` and update the version and zip link in `README.md` (plus the two tests that check the version).
- [x] `CHANGELOG.md`: the six PR #8 entries moved into a new `## 0.3.4` section with "Roll back to 0.3.3" steps; the "Release candidate" line is gone from 0.3.3.
- [x] Filter lists repacked 2026-11-11 22:41 UTC (`python3 scripts/pack-filter-lists.py`): 2,518 rules in `general-network.json`, 15,844 threat hosts in 199 rules.
- [x] Release checks: `deno test` 570 passed / 0 failed / 2 ignored; `scripts/pack-zip.sh` packed 67 files; `scripts/release-gate.sh` CLEAN on the checkout and with `--zip`; privacy check passed.
- [x] Smoke test of the packed zip in headless Chromium: the worker starts, the `general`, `threat` and `ubo-youtube` rulesets are on, the refresh alarm is set, and the popup and settings pages open with no errors.
- [x] Release PR merged into `main` (#9).
- [x] Live check in headless Chromium, with and without the extension: Twitch (page works, 5 requests blocked), Kick (video plays), the Guardian (649 requests down to 136) and weather.com (905 down to 191).
- [ ] Try YouTube by hand in your own Chrome: YouTube refused the build machine (HTTP 429, a bot check), so it was not tested live.
- [x] Release published 2026-11-12 by the new release workflow (`.github/workflows/release.yml`, #10): [v0.3.4](https://github.com/gecko-of-shadow/adgecko/releases/tag/v0.3.4) with `adgecko-0.3.4.zip` (67 files). Next release: bump the version and add its changelog section, then **Actions** -> **release** -> **Run workflow**.

### 2. Keep an eye on

- [ ] The weekly uBO YouTube drift check (`.github/workflows/ubo-youtube-drift.yml`, Mondays 06:00 UTC). A red run means YouTube's upstream filters changed and `scripts/sync-ubo-youtube.mjs` needs a re-run.
- [ ] Twitch ad changes: `src/vendor/video-swap-new.user.js` is TwitchAdSolutions 1.55, vendored unchanged. Check upstream for a newer version now and then.

### 3. Later / owner decisions

- [ ] **Chrome Web Store:** nothing has been submitted. Read [docs/STORE-REVIEW-NOTES.md](docs/STORE-REVIEW-NOTES.md) first (the vendored Twitch script has an `eval` a reviewer may flag).
- [ ] Tidy `docs/`: old one-off files (`README-backup-2026-10-24.md`, `chat-2026-10-11.md`, `agent-notes/`, the `beta-0.2.x-release.md` pages and the many `cards-*` folders) could move to an archive folder or be removed.
- [ ] Not covered today, if wanted later: YouTube Music, YouTube Kids, and ads that are part of the video itself (see "What it does and doesn't do" in the README).
