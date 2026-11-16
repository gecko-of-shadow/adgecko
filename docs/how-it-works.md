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

- **Player ads.** uBlock Origin’s YouTube scriptlets (`src/vendor/ubo-youtube.js` and the isolated script) and `src/vendor/ubo-youtube.css`, from uBlock Origin 1.75.0, prune ads in player responses. While that layer is present, `src/youtube.js` does not strip player fields itself and does not watch the page for changes. After each navigation it removes some leftover ad nodes, but it does not show the “Blocking ads” chip for them and does not hide toasts itself.
- **Feed and toasts.** `src/youtube-ads.css` always hides sponsored feed cards and the “Experiencing interruptions?” toast. The toast is hidden in place. Saved and clipboard toasts stay.
- **Sponsors in the video.** Nothing in these files edits the video file, so a sponsorship that is part of the video still plays.
- **Other YouTube sites.** The YouTube ad scripts and hide sheets do not run on YouTube Music, YouTube Studio, YouTube TV, `youtube-nocookie.com` or YouTube Kids. These hosts get only `src/settings/flags.js`, which tells the popup the page origin (see [How the popup finds the page](#how-the-popup-finds-the-page)).
- **Embedded players.** A YouTube player that another website embeds (an `/embed/` frame of `www.youtube.com` or `youtube-nocookie.com`) is a child frame. The YouTube ad scripts run in the top frame only, so they do not run in that player. Only the network block rules apply there.

## Kick

Covers `kick.com` and subdomains.

- An in-player ad is skipped only when the IVS player can seek back to the stream without a long rewind, at most twice in 60 seconds. Otherwise the ad plays.
- The live video is left visible, audible, and at normal speed.
- A post-roll ad cover is hidden and its clip paused, but only when nothing in it could be the live player: a video with a stream source (`blob:` or a stream object), an endless length, or a source or length not known yet keeps the cover visible. Some ad chrome and page banners are hidden too.

## Other websites

Covers other http and https sites. The README and the popup call these "ordinary sites".

- `declarativeNetRequest` blocks domains from the packed lists, and `src/cosmetic.js` hides leftover ad boxes.
- The packed snapshot in `src/rules/meta.json` is 195,069 whole-domain and 18,422 scoped entries in 2,851 list rules (lists downloaded 2026-11-14 22:00 UTC). The merged `general-network.json` has 2,856 rules. `src/rules/meta.json` always has the current totals (`domains_total`, `scoped_entries_total`, `dnr_rules_total` and `general_network_rules_total`); `test/docs-claims.test.js` checks that the numbers here agree with it.
- A site is blocked from opening (Chrome shows "blocked by an extension") only when a list says so with an explicit `$document` filter or a plain `$all` filter, or when it is a known malware host (the threat tier). A whole-domain entry blocks the site's pieces inside other pages, not opening it. Filters that name only types to skip (`$~script`) never block opening the site. Twitch, YouTube, Kick and their player hosts, and a few affiliate redirectors people click on purpose, are never blocked from opening by the lists. To open such a page anyway: settings page -> **Allow this domain** ([Allow a site](allow-a-page.md#a-page-chrome-says-is-blocked)).
- Twitch, YouTube (including `youtu.be`, nocookie, Kids, and the video CDNs), and Kick are excluded from this general pass.
- Ordinary-site blocking starts **on**.

How the lists are downloaded and refreshed: [What it transmits](permissions-and-privacy.md#what-it-transmits). To turn blocking off for one site: [Allow a site](allow-a-page.md).

## Page guards

On ordinary sites (never Twitch, YouTube or Kick) two small scripts run in the page itself, in every frame including blank and `srcdoc` frames:

- **Clipboard guard (on by default).** Checks `navigator.clipboard.writeText` and `.write`, `document.execCommand("copy"/"cut")`, the browser's own copy of the selection, and the text a copy handler sets. A command that looks like the "paste this into Run / PowerShell / a terminal" trick is not written unless you copied exactly that text yourself (Ctrl/Cmd+C or the context menu on your selection) or the site is a known documentation host. A copy button on the page does not count. A short notice explains it.
- **Pop-up guard (off by default).** Blocks `window.open` without a click, a second window per click, and pop-unders from clicks on plain page content, unless the target is the same site (same registrable domain) or a known sign-in or share page. A key press in a focused control (for example Enter in a search box) starts a new gesture of its own. Limits: the guard checks only `window.open`. A new window from a link with `target="_blank"` (also a script `.click()` on such a link) or from a form with `target="_blank"` is not checked. Each frame judges its own clicks, so a `window.open` in a same-site child frame after a click in the parent is not checked as a pop-under, and a new blank frame has the guard off until its switch arrives.

Both get their on/off switch from the extension over a private channel the page cannot read or forge, and both keep working if the page replaces built-in functions after it loads.

## The popup

The popup shows the site, one status line (**✅ Protected** or **Allowed – not blocking here**), a **Fix this site** button (turns off hide rules and the page guards for that site only, then asks whether that helped; **No** puts back exactly what it changed), **Allow this site** / **Block again**, and a folded **Show more** with the list and feed status and the version. The gear opens the settings page, which has every other switch, the per-site list, list updates and the popup theme. A small magenta dot on the toolbar icon means a page guard blocked something on that tab; opening the popup says what and clears it.

### How the popup finds the page

This manifest does not include `tabs` or `activeTab`, so Chrome leaves `tab.url` unset on a normal page. The popup instead asks the page's top-frame content script (`src/cosmetic.js`) for its origin with `chrome.tabs.sendMessage`, and shows “Checking this page…” while it waits.

On Twitch, YouTube and Kick `src/settings/flags.js` answers instead. This includes YouTube Music, YouTube Studio, YouTube TV, YouTube Kids and `youtube-nocookie.com`. There, no ad script runs, so the popup shows “Malware blocking only – ad scripts don't run on this site” (or “Nothing runs on this site” when the malware lists are off), and **Allow this site** and **Fix this site** stay disabled. Pages with neither script (Chrome's own pages, pages opened before the extension loaded, and sites that are outside the **Site access** you gave the extension in `chrome://extensions`) give no answer, so the button stays disabled there with “Open a normal http(s) page to allow it. Already on one? Reload it.”
