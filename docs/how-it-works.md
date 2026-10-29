# How it works

[← Back to the README](../README.md)

This page has the technical detail for each site, and for the popup. The short version is in the [README](../README.md).

## Twitch

Covers `twitch.tv` and subdomains.

- **Live streams.** Live playlists are handled by [TwitchAdSolutions video-swap-new](https://github.com/pixeltris/TwitchAdSolutions) v1.55, copied unmodified into `src/vendor/video-swap-new.user.js`.
- **Ad breaks.** When a playlist contains the `stitched-ad` marker, the script requests backup playlists (player types `autoplay`, `picture-by-picture`, and `embed`) and prefers one without that marker. The last backup is still used if it has the marker. The player reloads back once the main playlist no longer has it. That backup ladder can be a lower resolution.
- **Browse pages.** Browse-page ad slots are hidden separately by `src/twitch-directory-ads.js` (the browse banner, elements labeled Advertisement, and the card around an ad-feedback button).
- **Every Twitch page.** The same Twitch script is injected on every Twitch page, including VODs and clips: it rewrites `PlaybackAccessToken` `playerType` to `popout`, and it reports the page as visible.

The extra requests this sends to Twitch are listed under [What it transmits](permissions-and-privacy.md#what-it-transmits).

## YouTube

Covers `youtube.com`, `www.youtube.com`, and `m.youtube.com`, top frame only.

- **Player ads.** uBlock Origin’s YouTube scriptlets (`src/vendor/ubo-youtube.js` and the isolated script) and `src/vendor/ubo-youtube.css`, from uBlock Origin 1.75.0, prune ads in player responses. While that layer is present, `src/youtube.js` does not strip player fields itself and does not run its DOM sweep.
- **Feed and toasts.** `src/youtube-ads.css` always hides sponsored feed cards and the “Experiencing interruptions?” toast. The toast is hidden in place. Saved and clipboard toasts stay.
- **Sponsors in the video.** Nothing in these files edits the video file, so a sponsorship that is part of the video still plays.
- **Other YouTube sites.** YouTube Music, `youtube-nocookie.com`, and YouTube Kids are outside these content scripts.

## Kick

Covers `kick.com` and subdomains.

- An in-player ad is skipped only when the IVS player can seek back to the stream without a long rewind, at most twice in 60 seconds. Otherwise the ad plays.
- The live video is left visible, audible, and at normal speed.
- A post-roll cover can be paused, and some ad chrome and page banners are hidden.

## Other websites

Covers other http and https sites. The README and the popup call these "ordinary sites".

- `declarativeNetRequest` blocks domains from the packed lists, and `src/cosmetic.js` hides leftover ad boxes.
- The packed snapshot in `src/rules/meta.json` is 211,995 domains.
- Twitch, YouTube (including `youtu.be`, nocookie, Kids, and the video CDNs), and Kick are excluded from this general pass.
- Ordinary-site blocking starts **on**.

How the lists are downloaded and refreshed: [What it transmits](permissions-and-privacy.md#what-it-transmits). To turn blocking off for one site: [Allow a page](allow-a-page.md).

## The popup

The popup turns ordinary-site blocking on or off and can ask for a list refresh. It also draws an **Allow this page** button.

### How the popup finds the page

This manifest does not include `tabs` or `activeTab`, so Chrome leaves `tab.url` unset on a normal page. The popup instead asks the page's top-frame content script (`src/cosmetic.js`) for its origin with `chrome.tabs.sendMessage`, and shows “Checking this page…” while it waits.

Pages without that script (Twitch, YouTube, Kick, Chrome's own pages, and pages opened before the extension loaded) give no answer, so the button stays disabled there with “Open a normal http(s) page to allow it. Already on one? Reload it.”
