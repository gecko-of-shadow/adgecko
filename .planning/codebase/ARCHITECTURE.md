# Architecture

Analysis date: 2026-11-16
Commit: 5cd4ab6 (version 0.3.6)

This document tells you how the parts of Adgecko operate together.
Find each name in this document with a text search. The document gives no line numbers.
UNVERIFIED: all behaviour in Chrome. The statements come from the code and the tests.

## 1. Overview

Adgecko is a Chrome Manifest V3 extension with no build step. Chrome loads the files in `src/`.

| Part | Files | Function |
|---|---|---|
| Static DNR rulesets | `src/rules/general-network.json`, `ubo-youtube-network.json`, `threat-network.json` | Packed rules. All three are enabled in the manifest. |
| Dynamic DNR rules | Written by the worker and `src/general/update.js` | Refreshed list and threat rules, user allow rules, the list-download allow rule. |
| Session DNR rules | Written by `src/feed/client.js` through the worker | Rules of the signed threat feed. The feed is dormant. |
| Content scripts | See section 2 | Hide rules, feature flags, site handlers, page guards. |
| Service worker | `src/general-background.js` and its modules | All DNR writes, list refresh, settings sync, feed, toolbar icon, messages. |
| Popup | `src/popup.html`, `popup.js`, `popup.css` | Site status, **Allow this site**, **Fix this site** and its second test (**Test with the ad lists off**, section 13). |
| Settings page | `src/settings.html`, `settings.js` (loads `settings/features.js`, `threat/psl.js`, `threat/compile.js`) | All switches, the per-site list, list update and revert, **Allow this domain**. |

Permissions and hosts: `STACK.md` and `INTEGRATIONS.md`.

## 2. Content scripts

The manifest has 11 entries. All run at `document_start`. No `world` key means the ISOLATED world.

| Entry | Sites | World | Frames | Files |
|---|---|---|---|---|
| CS-1 | Twitch | MAIN | all | `src/vendor/video-swap-new.user.js` |
| CS-2 | YouTube (`www`, `m`, bare domain) | MAIN | top | `src/vendor/ubo-youtube.js` |
| CS-3 | same YouTube hosts | ISOLATED | top | `src/vendor/ubo-youtube-isolated.js`; CSS `src/vendor/ubo-youtube.css`, `src/youtube-ads.css` |
| CS-4 | same YouTube hosts | MAIN | top | `src/youtube.js` |
| CS-5 | Kick | MAIN | all | `src/kick.js` |
| CS-6 | Twitch | ISOLATED | top | `src/settings/features.js`, `src/twitch-directory-ads.js` |
| CS-7 | Ordinary sites | ISOLATED | all | `src/settings/features.js`, `src/general/cosmetic-parse.js`, `src/cosmetic.js` |
| CS-8 | YouTube family (all subdomains, Kids, nocookie) and Twitch | ISOLATED | top | `src/settings/features.js`, `src/settings/flags.js` |
| CS-9 | Kick | ISOLATED | all | `src/settings/features.js`, `src/settings/flags.js` |
| CS-10 | Ordinary sites | ISOLATED | all, also `about:blank` frames | `src/settings/features.js`, `src/settings/flags.js` |
| CS-11 | Ordinary sites | MAIN | all, also `about:blank` frames | `src/guards/clipboard.js`, `src/guards/popups.js` |

- "Ordinary sites" means `http://*/*` and `https://*/*` with 34 `exclude_matches` patterns for the stream sites (section 11).
- CS-10 and CS-11 set `match_about_blank` and `match_origin_as_fallback`.
- CS-7 and CS-10 can inject `src/settings/features.js` two times into one frame. The second run keeps the first registry.

## 3. Service worker modules

The worker is a classic worker. One `importScripts` call loads 16 files. The sequence is part of the contract.

