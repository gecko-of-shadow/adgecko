# Architecture

Analysis date: 2026-11-16
Commit: b01e6a5

This document describes the structure of the Adgecko extension (version 0.3.5, Manifest V3).
All statements come from the source files that the last section lists.
No test was run. The extension was not loaded in a browser.
The mark UNVERIFIED shows a statement about runtime behaviour that comes only from comments or docs.

## 1. Overview

Adgecko is a Chrome extension with no build step.
The browser loads the files in `src/` directly.
The extension has three API permissions: `storage`, `declarativeNetRequest` and `alarms` (`manifest.json:7-11`).
The host permissions are only the filter-list hosts (`manifest.json:12-22`).
The minimum Chrome version is 137 (`manifest.json:5`).
The manifest has no `tabs`, `activeTab`, `scripting` or `webRequest` permission.
The manifest has no web-accessible resources.

The extension has four parts that block or hide content:

- Network rules (declarativeNetRequest, DNR): static rulesets, dynamic rules and session rules.
- Content scripts in the ISOLATED world: cosmetic hide, the flag sender, the Twitch directory script and the vendored YouTube ISOLATED script.
- Content scripts in the MAIN (page) world: site scripts for Twitch, YouTube and Kick, and two page guards.
- A service worker that owns all DNR writes, list refresh, settings sync and messages.

Two extension pages give the user interface: the popup and the settings page.

## 2. Layers

| Layer | Files | Function |
| --- | --- | --- |
| Static DNR rulesets | `src/rules/general-network.json`, `src/rules/ubo-youtube-network.json`, `src/rules/threat-network.json` | Packed rules. All three are enabled in `manifest.json:27-44`. |
| Dynamic DNR rules | Written by `src/general-background.js` and `src/general/update.js` | Refreshed list rules, refreshed threat rules, copies of bundled non-list rules, user allow rules, the list-download allow rule. |
| Session DNR rules | Written by `src/feed/client.js` through the worker | Rules from the signed threat feed. The feed is dormant (see section 12). |
| ISOLATED content scripts | `src/cosmetic.js`, `src/general/cosmetic-parse.js`, `src/settings/features.js`, `src/settings/flags.js`, `src/twitch-directory-ads.js`, `src/vendor/ubo-youtube-isolated.js` | Hide rules, feature flags, page origin answer. |
| MAIN content scripts | `src/vendor/video-swap-new.user.js`, `src/vendor/ubo-youtube.js`, `src/youtube.js`, `src/kick.js`, `src/guards/clipboard.js`, `src/guards/popups.js` | Site handlers and page guards. |
| Popup | `src/popup.html`, `src/popup.js`, `src/popup.css` | Site status, "Allow this site", "Fix this site". |
| Settings page | `src/settings.html`, `src/settings.js`, plus `src/settings/features.js`, `src/threat/psl.js` and `src/threat/compile.js` as script tags (`src/settings.html:112-115`) | All feature switches, per-site list, list update and revert, "Allow this domain". |
| Service worker | `src/general-background.js` and the files that it imports | DNR writes, list refresh, settings sync, feed, toolbar icon and badge, message handler. |

### 2.1 Static rulesets

| Ruleset id | File | Rules at this commit | Contents |
| --- | --- | --- | --- |
| `general` | `src/rules/general-network.json` | 2,856 | Ids 1 to 3: stream-site allow rules. Id 4: one YouTube ad-host block. Ids 100 to 2950: packed list blocks. Id 2951: extra tracker block. |
| `ubo-youtube` | `src/rules/ubo-youtube-network.json` | 4 | YouTube block rules from the uBlock Origin filters, ids 1 to 4. |
| `threat` | `src/rules/threat-network.json` | 199 | Threat-host blocks, ids 1 to 199, 80 hosts maximum for each rule. |

The counts come from a script that read the three JSON files in this session.
`scripts/pack-filter-lists.py` makes the block batches and then runs `scripts/merge-dnr-rules.py` (`scripts/pack-filter-lists.py:1220-1276`).
`scripts/merge-dnr-rules.py` adds the hand-written rules and writes the `general` file.
`scripts/build-threat-rules.mjs` builds the `threat` file.
`scripts/sync-ubo-youtube.mjs` builds the `ubo-youtube` file.

### 2.2 Content scripts by site

All content scripts run at `document_start`.
The manifest has eleven entries. The table shows them in manifest order.
Rows 10a and 10b are two different entries (the tenth and the eleventh) with the same match patterns.
The "Manifest line" column gives the line of the `matches` key. Row 1 is the one exception: it gives the line after the `{` of the entry.

| # | Sites | Files | World | Frames | Manifest line |
| --- | --- | --- | --- | --- | --- |
| 1 | `twitch.tv` and subdomains | `src/vendor/video-swap-new.user.js` | MAIN | all | `manifest.json:61` |
| 2 | `www.youtube.com`, `m.youtube.com`, `youtube.com` | `src/vendor/ubo-youtube.js` | MAIN | top | `manifest.json:73` |
| 3 | Same three YouTube hosts | `src/vendor/ubo-youtube-isolated.js`, plus CSS `src/vendor/ubo-youtube.css` and `src/youtube-ads.css` | ISOLATED (default) | top | `manifest.json:86` |
| 4 | Same three YouTube hosts | `src/youtube.js` | MAIN | top | `manifest.json:102` |
| 5 | `kick.com` and subdomains | `src/kick.js` | MAIN | all | `manifest.json:115` |
| 6 | `twitch.tv` and subdomains | `src/settings/features.js`, `src/twitch-directory-ads.js` | ISOLATED | top | `manifest.json:127` |
| 7 | All http and https sites, with stream sites excluded | `src/settings/features.js`, `src/general/cosmetic-parse.js`, `src/cosmetic.js` | ISOLATED | all | `manifest.json:139` |
| 8 | YouTube family (all subdomains, Kids, nocookie) and Twitch | `src/settings/features.js`, `src/settings/flags.js` | ISOLATED | top | `manifest.json:188` |
| 9 | `kick.com` and subdomains | `src/settings/features.js`, `src/settings/flags.js` | ISOLATED | all | `manifest.json:208` |
| 10a | All http and https sites, with stream sites excluded | `src/settings/features.js`, `src/settings/flags.js` | ISOLATED | all, plus `about:blank` and origin-fallback frames | `manifest.json:220` |
| 10b | Same as 10a | `src/guards/clipboard.js`, `src/guards/popups.js` | MAIN | all, plus `about:blank` and origin-fallback frames | `manifest.json:270` |

Entries 7 and 10a can inject `src/settings/features.js` two times into one frame.
The second run keeps the first registry (`src/settings/features.js:16-18`).

### 2.3 Service worker modules

The worker is a classic worker. It loads its modules with `importScripts` (`src/general-background.js:7-8`).
Each module sets one global object. The load order is important.

