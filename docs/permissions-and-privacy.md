# Permissions and privacy

[← Back to the README](../README.md)

In short: the extension does not send your browsing history anywhere. It downloads the public filter lists below. On Twitch it also asks Twitch for ad-free copies of the stream. It has no account and no analytics call of its own.

## Permissions

`manifest.json` requests three API permissions:

| Permission | Used for |
| --- | --- |
| `storage` | `chrome.storage.local` holds the ordinary-site on/off switch (`generalEnabled`, default on), allowed origins, a small list-refresh state key (`listState`: ETags, timestamps, counts, last errors), one payload key per list (`listData:<name>`: parsed domains and selectors, read only by the service worker), the status text, and cosmetic rules. |
| `declarativeNetRequest` | Static rulesets `general` (`src/rules/general-network.json`) and `ubo-youtube` (`src/rules/ubo-youtube-network.json`). Dynamic rules hold a refreshed domain block list, per-site allows, and an allow rule so list downloads are not blocked by those rules. |
| `alarms` | One alarm, `gecko-refresh`, every 3 hours, that wakes the service worker to check the lists. |

### Host permissions

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

### Not requested

The manifest does not request `tabs`, `activeTab`, `scripting`, `cookies`, `history`, `webRequest`, `unlimitedStorage`, or `declarativeNetRequestFeedback`.

## Privacy

### What it transmits

- **Filter lists.** The service worker downloads the nine public lists named under [Host permissions](#host-permissions). The `gecko-refresh` alarm wakes the worker every 3 hours (the first time 5 to 30 minutes after install or browser start). A refresh is skipped if one finished in the last 12 hours (or one failed in the last 30 minutes), and each list waits out its own `! Expires:` header (default 24 hours). **Update lists** checks every list immediately. Requests are HTTPS `GET`s with `credentials: "omit"` (no cookies). When a saved validator exists, the request also sends `If-None-Match` and `If-Modified-Since`. Those hosts see the list URL and this browser’s IP address. The page you are visiting is not part of the URL.
- **Twitch.** On Twitch pages, video-swap-new sends extra requests to Twitch (`gql.twitch.tv`, `usher.ttvnw.net`, and ad media URLs). Its GraphQL calls copy the page’s `Authorization` and `Client-Integrity` headers. Those requests go to Twitch.
- **YouTube.** On YouTube, the uBlock scripts wrap the page’s own XHR and fetch and edit the responses. `src/youtube.js` and `src/kick.js` do not call `fetch`. A declarativeNetRequest ruleset blocks some YouTube ad URLs (`src/rules/ubo-youtube-network.json`).

If a download fails, the packed rules stay in use.

### What it stores on this browser

Settings, list metadata, parsed domains, and cosmetic selectors stay in `chrome.storage`. The extension has no account and no analytics call of its own. The popup does not fetch. The `@updateURL` line in the vendored userscript header is a comment; the file shipped in this repo is the one that runs.