| Order | File (below `src/`) | Global |
|---|---|---|
| 1 | `settings/features.js` | `GeckoFeatures` |
| 2 | `general-settings.js` | `GeneralSettings` |
| 3 | `general/filter-options.js` | `GeneralFilterOptions` |
| 4 | `general/never-block-captcha.js` | `GeckoNeverBlockCaptcha` |
| 5 | `threat/psl.js` | `GeckoPublicSuffix` |
| 6 | `threat/protected-hosts.js` | `GeckoProtectedHosts` |
| 7 | `threat/compile.js` | `GeckoThreatCompile` |
| 8 | `general/update.js` | `GeneralAdblockUpdate` |
| 9 | `general/cosmetic-parse.js` | `GeneralCosmeticParse` |
| 10 to 16 | `feed/config.js`, `keys.js`, `canonical.js`, `schema.js`, `verify.js`, `compile.js`, `client.js` | `GeckoFeedConfig`, `GeckoFeedKeys`, `GeckoFeedCanonical`, `GeckoFeedSchema`, `GeckoFeedVerify`, `GeckoFeedCompile`, `GeckoFeedClient` |

`general/update.js` and `threat/protected-hosts.js` throw an error if file 4 did not load first.

## 4. DNR rules: priorities and id ranges

A higher priority has precedence. Use a new id range only after you read this table.

| Priority | Action | Rules | Ids | Store |
|---|---|---|---|---|
| 1 | block | Packed list rules, and one extra tracker rule (the last id) | 100 to 2951 | static `general` |
| 1 | block | Refreshed list rules (`LIST_RULE_ID_BASE`, maximum `MAX_LIST_RULES` = 25,000) | 100000 and up | dynamic |
| 1 | allow | List `@@` exceptions for a host under a blocked parent, or type-only (`exceptionAllows`); after the refreshed blocks, same id series. With the packed lists alone, `syncPackedAllows` writes the packed lists' subdomain exceptions in the same range. Beat the priority-1 blocks of both stores. Not made under a `$important` block on that host, a parent or a subdomain (whole-domain or scoped), or for an exception that an `@@...$badfilter` line withdraws. With the packed lists alone, the same data comes from `packed-cross.json` (`importantScoped`, `cancelAllow`). | 100000 and up | dynamic |
| 10,000 | allow | **Allow this site**: one rule for each host, matched by `initiatorDomains` | 900000 to 909999 | dynamic |
| 2,000,000 | allowAllRequests, allow | Stream-site allow rules | 1 to 3 | static `general` |
| same as source | same as source | Copies of the bundled rules that are not list rules (`KEPT_RULE_ID_BASE`) | 800000 and up | dynamic |
| 2,000,001 | block | `doubleclick.net` from YouTube initiators | 4 | static `general` |
| 2,000,010 | block | Packed threat hosts, 80 hosts maximum for each rule | 1 to 199 | static `threat` |
| 2,000,010 | block | Refreshed threat hosts | 600000 to 609999 | dynamic |
| 2,000,010 | block | Signed-feed rules (dormant) | 700001 to 704500 | session |
| 2,000,011 | block | uBlock Origin YouTube rules | 1 to 4 | static `ubo-youtube` |
| 2,000,020 | allow | **Allow this domain**: matched by `requestDomains`, all resource types | 950000 to 950999 | dynamic |
| 3,000,000 | allow | List-download allow rule: initiator is the extension, target is a list host | 990001 | dynamic |

- The three stream-site allow rules: `allowAllRequests` for YouTube and Kick frames, `allow` for `twitch.tv` without `ads.twitch.tv`, `allow` for seven player CDN hosts.
- The extra tracker rule blocks `ads.twitch.tv` and its subdomains (owner decision 2026-11-20). It is the only block rule in `general` that names a stream host. UNVERIFIED in Chrome: the Twitch player with this host blocked.
- A threat block is above the stream-site allow rules. Thus a threat host is blocked on stream pages also.
- **Allow this site** (10,000) does not release a threat host. **Allow this domain** (2,000,020) does.
- Threat rules list eight resource types. Stylesheet, image and font are not in the list.
- `isOurRule(id)` is true for 100000 to 899999 without the threat range. A list swap, the lists switch and `fallback()` remove only these ids.
- `isThreatRule(id)` is true for 600000 to 609999. Only a threat rebuild, a threat removal or **Revert lists** changes this range.
- The code uses 30,000 as the dynamic rule limit (`DYNAMIC_RULE_LIMIT`).

## 5. The DNR write queue

All DNR writes go through `dnrExclusive(op)` in the worker. It runs one section at a time, in call order.