| Order | File | Global |
| --- | --- | --- |
| 1 | `src/settings/features.js` | `GeckoFeatures` |
| 2 | `src/general-settings.js` | `GeneralSettings` |
| 3 | `src/general/filter-options.js` | `GeneralFilterOptions` |
| 4 | `src/general/never-block-captcha.js` | `GeckoNeverBlockCaptcha` |
| 5 | `src/threat/psl.js` | `GeckoPublicSuffix` |
| 6 | `src/threat/protected-hosts.js` | `GeckoProtectedHosts` |
| 7 | `src/threat/compile.js` | `GeckoThreatCompile` |
| 8 | `src/general/update.js` | `GeneralAdblockUpdate` |
| 9 | `src/general/cosmetic-parse.js` | `GeneralCosmeticParse` |
| 10 to 16 | `src/feed/config.js`, `keys.js`, `canonical.js`, `schema.js`, `verify.js`, `compile.js`, `client.js` | `GeckoFeedConfig`, `GeckoFeedKeys`, `GeckoFeedCanonical`, `GeckoFeedSchema`, `GeckoFeedVerify`, `GeckoFeedCompile`, `GeckoFeedClient` |

`src/general/update.js` and `src/threat/protected-hosts.js` throw an error if file 4 is not loaded first (`src/general/update.js:118-121`, `src/threat/protected-hosts.js:46-49`).

### 2.4 Files that no manifest entry and no importScripts call loads

These files are in the package list (`scripts/lib/package_files.py:45`, `:55-57`).
No manifest entry, page or `importScripts` call names them:

- `src/general-exclude-hosts.js`
- `src/general/exclusions.js`
- `src/general/toggles.js`
- `src/general/cosmetic.js`

The comments in `scripts/lib/package_files.py:44` and `:53-54` call these files dead modules.
`scripts/merge-dnr-rules.py:29` tells the maintainer to keep its host lists the same as `src/general-exclude-hosts.js`.
UNVERIFIED: that tests import these files. This analysis did not read the tests.

## 3. DNR priority ladder

A higher number has precedence. The table goes from the lowest priority to the highest.

| Priority | Action | Rule set | Rule ids | Kind | Definition |
| --- | --- | --- | --- | --- | --- |
| 1 | block | Packed list rules and the extra tracker rule | 100 and up (2951 is the extra rule at this commit) | static `general` | `scripts/merge-dnr-rules.py:50-51`, extra rule at `:290-294` |
| 1 | block | Refreshed list rules | 100000 and up, 25,000 rules maximum | dynamic | `src/general/update.js:467` (priority), `:25` (id base), `:24` (limit) |
| 10,000 | allow | "Allow this site" rules, one for each host, matched by `initiatorDomains` | 900000 to 909999 | dynamic | `src/general-background.js:153` (priority), `:132` (limit), `src/general-settings.js:28` (id base) |
| 2,000,000 | allowAllRequests, allow | Stream-site allow rules | 1 to 3 | static `general` | `scripts/merge-dnr-rules.py:48-49` |
| 1, 2,000,000 and 2,000,001 | same as source | Copies of the bundled non-list rules: static ids 1 to 4 and the extra tracker rule (priority 1) | 800000 and up (five rules at this commit) | dynamic | `src/general/update.js:26`, `:495-507` |
| 2,000,001 | block | `doubleclick.net` from YouTube initiators | 4 | static `general` | `scripts/merge-dnr-rules.py:87-88` |
| 2,000,010 | block | Packed threat hosts | 1 to 199 | static `threat` | `src/threat/compile.js:10`, built by `scripts/build-threat-rules.mjs:83` |
| 2,000,010 | block | Refreshed threat hosts | 600000 to 609999 | dynamic | `src/general/update.js:31-32` |
| 2,000,010 | block | Signed-feed rules (dormant) | 700001 to 704500 | session | `src/feed/compile.js:7-9` |
| 2,000,011 | block | uBlock Origin YouTube network rules | 1 to 4 | static `ubo-youtube` | `scripts/sync-ubo-youtube.mjs:295`, `:306` |
| 2,000,020 | allow | "Allow this domain" rules, matched by `requestDomains`, all resource types | 950000 to 950999 | dynamic | `src/threat/compile.js:11`, `src/general-background.js:217-218` |
| 3,000,000 | allow | List-download allow rule for the extension's own requests | 990001 | dynamic | `src/general/update.js:96`, `:103` |

Notes on the ladder:

- The three stream-site allow rules are: `allowAllRequests` for YouTube and Kick frames, `allow` for `twitch.tv` without `ads.twitch.tv`, and `allow` for player CDN hosts. The rule contents come from `src/rules/general-network.json` ids 1 to 3.
- A threat block (2,000,010) is above the stream-site allow rules. Thus a threat host is blocked on stream pages also (`src/threat/compile.js:1-6`).
- "Allow this site" (10,000) does not release a threat host. "Allow this domain" (2,000,020) does (`src/threat/compile.js:5-6`).
- The threat rules list their resource types. Stylesheet, image and font are not in the list (`src/threat/compile.js:12`).
- The 2,000,011 value was read from the JSON file. The script adds a base of 2,000,001 to each upstream rule priority.
- The list-download allow rule matches only when the initiator is the extension id and the request host is a list host (`src/general/update.js:98-107`).
- That DNR applies these priorities as documented is UNVERIFIED. `docs/threat-tier.md` says the test matcher models the documented precedence only.

### 3.1 Rule id ranges

| Range | Kind | Owner | Definition |
| --- | --- | --- | --- |
| 1 to 4 | static `general` | hand-written stream rules | `scripts/merge-dnr-rules.py:48`, `:87` |
| 100 and up | static `general` | packed list rules | `scripts/merge-dnr-rules.py:50` |
| 100000 to 599999 | dynamic | refreshed list rules | `src/general/update.js:25` |
| 600000 to 609999 | dynamic | refreshed threat rules | `src/general/update.js:31-32` |
| 700001 to 704500 | session | signed feed | `src/feed/compile.js:7-13` |
| 800000 to 899999 | dynamic | copies of bundled non-list rules | `src/general/update.js:26` |
| 900000 to 909999 | dynamic | "Allow this site" | `src/general-settings.js:28`, `src/general-background.js:132` |
| 950000 to 950999 | dynamic | "Allow this domain" | `src/general-background.js:217-218` |
| 990001 | dynamic | list-download allow | `src/general/update.js:96` |

`isOurRule(id)` is true for 100000 up to 899999, without the threat range (`src/general/update.js:513-515`).
A list swap, the lists switch and `fallback()` remove only `isOurRule` ids.
`isThreatRule(id)` is true for 600000 up to 609999 (`src/general/update.js:509-511`).
Only a threat rebuild, a threat removal or "Revert lists" changes the threat range.
The code uses 30,000 as the dynamic rule limit (`src/general/update.js:33`).
The threat rebuild computes its budget from that limit minus the other dynamic rules minus 100 (`src/general/update.js:572`).

## 4. The dnrExclusive queue

All DNR writes go through one promise queue in the worker (`src/general-background.js:30-81`).
The function is `dnrExclusive(op)`. It runs one section at a time, in call order.

