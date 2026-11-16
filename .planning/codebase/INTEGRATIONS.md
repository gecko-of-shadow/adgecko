# External integrations

Analysis date: 2026-11-16
Commit: b01e6a5

This document lists each external system that Adgecko 0.3.5 contacts or uses.
It also lists the systems that the extension does not contact.

The word UNVERIFIED marks a statement about runtime behaviour that comes only from a comment or a doc.
No test was run and the extension was not loaded for this analysis.
Statements without that mark describe what the code text says. They are not proof of behaviour in Chrome.

## 1. Summary

| Integration | Direction | Active in 0.3.5 | Main files |
|---|---|---|---|
| Eight public filter lists (eight hosts with the mirrors, nine host patterns in the manifest) | Service worker downloads | Yes | `src/general/update.js`, `src/general-background.js` |
| Signed threat feed | Service worker downloads | No (dormant) | `src/feed/*` |
| Twitch (GraphQL, playlists, media) | Page script sends requests | Yes, on Twitch pages only | `src/vendor/video-swap-new.user.js` |
| YouTube | No request to a host of the extension. Scripts wrap the page's own requests (section 6). | Yes, on YouTube pages only | `src/vendor/ubo-youtube*.js`, `src/youtube.js` |
| Upstream repositories (vendored code) | Developer tools download | Developer PC and CI only | `scripts/update-twitch-vendor.mjs`, `scripts/sync-ubo-youtube.mjs` |
| Filter list packer | Developer tool downloads | Developer PC only | `scripts/pack-filter-lists.py` |
| GitHub Actions | CI and release | Yes | `.github/workflows/*.yml` |
| `chrome.storage.local` and `chrome.storage.session` | Local data only | Yes | See section 9 |

## 2. Filter list sources

### 2.1 Inventory

The runtime source table is `SOURCES` in `src/general/update.js:69-92`.
The pack-time source table is `SOURCES` in `scripts/pack-filter-lists.py:31-112`.
The two tables use the same eight names and the same primary URLs.
The pack-time table has no mirrors. It holds the licence text, the role and the priority of each list.
`src/rules/meta.json:10-99` records the URL, SHA-256, role and priority of each packed list.
`src/rules/LICENSES.md:26-82` records the licence text for each list.

| List id | Primary URL host | Role | Pack priority | Licence (from `src/rules/LICENSES.md`) | Runtime options (`update.js`) |
|---|---|---|---|---|---|
| `peter_lowe` | `pgl.yoyo.org` | `ads_trackers` | 100 | Free for personal and non-commercial use. Credit is necessary. | `minDomains` 1000 (line 70) |
| `urlhaus_hosts` | `malware-filter.gitlab.io` | `malware_threat` | 90 | Repository: CC0 1.0 and MIT. URLhaus data: CC0 1.0. | `maxDomains` 8000, `minDomains` 50 (line 71) |
| `easylist` | `easylist.to` | `ads` | 70 | GPL-3.0-or-later or CC BY-SA 3.0-or-later | `cosmetic: true`, `minDomains` 10000, three mirrors (lines 72-76) |
| `easyprivacy` | `easylist.to` | `privacy` | 50 | Same dual licence as `easylist` | `cosmetic: true`, `minDomains` 10000, three mirrors (lines 77-81) |
| `hagezi_pro_mini` | `raw.githubusercontent.com` | `ads_trackers` | 40 | GPL-3.0 | `minDomains` 10000 (line 82) |
| `ublock_badware` | `ublockorigin.github.io` | `malware_threat` | 35 | GPL-3.0 | `minDomains` 500 (line 83) |
| `dandelion_antimalware` | `raw.githubusercontent.com` | `malware_threat` | 30 | Dandelicence v1.4 | `minDomains` 1000 (line 84) |
| `adguard_base` | `filters.adtidy.org` | `ads` | 20 | GPL-3.0 | `minDomains` 1000, network rules only (lines 85-91) |

The licence column is a short form. Read `src/rules/LICENSES.md` for the full text and the credit lines.
`src/rules/LICENSES.md:92-95` states that the EasyList material is redistributed under CC BY-SA 3.0-or-later.
`src/LICENSE-EasyList.txt` and `src/rules/CREDIT-EasyList.txt` are in the tree. This analysis did not read them.

### 2.2 Mirrors

Only `easylist` and `easyprivacy` have mirrors (`src/general/update.js:72-81`).
The refresh tries the primary URL first, then each mirror in the given sequence (`src/general/update.js:875`).

| Mirror host | Lists |
|---|---|
| `ublockorigin.github.io` | `easylist`, `easyprivacy` |
| `easylist-downloads.adblockplus.org` | `easylist`, `easyprivacy` |
| `secure.fanboy.co.nz` | `easylist`, `easyprivacy` |

### 2.3 Host allow-lists

Three places must agree when a list host changes.

| Place | Content | Reference |
|---|---|---|
| `LIST_HOSTS` | Eight host names | `src/general/update.js:93` |
| `host_permissions` | Nine patterns. Two patterns limit `raw.githubusercontent.com` to one repository path each. One pattern limits `filters.adtidy.org` to `/extension/ublock/`. | `manifest.json:12-22` |
| Release gate | An empty list, or the exact `host_permissions` list, or that list plus one feed host when `FEED_ORIGIN` is set | `scripts/release-gate.sh:311-325` |

The worker rejects each list request whose URL fails `isListUrl` (`src/general-background.js:581-584`).
`isListUrl` accepts only `https:` URLs whose host is in `LIST_HOSTS` (`src/general/update.js:1321-1328`).

A dynamic allow rule (id 990001, priority 3,000,000) protects the list downloads from block rules.
The rule matches the list hosts, the extension as initiator, and the types `xmlhttprequest` and `other` (`src/general/update.js:94-107`).
The worker installs this rule in `ensureListAllowRule` (`src/general-background.js:407-421`).

### 2.4 Roles and the threat tier

Three lists feed the threat tier: `urlhaus_hosts`, `ublock_badware` and `dandelion_antimalware` (`src/threat/compile.js:18`).
`src/rules/threat-meta.json:20-45` records the packed threat counts for these three lists.
The packed threat set has 15,865 hosts in 199 rules at priority 2,000,010 (`src/rules/threat-meta.json:4`, `:46`, `:48`).

