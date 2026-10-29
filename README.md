# 🦎 twitch-adblock

**Manifest V3 Chrome extension, version 0.2.21, covering Twitch, YouTube, Kick, and other sites.**

<p align="center">
  <img src="docs/gecko-avatar.jpg" width="168" alt="Green gecko holding a blue shield with a white prohibition symbol">
</p>

<p align="center">
  <img src="icons/icon48-working.png" width="48" height="48" alt="Toolbar icon while ordinary-site blocking is on: green gecko with an amber glowing eye">
  &nbsp;
  <img src="icons/icon48-off.png" width="48" height="48" alt="Toolbar icon while ordinary-site blocking is off: grey gecko with a half-shut eye">
</p>

🦎 The toolbar icon is a green gecko. An amber glowing eye means ordinary-site blocking is on. When it is off, the icon turns grey and the eye is half-shut. Twitch, YouTube, and Kick filters keep running either way.

That version is the `version` field in `manifest.json`. The matching release zip is [twitch-adblock-0.2.21.zip](https://github.com/gecko-of-shadow/twitch-adblock/releases/download/v0.2.21/twitch-adblock-0.2.21.zip) ([release v0.2.21](https://github.com/gecko-of-shadow/twitch-adblock/releases/tag/v0.2.21)).

## 🦎 Start here (plain words)

This part is for people who just want to use the extension. The sections after it go into detail.

### In short

- It blocks video ads on Twitch, YouTube, and Kick.
- It blocks ads on other websites, using public ad lists.
- It hides the empty boxes that ads leave behind on other websites.
- It works inside Chrome. No separate program is installed. There is no account.

### What it does not do

- Ads that are part of the video itself still play. Example: a YouTuber reading out a sponsor.
- On Twitch, the picture can drop to lower quality for a moment during an ad break. The stream keeps playing.
- Sometimes a Twitch ad still shows, when no ad-free copy of the stream is available.
- On Kick, some ads still play. It only skips an ad when it can do that safely.
- YouTube Music and YouTube Kids are not covered.
- It does not send your browsing history anywhere. It downloads the public ad lists. On Twitch it also asks Twitch for ad-free copies of the stream.

### How to install it

"Developer mode" is a Chrome switch that lets you add an extension from a folder on your computer. "Load unpacked" is the Chrome button that does that. The "toolbar" is the row of icons to the right of the address bar.

1. Get the extension files. Pick one:
   - Download [twitch-adblock-0.2.21.zip](https://github.com/gecko-of-shadow/twitch-adblock/releases/download/v0.2.21/twitch-adblock-0.2.21.zip) and unzip it.
   - Or, on this GitHub page, click the green **Code** button, then **Download ZIP**, and unzip it. This gives you the newest code, which may be newer than the last numbered release. Chrome still shows the version number of that release.
2. Open Chrome. Type `chrome://extensions` in the address bar and press Enter.
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked**.
5. Pick the unzipped folder. It is the folder that has `manifest.json` directly inside it.
6. Optional: click the puzzle-piece icon next to the address bar, then the pin next to **twitch-adblock**. Now the gecko stays visible in your toolbar.

Keep the folder where it is. Chrome runs the extension from that folder. If you had an older copy loaded, remove it first.

### How to allow a page

Some websites break or refuse to work when ads are blocked. You can switch off blocking for one website.

1. Open the website you want to allow.
2. Click the gecko icon in the toolbar. A small window opens.
3. Click **Allow this page**.
4. The button now says **Blocking this page** and is highlighted. That label means the site is now allowed. The line under it says **Allowed for this site:** and the site address.
5. Reload the page, so the things that were blocked can load.

What that changes:

- On that website, the extension stops blocking from the ad lists and stops hiding ad boxes.
- It counts for the whole website address (for example every page on `https://www.example.com`), not only the page you are on.
- Other addresses of the same site count separately. For example `example.com` without `www`, or `shop.example.com`. Allow each one you need.
- Chrome remembers it. It stays until you undo it.
- If you remove the extension, or load a new copy from a different folder, the allowed sites are forgotten. Allow them again.
- Twitch, YouTube, and Kick are not affected. Their ad filters always keep running.

How to undo it:

1. Open the same website.
2. Click the gecko icon.
3. Click **Blocking this page**. It goes back to **Allow this page**.
4. Reload the page.

When the window opens, the line under the button may say **Checking this page…** for a moment while it asks the page for its address.

If the button is grey and does nothing, the line under it says why. Common reasons:

- It says **Turn general blocking on to change page allows.** The **Block ads on ordinary sites** switch in the same window is off. Turn it on first.
- It says **Open a normal http(s) page to allow it. Already on one? Reload it.** This means one of these:
  - You are on Twitch, YouTube, or Kick. Allowing does not work there.
  - You are on a Chrome page, like a new tab or `chrome://extensions`. Allowing only works on normal websites.
  - The page was already open before you installed or reloaded the extension. Reload the page, then open the window again.

The 0.2.21 zip came out before the "Allow this page" fix, so in that copy the button always stays grey. A copy from **Download ZIP** has the fix.

## 🦎 What it does

- **Twitch** (`twitch.tv` and subdomains). Live playlists are handled by [TwitchAdSolutions video-swap-new](https://github.com/pixeltris/TwitchAdSolutions) v1.55, copied unmodified into `src/vendor/video-swap-new.user.js`. When a playlist contains the `stitched-ad` marker, the script requests backup playlists (player types `autoplay`, `picture-by-picture`, and `embed`) and prefers one without that marker. The last backup is still used if it has the marker. The player reloads back once the main playlist no longer has it. That backup ladder can be a lower resolution. Browse-page ad slots are hidden separately by `src/twitch-directory-ads.js` (the browse banner, elements labeled Advertisement, and the card around an ad-feedback button). The same Twitch script is injected on every Twitch page, including VODs and clips: it rewrites `PlaybackAccessToken` `playerType` to `popout`, and it reports the page as visible.
- **YouTube** (`youtube.com`, `www.youtube.com`, and `m.youtube.com`, top frame only). uBlock Origin’s YouTube scriptlets (`src/vendor/ubo-youtube.js` and the isolated script) and `src/vendor/ubo-youtube.css`, from uBlock Origin 1.75.0, prune ads in player responses. While that layer is present, `src/youtube.js` does not strip player fields itself and does not run its DOM sweep. `src/youtube-ads.css` always hides sponsored feed cards and the “Experiencing interruptions?” toast. The toast is hidden in place. Saved and clipboard toasts stay. Nothing in these files edits the video file, so a sponsorship that is part of the video still plays. YouTube Music, `youtube-nocookie.com`, and YouTube Kids are outside these content scripts.
- **Kick** (`kick.com` and subdomains). An in-player ad is skipped only when the IVS player can seek back to the stream without a long rewind, at most twice in 60 seconds. Otherwise the ad plays. The live video is left visible, audible, and at normal speed. A post-roll cover can be paused, and some ad chrome and page banners are hidden.
- **Other http and https sites.** `declarativeNetRequest` blocks domains from the packed lists, and `src/cosmetic.js` hides leftover ad boxes. The packed snapshot in `src/rules/meta.json` is 211,995 domains. Twitch, YouTube (including `youtu.be`, nocookie, Kids, and the video CDNs), and Kick are excluded from this general pass. Ordinary-site blocking starts **on**.

The popup turns ordinary-site blocking on or off and can ask for a list refresh. It also draws an **Allow this page** button. This manifest does not include `tabs` or `activeTab`, so Chrome leaves `tab.url` unset on a normal page. The popup instead asks the page's top-frame content script (`src/cosmetic.js`) for its origin with `chrome.tabs.sendMessage`, and shows “Checking this page…” while it waits. Pages without that script (Twitch, YouTube, Kick, Chrome's own pages, and pages opened before the extension loaded) give no answer, so the button stays disabled there with “Open a normal http(s) page to allow it. Already on one? Reload it.”

## Install

There is no build step. Load the folder that contains `manifest.json`.

**Release zip**

1. Download [twitch-adblock-0.2.21.zip](https://github.com/gecko-of-shadow/twitch-adblock/releases/download/v0.2.21/twitch-adblock-0.2.21.zip).
2. Unzip it. The zip root is `manifest.json`, `src/`, and `icons/`.
3. Open `chrome://extensions`.
4. Turn on **Developer mode**.
5. Choose **Load unpacked** and select that unzipped folder.

**Git clone**

Load this repository’s root (the directory that contains `manifest.json`). `docs/`, `test/`, and `scripts/` are not part of the running extension.

All releases are listed at [github.com/gecko-of-shadow/twitch-adblock/releases](https://github.com/gecko-of-shadow/twitch-adblock/releases). If an older unpacked copy is already loaded, remove it before loading this folder.

## Permissions

`manifest.json` requests two API permissions:

| Permission | Used for |
| --- | --- |
| `storage` | `chrome.storage.local` holds the ordinary-site on/off switch (`generalEnabled`, default on), allowed origins, list-refresh state (parsed domains, ETags, timestamps, status text), and cosmetic rules. `chrome.storage.session` holds a flag so the quiet refresh runs once per browser session. |
| `declarativeNetRequest` | Static rulesets `general` (`src/rules/general-network.json`) and `ubo-youtube` (`src/rules/ubo-youtube-network.json`). Dynamic rules hold a refreshed domain block list, per-site allows, and an allow rule so list downloads are not blocked by those rules. |

Host permissions, all for downloading public filter lists:

- `https://easylist.to/*` — EasyList and EasyPrivacy
- `https://pgl.yoyo.org/*` — Peter Lowe’s list
- `https://malware-filter.gitlab.io/*` — URLhaus hosts and the Curben phishing list
- `https://ublockorigin.github.io/*` — EasyList mirrors and uBlock Origin badware
- `https://easylist-downloads.adblockplus.org/*` — EasyList mirrors
- `https://secure.fanboy.co.nz/*` — EasyList mirrors
- `https://raw.githubusercontent.com/hagezi/dns-blocklists/*` — HaGeZi Pro mini
- `https://raw.githubusercontent.com/DandelionSprout/adfilt/*` — Dandelion Sprout’s Anti-Malware List
- `https://filters.adtidy.org/extension/ublock/*` — AdGuard Base

The manifest does not request `tabs`, `activeTab`, `scripting`, `cookies`, `history`, `webRequest`, or `alarms`.

## 🦎 Privacy

**What it transmits**

- The service worker downloads those nine public lists. A quiet refresh starts 5 seconds after the worker starts, once per browser session. It is skipped if a refresh finished in the last 12 hours, and each list waits out its own `! Expires:` header (default 24 hours). **Update lists** checks every list immediately. Requests are HTTPS `GET`s with `credentials: "omit"` (no cookies). When a saved validator exists, the request also sends `If-None-Match` and `If-Modified-Since`. Those hosts see the list URL and this browser’s IP address. The page you are visiting is not part of the URL.
- On Twitch pages, video-swap-new sends extra requests to Twitch (`gql.twitch.tv`, `usher.ttvnw.net`, and ad media URLs). Its GraphQL calls copy the page’s `Authorization` and `Client-Integrity` headers. Those requests go to Twitch.
- On YouTube, the uBlock scripts wrap the page’s own XHR and fetch and edit the responses. `src/youtube.js` and `src/kick.js` do not call `fetch`. A declarativeNetRequest ruleset blocks some YouTube ad URLs (`src/rules/ubo-youtube-network.json`).

If a download fails, the packed rules stay in use.

**What it stores on this browser**

Settings, list metadata, parsed domains, and cosmetic selectors stay in `chrome.storage`. The extension has no account and no analytics call of its own. The popup does not fetch. The `@updateURL` line in the vendored userscript header is a comment; the file shipped in this repo is the one that runs.

## Credits

- Twitch live swap: TwitchAdSolutions video-swap-new v1.55, MIT, [upstream](https://github.com/pixeltris/TwitchAdSolutions) and [`src/vendor/LICENSE-TwitchAdSolutions`](src/vendor/LICENSE-TwitchAdSolutions).
- YouTube layer: uBlock Origin 1.75.0 and uAssets, GPLv3. See [`src/vendor/LICENSE-uBlock.md`](src/vendor/LICENSE-uBlock.md).
- Ordinary-site lists: The EasyList authors and the other lists named above. See [`src/rules/LICENSES.md`](src/rules/LICENSES.md).

## Development

```bash
deno test --no-lock --allow-read --allow-run --allow-env test/
bash scripts/release-gate.sh
bash scripts/pack-zip.sh
```

`scripts/pack-zip.sh` writes `twitch-adblock-<version>.zip` containing `manifest.json`, `src/`, and `icons/`.