| Property | Value | Definition |
| --- | --- | --- |
| Timeout for each section | 120,000 ms | `DNR_SECTION_MAX_MS`, `src/general-background.js:49` |
| Timeout result | `{ ok: false, reason, error, timedOut: true }` | `DNR_TIMED_OUT`, `src/general-background.js:50` |
| Timer start | When the section starts, not when it is put in the queue | `src/general-background.js:60-64` |
| Reentrant | No | comment at `src/general-background.js:37-39` |

Rules for callers:

- Code in a section must not wait for a second `dnrExclusive` call. The second call would wait for the first.
- Engine functions that run in a section get `listDeps()` without `exclusive`.
- Only `refreshLists()` gives `exclusive: dnrExclusive` to the engine (`src/general-background.js:841`).
- List downloads and feed downloads run outside the queue.
- After a timeout, the queue releases. A late section can then write at the same time as the next section. The code comment accepts this risk (`src/general-background.js:46-48`).

Sections that use the queue:

| Caller | Work in the section | Line |
| --- | --- | --- |
| `syncThreatAllowRules` | Replace the 950000 range from `threatAllowDomains` | `src/general-background.js:222-224` |
| `syncFromSettings` | Enable or disable the `threat` ruleset; rebuild or remove refreshed threat rules | `src/general-background.js:323-333` |
| `applyGeneralState` | List-download allow rule, icon, lists switch, 900000 range | `src/general-background.js:429-449` |
| `refreshLists` | Read of the lists switch into `currentEnabled` | `src/general-background.js:825-828` |
| `GU.refresh` through `deps.exclusive` | Rule swap, or fallback after a download failure | `src/general/update.js:1015`, `:1035` |
| `revertLists` | `GU.revertLists` | `src/general-background.js:900` |
| `feedDeps().updateSessionRules` | Each feed session-rule write | `src/general-background.js:387-390` |

The worker has three other serial queues:

- `settingsQueue` for `syncFromSettings` (`src/general-background.js:304`).
- `feedQueue` for feed operations (`src/general-background.js:396`).
- `stateQueue` for `listState` writes (`src/general-background.js:567`).

## 5. Service worker start-up sequence

These top-level statements run each time the worker starts, in this order:

1. `importScripts` loads the modules (`src/general-background.js:7-8`).
2. `migrateSettings()` starts. Its promise is `settingsReady` (`src/general-background.js:341`).
3. `syncFromSettings()` starts. It waits for `settingsReady` (`src/general-background.js:342`).
4. The `alarms.onAlarm` listener is added (`src/general-background.js:958-964`).
5. `ensureRefreshAlarm()` creates the `gecko-refresh` alarm only if it is missing (`src/general-background.js:966`).
6. `storageReady()` starts the one-time list storage migration (`src/general-background.js:967`).
7. `applyCachedFeed()` puts feed session rules back (`src/general-background.js:970`). With the feed dormant, it only records the dormant state.
8. The toolbar icon is painted from storage. This step makes no DNR call (`src/general-background.js:973`).
9. The `onInstalled`, `onStartup`, `storage.onChanged` and `onMessage` listeners are added (`src/general-background.js:975`, `:994`, `:999`, `:1162`).

A worker start alone does not call `applyGeneralState()`.

### 5.1 Listeners

| Listener | Line | Work |
| --- | --- | --- |
| `chrome.alarms.onAlarm` | `src/general-background.js:959` | For the `gecko-refresh` alarm only: `refreshLists(false)` and `checkFeedNow()`. |
| `chrome.runtime.onInstalled` | `src/general-background.js:975` | `ensureCosmetic()`, `ensureRefreshAlarm()`, `syncThreatAllowRules()`, `applyCachedFeed()`. Writes legacy defaults if they are missing. Calls `applyGeneralState()`. On reason `install`, calls `refreshLists(true)`. |
| `chrome.runtime.onStartup` | `src/general-background.js:994` | `applyGeneralState()` and `syncThreatAllowRules()`. |
| `chrome.storage.onChanged` (area `local`) | `src/general-background.js:999` | `generalEnabled` or `generalAllowedOrigins`: `applyGeneralState()`. `threatAllowDomains`: `syncThreatAllowRules()`. `feedPaused`: `applyCachedFeed()`. `settings` or `siteOverrides`: `syncFromSettings()`. |
| `chrome.runtime.onMessage` | `src/general-background.js:1162` | See section 5.3. |

Other contexts also have a `chrome.storage.onChanged` listener:

| Context | Line | Keys that start work |
| --- | --- | --- |
| `src/cosmetic.js` | `src/cosmetic.js:239-247` | `generalEnabled`, `generalAllowedOrigins`, `cosMeta`, `settings`, `siteOverrides` |
| `src/settings/flags.js` | `src/settings/flags.js:124-127` | `settings`, `siteOverrides` |
| `src/twitch-directory-ads.js` | `src/twitch-directory-ads.js:142-144` | `settings`, `siteOverrides` |
| `src/settings.js` | `src/settings.js:290-293` | each key in its `KEYS` list (`src/settings.js:10`) |

### 5.2 The refresh alarm

| Item | Value | Definition |
| --- | --- | --- |
| Alarm name | `gecko-refresh` | `src/general/update.js:18` |
| Period | 180 minutes | `src/general/update.js:19` |
| First delay | 5 to 30 minutes, random | `src/general-background.js:931` |
| Minimum time between successful automatic runs | 12 hours | `src/general/update.js:20` |
| Minimum time after a failed attempt | 30 minutes | `src/general/update.js:21` |

The worker tries `persistAcrossSessions: true` first, then creates the alarm without it (`src/general-background.js:933-942`).
The comment says older Chrome versions drop alarms on a browser restart. This is UNVERIFIED.

### 5.3 Message types

All worker messages have `source: "adgecko-general"`.
The worker ignores a message from a different extension id (`src/general-background.js:1163-1167`).
If the sender has a tab, the worker accepts only two types from it, unless the sender URL is the settings page (`src/general-background.js:1182-1190`).

| Type | Sender | Receiver | Payload and reply | Line |
| --- | --- | --- | --- | --- |
| `cosmeticCss` | `src/cosmetic.js:86` (content script) | Worker | Reply `{ css }`: the text of `src/cosmetic-hide.css`, or `null`. | `src/general-background.js:1170` |
| `guardEvent` | `src/settings/flags.js:56` (content script) | Worker | `{ kind }` with `clipboard` or `popup`. No reply. Sets the tab badge. | `src/general-background.js:1178` |
| `applyGeneralState` | `src/popup.js:438` | Worker | Reply `{ ok, enabled, ruleset, allows }`. | `src/general-background.js:1191` |
| `updateLists` | `src/settings.js:265` | Worker | Reply `{ ok, result }`. Starts a manual refresh. | `src/general-background.js:1195` |
| `revertLists` | `src/settings.js:271` | Worker | Reply from `GU.revertLists`. | `src/general-background.js:1199` |
| `tabSignal` | `src/popup.js:409` | Worker | `{ tabId }`. Reply `{ ok, signal }`. Clears the badge. | `src/general-background.js:1203` |
| `siteInfo` | `src/popup.js:374` | Worker | `{ origin }`. Reply: host, stream flag, limited flag, feature list. | `src/general-background.js:1211` |
| `pageOrigin` | `src/popup.js:394` (`chrome.tabs.sendMessage`, frame 0) | Top-frame content script: `src/cosmetic.js:230` or `src/settings/flags.js:135` | Reply `{ origin }`. This message has no `source` field. | see section 9 |

