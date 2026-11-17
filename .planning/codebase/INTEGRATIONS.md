# External integrations

Analysis date: 2026-11-16
Commit: 5cd4ab6 (version 0.3.6)

This document lists each external system that Adgecko contacts or uses, and the policy for each.
UNVERIFIED: all behaviour in Chrome. No list URL and no upstream repository was contacted for this document.

## 1. Summary

| Integration | Direction | Active | Main files |
|---|---|---|---|
| Eight public filter lists (eight hosts, nine host patterns in the manifest) | The worker downloads | Yes | `src/general/update.js`, `src/general-background.js` |
| Signed threat feed | The worker downloads | No (dormant) | `src/feed/*` |
| Twitch (GraphQL, playlists, media) | A page script sends requests | On Twitch pages only | `src/vendor/video-swap-new.user.js` |
| YouTube and Kick | No request to a host of the extension | On those pages only | `src/vendor/ubo-youtube*.js`, `src/youtube.js`, `src/kick.js` |
| Upstream repositories | Developer tools download | Developer PC and CI only | `scripts/update-twitch-vendor.mjs`, `scripts/sync-ubo-youtube.mjs`, `scripts/pack-filter-lists.py` |
| GitHub Actions | CI and release | Yes | `.github/workflows/*.yml` |

## 2. Filter list sources

The runtime source table is `SOURCES` in `src/general/update.js`. The pack-time table is `SOURCES` in `scripts/pack-filter-lists.py`.
The two tables use the same eight names and primary URLs. The pack-time table also holds the licence text, the role and the priority.

| List id | Primary host | Role | Pack priority | Licence (short form) | Runtime options |
|---|---|---|---|---|---|
| `peter_lowe` | `pgl.yoyo.org` | `ads_trackers` | 100 | Free for personal and non-commercial use, credit necessary | `minDomains` 1000 |
| `urlhaus_hosts` | `malware-filter.gitlab.io` | `malware_threat` | 90 | CC0 1.0 and MIT; URLhaus data CC0 1.0 | `maxDomains` 8000, `minDomains` 50 |
| `easylist` | `easylist.to` | `ads` | 70 | GPL-3.0-or-later or CC BY-SA 3.0-or-later | `cosmetic: true`, `minDomains` 10000, three mirrors |
| `easyprivacy` | `easylist.to` | `privacy` | 50 | same as `easylist` | `cosmetic: true`, `minDomains` 10000, three mirrors |
| `hagezi_pro_mini` | `raw.githubusercontent.com` | `ads_trackers` | 40 | GPL-3.0 | `minDomains` 10000 |
| `ublock_badware` | `ublockorigin.github.io` | `malware_threat` | 35 | GPL-3.0 | `minDomains` 500 |
| `dandelion_antimalware` | `raw.githubusercontent.com` | `malware_threat` | 30 | Dandelicence v1.4 | `minDomains` 1000 |
| `adguard_base` | `filters.adtidy.org` | `ads` | 20 | GPL-3.0 | `minDomains` 1000, network rules only |