### 2.5 Source rules and removed sources

- `urlhaus_hosts` is the only list from the malware-filter project. Its one permitted URL is in `src/rules/LICENSES.md:15-24`.
- `scripts/release-gate.sh:549-563` runs `scripts/lib/curben_check.py` to enforce that rule.
- `scripts/release-gate.sh:644-653` rejects each other URL on a malware-filter host in the JavaScript files.
- The list `curben_phishing` is retired. The refresh deletes its stored data (`src/general/update.js:741-764`).
- The refresh and the packer drop one phishing-feed section of the `ublock_badware` list (`src/general/update.js:187-191`).
- `adguard_base` supplies network rules only. Its hide rules were removed because of the storage quota (`src/general/update.js:85-91`).

### 2.6 Packed snapshot

`scripts/pack-filter-lists.py` downloads the eight lists and writes the packed data in `src/rules/`.
The packer sends a `User-Agent` header and uses a 120 second timeout (`scripts/pack-filter-lists.py:609-622`).
The packer downloads from the primary URL only. It sends no conditional header.
The packer keeps the raw lists in `scripts/.list-cache/` (`scripts/pack-filter-lists.py:22`), which `.gitignore:5` excludes.

| Fact | Value | Reference |
|---|---|---|
| Lists packed at (UTC) | 2026-11-14T22:00:32Z | `src/rules/meta.json:2` |
| Whole domains | 195,069 | `src/rules/meta.json:4` |
| Scoped entries | 18,422 | `src/rules/meta.json:5` |
| List rules | 2,851 | `src/rules/meta.json:6` |
| Rules in `general-network.json` | 2,856 | `src/rules/meta.json:154` |
| Domains for each rule | 80 | `src/rules/meta.json:7` |

`docs/how-it-works.md:40` gives older counts (2026-11-09). That doc line is out of date.

## 3. Fetch policy for the filter lists

The policy name is `alarm-and-manual` (`src/general/update.js:17`).

### 3.1 Schedule

| Item | Value | Reference |
|---|---|---|
| Alarm name | `gecko-refresh` | `src/general/update.js:18` |
| Alarm period | 180 minutes | `src/general/update.js:19` |
| First alarm delay | 5 to 30 minutes (random) | `src/general-background.js:931` |
| Minimum interval after a successful run | 12 hours | `src/general/update.js:20`, `:624-630` |
| Minimum interval after a failed attempt | 30 minutes | `src/general/update.js:21`, `:629` |
| Default list expiry | 24 hours | `src/general/update.js:22` |
| List expiry from the `! Expires:` header | Minimum 12 hours, maximum 7 days | `src/general/update.js:396-403` |
| Manual run | Always runs, and checks each list | `src/general/update.js:625`, `:636` |
| Manual trigger | Message type `updateLists` from the popup or the settings page | `src/general-background.js:871-874`, `:1195-1198` |
| Run on first install | One manual-type refresh | `src/general-background.js:990` |

The worker creates the alarm only when it is missing (`src/general-background.js:945-956`).
The alarm listener starts the list refresh and the feed check (`src/general-background.js:958-964`).
The release gate permits only this one alarm and no `setInterval` in the worker (`scripts/release-gate.sh:719-727`).
`lastAttemptAt` is written at the start of each run (`src/general/update.js:850`).
`lastRunAt` is written only after a run in which a list server gave an answer (`src/general/update.js:1001-1006`, `:1060`).

### 3.2 Request options

Each list request uses these options (`src/general/update.js:887`).

| Option | Value | Effect |
|---|---|---|
| `credentials` | `"omit"` | The request sends no cookies. |
| `cache` | `"no-cache"` | The browser cache must revalidate. |
| `redirect` | `"error"` | A redirect counts as a failed source. |
| `signal` | Abort after 90 seconds | `FETCH_TIMEOUT_MS`, `src/general/update.js:34`, `:882-883` |

The method is the `fetch` default (`GET`). The code sets no method and no body.

### 3.3 Conditional requests

- The refresh sends `If-None-Match` when an ETag is stored (`src/general/update.js:879`).
- The refresh sends `If-Modified-Since` when a `Last-Modified` value is stored (`src/general/update.js:880`).
- The refresh sends these headers only to the URL that supplied them (`src/general/update.js:877-881`).
- A `304` answer updates only `fetchedAt` (`src/general/update.js:906-910`).
- A `200` answer stores the new `ETag` and `Last-Modified` values after the payload is stored (`src/general/update.js:949-964`).
- A list with no stored payload, or with an old parser version, is downloaded without validators (`src/general/update.js:857-861`).

### 3.4 Limits and checks on a download

| Check | Value | Reference |
|---|---|---|
| Maximum body size | 16 MB. The read stops and cancels above this size. | `src/general/update.js:36`, `:39-66` |
| Body read inside the timeout | Yes | `src/general/update.js:889-892` |
| Minimum parsed entries | `minDomains` for each list, default 50 | `src/general/update.js:915-916` |
| Maximum size change in one refresh | 25 % | `src/general/update.js:651`, `:701-708` |
| Protected stream hosts in one list | 25. `hagezi_pro_mini` has an adaptive limit with seed 64. | `src/general/update.js:653-666`, `:691-698` |
| Generic hide rules | 30,000 | `src/general/update.js:667` |
| New threat hosts in one refresh | 2,500, and 20 % of the previous set | `src/general/update.js:522-523` |
| Refreshed set against packed set | Not less than 50 % | `src/general/update.js:1179` |

A rejected list keeps its last good copy (`src/general/update.js:936-947`).
A failure of one list does not stop the other lists (`src/general/update.js:968-972`).
When a download fails, the packed rules or the last good rules stay active (`src/general/update.js:1011-1027`).
The packed `general` ruleset stays enabled as the offline floor (`src/general/update.js:1184-1190`).

### 3.5 What a list server receives

The request has the list URL, the conditional headers, and no cookies.
The URL contains no page address. The source table has only fixed URLs (`src/general/update.js:69-92`).
UNVERIFIED: `docs/permissions-and-privacy.md:47` states that the hosts see the list URL and the IP address of the browser.