The badge data for `guardEvent` is kept in `chrome.storage.session` under `tabSignals`, for 50 tabs maximum (`src/general-background.js:1083-1122`).
The worker ignores a second `guardEvent` for the same document in 2 seconds (`src/general-background.js:1096`).

## 6. List refresh data flow

The engine is `src/general/update.js`. The worker gives it its dependencies through `listDeps()` (`src/general-background.js:578-644`).

### 6.1 Diagram

```
 gecko-refresh alarm (3 h)        settings page "Update lists"      first install
          |                                  |                           |
          v                                  v                           v
   refreshLists(false)                refreshLists(true)  <--------------+
          |                                  |
          +----------------+-----------------+
                           v
        ensureCosmetic()  (seed hide rules from src/rules/cosmetic-rules.json)
                           |
                           v
        GU.refresh(deps, {manual})                 src/general/update.js:824
          1. shouldRun?  (12 h / 30 min throttle; manual always runs)
          2. dropRetiredLists, dropRetiredCosmetic
          3. for each source in SOURCES that is due:
               fetch (list hosts only, ETag / If-Modified-Since,
                      90 s timeout, 16 MB limit, redirect = error, mirrors)
               304 -> keep stored payload
               200 -> parseEntriesFull() -> checkListChange()
                         | rejected -> keep last good copy
                         v accepted
               storage: listData:<name>  = {domains, scoped, cancel, allow, ...,
                                            cosmetic?}
          4. storage: listState.lists = small metadata for each list
          5. hide rules (only if all required cosmetic sources have a copy):
               mergeCosmetic() -> writeCosmetic()
                 -> storage: cosG, cosS:<host>, cosE:<host>, cosMeta, cosKeys
                           |
                           v            (one dnrExclusive section)
        swap()                                     src/general/update.js:1128
          crossListRules -> mergeDomains / mergeScoped -> buildListRules
          + keptBundledRules (copies of the bundled non-list rules)
          updateDynamicRules: remove isOurRule ids, add ids 100000+ and 800000+
          static "general" ruleset stays enabled (offline floor)
          applyThreatRules -> updateDynamicRules: ids 600000-609999
                           |
                           v
        applyGeneralState()  (lists switch, allow rules, icon)
                           |
                           v
        storage: generalListStatus, generalListUpdatedAt  -> popup, settings page

 Page load on an ordinary site:
   src/cosmetic.js reads cosMeta, cosG (top frame only), cosS:<host>, cosE:<host>
   -> buildPageCss() -> one <style> element
   (no cosMeta in storage -> message "cosmeticCss" -> bundled src/cosmetic-hide.css)
```

### 6.2 Download step

- `SOURCES` has eight lists, each with a primary URL, optional mirrors and a minimum entry count (`src/general/update.js:69-92`).
- `listDeps().fetch` rejects a URL that is not an https URL on a list host (`src/general-background.js:581-584`, `src/general/update.js:1321-1328`).
- A request sends validators only to the URL that gave them (`src/general/update.js:876-881`).
- Each request uses `cache: "no-cache"`, `credentials: "omit"` and `redirect: "error"` (`src/general/update.js:887`).
- The timeout is 90 seconds and the body limit is 16 MB (`src/general/update.js:34`, `:36`).
- An automatic run downloads a list only after its expiry time. A manual run checks all lists (`src/general/update.js:634-638`).
- The expiry time comes from the `! Expires:` header, limited to 12 hours minimum and 7 days maximum (`src/general/update.js:396-403`).

### 6.3 Parse step

- `parseEntriesFull()` converts each line to a whole-domain entry or a scoped entry (`src/general/update.js:203-284`).
- `src/general/filter-options.js` converts filter options to a scope key. The packer uses the same table.
- An option that has no exact DNR equivalent drops the filter (`src/general/filter-options.js:5-7`).
- The parser never makes a rule for a never-block host, an ICANN public suffix or a non-public address (`src/general/update.js:155-185`).
- `PARSER_VERSION` is 4. A stored payload with a different version is downloaded again (`src/general/update.js:133`, `:737-739`).

### 6.4 Self-protection checks

A downloaded list is rejected as a whole in these conditions. The last good copy stays in use.

| Check | Limit | Definition |
| --- | --- | --- |
| Size change in one refresh | more than 25% | `src/general/update.js:651`, `:701-708` |
| Protected stream hosts named | more than 25 (adaptive limit for one list) | `src/general/update.js:653`, `:664-666`, `:691-698` |
| Generic hide selectors | more than 30,000 | `src/general/update.js:667` |
| Whole-page site hide rules | more than 100 | `src/general/update.js:668` |
| Hide list change | more than 25% | `src/general/update.js:720-723` |
| Too few entries | below the `minDomains` value of the source | `src/general/update.js:915-916` |

A change that occurs again on the next download, in 10% of the rejected size, is accepted (`src/general/update.js:686-687`).

### 6.5 Swap step

- `swap()` reads the bundled rules, the stored payloads and the pack-time cross-list data (`src/general/update.js:1128-1149`).
- `crossListRules()` applies `$badfilter` cancels and unconditional exceptions across all lists (`src/general/update.js:318-377`).
- For a list with no current copy, the packed rules and `src/rules/packed-cross.json` are used (`src/general/update.js:1156-1176`).
- The swap fails if the new set is smaller than 50% of the bundled set (`src/general/update.js:1179`).
- One `updateDynamicRules` call removes the old rules and adds the new rules (`src/general/update.js:1180-1183`).
- The static `general` ruleset stays enabled as the offline floor. Only the lists switch disables it (`src/general/update.js:1184-1190`).
- After the list swap, `applyThreatRules()` rebuilds the threat range in a second call (`src/general/update.js:1194`).

### 6.6 Hide-rule storage

| Key | Contents | Reader |
| --- | --- | --- |
| `cosG` | Generic selectors, one for each line | top frames |
| `cosS:<host>` | Site selectors for one host | frames on that host |
| `cosE:<host>` | Exception selectors for one host | frames on that host |
| `cosMeta` | Small gate record. A change starts the content script again. | all frames |
| `cosKeys` | Index of all stored hide keys | worker only |

The key names are at `src/general/cosmetic-parse.js:418-426`.
`writeCosmetic()` writes rule keys first, then `cosMeta`, then removes stale keys (`src/general-background.js:686-712`).
The refresh writes hide rules only when all `cosmetic: true` sources have a parsed copy (`src/general/update.js:984-1000`).
`ensureCosmetic()` runs on `onInstalled` and at the start of each `refreshLists()` run (`src/general-background.js:721-778`, `:820`, `:976`).
It seeds storage from `src/rules/cosmetic-rules.json`. It does nothing if a refreshed set is stored, or if this extension version made the check before.