- Read `src/rules/LICENSES.md` for the full licence text and the credit lines.
- Mirrors: only `easylist` and `easyprivacy`. The refresh tries the primary URL first, then `ublockorigin.github.io`, `easylist-downloads.adblockplus.org` and `secure.fanboy.co.nz`.
- The three `malware_threat` lists feed the threat tier (`THREAT_LISTS` in `src/threat/compile.js`).
- `urlhaus_hosts` is the only list from the malware-filter project, from one fixed URL. `scripts/lib/curben_check.py` and the gate enforce this (#13, #18b).
- The list `curben_phishing` is retired. The refresh deletes its stored data. The refresh and the packer drop one phishing-feed section of `ublock_badware`.
- `adguard_base` supplies network rules only. Its hide rules were removed because of the storage quota.

Three places must agree when a list host changes:

| Place | Content |
|---|---|
| `LIST_HOSTS` in `src/general/update.js` | Eight host names. `isListUrl` accepts only `https:` URLs on these hosts. |
| `host_permissions` in `manifest.json` | Nine patterns. Two patterns limit `raw.githubusercontent.com` to one repository path each. One limits `filters.adtidy.org` to `/extension/ublock/`. |
| `LIST_HOSTS` in `scripts/release-gate.sh` | The exact `host_permissions` list. |

Packed snapshot at this commit (`src/rules/meta.json`, `threat-meta.json`):

| Fact | Value |
|---|---|
| Lists packed at (UTC) | 2026-11-14T22:00:32Z |
| Whole domains, scoped entries | 195,069 and 18,422 |
| List rules, rules in `general-network.json` | 2,851 and 2,856 (80 domains for each rule) |
| Threat hosts, threat rules | 15,865 and 199 |

The packer downloads from the primary URL only and keeps the raw lists in `scripts/.list-cache/`.
`test/docs-claims.test.js` compares the numbers in `docs/how-it-works.md` with `meta.json`.

## 3. Fetch policy for the filter lists

| Item | Value | Name in `src/general/update.js` |
|---|---|---|
| Alarm | `gecko-refresh`, period 180 minutes, first delay 5 to 30 minutes | `REFRESH_ALARM`, `ALARM_PERIOD_MINUTES` |
| Minimum interval after a successful automatic run | 12 hours | `MIN_INTERVAL_MS` |
| Minimum interval after a failed attempt | 30 minutes | `RETRY_MIN_MS` |
| Retry after a failed run | One one-shot alarm `gecko-refresh-retry` after 31 minutes | `RETRY_ALARM`, `RETRY_DELAY_MINUTES` |
| Stored time in the future | Ignored when it is more than 5 minutes ahead | `CLOCK_SKEW_MS` |
| List expiry | From the `! Expires:` header, 12 hours minimum and 7 days maximum. Default 24 hours. | `DEFAULT_EXPIRES_MS` |
| Manual run (**Update lists**) | Always runs and checks each list | - |
| First install | One manual-type refresh, at once | - |

- `lastAttemptAt` is written at the start of each run. `lastRunAt` is written only after a run in which a list server gave an answer.
- Each request uses `credentials: "omit"`, `cache: "no-cache"` and `redirect: "error"`. The method is `GET`. The timeout is 90 seconds and includes the body (`FETCH_TIMEOUT_MS`).
- The refresh sends `If-None-Match` and `If-Modified-Since` only to the URL that supplied the values. A `304` answer updates only `fetchedAt`. A list with no stored payload, or with an old parser version, is downloaded without validators.
- A list server receives the list URL, the conditional headers and no cookies. The URL contains no page address.
- A dynamic allow rule (id 990001, priority 3,000,000) protects the list downloads from block rules. The worker installs it in `ensureListAllowRule`.

Limits and checks on a download. A list that fails a check is rejected as a whole, and its last good copy stays in use.

| Check | Limit | Name |
|---|---|---|
| Body size | 16 MB. The read stops above this size. | `MAX_LIST_BYTES` |
| Parsed entries | Not below `minDomains` of the source (default 50) | - |
| Size change in one refresh | 25 % maximum | `MAX_CHANGE_RATIO` |
| Protected stream hosts named by one list | 25 maximum. `hagezi_pro_mini` has an adaptive limit with seed 64. | `PROTECTED_HITS_MAX`, `PROTECTED_HITS_SEED_BY_LIST` |
| Generic hide selectors | 30,000 maximum | `MAX_GENERIC_SELECTORS` |
| Whole-page site hide rules | 100 maximum | `MAX_PAGE_ROOT_SITE_RULES` |
| New threat hosts in one refresh | 2,500 maximum, and 20 % of the previous set maximum | `MAX_NEW_THREAT_HOSTS`, `MAX_NEW_THREAT_RATIO` |
| Refreshed set against the packed set | Not less than 50 % | in `swap()` |

- A change that occurs again on the next download, in 10 % of the rejected size, is accepted (`CONFIRM_RATIO`). Thus no list is frozen for all time.
- A failure of one list does not stop the other lists. When a download fails, the packed rules or the last good rules stay active.

## 4. Signed threat feed (dormant)

The feed code is in `src/feed/`. The worker loads it at each start, but it contacts nothing: `FEED_ORIGIN` is an empty string, `FEED_KEYS` and `KILL_KEYS` are empty, and the manifest has no feed host.
`configured()` in `src/feed/client.js` needs all three conditions:

1. `FEED_ORIGIN` is a bare `https` origin with no path.
2. `FEED_KEYS` holds a minimum of one public key.
3. `host_permissions` contains `FEED_ORIGIN + "/*"`. The gate permits exactly this one extra host.

The procedure for the owner is `docs/feed-setup.md`. The feed host (D-1) and the signer (D-7) are open decisions. Do not put a domain in `src/feed/config.js` and do not put a private key in the repository.

Design when the feed is configured (from the code and the tests):

| Item | Value |
|---|---|
| Trigger | The `gecko-refresh` alarm |
| Files | `/feed.json.sig` first, then `/feed.json`. No conditional requests. |
| Request | `credentials: "omit"`, `cache: "no-store"`, `redirect: "error"`, timeout 15 seconds |
| Size limits | Signature file 1,024 bytes. Feed file 512 KB. The stream read stops at the limit. |
| Signature | Ed25519 through WebCrypto, over the exact bytes of `feed.json`. `feed.json.sig` has two lines: `keyId=<id>`, then the base64 signature. |
| Sequence | Byte checks, signature file, pinned key, signature check, JSON parse, strict schema |
| Keys | A feed key signs only feed documents. A kill key signs only the kill document. A key id in the two key sets is rejected. |
| Rules | Block rules only, session rules 700001 to 704500, priority 2,000,010. A protected host rejects the full document. |
| Schema (format 1) | Unknown key rejects the document. `dnr`: 4,500 entries maximum, 1 to 80 hosts for each entry. `notAfter` is 14 days maximum after `createdAt`. Clock difference 1 hour. |
| Serial | Larger than the stored serial. Maximum 2,147,483,647. Maximum step 1,000,000 while the stored document is valid. The larger step after expiry needs a stored document that lived 24 hours minimum. |
| Key rotation | The stored serial is bound to the key that signed it. When an extension update removes that key, the serial starts again at 0. |
| Kill latch | A kill document from a kill key removes the feed rules and stops all fetches until the extension version changes. Kill serials have no step limit. |
| Soft kill | A feed with `killFeed: true` removes the feed rules. A later feed with a larger serial can add rules again. |
| Rollback | A document with a larger `serial`, an empty `dnr` and `rollbackTo`. The client keeps two verified files in `feedCache`. |
| Local pause | The key `feedPaused` removes the feed rules in this browser only. |
| Worker start | `applyCached()` puts the rules back from the verified cache, or from `src/rules/threat-snapshot.json` if the threat tier is on. A worker wake with the correct rules in place writes nothing. |
| Cache write failure | The client puts back the rules of the saved file. |

Tools: `scripts/feed-keygen.mjs` makes a key pair and refuses an output path in the repository. `scripts/feed-sign.mjs` signs a file after the schema checks, and refuses a feed whose `notAfter` is in the past. The two tools have no network permission.

## 5. Twitch: what the vendored script sends

`src/vendor/video-swap-new.user.js` is an unchanged copy of the upstream userscript, version 1.55. The extension code adds no request of its own on Twitch.

| Request | Destination | Data sent |
|---|---|---|
| GraphQL `PlaybackAccessToken` (POST) | `gql.twitch.tv/gql` | Channel name, player type, platform and a fixed query hash. Headers: `Client-Id`, `X-Device-Id`, `Authorization`, and `Client-Integrity` when available. |
| Backup playlist list | `usher.ttvnw.net` | Channel name, the usher parameters of the page, and the `sig` and `token` values of the access token |
| Stream playlists and one ad segment for each playlist request | The URLs in the playlists | No added data |

- The script copies the `Authorization`, `Client-Integrity` and device id headers from the page's own GraphQL requests. Thus each replacement of this file needs a code review.
- The backup player types are `autoplay`, `picture-by-picture` and `embed`. The script changes `playerType` to `popout` in the page's own token requests.
- The script reads and hooks five `localStorage` keys of the page (`video-quality`, `video-muted`, `volume`, `lowLatencyModeEnabled`, `persistenceEnabled`). It writes the first three only when the hook failed.
- One synchronous `XMLHttpRequest` reads the player worker script from a blob URL. This is a local read.
- Known upstream gap: the ad tracking-URL rewrite in `stripAdSegments` has no effect (`test/twitch-playlist.test.js` records it).

## 6. YouTube and Kick

- `src/kick.js` contains no `fetch`, `XMLHttpRequest` or `WebSocket` call.
- `src/youtube.js` contains no fixed request URL of its own. It wraps `fetch`, `XMLHttpRequest` and `JSON.parse` of the page. It can change the body of a `/player` request and can send a stream request again to a different target URL.
- The uBlock Origin scriptlets wrap the page's own XHR and fetch and edit the responses.
- The static ruleset `ubo-youtube` blocks some YouTube ad URLs (4 rules).
- YouTube players that are embedded in other websites get only the network rules. The YouTube scripts run only on the YouTube site.

## 7. Upstream repositories for vendored code

| Tool | Upstream | Network | Notes |
|---|---|---|---|
| `scripts/update-twitch-vendor.mjs` | `pixeltris/TwitchAdSolutions` (the docs say: archived) | `api.github.com`, `raw.githubusercontent.com` only | Finds the newest commit that changed the file, downloads the file at that commit, reads it as text and does not run it. Writes the file and `scripts/vendor-pins.json`. `--check` writes nothing and gives exit code 1 when upstream is different. It does not update `scripts/frozen-pins.json` and the gate. |
| `scripts/sync-ubo-youtube.mjs` | `uBlockOrigin/uAssets` (filters) and `gorhill/uBlock` at a release tag (scriptlets) | `raw.githubusercontent.com`, and `git` for the clone | It imports and runs uBlock Origin code. It stops if the clone is not the commit in `ublock_commit` of `src/vendor/ubo-youtube-meta.json`. A new tag needs `--ubo-commit` after a review of that commit. A `PATCHES` or `ARG_PATCHES` text patch that matches nothing gives only a warning and exit code 0. A failure of `ensurePlayerAdsPruned` or `widenYoutubeExpireWindow` stops the sync with an error. |
| `scripts/build-psl-subset.mjs` | Public Suffix List (MPL 2.0) | None. You download the file. | Also keeps the hand-kept platform lists. |
| `scripts/pack-filter-lists.py` | The eight list URLs | Yes | See section 2. |

Pins and versions: `STACK.md` section 7. Procedures: `docs/UPDATING-DEPENDENCIES.md`.

## 8. GitHub Actions

| File | Trigger | Permissions | Function |
|---|---|---|---|
| `checks.yml` | Pull request, push to `main` | `contents: read` | Jobs `tests` (Deno tests with `--parallel`), `privacy` (`scripts/privacy-check.py`), `release-gate` (pack the zip, then the gate on the checkout and on the zip). |
| `release.yml` | Manual, `main` only | `contents: write` on the one job | Reads the version from `manifest.json`. Stops if the tag or the release exists. Extracts the changelog section, packs, runs the gate two times, then creates the tag `v<version>` and the release with the zip and its `.sha256` file. |
| `ubo-youtube-drift.yml` | Monday 06:00 UTC, manual | `contents: read` | Runs the uBlock Origin sync with explicit Deno permissions. Fails if a shipped YouTube file is different. Commits nothing. |
| `refresh-release-notes.yml` | Manual | none | Retired. Prints one line. A test reads its text. |
| `android.yml` | Pull request and push to `main` with a paths filter (`android/**`, the Android scripts and vectors, `src/rules/**`, `src/threat/**`, `src/general/**`, the licence files, the workflow), manual | `contents: read` | Job `build`: Gradle tests, lint, manifest policy, APKs, artifact `adgecko-shield-debug` (7 days). Job `emulator` (API 33 and 36): device tests with `android/ci/emulator-run.sh`. Not a required check. No secret. |

- All jobs use `ubuntu-24.04`. The jobs `tests`, `release-gate`, `release` and `drift` use Deno `v2.9.8`, `actions/checkout` v7.0.1 (`3d3c42e5aac5ba805825da76410c181273ba90b1`) and `denoland/setup-deno` v2.0.5 (`22d081ff2d3a40755e97629de92e3bcbfa7cf2ed`). The job `privacy` uses only the checkout action. `android.yml` also uses `actions/setup-java` v6.3.0 (`d1374f8ac74474200d16ef8ecee22c7ae7a51880`) and `actions/upload-artifact` v7.0.2 (`cf430e030ddbb5b0abf93d22962f4752f3646cd9`).
- Secret `PRIVACY_PATTERNS`: the job `tests` gets it only on a push to `main`. The job `privacy` gets it on all events, but a pull request runs the checker from the base commit. `REQUIRE_PATTERNS` makes a push to `main` fail when the secret is missing.
- The jobs `release-gate` and `drift` use no secret. The release job uses only the token of the run.
- The release job publishes nothing if a step fails. The concurrency group `release` prevents two releases at the same time.
- No workflow publishes to the Chrome Web Store.
- UNVERIFIED: the 0.3.6 changes to the workflows (parallel tests, the `.sha256` file, the explicit Deno permissions) in a real run on GitHub.

## 9. What the extension does not contact

- No analytics, no account, no identity API. The gate rejects tracker hosts in JavaScript files, the manifest keys `oauth2`, `key` and `externally_connectable`, and each URL whose host is not in its permitted list.
- No feed host while the feed is dormant. No update server: the manifest has no `update_url`.
- The popup, the settings page and the page guards make no network request.
- Permissions that are not requested: `tabs`, `activeTab`, `scripting`, `cookies`, `history`, `webRequest`, `unlimitedStorage`, `declarativeNetRequestFeedback`. No optional permissions.
- The worker also calls `fetch` for package files through `chrome.runtime.getURL`. These are local reads.

The full list of outbound destinations is thus: the nine filter-list host patterns (worker), Twitch hosts (vendored script on Twitch pages), and the page's own requests on YouTube pages.

## 10. Before a change

- A new list host needs a change in `LIST_HOSTS` (runtime and gate), `manifest.json`, the packer and `docs/permissions-and-privacy.md`.
- A new list needs an entry in the two `SOURCES` tables, with the same name and URL. Full steps: `STRUCTURE.md` section 6.
- Do not edit `src/vendor/video-swap-new.user.js` by hand. Use `scripts/update-twitch-vendor.mjs`.
- A new third-party action must be pinned to a full commit SHA.
- Use `src/rules/meta.json` as the source for list counts.