- Each section has a time limit of 120 seconds (`DNR_SECTION_MAX_MS`). After the limit, the caller gets `DNR_TIMED_OUT` and the queue continues. A late section can then write at the same time as the next section. The code accepts this risk.
- The queue is not reentrant. Code in a section must not wait for a second `dnrExclusive` call.
- Engine functions that run in a section get `listDeps()` without `exclusive`. Only `refreshLists()` gives `exclusive: dnrExclusive` to the engine.
- Downloads run outside the queue.
- Callers: `syncThreatAllowRules`, `syncFromSettings`, `applyGeneralState`, `refreshLists`, `revertLists`, and each feed session-rule write.
- Three other serial queues exist: `settingsQueue` (settings sync), `feedQueue` (feed operations), `stateQueue` (`listState` writes).

## 6. Worker start, listeners and alarms

Each worker start runs these statements in sequence:

1. `importScripts` loads the modules.
2. `migrateSettings()` starts. Then `syncFromSettings()` starts and waits for it.
3. The two `alarms.onAlarm` listeners are added.
4. `ensureRefreshAlarm()` creates the `gecko-refresh` alarm only if it is missing.
5. `storageReady()` starts the one-time migration of the old list storage key.
6. `applyCachedFeed()` puts feed session rules back. With the feed dormant, it only records the dormant state.
7. The toolbar icon is painted from storage. This step makes no DNR call.
8. The `onInstalled`, `onStartup`, `storage.onChanged` and `onMessage` listeners are added.

A worker start alone does not call `applyGeneralState()`.

| Listener | Work |
|---|---|
| `alarms.onAlarm`, `gecko-refresh` | `refreshLists(false)` and `checkFeedNow()`. |
| `alarms.onAlarm`, `gecko-refresh-retry` | `refreshLists(false, { retry: true })`. |
| `runtime.onInstalled` | `ensureCosmetic()`, `ensureRefreshAlarm()`, `syncThreatAllowRules()`, `applyCachedFeed()`, legacy defaults, `applyGeneralState()`. On reason `install`: `refreshLists(true)`. |
| `runtime.onStartup` | `applyGeneralState()`. It writes the user's allow-domain override first, before the lists work. |
| `storage.onChanged` (area `local`) | `generalEnabled` or `generalAllowedOrigins`: `applyGeneralState()`. `threatAllowDomains`: `syncThreatAllowRules()`. `feedPaused`: `applyCachedFeed()`. `settings` or `siteOverrides`: `syncFromSettings()`. |
| `runtime.onMessage` | See section 7. |

| Alarm | Value |
|---|---|
| `gecko-refresh` | Period 180 minutes. First delay 5 to 30 minutes (random). The worker tries `persistAcrossSessions: true` first, then creates the alarm without it. |
| `gecko-refresh-retry` | One-shot, 31 minutes after a failed run. A failed retry makes no new retry. A new create replaces the old alarm. |

The release gate permits only these two alarms and no `setInterval` in the worker. The throttle values are in `INTEGRATIONS.md`.

## 7. Messages

Each worker message has `source: "adgecko-general"`. The worker ignores a sender with a different extension id.
A sender with a tab can send only `cosmeticCss` and `guardEvent`, unless its URL is the settings page.

| Type | Sender | Reply and effect |
|---|---|---|
| `cosmeticCss` | `src/cosmetic.js` | `{ css }`: the text of `src/cosmetic-hide.css`, or `null`. |
| `guardEvent` | `src/settings/flags.js` | No reply. `{ kind }` is `clipboard` or `popup`. Sets the dot on the toolbar icon of that tab. |
| `applyGeneralState` | popup | `{ ok, enabled, ruleset, allows }`. |
| `tabSignal` | popup | `{ ok, signal }` for `{ tabId }`. Clears the dot. |
| `siteInfo` | popup | For `{ origin }`: host, stream flag, `limited` flag and the features that apply. |
| `updateLists` | settings page | `{ ok, result }`. Starts a manual refresh. |
| `revertLists` | settings page | The result of `GU.revertLists`. |
| `pageOrigin` | popup, with `chrome.tabs.sendMessage` to frame 0 | `{ origin }` from the top-frame content script. This message has no `source` field. |

The dot data is in `chrome.storage.session` under `tabSignals`, for 50 tabs maximum. The worker changes this map one event at a time (`editSignals`), so blocks in several tabs at once all keep their event.

## 8. List refresh

The engine is `src/general/update.js` (`GeneralAdblockUpdate`, alias `GU`). It contains no `chrome.*` call. The worker gives it `listDeps()`.