## 4. Signed threat feed

### 4.1 Dormant state

The feed is dormant in 0.3.5.
`FEED_ORIGIN` is an empty string (`src/feed/config.js:8`).
`FEED_KEYS` and `KILL_KEYS` are empty objects (`src/feed/keys.js:10-11`).
`manifest.json:12-22` has no feed host.
While dormant, `checkFeed` returns before a request (`src/feed/client.js:204-206`).
While dormant, `applyCached` writes only the status `dormant` (`src/feed/client.js:162-168`).
The worker loads the seven feed files with `importScripts` in each start (`src/general-background.js:7-8`).

### 4.2 The three conditions to activate the feed

`configured` in `src/feed/client.js:24-39` requires all three conditions. `src/feed/config.js:1-6` lists the same conditions.

1. `FEED_ORIGIN` is a bare `https` origin with no path (`src/feed/client.js:27-34`).
2. `FEED_KEYS` holds a minimum of one public key (`src/feed/client.js:35`).
3. `host_permissions` in `manifest.json` contains `FEED_ORIGIN + "/*"` (`src/feed/client.js:36-37`).

The release gate permits exactly one extra host, and only when `FEED_ORIGIN` is set (`scripts/release-gate.sh:311-325`).
The procedure for the owner is in `docs/feed-setup.md`.
The feed host name is an open decision (D-1 in `src/feed/config.js:1-2`).

### 4.3 Fetch policy

| Item | Value | Reference |
|---|---|---|
| Trigger | The `gecko-refresh` alarm (each 3 hours) | `src/general-background.js:958-964`, `src/feed/client.js:203` |
| Files | `/feed.json.sig` first, then `/feed.json` | `src/feed/config.js:9-10`, `src/feed/client.js:226-228` |
| `credentials` | `"omit"` | `src/feed/client.js:82` |
| `cache` | `"no-store"` | `src/feed/client.js:82` |
| `redirect` | `"error"` | `src/feed/client.js:82` |
| Timeout | 15 seconds | `src/feed/client.js:12`, `:79` |
| Signature file size limit | 1,024 bytes | `src/feed/client.js:13`, `src/feed/canonical.js:11` |
| Feed file size limit | 512 KB | `src/feed/canonical.js:10` |
| Origin check on the answer | The answer URL must have the feed origin. | `src/feed/client.js:84` |
| Worker guard | The URL must start with `FEED_ORIGIN + "/"`. | `src/general-background.js:364-368` |
| `Content-Length` check | A larger value than the limit stops the read. The stream read also stops at the limit. | `src/feed/client.js:41-73`, `:85-87` |
| Conditional requests | None | `src/feed/client.js:75-94` |
| Same file again | Same bytes and signature as the applied file: the client records a good check and changes no rule. | `src/feed/client.js:233-245` |

When the feed is configured, the worker adds the feed host to the list-download allow rule (`src/general-background.js:410-411`).

### 4.4 Signature format

- The algorithm is Ed25519 through WebCrypto (`src/feed/verify.js:14-18`, `:31`).
- A public key is the base64 text of 32 raw bytes (`src/feed/keys.js:5`, `src/feed/verify.js:16`).
- The signature covers the exact bytes of `feed.json`. No JSON canonical form is used (`src/feed/canonical.js:5-8`).
- `feed.json` must be UTF-8, must have no BOM, and must not be empty (`src/feed/canonical.js:37-48`).
- `feed.json.sig` has exactly two lines: `keyId=<id>`, then the base64 signature of 64 bytes (`src/feed/canonical.js:51-62`).
- The key id must match `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$` (`src/feed/canonical.js:12`).
- The client verifies the signature before it parses the JSON (`src/feed/verify.js:5-9`, `:43-49`).
- A key id that is in the two key sets is rejected (`src/feed/verify.js:28`).
- A feed key can sign only feed documents. A kill key can sign only the kill document (`src/feed/verify.js:50-53`).

### 4.5 Schema limits (format 1)

| Field or limit | Rule | Reference |
|---|---|---|
| Permitted keys | `format`, `serial`, `createdAt`, `notBefore`, `notAfter`, `minExtension`, `maxExtension`, `killFeed`, `dropRuleIds`, `rollbackTo`, `dnr`, `cosmetic`, `tactics` | `src/feed/schema.js:41` |
| Necessary keys | `format`, `serial`, `createdAt`, `notBefore`, `notAfter`, `dnr` | `src/feed/schema.js:42` |
| Unknown key | Rejects the full document. This also applies to each `dnr` entry. | `src/feed/schema.js:81-83`, `:91`, `:142` |
| `serial` | Positive integer, larger than the stored serial | `src/feed/schema.js:94-95` |
| Maximum `serial` | 2,147,483,647 | `src/feed/schema.js:36` |
| Maximum `serial` step | 1,000,000 while the stored document is valid | `src/feed/schema.js:37`, `:76-79` |
| Lifetime | `notAfter` is a maximum of 14 days after `createdAt` and after `notBefore`. | `src/feed/schema.js:34`, `:103-104` |
| Clock difference | 1 hour | `src/feed/schema.js:35`, `:105-106` |
| Time format | ISO-8601 UTC with `Z` | `src/feed/schema.js:45` |
| Validity window | The document is rejected before `notBefore` and at or after `notAfter`. | `src/feed/schema.js:107-108` |
| `minExtension`, `maxExtension` | Dotted version or `null`. The document is rejected outside the range. | `src/feed/schema.js:109-115` |
| `dnr` entries | Maximum 4,500. Ids 1 to 4,500, each one time only. | `src/feed/schema.js:38`, `:135`, `:143-145` |
| Hosts in one entry | 1 to 80, lower case, each one time only | `src/feed/schema.js:39`, `:147-152` |
| Entry action | `block` only | `src/feed/schema.js:146` |
| Resource types | Subset of eight threat types | `src/feed/schema.js:40`, `:156-164` |
| Protected host | Rejects the full document | `src/feed/schema.js:153-154` |
| `dropRuleIds` | Array of ids 1 to 4,500. The compiler omits these entries. | `src/feed/schema.js:117-120`, `src/feed/compile.js:19-22` |
| `cosmetic`, `tactics` | Reserved. Must be empty or absent. | `src/feed/schema.js:123-125` |

