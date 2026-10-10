# Changelog

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