### 6.7 List storage

| Key | Contents | Definition |
| --- | --- | --- |
| `listState` | Small run metadata: lists, times, counts, errors, threat state | `src/general-background.js:456` |
| `listData:<list name>` | Parsed payload of one list | `src/general-background.js:457` |
| `generalListRefresh` | Old single key. Migrated one time, one list at a time. | `src/general-background.js:458`, `:522-548` |
| `generalListStatus`, `generalListUpdatedAt` | Status text and time for the user interface | `src/general-settings.js:10-11` |

### 6.8 Other engine entry points

| Function | Trigger | Effect | Line |
| --- | --- | --- | --- |
| `applyEnabled(deps, enabled)` | `applyGeneralStateNow` | Off: disable `general`, remove `isOurRule` ids. On: use dynamic rules if they are active, or rebuild, or fall back to static. | `src/general/update.js:1215` |
| `fallback(deps)` | A failed swap or a failed download with no active rules | Remove `isOurRule` ids, enable `general`, set `dynamicActive: false`. | `src/general/update.js:1198` |
| `revertLists(deps)` | Settings page | Remove all payloads, list rules and threat rules. Go back to the packed data. | `src/general/update.js:1296` |
| `rebuildThreatRules(deps)` | Threat tier switched on | Build the threat range from stored payloads. | `src/general/update.js:1268` |
| `removeThreatRules(deps)` | Threat tier switched off | Remove the threat range. | `src/general/update.js:1254` |

## 7. Settings model

### 7.1 Storage keys

| Key | Shape | Writer | Definition |
| --- | --- | --- | --- |
| `settings` | `{ v: 1, enabled, features: { id: bool } }` | settings page, worker migration | `src/settings/features.js:7` |
| `siteOverrides` | `{ host: { enabled?: false, features?: { id: bool } } }` | popup, settings page | `src/settings/features.js:8` |
| `generalEnabled` | boolean, legacy mirror | worker | `src/general-settings.js:8` |
| `generalAllowedOrigins` | array of origins, legacy mirror | worker | `src/general-settings.js:9` |
| `threatAllowDomains` | array of domains | settings page | `src/general-background.js:216` |
| `feedPaused` | boolean, derived | worker | `src/feed/client.js:16` |
| `popupFix`, `popupWelcomed`, `uiTheme` | popup state | popup, settings page | `src/popup.js:20-22` |

`settings` and `siteOverrides` are the source of truth (`src/general-background.js:264-267`).

### 7.2 Feature registry

`FEATURES` has 13 entries (`src/settings/features.js:39-53`).
Each entry has a layer, a default, an apply mode, a per-site flag and a site list.

| Feature id | Layer | Default | Apply | Per site | Sites |
| --- | --- | --- | --- | --- | --- |
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

An `always` feature cannot be switched off. The vendored scripts get no flags (`src/settings/features.js:33-34`).

### 7.3 Migration and mirrors

1. `migrateLegacy()` runs at each worker start. It does nothing if `settings` exists (`src/settings/features.js:166-183`).
2. It converts `generalEnabled: false` to `features.network: false`.
3. It converts each allowed origin to a site override with `enabled: false`. It skips stream hosts.
4. `syncFromSettings()` then writes the mirrors from `legacyMirror()` (`src/general-background.js:305-338`, `src/settings/features.js:188-199`).
5. `generalEnabled` is true when the master switch and the `network` feature are on.
6. `generalAllowedOrigins` holds an http origin and an https origin for each host with the site off or `network` off.
7. `feedPaused` is true unless the master switch and `threatFeed` are on.
8. The `threat` static ruleset is enabled when the master switch and `threatTier` are on.

The mirror write changes storage. That change starts `applyGeneralState()` through `storage.onChanged`.

### 7.4 How features resolve for a page

`resolve(settings, overrides, host)` gives on or off for each feature (`src/settings/features.js:146-161`).

1. An `always` feature is on.
2. A feature with `available: false` is off.
3. The base value is the master switch AND the global feature switch.
4. `overrideFor()` finds the override entries for the host and each parent domain (`src/settings/features.js:119-142`).
5. Feature switches come from the most specific entry only.
6. Two values come down from a parent entry: an Allow (`enabled: false`) and `network: false`.
7. An Allow sets each per-site feature to off. On ordinary sites, an Allow does not switch off a `keepOnAllow` feature. The global switch and the per-site switch of that feature still apply.
8. If there is no Allow, a per-site feature switch in the entry replaces the global switch. The master switch still applies.

Readers of the resolved values:

| Reader | Line |
| --- | --- |
| `src/settings/flags.js` (for the page-world scripts) | `src/settings/flags.js:98` |
| `src/cosmetic.js` (feature `cosmetic`) | `src/cosmetic.js:149` |
| `src/twitch-directory-ads.js` (feature `twitchDisplay`) | `src/twitch-directory-ads.js:123-133` |
| Worker `siteInfo()` (for the popup) | `src/general-background.js:1049` |

`src/cosmetic.js` also reads the two legacy mirrors (`src/cosmetic.js:137-144`).

## 8. Private MessagePort channel

`src/settings/flags.js` runs in the ISOLATED world. It sends feature flags to the page-world scripts of the extension.
The channel is a `MessageChannel` port. It does not use `window.postMessage` (`src/settings/flags.js:8-21`).

| Item | Value | Definition |
| --- | --- | --- |
| Port event name | `gk-p1` | `src/settings/flags.js:23` |
| Request event name | `gk-r1` | `src/settings/flags.js:24` |
| Maximum ports for each frame | 8 | `src/settings/flags.js:25` |
| Flags sent | `youtubeWatchdog`, `youtubeCosmetic`, `kick`, `guardClipboard`, `guardPopups` | `src/settings/flags.js:27` |
| Flag message shape | `{ f: { id: bool } }` | `src/settings/flags.js:33-38` |
| Return message shape | `{ g: "clipboard" }` or `{ g: "popup" }` | `src/settings/flags.js:49-56` |

Sequence:

1. `flags.js` dispatches a `gk-p1` MessageEvent on `window` with one port (`src/settings/flags.js:62-73`).
2. Each page-world script listens for `gk-p1` in the capture phase. It takes the first port and removes its listener.
3. Each page-world script also dispatches `gk-r1` when it starts. This covers the case where it starts after `flags.js`.
4. `flags.js` answers `gk-r1` only until the first task after injection (`src/settings/flags.js:111-118`).
5. `flags.js` reads `settings` and `siteOverrides`, resolves the flags and posts them on each port (`src/settings/flags.js:93-107`).
6. A storage change of these two keys sends new flags (`src/settings/flags.js:124-127`).
7. A page guard posts `{ g }` on the port when it blocks an action. `flags.js` sends `guardEvent` to the worker, one time in 2 seconds maximum.