1. Trigger: the alarm (`refreshLists(false)`), **Update lists** on the settings page or a first install (`refreshLists(true)`).
2. `ensureCosmetic()` seeds the hide rules from `src/rules/cosmetic-rules.json`, one time for each extension version.
3. `GU.refresh(deps, { manual })` runs. It never throws. It returns `{ ok, ran, reason }`.
4. `shouldRun` applies the throttle. A manual run always runs.
5. The engine removes the data of retired lists.
6. For each source in `SOURCES` that is due: download, then `parseEntriesFull()`, then `checkListChange()`. A rejected list keeps its last good copy.
7. Storage: `listData:<name>` gets the parsed payload. `listState` gets the small metadata.
8. If all `cosmetic: true` sources have a parsed copy: `mergeCosmetic()`, then `writeCosmetic()` writes the hide-rule keys.
9. `swap()` runs in one `dnrExclusive` section. `crossListRules()` applies `$badfilter` cancels and unconditional exceptions across all lists. One `updateDynamicRules` call removes the `isOurRule` ids and adds the new rules and the kept rules.
10. `applyThreatRules()` rebuilds the threat range in a second call.
11. `applyGeneralState()` writes the user's threat allow-domain override first, then applies the lists switch, the allow rules and the icon. Then the worker writes `generalListStatus` and `generalListUpdatedAt`.

Rules of the flow:

- The static `general` ruleset stays enabled as the offline floor. Only the lists switch disables it.
- For a list with no current copy, the swap uses the packed rules and `src/rules/packed-cross.json`.
- The swap fails if the new set is smaller than 50 % of the bundled set. A failed swap calls `fallback()`: the dynamic list rules are removed and the static ruleset is enabled.
- A failed run (`ran: true`, `ok: false`) makes the retry alarm.
- If `listState.ruleCount` is above 0 but no list rule is installed, the next refresh builds the set again.
- `PARSER_VERSION` is 6. A stored payload with a different version is downloaded again.
- The parser drops ICANN public suffixes and non-public addresses. The merge step (`mergeDomains`, `mergeScoped`) removes never-block hosts.
- `src/general/filter-options.js` converts filter options to a scope key. The packer uses the same table. An option with no exact DNR equivalent drops the filter.

Other entry points: `applyEnabled(deps, enabled)` (lists switch), `fallback(deps)`, `revertLists(deps)`, `rebuildThreatRules(deps)`, `removeThreatRules(deps)`.
Download policy and all limits: `INTEGRATIONS.md`, section 3.

## 9. Storage keys

All keys are in `chrome.storage.local`, but `tabSignals` is in `chrome.storage.session`. The extension uses no `chrome.storage.sync`.