The feed rules are DNR session rules with ids 700001 to 704500 and priority 2,000,010 (`src/feed/compile.js:7-9`, `:16-34`).
The feed can add block rules only. It cannot supply code (`src/feed/client.js:6-7`).

### 4.6 Kill switch

| Switch | Document | Effect | Reference |
|---|---|---|---|
| Kill latch | `{format, kill, serial, createdAt}` signed with a kill key | Removes the feed rules and clears the feed cache. No fetch occurs until the extension version changes. | `src/feed/schema.js:182-193`, `src/feed/client.js:144-152`, `:214-218`, `:256-263` |
| Soft kill | A feed document with `killFeed: true` | Removes the feed rules. A later feed with a larger serial can add rules again. | `src/feed/compile.js:18`, `src/feed/client.js:148`, `:286-292` |
| Local pause | Storage key `feedPaused` is `true` | Removes the feed rules in this browser only. | `src/feed/client.js:169-173`, `:207-211` |

The kill serial must be larger than the stored kill serial (`src/feed/schema.js:189`).

### 4.7 Rollback

- A rollback document has a larger `serial`, an empty `dnr`, and `rollbackTo` set to an earlier serial (`src/feed/schema.js:121-122`, `:127`).
- The client keeps two verified files, `current` and `previous`, in the key `feedCache` (`src/feed/client.js:290`).
- The client verifies each cached file again before it uses that file (`src/feed/client.js:266-271`).
- When the target serial is not stored, the client ignores the rollback and keeps the current rules (`src/feed/client.js:273-276`).
- A serial that is not larger than the stored serial is rejected as a replay (`src/feed/schema.js:95`).

### 4.8 Start behaviour and the packed snapshot

`applyCached` runs in each worker start and on install (`src/general-background.js:970`, `:979`).
When the feed is configured and no valid cached feed is found, the client applies `src/rules/threat-snapshot.json` (`src/feed/client.js:193-196`).
The snapshot is not signed. It gets the same entry checks (`src/feed/schema.js:168-179`).
While the feed is dormant, the client does not apply the snapshot (`src/feed/client.js:164-168`).

### 4.9 Feed tools

- `scripts/feed-keygen.mjs` makes an Ed25519 key pair. It refuses an output path in the repository (`scripts/feed-keygen.mjs:1-42`).
- `scripts/feed-sign.mjs` signs the exact bytes of a feed file after the schema checks (`scripts/feed-sign.mjs:1-39`).
- The two tools have no network permission in their command lines (`scripts/feed-keygen.mjs:1`, `scripts/feed-sign.mjs:1`).

## 5. Twitch: what the vendored script sends

`src/vendor/video-swap-new.user.js` is a copy of the upstream userscript, version 1.55 (`src/vendor/README.md:3-6`).
It runs in the `MAIN` world at `document_start` on `twitch.tv` and its subdomains, in all frames (`manifest.json:60-71`).
The extension code adds no request of its own on Twitch. The requests below come from this vendored file.

| Request | Destination | Data sent | Reference (vendored file) |
|---|---|---|---|
| GraphQL `PlaybackAccessToken` (POST) | `gql.twitch.tv/gql` | Body: channel name, player type, platform (`android` or `web`) and a fixed query hash. Headers: `Client-Id`, `X-Device-Id`, `Authorization`, and `Client-Integrity` when available. | lines 583-644, 662-664 |
| Backup playlist list | `usher.ttvnw.net/api/.../channel/hls/<channel>.m3u8` | Channel name, the page's usher parameters, and the `sig` and `token` values from the access token | lines 271-274 |
| Stream playlist (`.m3u8`) | The URL given in the playlist list | No added data | lines 258, 278, 385, 481 |
| One ad segment for each playlist request | The segment URL given in the playlist | No added data | lines 396-409 |

Other facts from the file text:

- The script copies the `Authorization` and `Client-Integrity` headers from the page's own GraphQL requests (lines 686-700).
- The script copies the device id from the page's `X-Device-Id` or `Device-ID` header. If none is found, it makes a random id of 32 characters (lines 605-611, 687-694).
- A player type with the suffix `-ALT` sends only `Client-Id` and `X-Device-Id`. That type is commented out in the default list (lines 25, 618-622).
- The `Client-Id` value is a fixed constant in the file (line 29).
- The backup player types are `autoplay`, `picture-by-picture` and `embed` (line 25).
- The script changes `playerType` to `popout` in the page's own `PlaybackAccessToken` requests (lines 26, 705-725).
- The script empties the body of the page's own `PlaybackAccessToken` request for the `picture-by-picture` player (lines 702-704).
- The page context sends the GraphQL request for the player worker with the page's original `fetch` (lines 639-642, 662-664).
- One synchronous `XMLHttpRequest` reads the player worker script from a blob URL. This is a local read (lines 208-214).
- The script reads and writes three `localStorage` keys of the page for quality, mute and volume: `video-quality`, `video-muted` and `volume` (lines 834-864).
- The `@updateURL` and `@downloadURL` lines are in a comment header. `src/vendor/README.md:9-10` states that Chrome ignores the header (UNVERIFIED).

`src/twitch-directory-ads.js` reads `settings` and `siteOverrides` from `chrome.storage.local` (line 128). A search found no `fetch` call in that file.
All these requests go to Twitch hosts (UNVERIFIED: `docs/permissions-and-privacy.md:48`).

## 6. YouTube and Kick

