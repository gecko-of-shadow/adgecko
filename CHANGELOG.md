# Changelog

## Unreleased

- New icon (concept E, picked 2026-11-02): a neon purple gecko head on a dark rounded square, snapping its tongue at a pixel "ad". Hand-drawn SVG sources with a separate 16 px pixel cut; the toolbar icon lights the pixel "ad" while blocking is on and turns grey when it is off. `scripts/build-icons.mjs` can render with a local Chrome / Chrome for Testing (`CHROME_PATH`). How the art was chosen: `docs/design/README.md`.
- Popup aligned with the picked mockups: larger header icon and text, purple-bordered "Something broke?" card, "Block again" outlined in purple, "Show more" with a chevron; high contrast shows the gecko white and rings the yellow buttons. The settings page now uses the same purple / high-contrast / forced-colours themes. Review screenshots in `docs/design/screenshots/`.
- Toolbar icon: it now really changes. Every `setIcon` call had been failing silently since the first release (the paths resolved against `src/`), so the icon stayed on its default even with blocking off. The popup header now follows the same switch as the toolbar icon.
- Popup: when the dot is up, opening the window unfolds Show more once so the reason can be read, and a block on the previous page is no longer reported on the next one. A block right after navigating still gets its dot. A failed save changes nothing on screen and says "Could not save. Try again." Show more no longer says the packed threat list is on when it is off, the "You're protected" card waits until the extension is on, and the "Already allowed: nothing is blocked here." note is gone (malware rules and stream-site code outrank Allow). The list status no longer prints its date twice.
- Accessibility: hover colours in the popup and settings meet AA (were 3.80:1 and 4.49:1), text box edges and placeholder text in settings too, the theme list no longer makes settings scroll sideways at 320 px, the settings switches keep keyboard focus when they change, and the Fix question is tied to its Yes / No buttons for screen readers.
- Filter lists: a `$document` filter now blocks opening that site even when another list also blocks it as a whole domain (about 500 ad servers such as a-ads.com opened when visited directly).
- Filter lists: filters with only negated types (`$~script`, `$~stylesheet,third-party`, ...) no longer block opening the site (e.g. prime.rambler.ru, or eloqua.com / exacttarget.com links followed from another site); they still block the page parts they name.
- Filter lists: Twitch / YouTube / Kick and their player hosts, and five redirectors people click on purpose (affiliate links: Skimlinks redirectingat.com, impact.com ojrq.net, Involve Asia invol.co, Adtraction; deal links: linksprf.com), never get a "block opening this site" rule from the ordinary lists; their other rules stay.
- Settings: "Allow this domain" now also opens a page the filter lists block (the way out of Chrome's "blocked by an extension" page for a site you trust).
- Filter lists repacked again on 2026-11-03 (20:37Z) with these fixes: 187,014 whole-domain + 5,480 scoped entries in 2,439 list rules (2,444 rules in `general-network.json`).

- Rules: every writer of blocking rules (list refresh, the lists switch and Allow this site, Revert lists, the malware-tier switch, Allow this domain, the threat feed) now takes turns in one queue, so two of them can no longer write the same rule ids at once; that used to make Chrome reject the second write and drop refreshed lists back to the packed ones. List downloads do not hold the queue, so a click never waits for the network.
- Filter lists repacked on 2026-11-03: the packed general ruleset no longer holds the public suffix `pisz.pl` or the address `0.0.0.1`. Now 186,987 whole-domain + 4,035 scoped entries in 2,421 list rules; the packed threat ruleset holds 15,913 hosts in 199 rules.
- Kick: the post-roll ad cover is hidden and its clip paused only when nothing in it could be the live player (a stream source, an endless length, or a video whose source or length is not known yet keeps it visible); the decision is made again when a video's source or length changes, a hide is undone if the live player turns up, and turning Kick help off shows the covers again. The stylesheet no longer hides post-roll covers.
- Docs: README (what it does, how to use the new popup, troubleshooting a copy button, the list sites contacted every 3 hours, clipboard text checked only in the browser), `docs/how-it-works.md` (page guards, new popup), `docs/allow-a-page.md` (Fix this site first, Allow this site / Block again), `docs/permissions-and-privacy.md` (what stays local), `docs/threat-tier.md` (no phishing list of its own; Safe Browsing is the backstop).
- New popup (Gecko Adblock design): icon, name and a gear for the settings page; the site; one plain status line ("✅ Protected" or "Allowed – not blocking here"); a "Something broke?" card whose **Fix this site** button turns off the hide rules and page guards (on YouTube and Twitch: the sponsored-tile and banner hiding; never the stuck-start reload or Kick's ad skip) for that site only and then asks "Did that fix it?" (Yes keeps it; No puts back exactly what it changed and points to Allow this site; the question survives closing the popup for a day); **Allow this site** / **Block again**; and a folded "Show more" with the list and feed status and the version. A one-time "You're protected" card on the first open. The master switch, the per-feature list and "Update lists" moved to the settings page. Quiet alerts: when a page guard blocks something, a small magenta dot appears on that tab's toolbar icon (no pop-ups, no counters); opening the popup says what was blocked and clears it. Purple theme plus a high-contrast theme that turns on by itself with high-contrast settings, or by the new theme switch on the settings page; system colours with Windows high contrast; visible keyboard focus; no animation. No new permission.
- Licence: the project is now explicitly GPLv3 (root `LICENSE`: copyright notice, list of third-party notices, and the unmodified GPLv3 text from gnu.org). The README has a "License and brand" section: the name "Gecko Adblock" and the gecko icon are the owner's brand and are not covered by the code licence. TwitchAdSolutions (MIT), uBlock Origin/uAssets (GPLv3), EasyList credit and the other list notices are unchanged.
- Pop-up guard (off by default): "same site" now compares registrable domains (a small copy of the public-suffix data), so `a.co.uk` and `evil.co.uk`, or `x.github.io` and `y.github.io`, count as different sites; clicks inside shadow DOM are judged by the real clicked element; the built-ins it relies on are captured before the page runs.
- Clipboard guard, after a multi-agent review: a button labelled "Copy" no longer lets a command through outside the documentation/code hosts (a page can hide or fake what it shows); only your own Ctrl/Cmd+C or context-menu copy of the selected text does, and the notice now says so. `navigator.clipboard.write()` is checked too; the browser's own copy is cancelled when the page swapped the selection for a command after you pressed Ctrl+C; `setData` is checked only on a copy/cut event's clipboard data (drag-and-drop works as before); the built-ins the guard relies on (regex, string methods, Promise.reject, key-event and selection getters) are captured before the page runs, so a page that replaces them later cannot blind it; switches are read from the private port through captured getters, so a page cannot rewrite or read them.
- Licence record (`src/rules/LICENSES.md`, generated by the packer's writer): each list now names its upstream terms as checked on 2026-11-02: HaGeZi, uBO uAssets and AdGuard Base GPL-3.0, Dandelion Sprout's list Dandelicence v1.4 with a link to its text, EasyList/EasyPrivacy GPL-3.0-or-later or CC BY-SA 3.0-or-later. Peter Lowe's line is unchanged for now (its terms are an open question).
- Signed threat feed (still dormant): a kill-key document is now a latch until the next extension version (a feed-key document can no longer switch a killed feed back on; nothing is fetched meanwhile); the 14-day lifetime is also measured from `notBefore`, `notBefore` may not be more than 1 h before `createdAt`, and `createdAt` may not be more than 1 h in the future, so a future `createdAt` cannot stretch a document's life; serials are capped at 2^31-1 and may not jump more than 1,000,000; the feed body is read as a stream and cut at the 512 KB cap even without `Content-Length`; a rollback to a `killFeed` document reports "killed". `scripts/feed-keygen.mjs` resolves the real path ("..", links) before refusing a key file inside the repo, and `scripts/build-threat-rules.mjs` writes nothing when a cached list's bytes do not match `src/rules/meta.json`.
- Privacy check (`scripts/privacy-check.py`): now also finds, without any secret, public IP addresses (documentation, private and loopback ranges excepted; blocklist data files skip this), e-mail addresses (noreply and example domains excepted), home-directory paths, Google API keys, Slack tokens and JSON web tokens, metadata in changed images (EXIF, XMP, comments, PNG text), and the author/committer names, e-mails and messages of the commits in range; `--all` scans the whole tree; a line can carry `privacy-check: allow` for IPs, e-mails or paths (never for secrets). CI (`.github/workflows/checks.yml`): a push to `main` fails when the `PRIVACY_PATTERNS` secret is missing, pull requests run the checker from the base commit (not their own copy) in Python isolated mode, actions are pinned to commit SHAs, and checkouts no longer keep credentials. Personal machine references were removed from code and tests; a captured test URL now uses a documentation IP.
- Threat tier: a small Public Suffix List subset plus a list of shared-hosting and big-platform parents (`src/threat/psl.js`) keeps one bad list line from blacking out a whole country domain or platform: `co.uk`, `github.io`, `pages.dev`, `amazonaws.com`, `blogspot.com`, `docs.google.com` and their parents are never threat-blocked (a customer's own host such as `evil.github.io` still can be), nor are private, loopback or link-local IPv4 addresses. The signed feed and the "Allow this domain" box use the same check (the box now refuses `github.io`, accepts `me.github.io`, and says why). One refresh may add at most 2,500 new threat hosts and 20% of the previous set; a bigger jump keeps the previous rules unless it repeats on the next refresh. The ordinary lists skip public suffixes and non-public IPv4 addresses too (refresh and packer). The packed threat ruleset was rebuilt offline from the same list download (15,925 hosts; `pisz.pl`, a Polish public suffix, dropped).
- Clipboard guard (ClickFix) bypasses closed: each value is turned into text once and that exact text is checked and written (an object returning harmless text first and a command second no longer gets through); `execCommand` is wrapped where it really lives (`Document.prototype`, so `Document.prototype.execCommand.call(...)` is checked) and `cut` is checked like `copy`; the selection and form-field text are read through browser getters saved before the page runs; a "copy" label alone no longer counts as a deliberate copy (the text must also be visible next to the clicked button), and a copy shortcut only allows text that was selected when the key was pressed (a copy handler cannot swap in a command); an error while judging a click now means "not deliberate". `readthedocs.io` / `.org` are no longer trusted (anyone can publish there). The guards and their switch script now also run in `about:blank`, `srcdoc` and `blob:` frames of ordinary sites (`match_about_blank`, `match_origin_as_fallback`), still never on Twitch, YouTube or Kick. The extension's own page-world scripts (`youtube.js`, `kick.js`, both guards) are each wrapped in one function and no longer add global names to the page; the Kick style element no longer carries an id.
- Feature switches for the page guards and the YouTube/Kick page scripts no longer travel as `window.postMessage` messages, which any page could fake (a page could switch the clipboard guard off on itself) or ask for. `src/settings/flags.js` now hands each page-world script its own `MessageChannel` port at document_start through a synchronous event, before any page script runs; flags come only over that port, later window messages are ignored, and the old `"?"` request is gone. Kick frames now get the switch too (flags.js runs in every Kick frame, like `kick.js`). If no port arrives, the built-in defaults stay (clipboard guard on, popup guard off). No new permission.
- Packaging: `scripts/pack-zip.sh` now builds its file list from `manifest.json` (service worker, content scripts, rulesets, popup and settings pages, icons), the worker's `importScripts(...)`, the pages' `<script>` tags and the files the code fetches (`scripts/lib/package_files.py`), then checks the zip holds exactly that list. Before, the settings page, the page guards, the threat tier, the signed-feed client and the threat rulesets were left out, so a packed zip would not have started. `scripts/release-gate.sh` (edited, not run) knows the new files, checks every manifest/importScripts path is in the package, and refuses any `optional_permissions` / `optional_host_permissions`.
- Curben's urlhaus-filter (abuse.ch URLhaus malware hosts) is kept as the one documented Curben exception (owner decision #18b): only source `urlhaus_hosts`, only from `malware-filter.gitlab.io/malware-filter/urlhaus-filter-hosts-online.txt`; his phishing list and every OpenPhish source stay out. New `scripts/lib/curben_check.py` enforces it in the release gate (new section 2c, edited, not run) and in `test/no-openphish.test.js` (with a negative case for each forbidden source). Its licence line is corrected to upstream's terms (URLhaus data CC0 1.0; urlhaus-filter repository CC0 1.0 + MIT; it was wrongly listed as CC BY-NC-SA 4.0), and the garbled characters in the licence file are gone.
- (Superseded before release by the concept E icon above.) New gecko icon: a green gecko with a blue "no ads" shield on a round teal badge. The eye glows amber while list blocking is on and the icon goes grey with a sleepy eye when it is off. Sources in `icons/source/`, rebuilt with `node scripts/build-icons.mjs`. The popup icon glow is round to match.
- Ordinary sites: switching lists off and on again (or a quick "Allow this page" and undo) no longer drops the refreshed lists back to the packed ones. Switching lists off while a list refresh is running now leaves them off.
- YouTube: going back to a video that already played (A, then B or the home page, then A) and getting stuck at 0:00 now gets the same automatic reload as any other stuck start.
- YouTube (only with the extra fetch hooks on): `fetch(new URL(...))` is filtered too, and a failed request is no longer sent twice.
- Tests: the uBO fixture runs no longer share Deno's on-disk localStorage, which made "uBO risky groups are individually switchable" fail under load.
- "Allow this page" works again. Chrome hides tab addresses from extensions without the `tabs` permission, so the button was always greyed out ("Open a normal http(s) page"). The popup now asks the page's own content script for its address. No new permission.
- After the first list refresh, the YouTube doubleclick block is kept. The refresh copied only the allow rules and the extra tracker rule into the new rule set, so `doubleclick.net` loaded on YouTube (and in YouTube embeds on other sites) once the packed rules were switched off.
- If EasyList fails to download on a refresh, the hide list is left as it was. Before, EasyPrivacy alone replaced it (a couple of selectors instead of about 13,600) and it stayed that way until EasyList came back.
- YouTube: the bundled uBO `videoplayback?expire=` decoy rule would have started blocking every normal YouTube video (and embeds) on 2027-01-15. `scripts/sync-ubo-youtube.mjs` now widens its allowed window locally (allow-only) to cover real links up to 2033-05-18, and stops with an error if upstream changes the rule's shape. A plain re-sync is not enough because upstream widens the window only after links break. The guard test now checks every day through 2033-05-01 instead of 30 days ahead. See `docs/youtube-expire-window.md`.
- New threat tier: known-bad hosts from URLhaus, uBO badware and Dandelion Sprout's Anti-Malware List are blocked at priority 2,000,010, above the stream-site allows, so they are blocked on YouTube, Kick and Twitch pages and in embeds too, and as page navigations. "Allow this page" no longer lets them through; a user "Allow this domain" override (2,000,020) does. Twitch, YouTube and Kick servers and player hosts can never be blocked (`src/threat/protected-hosts.js`). Packed as static ruleset `threat` (15,926 hosts, 200 rules) and refreshed as dynamic rules. See `docs/threat-tier.md`.
- Twitch: the directory ad sweep now runs only on directory and home pages and at most every 250 ms (it ran on every page change of every Twitch page, including busy chat on channel pages); the CSS hide rule is unchanged. Kick: the MediaTailor session listener wrapper no longer breaks `removeEventListener` and no longer fires a listener twice when it is added twice.
- Page guards on ordinary sites (never on Twitch, YouTube or Kick; their exclusions come from the registry): "Stop pages from copying shell commands" (on by default) blocks a page from putting a ClickFix-style command (encoded or downloading PowerShell, `cmd /c` chains, `mshta`, `bitsadmin`, `certutil -urlcache`, `curl ... | sh`, ...) into the clipboard through `navigator.clipboard.writeText`, `execCommand("copy")` or a copy handler, unless the visitor pressed a copy shortcut or clicked something labelled "copy", or the site is a known documentation/code host; a small notice explains it. "Block pop-ups opened without a click" (off by default) stops `window.open` without a gesture, a second window per click and pop-unders from clicks on plain page content; sign-in and share pages still open. Both fail open and can be switched per site. Threat lists' `$popup`-only hosts would become navigation-only threat rules (none in the current lists).
- Hardening: the YouTube script and the generated uBO bundle no longer read option overrides from `localStorage` (the page itself can write it); built-in defaults only, and the uBO group defaults are set in `scripts/sync-ubo-youtube.mjs` (bundle regenerated at the same uAssets/uBO commits). `src/cosmetic-hide.css` is no longer a web-accessible resource (pages could probe it to detect the extension); the content script gets it from the service worker. Page-visible markers use neutral ids (`Symbol.for("gk.u")`, `"gk.y"`, style ids `gk-*`, no marker properties on page objects), and page-console logging from the YouTube and Kick scripts is off by default.
- Switches for every feature: one registry (`src/settings/features.js`) lists the 13 features (filter lists, threat tier, threat feed, hide rules, Twitch player swap, Twitch directory banners, uBO YouTube scriptlets, YouTube stuck-start reload, YouTube sponsored-tile removal, Kick ad skip, and the clipboard, popup and miner guards that come later) and is the only copy of the Twitch/YouTube/Kick site list (the manifest's exclusions are checked against it). Settings live in two small keys, `settings` (global) and `siteOverrides` (per site); the old `generalEnabled` / `generalAllowedOrigins` are migrated once and kept as derived copies. The popup shows the current site, its own on/off switch ("Allow this page") and that site's features; the new settings page (All settings) lists every feature, the feed status with "Pause threat feed", "Update lists", "Revert lists", an "Allow this domain" box for the threat tier, and the per-site switches. List and threat switches and the hide rules apply at once; the YouTube and Kick page scripts get their switches from a small ISOLATED script and check them before each action (on until told otherwise; nothing is unpatched and no tab is reloaded). The vendored Twitch swap and uBO YouTube scriptlets stay always on (owner decision D-3; only turning the extension off in Chrome stops them). No new permission.
- Signed threat feed client, dormant until configured (`src/feed/config.js` `FEED_ORIGIN` is empty, no key is pinned, no feed host in the manifest): when set up it checks every 3 hours on the `gecko-refresh` alarm (signature first, HTTPS only, no redirects, 15 s timeout, 512 KB cap), replaces its session rules in one step, keeps the last two verified files for rollback, re-applies the saved file on browser start and after updates (or the packed `src/rules/threat-snapshot.json` when it has expired), and honours kill documents and a local "Pause threat feed" switch (storage key `feedPaused`). The popup shows the feed status. New `scripts/feed-keygen.mjs` (private key only to a path outside the repo, never printed) and `scripts/feed-sign.mjs`; steps in `docs/feed-setup.md`. `scripts/release-gate.sh` now allows the `alarms` permission and, once configured, the one feed host (edited, not run).
- Signed threat feed library (`src/feed/`): Ed25519 signature over the exact bytes of `feed.json` checked before anything is parsed, strict format-1 schema (unknown keys rejected, block-only entries, fixed priority, protected stream hosts reject the whole feed, 512 KB cap, serial must increase, 14-day lifetime), a separate kill key that can sign only a kill document, rollback to the stored previous payload, compiled to session rules at 2,000,010. Pinned key lists ship empty. `minimum_chrome_version` is now 137 (Ed25519 in WebCrypto).
- Filter lists protect themselves: a downloaded list is rejected (and its last good copy kept) when it grows or shrinks by more than 25% in one refresh (not on first load), names more than 25 protected stream hosts, or carries an abnormal hide list (more than 30,000 generic rules, a 25% jump, or more than 100 whole-page site rules). Generic hide rules that name no class, id, attribute or custom element (`*`, `body`, `div`) are dropped. The reason shows in the list status. New worker action "Revert lists" goes back to the packed lists and hide rules (button comes with the settings page).
- The packed `general` ruleset now stays enabled after a list refresh (it is the offline floor and holds the stream-site allows); only the lists switch turns it off.
- Filter lists: options are converted faithfully instead of being widened into whole-domain blocks (H-2). `$third-party`/`$first-party` become `domainType`, request types (`$script`, `$ping`, `$subdocument`, ...) become `resourceTypes`, `~type` becomes `excludedResourceTypes`, `$doc` blocks navigations only, `$badfilter` cancels its filter, and anything that cannot be represented (`$domain=`, `$redirect`, `$csp`, ...) drops the filter. Example: `||soundcloud.com^$ping` no longer blocks all of soundcloud.com and its embeds; `s1.wp.com` and `onetrust.com` are no longer whole-domain blocks. One table (`src/general/filter-options.js`) is used by both the packer and the runtime refresh, with a shared JS/Python test fixture. Lists cached by the old parser are refetched; the packed rules stand in until then. Packed at the time: 185,816 whole-domain + 4,030 scoped entries in 2,406 list rules (see the 2026-11-03 repack above).
- Removed: Curben phishing-filter list (OpenPhish-derived), owner decision. Gone from the packed rules, the list refresh, the licence file and the docs; existing installs drop its cached copy and rebuild their rules on the next start or refresh. curbengh's separate urlhaus-filter (URLhaus data) stays. Packed rules re-generated on 2026-11-02: 189,845 domains in 2,374 list rules (was 211,995 in 2,650; Curben was 30,391). Phishing coverage is smaller; Chrome Safe Browsing remains the backstop. Eight lists are downloaded now, not nine.
- Filter lists: refreshed by a `gecko-refresh` alarm every 3 hours (new `alarms` permission) instead of once per browser session; a real download still happens at most every 12 hours. An interrupted or failed refresh no longer blocks the next one for 12 hours (`lastRunAt` is written only after success, `lastAttemptAt` separately; retry after 30 minutes).
- Storage: list run state (`listState`, small) is now separate from each list's parsed payload (`listData:<name>`). Existing data moves over on first start, one list at a time, and the old key is deleted only after the new copy reads back. A 304 no longer rewrites megabytes. Storage write failures (for example the 10 MB quota) are recorded and shown in the popup's list status instead of being dropped.
- YouTube: uBO filters re-synced to uAssets@205b212 (was 69831a8; scriptlets still uBO 1.75.0). Picks up the comment-posting user-agent cleanup and newer inline/prefetch ad edits.

## 0.2.21

- YouTube: a video stuck at 0:00 after its blocked ad (decoy) streams failed recovers sooner. When those streams failed and no video data has loaded, the one automatic reload now comes 7s after the last sign of progress instead of 15s. In replays of a real stuck start, the reload came at about 9s (about 12s when YouTube also sent its usual early "retry later" reply) instead of about 17s, and playback resumed about 2s later.
- A start that has loaded some video data keeps the full 15s wait.
- On those stuck starts, each YouTube "retry later" reply holds the reload for at most 10s, and all such holds end 8s after the first one began, so a steady stream of them can no longer keep the video at 0:00. Elsewhere a recent reply still holds the reload for up to 20s, and the reply watcher now runs whichever order the scripts load in.
- A "retry later" reply from the previous video no longer delays the next video's reload.
- Trade-off: a start that shows no progress for 7s after its ad streams failed is reloaded even if YouTube would have started it by itself a few seconds later.
- Settings in `localStorage["twitch-adblock-yt-opts"]`: `decoyGentleMs` (7000; `0` turns the faster reload off), `decoyWaitHoldMs` (10000), `decoyWaitCapMs` (8000).
- Twitch, Kick, and ordinary-site playback and blocking are unchanged.

## 0.2.20

- Ordinary-site blocking adds five network lists: HaGeZi Pro mini, uBO badware, Dandelion Sprout's Anti-Malware, Curben phishing, and AdGuard Base (EasyList already removed). About 212,000 domains in 2,655 rules.
- List packing no longer turns `$removeparam`, popup-only, redirect, CSP, or site-scoped rules into full domain blocks. `live-video.net` and the other player frame hosts stay off the block list.
- The 12-hour refresh downloads the same nine lists. A failed, empty, or garbage download keeps that list's last good copy.
- Twitch, YouTube, and Kick playback are unchanged.

## 0.2.19

- YouTube: the brief grey player error that flashed on some watch starts (a blocked decoy stream, before the real one plays) is held back. Only an error that appears before playback, within 5s of the start, is hidden, until playback starts or 5s pass. Errors after playback show at once. Turn it off with `{"errorFlash":"off"}` in `localStorage["twitch-adblock-yt-opts"]`.

## 0.2.18

- YouTube starts faster. Clicking to a new video starts in about 0.7-1.0s instead of 1.3-1.6s. Remaining cold-start delay is YouTube's own server-side wait.
- Lighter uBO layer payload: its page observer no longer polls the player on every DOM change, and skips non-watch pages. The duplicate feed/toast style is no longer injected next to youtube-ads.css.
- Twitch: the Browse (/directory) page no longer goes blank when an Ad feedback button has no card around it.
- `scripts/sync-ubo-youtube.mjs` runs on Windows and keeps its local patches on CRLF checkouts. New `scripts/bench-youtube.mjs` load benchmark.

## 0.2.17 (beta)

- YouTube: uBlock Origin's own YouTube filters (uAssets@69831a8, scriptlets from uBO 1.75.0, GPLv3) ported via `scripts/sync-ubo-youtube.mjs`: MAIN-world scriptlets (json-prune*, rpfr/replace-xhr, set-constant, nano-stb, trusted-edit-inbound-object, prevent-dom-bypass), isolated rpnt/rmnt, 2 CSS hides, 4 DNR rules (incl. the decoy `videoplayback?expire=` block). Homemade player ad-field strip and ytInitialPlayerResponse trap stand down when this layer is present; stall reload and doubleclick block kept. Attribution: src/vendor/LICENSE-uBlock.md.
- YouTube: stall reload sooner (~2s, quiet 1.5s, 2nd after 3.5s); doubleclick.net blocked for YouTube initiators.
- YouTube: progress-aware start-stall watchdog (500ms polls; reload only after >=4s from navigation and 3s with no progress; stops permanently once playback starts; 2nd reload >=6s after the 1st; max 2).
- Filter lists: quiet refresh ~5s after browser start (once per session, at most every 12h, per-list `! Expires` respected, ETag/If-Modified-Since), swapped into dynamic DNR rules; bundled ruleset restored on any error. "Update lists" runs the same refresh. New host permissions: easylist.to, pgl.yoyo.org, malware-filter.gitlab.io (list downloads only).
- Cosmetic filtering: EasyList `##`/`#@#` generic + site-specific (incl. `name.*`) element hiding via one `<style>`; procedural/scriptlet rules skipped; selectors sanitized; bundled snapshot refreshed with the lists.

## 0.2.16

- YouTube starts faster. Player requests are no longer marked "no ad". uBlock Origin keeps that switch off too. Ads are still removed from the player response, so the same video plays.
- The page-wide Object.assign hook is gone. It ran on every call YouTube made.
- When a YouTube video server cannot be reached (a name that does not resolve, a 403, or a 5xx), the same request moves to the next server YouTube lists for that video, then to its redirector. A dead server is skipped for 10 minutes. A failed answer is never read or held.
- If every server fails and the video is still at 0:00, the video is reloaded once, and a second time if needed. Never more than twice per video.
- The console says which server failed, which one worked, and how long the start took.
- Twitch, Kick, and ordinary-site blocking are unchanged.

## 0.2.15

- The YouTube start wait on the playback policy is cleared. That wait is how long the picture stays black after the length is already known. The audio target and the request keepalive stay. The server start switch stays on. Nothing seeks or pauses.

## 0.2.14

- The debug switch, Copy debug, and the in-page debug log are removed. Twitch, YouTube, and Kick playback are unchanged.

## 0.2.13

This is the only current build. Twitch, YouTube, Kick, and ordinary-site blocking are in this zip. There is no separate beta download.

- Includes the 0.2.12 work: packed EasyList, EasyPrivacy, Peter Lowe, and urlhaus lists, leftover-box hiding, IMDb sponsored billboards, Twitch directory ads, and Kick in-player skip.
- YouTube's server start switch stays on. Turning it off left the black spinner up. Server ABR stays on, so a video that only has a SABR address still has a stream.
- The "Experiencing interruptions?" toast is hidden in place. Deleting it made YouTube open it again and again. Saved and clipboard toasts stay.
- A paused start that already has picture data is still asked to play once. Nothing seeks or pauses.
- Update lists still only remembers the ask. It does not download a new list. Nothing fetches on its own.

## 0.2.12 — beta

- EasyList, EasyPrivacy, Peter Lowe, and the urlhaus malware list were packed again. The full uBO stack was not added.
- Stream allows are unchanged: YouTube and Kick stay allow-all frames, Twitch stays a plain allow, video CDNs stay allowed.
- The Update lists button still only remembers the ask. It does not download a new list.
- Stable Latest stays v0.2.3. This beta replaces the 0.2.11 try.

## 0.2.11 — beta

- IMDb sponsored banners, including the large name-page billboard, are hidden. The slot is on IMDb itself. Amazon’s ad host was already blocked. Posters stay.
- This hide runs with the ordinary-site sheet. Twitch, YouTube, and Kick playback are unchanged.
- Stable Latest stays v0.2.3. This beta replaces the 0.2.10 try.

## 0.2.10 — beta

- Twitch Browse directory ads (the top banner slot and in-grid Ad cards) are hidden. The player, usher, and gql are not rewritten.
- Amazon’s ad host is no longer let through on Twitch pages. gql.twitch.tv and the video CDNs, including usher on ttvnw.net, stay allowed.
- Stable Latest stays v0.2.3. This beta replaces the 0.2.9 try.

## 0.2.9 — beta

- Some other videos still sat on a black loading screen after 0.2.8, with the length already known and the player already trying to play. One well-known video was often ready in a couple of seconds on 0.2.8. This beta also clears the video start-buffer target in the playback response, and turns off the server start-buffer switch, including when that switch’s policies arrive as a list. When that switch is present, the player is told not to wait on the server’s bandwidth pick. The video address stays. Nothing seeks or pauses.
- Stable Latest stays v0.2.3. This beta replaces the 0.2.8 try.

## 0.2.8 — beta

- YouTube’s “Experiencing interruptions?” toast is removed when it appears, including when YouTube puts it back. Other toasts stay. This does not start the picture by itself.
- Some starts still sat on a black loading screen for about 11 seconds after the backoff clear, with the length already known and the player already trying to play. The start-buffer wait in that playback response, and the same wait in the player response, is cleared. A newer playback part no longer hides a later backoff. A paused start that already has picture data is asked to play once. Nothing seeks or pauses.
- Stable Latest stays v0.2.3. This beta replaces the 0.2.7 try.

## 0.2.7 — beta

- Copy debug prints the loaded extension version. It no longer always says 0.2.3.
- A later YouTube playback policy, and a backoff that arrives before the rest of that part, is still cleared. Picture bytes stay the same length.
- Stable Latest stays v0.2.3. This beta replaces the 0.2.6 try.

## 0.2.6 — beta

- YouTube search results drop sponsored cards (`searchPyvRenderer`) the same way Home does. The video results stay.
- Leftover ad boxes on ordinary sites can load their hide stylesheet. The file is listed as a web-accessible resource so Chrome can fetch it.
- The YouTube black-spinner fix from stable main is in this beta. A short “Blocking ads” chip shows once per video, then stays hidden until you open another video.
- Three more tracker hosts are blocked on ordinary sites: facebook.net, imasdk.googleapis.com, and fundingchoicesmessages.google.com. Twitch, YouTube, and Kick frames are still allowed through.
- Kick’s own player try is still included. The general list still skips Twitch, YouTube, and Kick. Update lists still only remembers the ask. This does not block every ad. Stable Latest stays v0.2.3.

## 0.2.5 — beta

- On ordinary websites, many ad servers are blocked and leftover ad boxes are hidden. This does not block every ad.
- Twitch and YouTube playback scripts match stable and were not edited for general blocking. Kick in-player ad skip from v0.2.4 is included; the general list still skips Kick.
- General blocking starts on. The popup can turn it off, allow the open page, or update the lists by hand. Nothing updates in the background.
- The gecko’s eyes glow while general blocking is on.
- This is a new beta. The stable download stays v0.2.3.

## 0.2.3

- On a Twitch tab, the popup answers correctly when the extension is on. Copy debug includes the log from that tab, including the on-screen blocking label when it is showing.
- Debug stays off until you turn it on. Opening the popup does not turn it on.
- Twitch live still uses upstream video-swap-new. YouTube ad stripping stays.

## 0.2.2

- Debug stays off until you turn it on in the popup. Copy debug is still there.
- Twitch live still uses upstream video-swap-new. YouTube ad stripping stays.

## 0.2.1

- The toolbar icon is a gecko head.
- Twitch live still uses upstream video-swap-new. YouTube ad stripping and the temporary debug popup stay.

## 0.2.0

- Twitch live midrolls use the upstream TwitchAdSolutions **video-swap-new** userscript (v1.55), copied unmodified into `src/vendor/` and run as the MAIN-world `document_start` script.
- The hand-written Twitch playlist rewrite (`src/page.js` / `src/playlist.js`) is removed.
- YouTube player/home ad stripping and the temporary debug popup are unchanged.
- MIT license for the vendored script is included in the zip.

## 0.1.22 — beta

- Live client-side ad cues (a `twitch-maf-ad` marker on a playlist whose segments stay live) now hide that ad player and resume the live video. The player is not reloaded for this, and it does not start a backup swap. If hiding the ad would take the only picture, the ad plays.
- VODs and clips are unchanged.
- The Save your Streak side-nav row is hidden by one stylesheet rule. The rule does not apply when that row contains the video.
- The reload ceiling (2 player reloads in any 60 seconds) and the false-alarm hold are unchanged.
- Debug stays on by default (temporary).

## 0.1.21 — beta

- Fixes a reload loop on high-resolution (1440p60 source) channels where the player kept going black every few seconds during a midroll. After a swap, the new master was checked on the first rung only. That rung could look clean while the rung the player was on still had the ad, so the swap was undone and redone over and over. The check now follows the rung the ad was seen on.
- A swap that is undone within 15 seconds is treated as a false alarm. The ad then plays on main for 60 seconds, doubling on repeats up to 240 seconds, instead of swapping again. This applies to both ways of leaving the backup.
- Hard ceiling: the player is reloaded at most twice in any rolling 60 seconds, whatever the cause. The ceiling lives in the page's single reload path, so every guard shares it. A reload to leave the backup that the ceiling holds back goes out first once there is room. If the page refuses a reload that a player worker allowed, the worker is told and retries once there is room, so the player is never left on a backup.
- Debug log shows why an ad was detected (`ad-seen`), when the hold applies (`hold`) and when the ceiling blocks a swap (`reload-ceiling`).
- Debug stays on by default (temporary).

## 0.1.20 — beta

- Midrolls that start after a normal page load are swapped to the backup stream. A clean probe no longer drops the channel session, and a master response that already serves the main stream no longer arms the moving-off guard.
- Backup first: when the adopted backup's playlist is dirty or missing, the next clean backup type is tried before real ads pass through.
- At most two player reloads per break: enter and leave. A backup that gets its own ad plays it through instead of hopping to another type.
- Twitch "maf" ad breaks (one `twitch-maf-ad` DATERANGE on playlists whose segments stay live) lose only that line. Segments and numbering are untouched, and they never start a backup swap or a reload. Debug mode logs "maf-ad tag removed".
- The moving-off guard expires after 10 seconds when no master fetch clears it.
- A stitched ad range that starts just past the newest segment counts as an ad break.
- `stripAds` drops ad slots that live video follows, never lists a live segment twice, and keeps segment numbers steady across refreshes. A break at the live edge passes through until it ends.
- Stream display ad wrappers are hidden unless they hold the video.
- Debug on by default (temporary): a fresh install records the in-memory debug log with no user action. Token redaction and local-only copies are unchanged, and OFF in the popup still turns it off for that tab. The version stays 0.1.20.
- The debug popup moved into `src/`. Copy reads the top frame, and longer token and session query names are redacted.

Earlier versions: see the [releases page](https://github.com/gecko-of-shadow/twitch-adblock/releases) and the git tags.
