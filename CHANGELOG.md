# Changelog

## 0.1.20 — beta

- Midrolls that start after a normal page load are swapped to the backup stream. A clean probe no longer drops the channel session, and a master response that already serves the main stream no longer arms the moving-off guard.
- Backup first: when the adopted backup's playlist is dirty or missing, the next clean backup type is tried before real ads pass through.
- The moving-off guard expires after 10 seconds when no master fetch clears it.
- A stitched ad range that starts just past the newest segment counts as an ad break.
- `stripAds` drops ad slots that live video follows, never lists a live segment twice, and keeps segment numbers steady across refreshes. A break at the live edge passes through until it ends.
- Stream display ad wrappers are hidden unless they hold the video.
- The debug popup moved into `src/`. Copy reads the top frame, and longer token and session query names are redacted.

Earlier versions: see the [releases page](https://github.com/gecko-of-shadow/twitch-adblock/releases) and the git tags.