- A search found no `fetch`, `XMLHttpRequest` or `WebSocket` text in `src/kick.js`.
- `src/youtube.js` contains no fixed request URL of its own. It wraps the request functions of the page.
- `src/youtube.js` wraps `window.fetch` of the page when `HOOKS` is on (`src/youtube.js:1768`). It keeps the original function as `nativeFetch` (`:1109`).
- The wrapper sends the page's own requests with `nativeFetch`. It can change the body of a `/player` request (`src/youtube.js:1814-1821`).
- For a stream request, the wrapper can send the request again to a different target URL through `fetchWithFallback` (`src/youtube.js:618`, `:1777-1791`). UNVERIFIED: this analysis did not read how the target is selected.
- `src/youtube.js` wraps `XMLHttpRequest.prototype.open` and `send` of the page (`src/youtube.js:1995`, `:2017`).
- UNVERIFIED: the uBlock Origin scriptlets wrap the page's own XHR and fetch, and edit the responses (`docs/permissions-and-privacy.md:49`).
- The static ruleset `ubo-youtube` blocks some YouTube ad URLs. It has 4 rules (`manifest.json:33-37`, `src/vendor/ubo-youtube-meta.json` field `dnr_rules`).
- This analysis did not read `src/youtube.js`, `src/kick.js`, `src/vendor/ubo-youtube.js` and `src/vendor/ubo-youtube-isolated.js` in full.

## 7. Upstream repositories for vendored code

### 7.1 Twitch userscript: `scripts/update-twitch-vendor.mjs`

| Item | Value | Reference |
|---|---|---|
| Upstream repository | `pixeltris/TwitchAdSolutions` | `scripts/vendor-pins.json` |
| File path in upstream | `video-swap-new/video-swap-new.user.js` | `scripts/vendor-pins.json` |
| Pinned commit | `cebf3d73f0743f99708812dfeb946be701f1a97f` | `scripts/vendor-pins.json` |
| Pinned SHA-256 and size | Recorded, 51,556 bytes | `scripts/vendor-pins.json` |
| Licence | MIT, in `src/vendor/LICENSE-TwitchAdSolutions` | `src/vendor/README.md:5-6` |
| Network permission | `api.github.com` and `raw.githubusercontent.com` only | `scripts/update-twitch-vendor.mjs:1` |
| Request options | `redirect: "error"`, 30 second timeout, size limit | `scripts/update-twitch-vendor.mjs:41-53` |

The tool makes these requests:

1. `api.github.com/repos/<repo>/commits` to find the newest commit that changed the file (`scripts/update-twitch-vendor.mjs:68-70`).
2. `api.github.com/repos/<repo>` to read the archived state (`scripts/update-twitch-vendor.mjs:77`).
3. `raw.githubusercontent.com/<repo>/<commit>/<path>` to download the file at that commit (`scripts/update-twitch-vendor.mjs:80`).
4. `raw.githubusercontent.com/<repo>/<commit>/LICENSE` to compare the licence (`scripts/update-twitch-vendor.mjs:105`).

The tool reads the downloaded file as text and does not run it (`scripts/update-twitch-vendor.mjs:17-19`).
The option `--check` writes nothing and gives exit code 1 when upstream is different (`scripts/update-twitch-vendor.mjs:6`, `:149-154`).
`docs/UPDATING-DEPENDENCIES.md:9` states that the upstream repository is archived (UNVERIFIED).
`docs/UPDATING-DEPENDENCIES.md:56` states that `test/vendor-pin.test.js` compares the file with the pins (UNVERIFIED, test not read).

### 7.2 uBlock Origin YouTube filters: `scripts/sync-ubo-youtube.mjs`

| Item | Value | Reference |
|---|---|---|
| Filter repository | `uBlockOrigin/uAssets`, files `filters.txt`, `quick-fixes.txt` and `unbreak.txt` in the directory `filters/` | `scripts/sync-ubo-youtube.mjs:34-40` |
| Scriptlet repository | `gorhill/uBlock` at a release tag | `scripts/sync-ubo-youtube.mjs:32` |
| Default tag | `1.75.0` | `scripts/sync-ubo-youtube.mjs:25` |
| Default uAssets ref | `master`, resolved to a commit with `git ls-remote` | `scripts/sync-ubo-youtube.mjs:26-30` |
| Recorded uAssets commit | `e140ffc75aee8c1af136f579126389d6defae5ed` | `src/vendor/ubo-youtube-meta.json` |
| Recorded uBlock commit | `21f0e686506bb21b514b451c8c6cb9bf8c82d232` | `src/vendor/ubo-youtube-meta.json` |
| Licence | GPLv3, in `src/vendor/LICENSE-uBlock-GPLv3.txt` | `src/vendor/LICENSE-uBlock.md:11` |
| Permissions | All Deno permissions (`-A`) | `scripts/sync-ubo-youtube.mjs:1` |

The tool clones `gorhill/uBlock` and imports three of its modules (`scripts/sync-ubo-youtube.mjs:32`, `:42-44`).
Thus the tool runs upstream code on the PC or CI runner (`docs/UPDATING-DEPENDENCIES.md:142-148`).
The tool writes four shipped files and one meta file (`scripts/sync-ubo-youtube.mjs:282`, `:289`, `:315`, `:334`).
The tool also uses `git ls-remote` on `github.com` to find the uAssets commit (`scripts/sync-ubo-youtube.mjs:27-30`).
The fetch for the filter files sets no timeout and no redirect option (`scripts/sync-ubo-youtube.mjs:37`).

### 7.3 Other data sources

`scripts/build-psl-subset.mjs:4-5` states that the tool reads a local copy of the Public Suffix List and does not fetch (UNVERIFIED, file not read in full).
The Public Suffix List has the Mozilla Public License 2.0 (`docs/credits.md:8`).
Comments state that `scripts/build-threat-rules.mjs` and `scripts/pack-cosmetic.mjs` do not fetch (`scripts/build-threat-rules.mjs:8`, `scripts/pack-cosmetic.mjs:13`). UNVERIFIED.
`scripts/bench-youtube.mjs` is a developer tool that opens `www.youtube.com` pages in a browser (`scripts/bench-youtube.mjs:264-275`). The extension package does not contain it.

## 8. GitHub Actions

### 8.1 Workflows

| File | Trigger | Permissions | Jobs |
|---|---|---|---|
| `.github/workflows/checks.yml` | `pull_request`, push to `main` | `contents: read` | `tests`, `privacy`, `release-gate` |
| `.github/workflows/release.yml` | `workflow_dispatch`, only on `main` | `contents: write` for the one job | `release` |
| `.github/workflows/ubo-youtube-drift.yml` | Cron `0 6 * * 1` (Monday 06:00 UTC), `workflow_dispatch` | `contents: read` | `drift` |
| `.github/workflows/refresh-release-notes.yml` | `workflow_dispatch` | None | `refresh` (retired, prints one line) |