Port receivers:

| Script | Line | Flags used |
| --- | --- | --- |
| `src/youtube.js` | `src/youtube.js:1049-1090` | `youtubeWatchdog`, `youtubeCosmetic` |
| `src/kick.js` | `src/kick.js:679-722` | `kick` |
| `src/guards/clipboard.js` | `src/guards/clipboard.js:658-703` | `guardClipboard` |
| `src/guards/popups.js` | `src/guards/popups.js:285-327` | `guardPopups` |

Each receiver reads the event with `MessageEvent` getters that it captured at start (for example `src/youtube.js:1056-1064`).
A frame with no host of its own uses the origin of the site that made it (`src/settings/flags.js:79-91`).
If no port arrives, each page-world feature keeps its built-in default. The popup guard default is off. The other defaults are on.

UNVERIFIED: that all `document_start` scripts of the extension run in one task, in manifest order. The code handles the two orders (`src/settings/flags.js:18-20`).
UNVERIFIED: that a page script cannot get a port. This property depends on Chrome injection timing.

## 9. How the popup finds the page origin

The manifest has no `tabs` permission. The code comment says Chrome then gives no `tab.url` to the popup (`src/popup.js:108-110`). This is UNVERIFIED.

1. The popup calls `chrome.tabs.query` for the active tab (`src/popup.js:378-386`).
2. If `tab.url` is empty, the popup sends `{ type: "pageOrigin" }` to frame 0 of the tab (`src/popup.js:390-403`).
3. On an ordinary site, the top-frame `src/cosmetic.js` replies with the page origin (`src/cosmetic.js:224-234`).
4. On a stream host where `flags.js` runs, the top-frame `src/settings/flags.js` replies (`src/settings/flags.js:131-142`).
5. The popup stores the reply as `tab.pageOrigin` and uses it as the origin (`src/popup.js:106-112`).
6. The popup sends the origin to the worker in `siteInfo` (`src/popup.js:373-376`).
7. The worker reads the manifest to find which scripts run on that host (`src/general-background.js:1014-1034`).
8. The worker replies with the features that apply, and a `limited` flag (`src/general-background.js:1038-1071`).

`popup.html` loads only `popup.js` (`src/popup.html:55`). The popup cannot read the feature registry directly.
A page with no content script gives no reply. The popup then shows its "open a normal page" text (`src/popup.js:296-299`).
`limited` is true for a stream-family host where no feature script of the extension runs. The code comment gives YouTube Music and YouTube Kids as examples (`src/general-background.js:1054-1056`).
The popup uses `chrome.tabs.reload` and `chrome.tabs.create`. The comments say these need no `tabs` permission (`src/popup.js:424`, `:585`). This is UNVERIFIED.

## 10. Stream-site exclusion model

Stream sites are Twitch, YouTube, Kick and their player and media hosts.
The general lists, the cosmetic hide and the page guards do not operate on these sites.

| Mechanism | Where | Effect |
| --- | --- | --- |
| `STREAM_SITES` (17 hosts) | `src/settings/features.js:25-29` | The one list. A host matches itself and each subdomain (`isStreamHost`, `:61-65`). |
| `exclude_matches` | `manifest.json:143`, `:224`, `:274` | 34 patterns on the three ordinary-site entries (7, 10a, 10b). `streamExcludeMatches()` gives the same patterns (`src/settings/features.js:69-73`). |
| Second guard in the cosmetic script | `src/cosmetic.js:19-26` | The script stops on a stream host. With no registry, it hides nothing. |
| No stored hide rules | `src/general/cosmetic-parse.js:13-18` | The parser does not keep rules for a stream host. |
| Static allow rules at 2,000,000 | `src/rules/general-network.json` ids 1 to 3, built by `scripts/merge-dnr-rules.py:48-49` | Priority-1 list blocks do not apply to stream pages and player hosts. |
| Dynamic copies of those allow rules | `src/general/update.js:501-507` | The allow rules are also present as dynamic rules (ids 800000 and up) after a list swap. |
| Never-block hosts in the list tier | `src/general/update.js:109-114`, `:155-159` | The refresh makes no list rule for these hosts. One exception: `imasdk.googleapis.com` (`:153`). |
| Hard-exclude for allow rules | `src/general-background.js:140`, `:147`, `src/general-settings.js:48-54` | No "Allow this site" rule is made for a stream host. |
| Mirrors and migration | `src/settings/features.js:179`, `:193` | A stream host never becomes an allowed origin. |
| Threat-tier protected hosts | `src/threat/protected-hosts.js` | A threat rule can never name a stream host (see section 11). |

The comment at `src/settings/features.js:23-24` says a test compares these lists. The test was not run in this session.
The never-block list and the protected-host list contain more hosts than `STREAM_SITES`, for example Google API hosts.

Twitch is different from YouTube and Kick in the static rules.
Twitch has a plain `allow` rule for `twitch.tv` requests, without `ads.twitch.tv`.
YouTube and Kick have an `allowAllRequests` rule for their frames.
These contents were read from `src/rules/general-network.json`.

## 11. Threat tier and protected hosts

### 11.1 Sources of threat rules

| Source | Kind | Ids | Built by |
| --- | --- | --- | --- |
| Packed | static ruleset `threat` | 1 to 199 | `scripts/build-threat-rules.mjs` with `src/threat/compile.js` |
| Refreshed | dynamic rules | 600000 to 609999 | `applyThreatRules()`, `src/general/update.js:555-618` |
| Signed feed (dormant) | session rules | 700001 to 704500 | `src/feed/compile.js:16-34` |

- `THREAT_LISTS` names three of the eight sources (`src/threat/compile.js:18`).
- Only whole-domain entries and navigation-scope entries become threat hosts (`src/threat/compile.js:22`, `:32-39`).
- Popup-only filters become `main_frame`-only threat rules (`src/threat/compile.js:62-80`).
- One refresh can add 2,500 new hosts maximum and 20% of the previous set maximum (`src/general/update.js:522-523`).
- A larger change keeps the previous rules. The same change on a later download is accepted (`src/general/update.js:593-603`).
- The accepted set has a fingerprint in `listState.threatAcceptedSig`. The same set is installed again without a new check (`src/general/update.js:529-541`, `:597`).

### 11.2 Switches

- The threat tier is the feature `threatTier`. It is not a per-site feature.
- The lists switch, "Allow this site" and a failed list swap do not remove threat rules (`src/general/update.js:28-30`).
- With the lists off, a refresh still rebuilds the threat range from a new threat list (`src/general/update.js:1036-1050`).
- `threatOn` is `null` until the first sync. `threatEnabled()` returns true unless `threatOn` is false (`src/general-background.js:269`, `:640`).

### 11.3 Protected hosts

`protectedReason(host)` returns a reason if a threat rule must not name the host (`src/threat/protected-hosts.js:77-93`).