| Key | Contents | Writer |
|---|---|---|
| `settings` | `{ v: 1, enabled, features: { id: bool } }`. Source of truth. | settings page, worker migration |
| `siteOverrides` | `{ host: { enabled?: false, features?: { id: bool } } }`. Source of truth. | popup, settings page |
| `generalEnabled`, `generalAllowedOrigins` | Legacy mirrors (section 10). Their change starts `applyGeneralState()`. When `settings` exists, no code reads their values. | worker |
| `threatAllowDomains` | The **Allow this domain** list. | settings page |
| `listState` | Small run metadata: lists, times, counts, errors, threat state. | worker |
| `listData:<list>` | Parsed payload of one list. | worker |
| `generalListRefresh` | Old single key. The worker migrates it one time, then removes it. | worker |
| `generalListStatus`, `generalListUpdatedAt` | Status text and time for the user interface. | worker |
| `generalListUpdateRequestAt` | In the key table of `src/general-settings.js` only. No code uses it. | none |
| `cosG` | Generic hide selectors. Top frames read it. | worker |
| `cosGF` | Compact generic hide selectors for child frames (simple `#id` / `.class` selectors of at most 10 characters, the leading `#` or `.` included, so a name of at most 9 characters). | worker |
| `cosS:<host>`, `cosE:<host>` | Site selectors and exception selectors for one host. | worker |
| `cosNoG:<host>` | Bit mask for `$generichide`, `$specifichide` and `$elemhide` page exceptions. A child frame also reads the key of the top site (`keysForHost(host, withGeneric, topHost)`). | worker |
| `cosMeta` | Small gate record. All frames read it. A change starts the cosmetic script again. | worker |
| `cosKeys` | Index of all hide-rule keys. Only the worker reads it. | worker |
| `feedState`, `feedCache`, `feedPaused` | Feed status, two verified feed files, the derived pause switch. | worker |
| `popupFix`, `popupWelcomed`, `uiTheme` | Pending **Fix this site** question (an entry with `lists: true` is the second test, **Test with the ad lists off**: an Allow of the host's own entry), welcome card, popup theme. | popup, settings page |
| `ytStartTimes` | YouTube start times, opt-in: `{ v: 1, on, log: [{ time, version, kind, waitMs, ad, toast, timeout }] }`. `on` is off by default. At most 300 entries, the oldest go first. `time` is UTC to the minute. No video id, URL, title, channel or account. Rules: `GeckoFeatures.startTimes` in `src/settings/features.js`. | `src/settings/flags.js` (append, top YouTube frame), settings page (switch, Clear) |
| `tabSignals` (session) | The last guard event for each tab. | worker |

- A file that uses a key of a different file repeats the string. Do not rename a key without a search of all files. `test/storage-keys.test.js` checks each key literal in `src/` against one known list (the keys of this table). Add a new key to that list and to this table.
- `writeCosmetic()` writes the rule keys first, then `cosMeta`, then removes stale keys.
- A child frame uses the generic hides (`cosGF`, and the bundled fallback sheet) only when all of these hold: the top site is known from `location.ancestorOrigins` (last entry, http or https only); the top site is not a stream site; cosmetic hiding is on for the top site (`F.resolve`, or the legacy allow list); the top site has no `$generichide`. UNVERIFIED in Chrome: what `location.ancestorOrigins` gives in a content script for cross-origin, nested, sandboxed or no-referrer frames. If it gives `"null"` or no entries, the frame drops only the generic hides.
- A frame's own-host site rules (`cosS:`) do not follow an Allow on the top site.
- `src/general/cosmetic-parse.js` exports `noHideFlags`.
- Each worker write goes through `localSet` or `localRemove`. A failure is recorded in `listState.lastError` and shown in the list status.
- The quota of `chrome.storage.local` is 10,485,760 bytes. The manifest does not request `unlimitedStorage`. See `CONCERNS.md`, H1.

## 10. Settings model

`settings` and `siteOverrides` are the source of truth. `src/settings/features.js` holds the registry `FEATURES` (13 entries).

| Feature id | Layer | Default | Apply | Per site | Sites |
|---|---|---|---|---|---|
| `network` | dnr | on | live | yes | ordinary |
| `threatTier` | dnr | on | live | no | all |
| `threatFeed` | dnr | on | live | no | all |
| `cosmetic` | isolated | on | live | yes | ordinary |
| `twitchPlayer` | main | on | always | no | `twitch.tv` |
| `twitchDisplay` | isolated | on | live | yes | `twitch.tv` |
| `youtubeScriptlets` | main | on | always | no | `youtube.com` |
| `youtubeWatchdog` | main | on | live | yes | `youtube.com` |
| `youtubeCosmetic` | main | on | live | yes | `youtube.com` |
| `kick` | main | on | live | yes | `kick.com` |
| `guardClipboard` | main | on | live | yes, `keepOnAllow` | ordinary |
| `guardPopups` | main | off | live | yes | ordinary |
| `guardMiners` | dnr | on | live | no | ordinary; `available: false` |

An `always` feature cannot be switched off. The vendored scripts get no flags.

`resolve(settings, overrides, host)` gives on or off for each feature:

1. An `always` feature is on. A feature with `available: false` is off.
2. The base value is the master switch AND the global feature switch.
3. `overrideFor()` finds the entries for the host and each parent domain. Feature switches come from the most specific entry only.
4. Two values come down from a parent entry: an Allow (`enabled: false`) and `network: false`.
5. An Allow sets each per-site feature to off. On ordinary sites, an Allow does not switch off a `keepOnAllow` feature.
6. With no Allow, a per-site switch in the entry replaces the global switch. The master switch still applies.

Legacy mirrors:

- `migrateLegacy()` runs at each worker start. It does nothing if `settings` exists.
- `syncFromSettings()` writes the mirrors from `legacyMirror()`. `generalEnabled` is true when the master switch and `network` are on. `generalAllowedOrigins` holds the origins of each host with the site off or `network` off. `feedPaused` is true unless the master switch and `threatFeed` are on.
- The same function enables the static `threat` ruleset when the master switch and `threatTier` are on.
- The mirror write changes storage. That change starts `applyGeneralState()`.
- The mirrors are only this change signal. `applyGeneralState()`, the list refresh and the toolbar icon read `settings` and `siteOverrides` through `readListsState()` (`legacyMirror()`). The popup reads the lists switch from `settings` (`listsOn()`). A stale mirror changes no rule and no popup text. `legacyMirror()` and not `resolve()`: `resolve()` is for one host and cannot give the allow list.
- Only before the migration (no `settings` key) do the worker, the popup and `src/cosmetic.js` read the mirror values. When `settings` exists, only `resolve(...).cosmetic` decides in `src/cosmetic.js`.
- Each migration has a comment with the version that added it and the condition for its deletion. A test checks it (`test/settings.test.js`).
- Change `settings` or `siteOverrides` only. Let the worker write the mirrors.

## 11. Stream-site exclusion

Stream sites are Twitch, YouTube, Kick and their player and media hosts. The lists, the cosmetic hide and the page guards do not operate on them.

| Mechanism | Where |
|---|---|
| `STREAM_SITES` (17 hosts). A host matches itself and each subdomain (`isStreamHost`). This is the one list. | `src/settings/features.js` |
| 34 `exclude_matches` patterns on CS-7, CS-10 and CS-11. They must equal `streamExcludeMatches()`. A test compares them. | `manifest.json` |
| Second guard: the cosmetic script stops on a stream host. With no registry, it hides nothing. | `src/cosmetic.js` |
| The hide-rule parser keeps no rule for a stream host. | `src/general/cosmetic-parse.js` |
| Static allow rules at 2,000,000, and dynamic copies after a list swap. The merger checks its host lists against `STREAM_SITES` (`check_stream_hosts`); four stream hosts have no static allow (`STREAM_SITES_NOT_ALLOWED`). | `scripts/merge-dnr-rules.py`, `src/general/update.js` |
| Never-block hosts in the list tier (`NEVER_BLOCK_SUFFIXES`; one exception: `imasdk.googleapis.com`). | `src/general/update.js` |
| One stream host is blocked: the extra tracker rule blocks the Twitch ad host `ads.twitch.tv`. The Twitch allow rule excludes it. | `scripts/merge-dnr-rules.py` (`EXTRA_TRACKER_DOMAINS`) |
| No **Allow this site** rule and no allowed origin for a stream host. | `src/general-background.js`, `src/general-settings.js`, `src/settings/features.js` |
| A threat rule can never name a stream host. | `src/threat/protected-hosts.js` |

Add a stream host to `STREAM_SITES` and to the three `exclude_matches` lists together. Then give it a place in `scripts/merge-dnr-rules.py` (an allow list or `STREAM_SITES_NOT_ALLOWED`), or the merger and `test/dnr.test.js` fail. More copies of the host list: `CONCERNS.md`, M1.

## 12. Private flag channel

`src/settings/flags.js` (ISOLATED world) gives feature flags to the page-world scripts of the extension. The channel is a `MessageChannel` port, not `window.postMessage`.

1. `flags.js` dispatches a `gk-p1` MessageEvent on `window` with one port.
2. Each page-world script listens for `gk-p1` in the capture phase. It takes the first port and removes its listener.
3. Each page-world script also dispatches `gk-r1` when it starts. This covers the case where it starts after `flags.js`.
4. `flags.js` answers `gk-r1` only until the first of these events: the parser inserts a `<script>` element, the first `readystatechange`, or the first task after injection. The limit is 8 ports for each frame.
5. `flags.js` reads `settings` and `siteOverrides`, resolves the flags and posts `{ f: { id: bool } }` on each port. A storage change of these keys sends new flags.
6. A page guard posts `{ g: "clipboard" }` or `{ g: "popup" }` when it blocks an action. `flags.js` then sends `guardEvent` to the worker, one time in 2 seconds maximum.
7. In the top frame of `www.youtube.com`, `m.youtube.com` or `youtube.com` only, `src/youtube.js` posts `{ y: { kind, waitMs, ad, toast, timeout } }` after each measured video start, while the flag `ytTiming` is on. `flags.js` checks the record (`GeckoFeatures.startTimes.entry`), adds the minute and the extension version, and appends it to `ytStartTimes`, one record in 1 second maximum. No worker message. Best effort: the writes are in order inside one tab only, so two YouTube tabs at the same moment can lose one record, and a tab that read the log just before **Clear** can write old records back. `src/youtube.js` adds its poll and media listeners only while a start is pending, and drops a start at 60 s instead of a timeout when the player shows `.ytp-error` or `.ytp-offline-slate`, when the video never had metadata, or when it has data but sits paused with no spinner.

- Flags sent: `youtubeWatchdog`, `youtubeCosmetic`, `kick`, `guardClipboard`, `guardPopups`. In the top YouTube frame also `ytTiming` (`ytStartTimes.on`, off by default).
- Receivers: `src/youtube.js`, `src/kick.js`, `src/guards/clipboard.js`, `src/guards/popups.js`.
- A frame with no host of its own uses the origin of the site that made it.
- If no port arrives, each page-world feature keeps its built-in default. The pop-up guard default is off. `ytTiming` (YouTube start times) is off: no record is sent without it. The other defaults are on.
- An "off" flag stops the next action. It does not remove a patch.
- UNVERIFIED: the run order of `document_start` scripts in Chrome. The code handles the two orders.

## 13. How the popup finds the page

The manifest has no `tabs` permission, thus the popup gets no `tab.url` on a normal page.

1. The popup sends `pageOrigin` to frame 0 of the active tab.
2. On an ordinary site, the top-frame `src/cosmetic.js` replies. On a stream host where `flags.js` runs, the top-frame `src/settings/flags.js` replies.
3. The popup sends the origin to the worker in `siteInfo`. The worker reads the manifest to find which scripts run on that host.
4. The worker replies with the features that apply and a `limited` flag. `limited` is true for a stream-family host where no feature script runs (for example YouTube Music).

`popup.html` loads only `popup.js`. The popup cannot read the feature registry directly.
A page with no content script gives no reply. The popup then shows its "open a normal page" text.

"Something broke?" is a test in two steps. The popup cannot see which requests the rules blocked (that needs `activeTab` or `declarativeNetRequestFeedback`), so it gives a test, not a count.

1. **Fix this site** turns off the `FIXABLE` features on the host's own entry. The line `fix-scope` (`scopeLine` in `src/popup.js`) is built from `siteInfo` `features[].on` for the page: what is off, what is still on (from `SCOPE_NAMES`), and `SCOPE_FRAMES`. It never names a filter as on that a switch turned off.
2. After **No**, on an ordinary site where `network` is on, **Test with the ad lists off** writes `enabled: false` on the host's own entry (the same write as **Allow this site**) and a `popupFix` entry with `lists: true`. **Yes** keeps the Allow. **No** removes it again.
3. The scope line of step 2 comes from the same `scopeLine`. On the page, threat rules (priority above the Allow rule) and the clipboard guard (`keepOnAllow`) normally stay on. Each frame resolves its own address: the Allow rule matches by `initiatorDomains`, and `cosmetic.js` and the guard flags read the frame's hostname. So a frame from an address outside the tested host, also a sibling subdomain, keeps the ad lists, hiding and the guards. A frame under the tested host (a child subdomain) follows the page, because `initiatorDomains` and `overrideFor` both cover subdomains. `SCOPE_FRAMES` and the last "No" name the host ("outside <host>"). The MAIN-world guards stay installed whatever the flags say, so the last "No" says "likely not the cause" and points to `chrome://extensions`. `test/site-test-scope.test.js` proves these sentences.
4. An unanswered step 2 ends after `LIST_TEST_TTL_MS` (24 hours, owner decision 2026-11-22). `FEAT.expireListTests` (pure, in `src/settings/features.js`) removes `enabled: false` from the host's own entry (other fields stay) and drops the `lists` record. The worker runs it (`expireListTestsNow`) at worker start, on `onStartup`, on each `gecko-refresh` alarm and before each `siteInfo`; `siteInfo` then carries `listTestExpired: true` and the popup reads storage again. Until then the popup shows "Allowed – not blocking here" and **Block again**, which also ends the test. No new alarm.

## 14. Threat tier and protected hosts

| Source | Store | Built by |
|---|---|---|
| Packed | static ruleset `threat` | `scripts/build-threat-rules.mjs` with `src/threat/compile.js` |
| Refreshed | dynamic rules | `applyThreatRules()` in `src/general/update.js` |
| Signed feed (dormant) | session rules | `src/feed/compile.js` |

- `THREAT_LISTS` names three of the eight sources: `urlhaus_hosts`, `ublock_badware`, `dandelion_antimalware`.
- Only whole-domain entries and navigation-scope entries become threat hosts. Popup-only filters become `main_frame`-only rules.
- The threat tier is the feature `threatTier`. It is not a per-site feature.
- The lists switch, **Allow this site** and a failed list swap do not remove threat rules. With the lists off, a refresh still rebuilds the threat range.
- The feed snapshot fallback follows the threat tier: it is not used with the tier off.

`protectedReason(host)` in `src/threat/protected-hosts.js` returns a reason if a threat rule must not name the host:

- The host is empty, not a plain host name, one label, or a non-public IPv4 address.
- The host is equal to, below or a parent of a stream, Google API or captcha entry.
- The host is a public suffix, a shared platform or a parent of one (`src/threat/psl.js`).
- The host is below a single-service platform (for example `www.facebook.com`) or is an exact shared service host (for example `raw.githubusercontent.com`).

The same function checks the signed feed. `userDomainReason()` applies the public-suffix check to the **Allow this domain** input.
The captcha list has one source: `src/rules/never-block-captcha.json`. The packer generates `src/general/never-block-captcha.js` from it.
If the public-suffix data is not loaded, each threat host is rejected and no domain is accepted.

The signed feed design, limits and switches are in `INTEGRATIONS.md`, section 4.

## 15. YouTube: two layers

`src/vendor/ubo-youtube.js` (generated uBlock Origin scriptlets) and `src/youtube.js` run in the MAIN world on the same three hosts. The manifest lists the uBlock Origin file first.

- The uBlock Origin file sets `globalThis[Symbol.for("gk.u")]` to true at its end. It has no flag port.
- `src/youtube.js` reads the marker in `uboLayerPresent()` at each use. When the marker is present, it stands down:
  - It does not drop ad entries from player data.
  - Its fetch, XHR and JSON hooks pass calls to the native functions.
  - It does not inject its own feed CSS and does not start its DOM sweep.
  - The start watchdog uses the "gentle" mode with longer wait times.
- The watchdog does not reload pages that cannot play (premieres, sign-in or age-check pages).
- The static `ubo-youtube` ruleset and the two CSS files are part of the same layer.

The Twitch script `src/vendor/video-swap-new.user.js` is a byte-for-byte upstream copy. It has no flag port and no connection to other extension code.

## 16. Error policy

"Fail-open": on an error, the extension blocks or hides less, and the page works. "Fail-closed": the extension refuses the action.

| Area | Condition | Result |
|---|---|---|
| Flag port | No port or no flags | Each page-world feature keeps its default (fail-open). |
| Cosmetic script | Registry not loaded, or the fallback sheet does not load | Nothing is hidden (fail-open). |
| Page guards | Internal error | The original call continues (fail-open). An error in the "user copied it" check counts as "no". |
| Clipboard guard | `clipboard.write()` text cannot be read | The write is blocked while the guard is on (fail-closed). |
| Allow rules | Registry not loaded | No allow rule is made (fail-closed). |
| Threat hosts, **Allow this domain** | Public-suffix data not loaded | Rejected (fail-closed). |
| List download | One list fails or is rejected | Its last good copy stays. Other lists continue. |
| List download | No list server gives an answer | The run is a failure. The retry alarm follows. |
| Rule swap | The swap throws | `fallback()` to the packed rules. |
| Threat rebuild | Error, or too many new hosts | The previous threat rules stay. |
| List fetch | Not a list host, or a redirect | Rejected (fail-closed). |
| Feed | Not configured, bad signature, schema error | No change (fail-closed). |
| Worker messages | Wrong sender | Ignored (fail-closed). |
| Popup save | Storage write fails | The popup shows "Could not save. Try again." |

The page-world scripts write to the page console only when a debug option is on.

## 17. Rules for new work

- Put each new DNR write in a `dnrExclusive` section. Do not nest sections. Do not download in a section.
- Use a new rule id range only after a check of section 4.
- Add a stream host to `STREAM_SITES` and to the three `exclude_matches` lists together, and give it a place in `scripts/merge-dnr-rules.py`.
- Change `settings` or `siteOverrides` only. Let the worker write the legacy mirrors.
- Do not edit generated files or frozen files. The lists are in `CONVENTIONS.md`.