All jobs use the runner `ubuntu-24.04`.

### 8.2 Pinned actions

| Action | Pinned commit | Version comment | Reference |
|---|---|---|---|
| `actions/checkout` | `3d3c42e5aac5ba805825da76410c181273ba90b1` | v7.0.1 | `.github/workflows/checks.yml:31` |
| `denoland/setup-deno` | `22d081ff2d3a40755e97629de92e3bcbfa7cf2ed` | v2.0.5 | `.github/workflows/checks.yml:36` |

- The three active workflows use the same two pins.
- Each checkout step sets `persist-credentials: false`.
- The Deno version is `v2.9.8` (`.github/workflows/checks.yml:38`).
- UNVERIFIED: the repository setting `sha_pinning_required` is on, and `allowed_actions` is `selected` (`.github/workflows/checks.yml:20-23`).
- The procedure to update a pin is in `.github/workflows/checks.yml:17-18`.

### 8.3 Secrets (names only)

| Name | Used in | Condition |
|---|---|---|
| `PRIVACY_PATTERNS` | `checks.yml` job `tests` (line 45) | Only on a push to `main` |
| `PRIVACY_PATTERNS` | `checks.yml` job `privacy` (line 78) | All events. A pull request runs the checker from the base commit (lines 62-71). |
| `GITHUB_TOKEN` (as `github.token`) | `release.yml` (lines 47, 81) | To read tags and create the release |

- `REQUIRE_PATTERNS` is an environment value, not a secret. It makes a push to `main` fail when the secret is missing (`.github/workflows/checks.yml:73-79`).
- The `release-gate` job and the drift workflow use no secret (`.github/workflows/checks.yml:89`, `.github/workflows/ubo-youtube-drift.yml:9`).
- The privacy check runs Python with `-I` (`.github/workflows/checks.yml:82-83`).

### 8.4 Network use in CI

- `checks.yml` downloads the pinned actions and Deno. The test command has no `--allow-net` flag (`.github/workflows/checks.yml:46`).
- The `release-gate` job and the release job install `ripgrep` with `apt-get` only if it is missing (`.github/workflows/checks.yml:107`, `.github/workflows/release.yml:42`).
- The gate runs the Deno tests with no `--allow-net` flag (`scripts/release-gate.sh:739`).
- `release.yml` calls the GitHub API through `gh` (`.github/workflows/release.yml:52-59`, `:85-89`).
- `ubo-youtube-drift.yml` contacts `github.com` and `raw.githubusercontent.com` through the sync tool (`.github/workflows/ubo-youtube-drift.yml:35`).
- `scripts/release-gate.sh:3` states that the gate is local only (UNVERIFIED).

### 8.5 Release flow

The release is manual: Actions, then `release`, then Run workflow (`.github/workflows/release.yml:3-11`).

1. The job reads the version from `manifest.json` (`.github/workflows/release.yml:49`).
2. The job stops if the tag `v<version>` or a release with that tag exists (`.github/workflows/release.yml:52-59`).
3. `scripts/release-notes.py` extracts the `## <version> (` section of `CHANGELOG.md`. It fails if the section is missing.
4. `scripts/pack-zip.sh` packs `manifest.json`, `src/` and `icons/` into `adgecko-<version>.zip`.
5. `scripts/release-gate.sh` runs on the checkout, then on the zip with `--zip`.
6. `gh release create` makes the tag on the checked-out commit, with the title `Adgecko <version>` and the zip attached.

The job publishes nothing if a step fails (`.github/workflows/release.yml:10-11`).
The concurrency group `release` prevents two releases at the same time (`.github/workflows/release.yml:17-19`).
The zip file list comes from `scripts/lib/package_files.py` (`scripts/pack-zip.sh:5-10`).
No workflow publishes to the Chrome Web Store. No store upload step is in the workflow files.
The file `docs/STORE-REVIEW-NOTES.md` is in the tree. This analysis did not read it.

### 8.6 Drift check

The drift job runs the sync tool, then fails if a shipped YouTube file is different from the checkout.
The comparison ignores the one banner line that names the uAssets commit (`.github/workflows/ubo-youtube-drift.yml:37-49`).
The job commits nothing and opens no pull request (`.github/workflows/ubo-youtube-drift.yml:8-9`).

## 9. Data storage

The extension has no server-side store. All data stays in `chrome.storage` of the browser.

### 9.1 `chrome.storage.local` keys

| Key | Content | Writer | Reference |
|---|---|---|---|
| `generalEnabled` | On/off switch for ordinary sites (default `true`). A mirror that the worker derives from `settings`. | Worker | `src/general-settings.js:7-21`, `src/general-background.js:311-317` |
| `generalAllowedOrigins` | Allowed origins (legacy mirror) | Worker | `src/general-settings.js:9`, `src/popup.js:8-9`, `src/general-background.js:314` |
| `generalListUpdatedAt` | Time of the last list update | Worker | `src/general-background.js:851-856` |
| `generalListStatus` | Status text for the popup | Worker | `src/general-background.js:851-856` |
| `generalListUpdateRequestAt` | In the key table and the defaults table only. A search of `src/` found no other use. | None found | `src/general-settings.js:12`, `:20` |
| `settings` | Feature settings | Popup, settings page | `src/popup.js:15`, `src/settings.js:10` |
| `siteOverrides` | Settings for each site | Popup, settings page | `src/popup.js:16` |
| `threatAllowDomains` | The "Allow this domain" list | Settings page | `src/general-background.js:216` |
| `popupFix` | Pending "Fix this site" question | Popup | `src/popup.js:20` |
| `popupWelcomed` | Welcome card shown | Popup | `src/popup.js:21` |
| `uiTheme` | Popup theme | Settings page | `src/popup.js:22` |
| `listState` | Small refresh metadata: URL, ETag, `Last-Modified`, times, counts, errors | Worker only | `src/general-background.js:451-456`, `src/general/update.js:640-644` |
| `listData:<list name>` | Parsed payload of one list | Worker only | `src/general-background.js:457`, `:588-603` |
| `generalListRefresh` | Old single key. The worker migrates it, then removes it. | Worker only | `src/general-background.js:458`, `:522-547` |
| `cosG` | Generic hide selectors, one string | Worker | `src/general/cosmetic-parse.js:418` |
| `cosMeta` | Small hide-rule metadata | Worker | `src/general/cosmetic-parse.js:423` |
| `cosKeys` | Index of all hide-rule keys | Worker | `src/general/cosmetic-parse.js:424` |
| `cosS:<host>` | Hide selectors for one host | Worker | `src/general/cosmetic-parse.js:425` |
| `cosE:<host>` | Hide exceptions for one host | Worker | `src/general/cosmetic-parse.js:426` |
| `feedState` | Feed status. The popup and the settings page read it. | Worker | `src/feed/client.js:14`, `src/popup.js:31`, `src/settings.js:10` |
| `feedCache` | Two verified feed files as base64, with signatures | Worker | `src/feed/client.js:15`, `:134` |
| `feedPaused` | Local "Pause threat feed" switch | Worker (from settings) | `src/feed/client.js:16`, `src/general-background.js:316` |

