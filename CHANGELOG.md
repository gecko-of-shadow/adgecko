# Changelog

## 0.1.21 — beta

- Fixes a reload loop on high-resolution (1440p60 source) channels where the player kept going black every few seconds during a midroll. After a swap, the new master was checked on the first rung only. That rung could look clean while the rung the player was on still had the ad, so the swap was undone and redone over and over. The check now follows the rung the ad was seen on.
- A swap that is undone within 15 seconds is treated as a false alarm. The ad then plays on main for 60 seconds, doubling on repeats up to 240 seconds, instead of swapping again. This applies to both ways of leaving the backup.
- Hard ceiling: the player is reloaded at most twice in any rolling 60 seconds, whatever the cause. The ceiling lives in the page's single reload path, so every guard shares it. A reload to leave the backup that the ceiling holds back goes out first once there is room.
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
