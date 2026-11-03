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
- A post-roll ad cover is hidden and its clip paused, but only when nothing in it could be the live player: a video with a stream source (`blob:` or a stream object), an endless length, or a source or length not known yet keeps the cover visible. Some ad chrome and page banners are hidden too.

## Other websites

Covers other http and https sites. The README and the popup call these "ordinary sites".

- `declarativeNetRequest` blocks domains from the packed lists, and `src/cosmetic.js` hides leftover ad boxes.
- The packed snapshot in `src/rules/meta.json` is 186,987 whole-domain and 4,035 scoped entries in 2,421 rules (packed 2026-11-03 16:31 UTC).
- Twitch, YouTube (including `youtu.be`, nocookie, Kids, and the video CDNs), and Kick are excluded from this general pass.
- Ordinary-site blocking starts **on**.

How the lists are downloaded and refreshed: [What it transmits](permissions-and-privacy.md#what-it-transmits). To turn blocking off for one site: [Allow a site](allow-a-page.md).

## Page guards

On ordinary sites (never Twitch, YouTube or Kick) two small scripts run in the page itself, in every frame including blank and `srcdoc` frames:

- **Clipboard guard (on by default).** Checks `navigator.clipboard.writeText` and `.write`, `document.execCommand("copy"/"cut")`, the browser's own copy of the selection, and the text a copy handler sets. A command that looks like the "paste this into Run / PowerShell / a terminal" trick is not written unless you copied exactly that text yourself (Ctrl/Cmd+C or the context menu on your selection) or the site is a known documentation host. A copy button on the page does not count. A short notice explains it.
- **Pop-up guard (off by default).** Blocks `window.open` without a click, a second window per click, and pop-unders from clicks on plain page content, unless the target is the same site (same registrable domain) or a known sign-in or share page.

Both get their on/off switch from the extension over a private channel the page cannot read or forge, and both keep working if the page replaces built-in functions after it loads.

## The popup

The popup shows the site, one status line (**✅ Protected** or **Allowed – not blocking here**), a **Fix this site** button (turns off hide rules and the page guards for that site only, then asks whether that helped; **No** puts back exactly what it changed), **Allow this site** / **Block again**, and a folded **Show more** with the list and feed status and the version. The gear opens the settings page, which has every other switch, the per-site list, list updates and the popup theme. A small magenta dot on the toolbar icon means a page guard blocked something on that tab; opening the popup says what and clears it.

### How the popup finds the page

This manifest does not include `tabs` or `activeTab`, so Chrome leaves `tab.url` unset on a normal page. The popup instead asks the page's top-frame content script (`src/cosmetic.js`) for its origin with `chrome.tabs.sendMessage`, and shows “Checking this page…” while it waits.

Pages without that script (Twitch, YouTube, Kick, Chrome's own pages, and pages opened before the extension loaded) give no answer, so the button stays disabled there with “Open a normal http(s) page to allow it. Already on one? Reload it.”