| Check | Definition |
| --- | --- |
| Empty, not a plain host name, or one label | `src/threat/protected-hosts.js:79-81` |
| Two labels that look like a public suffix | `src/threat/protected-hosts.js:56`, `:83` |
| Equal to or below a `SUFFIX` entry or a captcha entry | `src/threat/protected-hosts.js:26-39`, `:84-85` |
| Equal to or a parent of a `SUFFIX`, `EXACT` or captcha entry | `src/threat/protected-hosts.js:40`, `:86-87` |
| A non-public IPv4 address | `src/threat/protected-hosts.js:67-74` |
| A public suffix, a shared platform or a parent of one | `src/threat/psl.js`, called at `src/threat/protected-hosts.js:90-92` |

The same function checks the signed feed (`src/general-background.js:363`).
`userDomainReason()` applies the public-suffix check to the "Allow this domain" input (`src/threat/compile.js:94-116`).
The captcha list has one source file: `src/rules/never-block-captcha.json`. The packer generates `src/general/never-block-captcha.js` from it.

## 12. Signed threat feed (dormant)

The feed code is in `src/feed/`. It is dormant at this commit.
`FEED_ORIGIN` is empty (`src/feed/config.js:8`). `FEED_KEYS` and `KILL_KEYS` are empty (`src/feed/keys.js:10-11`).
`configured()` needs an origin, one key minimum and the origin in `host_permissions` (`src/feed/client.js:24-39`).
With the feed dormant, `applyCached()` and `checkFeed()` return before a fetch or a rule write (`src/feed/client.js:163-168`, `:205-206`).

Design when it is configured (from the code, not run):

- Two files: the feed document and a signature file. The signature covers the exact bytes (`src/feed/canonical.js:5-8`).
- Order: byte checks, signature file, pinned key, Ed25519 verify, JSON parse, strict schema (`src/feed/verify.js:5-9`).
- The feed can only add block rules at priority 2,000,010. It cannot name a protected host (`src/feed/schema.js:23-28`).
- A kill document from a kill key stops the feed until the extension version changes (`src/feed/client.js:144-152`).
- Session rules are put back at each worker start from the verified cache or from `src/rules/threat-snapshot.json` (`src/feed/client.js:161-201`).
- Storage keys: `feedState`, `feedCache`, `feedPaused` (`src/feed/client.js:14-16`).

## 13. Layering between `src/vendor/ubo-youtube.js` and `src/youtube.js`

The two scripts run in the MAIN world on the same three YouTube hosts.
The manifest lists `src/vendor/ubo-youtube.js` first (`manifest.json:79`) and `src/youtube.js` later (`manifest.json:108`).

| Item | `src/vendor/ubo-youtube.js` | `src/youtube.js` |
| --- | --- | --- |
| Origin | Generated by `scripts/sync-ubo-youtube.mjs`. Do not edit by hand (`src/vendor/ubo-youtube.js:1`). | Written for this extension. |
| Function | uBlock Origin scriptlets that prune ad data in player responses. | Stuck-start watchdog, feed tile removal, and its own ad-field strip as a fallback. |
| Switch | `apply: "always"`. No flag port. Internal toggles only (`src/vendor/ubo-youtube.js:11-14`). | `youtubeWatchdog` and `youtubeCosmetic` through the flag port. |
| Marker | Sets `globalThis[Symbol.for("gk.u")]` to true at its end (`src/vendor/ubo-youtube.js:2017`). | Reads the marker in `uboLayerPresent()` at each use (`src/youtube.js:11-18`). |

When the marker is present, `src/youtube.js` stands down in these places:

| Behaviour | Line |
| --- | --- |
| It does not drop ad entries from player, reel and browse data. | `src/youtube.js:312`, `:329`, `:335` |
| Its fetch, XHR and JSON hooks pass calls to the native functions. | `src/youtube.js:1129-1138`, `:1174-1178` |
| It does not inject its own home-feed CSS. The manifest CSS does this work. | `src/youtube.js:2066` |
| It does not start its DOM sweep observer. | `src/youtube.js:2098` |
| The stall watchdog uses the "gentle" mode with longer wait times. | `src/youtube.js:1031`, `:1469-1471`, `:1531` |
| A read-only resource-timing observer gives the watchdog its evidence. | `src/youtube.js:1148-1171` |

The marker can appear after `src/youtube.js` installed its hooks. The hooks then stand down on the next call (`src/youtube.js:1174-1178`).
`src/vendor/ubo-youtube-isolated.js` uses a different marker, `gk.ui` (`src/vendor/ubo-youtube-isolated.js:8-9`).
The static `ubo-youtube` ruleset and the two CSS files are part of the same layer.
All timing values and effects in `src/youtube.js` comments are UNVERIFIED in this session.

The Twitch script `src/vendor/video-swap-new.user.js` is a byte-for-byte copy of an upstream userscript (`src/vendor/README.md`).
It has no flag port and no connection to other extension code.
`TODO.md` says the release gate freezes `src/kick.js`. This analysis did not read that part of `scripts/release-gate.sh`.

## 14. Error handling: fail-open and fail-closed

"Fail-open" here means: on an error, the extension blocks or hides less, and the page works.
"Fail-closed" means: on an error, the extension refuses the action.

| Area | Condition | Result | Type | Line |
| --- | --- | --- | --- | --- |
| Flag port | No port or no flags arrive | Each page-world feature keeps its built-in default. The popup guard default is off (`src/guards/popups.js:287`). The other receivers default to on. | fail-open to defaults | `src/settings/flags.js:17-18` |
| Cosmetic script | Registry not loaded | Host counts as excluded. Nothing is hidden. | fail-open | `src/cosmetic.js:23-25` |
| Cosmetic script | Fallback sheet does not load | Style removed. No error goes to the page. | fail-open | `src/cosmetic.js:170-174` |
| Clipboard guard | Internal error | The original call continues. An error in the "user copied it" check counts as "no". | fail-open, with one fail-closed check | `src/guards/clipboard.js:56-57` |
| Popup guard | Internal error | The call continues. | fail-open | `src/guards/popups.js:8` |
| `src/youtube.js`, `src/kick.js` | No flags | Features stay on. An "off" flag stops only the next action. | fail-open | `src/youtube.js:1040-1042`, `src/kick.js:673-675` |
| Allow rules | Registry not loaded | Each host counts as hard-excluded. No allow rule is made. | fail-closed | `src/general-settings.js:52-53` |
| Protected hosts | Public-suffix data not loaded | Each threat host is rejected. | fail-closed (blocks nothing) | `src/threat/protected-hosts.js:90-91` |
| "Allow this domain" | Public-suffix data not loaded | No domain is accepted. | fail-closed | `src/threat/compile.js:112-113` |
| Module load | Captcha list not loaded first | The module throws. | fail-closed | `src/general/update.js:119-121` |
| List download | One list fails | Its stored copy stays. Other lists continue. | keep last good | `src/general/update.js:968-972` |
| List download | All due lists fail | The run is a failure. Retry after 30 minutes. | keep last good | `src/general/update.js:842-847`, `:1001-1004` |
| List check | A list is rejected | The last good copy stays. The reason is stored. | keep last good | `src/general/update.js:936-947` |
| Rule swap | The swap throws | `fallback()`: dynamic list rules removed, static ruleset enabled. | fall back to packed | `src/general/update.js:1062-1072` |
| Threat rebuild | Error, or too many new hosts | Previous threat rules stay. The static `threat` ruleset is the floor. | keep last good | `src/general/update.js:549-550`, `:598-603` |
| List fetch | URL is not a list host, or a redirect | Rejected. | fail-closed | `src/general-background.js:582`, `src/general/update.js:885-887` |
| Feed | Not configured, bad signature, schema error | No change. Previous rules stay. | fail-closed | `src/feed/client.js:251-254` |
| DNR queue | A section does not end in 120 seconds | The caller gets `DNR_TIMED_OUT`. The queue continues. | time limit | `src/general-background.js:60-64` |
| Storage writes in the worker | `localSet` or `localRemove` fails | The error is stored in `listState.lastError` and shown in the list status. | reported | `src/general-background.js:480-515` |
| Popup save | Storage write fails | The popup shows "Could not save. Try again." State does not change. | reported | `src/popup.js:338-358` |
| Worker messages | Sender is not this extension, or a tab that is not the settings page | Ignored. | fail-closed | `src/general-background.js:1167`, `:1182-1190` |
| Callback functions in DNR sections | A throw in a callback | The promise resolves with `{ ok: false }`. The queue is not held. | resolves always | `src/general-background.js:183-185` |

