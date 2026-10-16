# Changelog

## 0.2.17 (beta)

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