### 9.2 `chrome.storage.session` keys

| Key | Content | Reference |
|---|---|---|
| `tabSignals` | The last guard event for each tab, maximum 50 tabs | `src/general-background.js:1084-1085` |

A search found no use of `chrome.storage.sync` in `src/`.

### 9.3 Quota facts

- `manifest.json:7-11` requests `storage`, `declarativeNetRequest` and `alarms`. It does not request `unlimitedStorage`.
- A code comment gives the `chrome.storage.local` quota as 10 MB (`src/general/update.js:85-88`). UNVERIFIED against Chrome.
- The same comment states that the `adguard_base` hide rules needed about 5 MB and caused a quota failure.
- A comment states that IndexedDB is a possible later store for those rules (`src/general/update.js:88-89`).
- The old single key held about 6 MB (`src/general-background.js:454-455`).
- A comment gives the largest list download as about 4.4 MB (`src/general/update.js:35`).
- Each worker write goes through `localSet` or `localRemove`. A failure is recorded in `listState.lastError` (`src/general-background.js:480-512`).
- `listDataPresent` uses `getBytesInUse` to check a payload without a read of its data (`src/general-background.js:603-620`).
- The refresh stores the payload first, then the validators (`src/general/update.js:949-950`).
- For the feed, the rules are replaced first, then the cache is written (`src/feed/client.js:287-290`).

### 9.4 Rule stores (not `chrome.storage`)

| Store | Id range | Content | Reference |
|---|---|---|---|
| Static rulesets | Not applicable | `general`, `ubo-youtube`, `threat` | `manifest.json:26-44` |
| Dynamic rules | 100000 and up | Refreshed list rules, maximum 25,000 | `src/general/update.js:24-25` |
| Dynamic rules | 600000 to 609999 | Refreshed threat rules | `src/general/update.js:31-32` |
| Dynamic rules | 800000 and up | Copies of bundled rules that are not list rules | `src/general/update.js:26` |
| Dynamic rules | 900000 and up | User "Allow this page" rules | `src/general/update.js:27` |
| Dynamic rules | 950000 and up | User "Allow this domain" rules, maximum 1,000 | `src/general-background.js:216-218` |
| Dynamic rule | 990001 | List-download allow rule | `src/general/update.js:96` |
| Session rules | 700001 to 704500 | Feed rules (none while dormant) | `src/feed/compile.js:7-8` |

A code comment gives the dynamic rule limit as 30,000 (`src/general/update.js:33`). UNVERIFIED against Chrome.

## 10. What the extension does not contact

These statements come from a search of the `src/` files and from the release gate text.

- **Analytics:** A search of the extension's own files found no analytics or telemetry call. `scripts/release-gate.sh:608-614` fails the build if a JavaScript file names a known tracker host.
- **Accounts:** The manifest has no `oauth2`, `key` or `externally_connectable` field. The gate rejects these fields (`scripts/release-gate.sh:309-310`, `:326-328`).
- **Identity APIs:** The gate rejects `chrome.identity`, `navigator.sendBeacon`, geolocation and WebRTC connection calls (`scripts/release-gate.sh:575`).
- **Other hosts:** The gate rejects each URL in a JavaScript file whose host is not in its allow-list (`scripts/release-gate.sh:618-672`). The allow-list has the list hosts, the stream-site hosts and `support.google.com`. The scan ignores comment lines and `src/rules/`.
- **Feed host:** No feed host is contacted while the feed is dormant (section 4.1).
- **Update server:** The manifest has no `update_url` field and no `web_accessible_resources` field (check of the top-level keys of `manifest.json`). The vendored userscript's update lines are comments.
- **Popup and settings page:** A search found no `fetch(` call in `src/popup.js` and `src/settings.js`. `src/popup.js:9` states "No network calls here".
- **Page guards:** A search found no `fetch`, `XMLHttpRequest`, `WebSocket` or `sendMessage` text in `src/guards/*.js`. UNVERIFIED: the copied text stays in the page (`docs/permissions-and-privacy.md:33`).
- **Permissions not requested:** `tabs`, `activeTab`, `scripting`, `cookies`, `history`, `webRequest`, `unlimitedStorage`, `declarativeNetRequestFeedback` (`docs/permissions-and-privacy.md:39`, and `manifest.json:7-11` for the API permissions).
- **Optional permissions:** The gate rejects `optional_permissions` and `optional_host_permissions` (`scripts/release-gate.sh:363-365`).

The worker also calls `fetch` for package files through `chrome.runtime.getURL`. These are local reads, not network requests
(`src/general-background.js:391`, `:631-638`, `:650`, `:1171`).
`src/cosmetic.js:97-112` gets the packed hide sheet from the worker, or from a package URL. This is also a local read.
The worker accepts messages only from the extension itself (`src/general-background.js:1163-1167`). A search found no `onMessageExternal` listener in that file.

The full list of outbound destinations of the shipped extension is thus:

1. The nine filter-list host patterns in `manifest.json:12-22`, from the service worker.
2. Twitch hosts, from the vendored script on Twitch pages (section 5).
3. On YouTube pages, the page's own requests, which `src/youtube.js` can send again or change (section 6).
4. No other destination was found in the files that this analysis read.