`GU.refresh()` never throws. It returns `{ ok, ran, reason }` (`src/general/update.js:816-823`).
Most `chrome.*` callbacks read `chrome.runtime.lastError` and continue.
The page-world scripts write to the page console only when a debug option is on (`src/youtube.js:1034-1038`, `src/kick.js:10-17`).

## 15. Concurrency rules for new work

- Put each new DNR write in a `dnrExclusive` section. Do not nest sections.
- Do not download in a section.
- Use a new rule id range only after a check of section 3.1 and of `src/feed/compile.js:3-5`.
- Add a stream host to `STREAM_SITES` and to the three `exclude_matches` lists together.
- Change `settings` or `siteOverrides` only. Let the worker write the legacy mirrors.
- Do not edit the generated files: `src/vendor/ubo-youtube.js`, `src/vendor/ubo-youtube-isolated.js`, `src/threat/psl.js`, `src/general/never-block-captcha.js`.

## Checked and not checked

An independent check compared this document with the source at commit b01e6a5. This section gives the result of that check.

Checked (read from the files in the check session):

- `manifest.json`: read in full. All manifest line references were compared.
- `src/general-background.js`, `src/general/update.js`: read in full. Each line reference to these two files was compared.
- `src/settings/features.js`, `src/settings/flags.js`, `src/general-settings.js`: read in full.
- `src/threat/compile.js`, `src/threat/protected-hosts.js`, `src/feed/config.js`, `src/feed/keys.js`, `src/feed/compile.js`, `src/general/never-block-captcha.js`: read in full.
- `src/feed/client.js`: lines 1 to 60 and 135 to 260. `src/feed/schema.js`: lines 1 to 30. `src/feed/canonical.js`: lines 1 to 12. `src/feed/verify.js`: lines 1 to 14. `src/threat/psl.js`: lines 1 to 40.
- `src/cosmetic.js`: lines 1 to 40, 80 to 180 and 182 to 273. `src/general/cosmetic-parse.js`: lines 1 to 22 and 410 to 430. `src/general/filter-options.js`: lines 1 to 10.
- `src/popup.js`: lines 100 to 114, 292 to 300 and 334 to 445, and a search for message, tab and storage-key code. `src/settings.js`: lines 14 to 34 and 258 to 290, and a search for message and storage code.
- `src/popup.html`, `src/settings.html`: script and link tags only.
- `src/youtube.js`: lines 9 to 19, 308 to 337, 1028 to 1092, 1126 to 1180, 2060 to 2068 and 2092 to 2100, and a search for the marker and the "gentle" mode.
- `src/kick.js`: lines 8 to 18 and 670 to 724. `src/guards/clipboard.js`: lines 50 to 58 and 655 to 705. `src/guards/popups.js`: lines 5 to 10 and 283 to 328. `src/twitch-directory-ads.js`: lines 118 to 135 and 142 to 144.
- `src/vendor/ubo-youtube.js`: lines 1 to 5, 8 to 16 and 2008 to 2021. `src/vendor/ubo-youtube-isolated.js`: lines 1 to 12. `src/vendor/README.md`: lines 1 to 30.
- The three static ruleset JSON files: a `python3 -I` script counted the rules, the priorities, the actions, the id ranges and the hosts for each threat rule. It printed each rule with a priority above 1.
- `src/rules/dnr-merge-meta.json`: read. `src/rules/never-block-captcha.json`: first 300 characters.
- `scripts/merge-dnr-rules.py`, `scripts/build-threat-rules.mjs`, `scripts/sync-ubo-youtube.mjs`, `scripts/lib/package_files.py`: only the lines that this document refers to. `scripts/pack-filter-lists.py` and `scripts/release-gate.sh`: search results only.
- `docs/threat-tier.md` and `TODO.md`: search results only, for the two statements that this document takes from them.
- Line counts of the files in `src/` came from `wc -l`. The commit id came from `git rev-parse --short HEAD`.
- A search of this document found no absolute path, no e-mail address and no IP address.

Not checked:

- No test was run. Deno is not installed. The files in `test/` were not read.
- The extension was not loaded in Chrome. All runtime behaviour is UNVERIFIED on a real browser.
- DNR precedence in Chrome, alarm persistence, content-script injection order and the port timing are UNVERIFIED.
- The large JSON files `src/rules/general-network.json`, `cosmetic-rules.json`, `packed-cross.json`, `threat-snapshot.json`, `cosmetic-sample.json` and `meta.json` were not read as text.
- The parts of `src/youtube.js`, `src/kick.js`, `src/guards/clipboard.js`, `src/guards/popups.js`, `src/popup.js`, `src/settings.js`, `src/feed/`, `src/general/filter-options.js` and `src/general/cosmetic-parse.js` that the list above does not name were not read.
- The bodies of `src/vendor/ubo-youtube.js`, `src/vendor/ubo-youtube-isolated.js` and `src/vendor/video-swap-new.user.js` were not read.
- The files in section 2.4 were not read in the check session.
- `scripts/pack-filter-lists.py`, `scripts/pack-zip.sh`, `scripts/release-gate.sh` and the other scripts were not read in full.
- `docs/how-it-works.md`, `docs/permissions-and-privacy.md`, `docs/UPDATING-DEPENDENCIES.md`, `docs/feed-setup.md`, `CHANGELOG.md` and the other docs were not read in the check session.
- `.github/workflows/` files were not read.
- The statement in an earlier version of this section, that the counts in the docs are older than the JSON files, was not checked. This document uses the counts from the JSON files.
- That the four files in section 2.4 are used only by tests was not confirmed.