## 11. Points to know before a change

- A new list host needs a change in `LIST_HOSTS`, `manifest.json`, the gate, the packer and `docs/permissions-and-privacy.md`.
- A new list also needs an entry in `SOURCES` of the two source tables, with the same name and URL.
- Do not edit `src/vendor/video-swap-new.user.js` by hand (`src/vendor/README.md:10`). Use `scripts/update-twitch-vendor.mjs` (`docs/UPDATING-DEPENDENCIES.md:9`).
- Do not put a private key in the repository (`src/feed/keys.js:8`).
- Do not put a feed domain in `src/feed/config.js` without the owner's decision (`src/feed/config.js:6`).
- A new third-party action must be pinned to a full commit SHA (`.github/workflows/checks.yml:12-23`).
- `docs/how-it-works.md:40` has out-of-date list counts. Use `src/rules/meta.json` as the source.

## Checked and not checked

An independent check of this document read the files below again and corrected the text.

### Read from the files in this session

- `src/general/update.js`: lines 1-110, 180-195, 392-405, 518-526, 618-712, 738-766, 840-1065, 1170-1195, 1315-1344 (1,344 lines in the file).
- `src/feed/config.js`, `keys.js`, `canonical.js`, `verify.js`, `compile.js`, `client.js` (all lines). `src/feed/schema.js` lines 1-28 (preview) and 29-199.
- `src/rules/meta.json` and `src/rules/threat-meta.json` (all lines). `src/rules/LICENSES.md` (all 95 lines).
- `src/general-background.js`: lines 1-20, 205-220, 310-320, 360-424, 448-460, 478-514, 520-548, 578-652, 848-858, 866-874, 925-995, 1080-1100, 1160-1202, and search results for `fetch(`, storage calls and message types.
- `src/general-settings.js` lines 1-30. `src/popup.js` lines 5-24 and search results. `src/settings.js` lines 5-22. `src/general/cosmetic-parse.js` lines 410-430. `src/cosmetic.js` lines 97-112. `src/settings/features.js` lines 1-20.
- `src/threat/compile.js` lines 14-20. `src/twitch-directory-ads.js` lines 126-130.
- `src/youtube.js`: lines 1766-1826 and search results for `fetch` and `XMLHttpRequest.prototype`.
- `manifest.json`: lines 1-125, and all top-level keys and content-script entries through a JSON parse.
- `src/vendor/README.md` (all lines), `src/vendor/LICENSE-uBlock.md` (lines 1-16), `scripts/vendor-pins.json` (all lines), the top-level fields of `src/vendor/ubo-youtube-meta.json`, and the rule count (4) of `src/rules/ubo-youtube-network.json`.
- `src/vendor/video-swap-new.user.js`: lines 20-32, 200-222, 252-282, 395-410, 476-484, 580-648, 660-668, 680-726, 826-840, and search results for request, header and `localStorage` code. The file size is 51,556 bytes.
- `scripts/update-twitch-vendor.mjs`, `scripts/feed-keygen.mjs`, `scripts/feed-sign.mjs`, `scripts/release-notes.py` (all lines). `scripts/sync-ubo-youtube.mjs` lines 1-125 and search results for write and network calls.
- `scripts/pack-filter-lists.py`: lines 1-115, 600-630, and search results for URLs, the timeout and the cache directory.
- `scripts/pack-zip.sh` lines 1-30. `scripts/build-psl-subset.mjs` lines 1-12.
- `scripts/release-gate.sh`: lines 1-20, 300-370, 540-680, 712-735, and search results for `deno` commands.
- The four files in `.github/workflows/` (all lines).
- `docs/permissions-and-privacy.md` (all 55 lines). `docs/how-it-works.md` lines 38-42. `docs/UPDATING-DEPENDENCIES.md` lines 7-11, 54-58, 140-148. Search results from `docs/feed-setup.md` and `docs/credits.md`.
- `CHANGELOG.md` lines 1-30. `.gitignore` (search for the cache directory).
- The commit id, from `git rev-parse --short HEAD`.

### Not checked

- No test was run. Deno is not installed.
- The extension was not loaded in Chrome. All runtime behaviour is UNVERIFIED on a PC.
- No list URL, upstream repository or GitHub setting was contacted. The licence texts and the archived state of upstream are not confirmed.
- The Chrome quota values (10 MB storage, 30,000 dynamic rules) come from code comments only.
- The repository settings `sha_pinning_required` and `allowed_actions` come from a workflow comment only.
- The large JSON files in `src/rules/` were not read (`general-network.json`, `threat-network.json`, `threat-snapshot.json`, `cosmetic-rules.json`, `packed-cross.json`).
- `src/vendor/ubo-youtube.js`, `src/vendor/ubo-youtube-isolated.js`, `src/kick.js`, `src/youtube.js`, `src/cosmetic.js`, `src/popup.js`, `src/settings.js` and `src/guards/*.js` were searched or read in part, not read in full.
- The selection of a different target URL in `fetchWithFallback` of `src/youtube.js` was not read.
- `src/vendor/video-swap-new.user.js` was read in part. A request path outside the read lines is possible.
- The parts of `src/general/update.js` and `src/general-background.js` that are not in the list above were not read in this check.
- `scripts/lib/*` (for example `curben_check.py`, `package_files.py`, `twitch-vendor.mjs`, `feed-tools.mjs`) were not read. Search results gave single lines only.
- `scripts/build-threat-rules.mjs`, `scripts/pack-cosmetic.mjs`, `scripts/merge-dnr-rules.py`, `scripts/bench-youtube.mjs` and `scripts/privacy-check.py` were searched for URLs and fetch calls only.
- The tests in `test/` were not read. Statements about what a test checks come from docs and comments.
- `docs/feed-setup.md` and `docs/credits.md` were searched only, not read in full.
- `docs/threat-tier.md`, `docs/STORE-REVIEW-NOTES.md`, `TODO.md`, `src/rules/README.md`, `src/LICENSE-EasyList.txt` and `src/rules/CREDIT-EasyList.txt` were not read in this check.
- Line numbers are correct for commit b01e6a5 only.
