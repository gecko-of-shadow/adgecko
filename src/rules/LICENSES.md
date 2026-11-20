# Third-party filter list licenses

This directory ships **trimmed / converted** copies of public filter lists
for Chrome MV3 `declarativeNetRequest`. Full upstream lists are not reproduced.

Packed at: `2026-11-14T22:00:32Z` (UTC).

## Required credit

> Filter lists derived from **The EasyList authors** (EasyList / EasyPrivacy).

Additional credits: **Peter Lowe** (ad/tracking server list);
**abuse.ch URLhaus** data via **urlhaus-filter** / malware-filter packaging.

## The one Curben list (owner decision #18b)

`urlhaus_hosts` is curbengh's urlhaus-filter (malware-filter project):
URLhaus malware-host data from abuse.ch (CC0 1.0); the urlhaus-filter
repository is CC0 1.0 and MIT. It is the only list from that project that
Adgecko uses, fetched only from
`https://malware-filter.gitlab.io/malware-filter/urlhaus-filter-hosts-online.txt`.
No phishing-feed data: the project's phishing list stays dropped (owner
decisions #13 and #18b). `scripts/lib/curben_check.py` enforces this in the
release gate and the tests.

## Sources

### peter_lowe

- URL: `https://pgl.yoyo.org/adservers/serverlist.php?hostformat=adblockplus&showintro=0&mimetype=plaintext`
- Role: `ads_trackers`
- SHA-256 of downloaded bytes: `197ddaa4bbbcf4e435d5eadb903e247864c47894c30f2bd6a015436b7c0a457d`
- License / terms: Peter Lowe's list - free for personal/non-commercial use; credit required. See https://pgl.yoyo.org/as/ (check page for current terms).

### urlhaus_hosts

- URL: `https://malware-filter.gitlab.io/malware-filter/urlhaus-filter-hosts-online.txt`
- Role: `malware_threat`
- SHA-256 of downloaded bytes: `1a005904a07ea817764bac436a136eb9b98230711770101a8e3e3394e998420c`
- License / terms: urlhaus-filter by curbengh (malware-filter project) - repository CC0 1.0 and MIT License; URLhaus data by abuse.ch - CC0 1.0 (not endorsed by abuse.ch). The one Curben list we use (owner decision #18b): URLhaus malware data only. https://gitlab.com/malware-filter/urlhaus-filter

### easylist

- URL: `https://easylist.to/easylist/easylist.txt`
- Role: `ads`
- SHA-256 of downloaded bytes: `22537bd53aa00c4c850b89a094a71f03811d2ce9454f5c56ec4e079eae67665a`
- License / terms: EasyList - dual-licensed GNU GPL-3.0-or-later OR CC BY-SA 3.0-or-later. Credit: "The EasyList authors". https://easylist.to/pages/licence.html

### easyprivacy

- URL: `https://easylist.to/easylist/easyprivacy.txt`
- Role: `privacy`
- SHA-256 of downloaded bytes: `e787a5bb16d5cad180c4033e51b1c62dd1cc3780c40760142655d39e0f7b05ba`
- License / terms: EasyPrivacy - same EasyList dual license (GPL-3.0-or-later OR CC BY-SA 3.0-or-later). Credit: "The EasyList authors".

### hagezi_pro_mini

- URL: `https://raw.githubusercontent.com/hagezi/dns-blocklists/main/adblock/pro.mini.txt`
- Role: `ads_trackers`
- SHA-256 of downloaded bytes: `3420114815982741349501d40d2a9cab5509e08a6cdd60951b7c4801b55ee06c`
- License / terms: HaGeZi DNS Blocklists (Pro mini) - GPL-3.0 (repository LICENSE, checked 2026-11-02). Credit: HaGeZi. https://github.com/hagezi/dns-blocklists

### ublock_badware

- URL: `https://ublockorigin.github.io/uAssets/filters/badware.txt`
- Role: `malware_threat`
- SHA-256 of downloaded bytes: `de1598a9466d60ddccfe7a54511201ece53357900c342b8ed9fd344fa965ed10`
- License / terms: uBlock Origin badware filters (uAssets) - GPL-3.0 (repository LICENSE, checked 2026-11-02). Credit: Raymond Hill and uBlock Origin contributors. https://github.com/uBlockOrigin/uAssets

### dandelion_antimalware

- URL: `https://raw.githubusercontent.com/DandelionSprout/adfilt/master/Dandelion%20Sprout%27s%20Anti-Malware%20List.txt`
- Role: `malware_threat`
- SHA-256 of downloaded bytes: `e7c7f6bbd7565fd918a8890e3b3520aa6a7f142c22ac0a879bfe46fd76824007`
- License / terms: Dandelion Sprout's Anti-Malware List - Dandelicence v1.4 (use and redistribution with or without changes and with or without commercial purpose; keep the licence text or a link to it; checked 2026-11-02): https://github.com/DandelionSprout/adfilt/blob/master/LICENSE.md. Credit: Dandelion Sprout.

### adguard_base

- URL: `https://filters.adtidy.org/extension/ublock/filters/2_without_easylist.txt`
- Role: `ads`
- SHA-256 of downloaded bytes: `0373107297ba30ff06cdb0d1351b03be0e3b7f021308f22514260d24bd351771`
- License / terms: AdGuard Base filter (EasyList already removed) - GPL-3.0 (AdguardFilters repository LICENSE, checked 2026-11-02). Credit: AdGuard. https://github.com/AdguardTeam/AdguardFilters

## How we use them

- Network blocking in `general-network.json` (domain -> DNR `requestDomains`), from all lists.
- The malware and threat lists also go into the `threat` ruleset in `threat-network.json`
  (built by `scripts/build-threat-rules.mjs`).
- At run time the extension downloads new copies of the lists and puts them in dynamic
  DNR rules. See `docs/permissions-and-privacy.md`.
- Hide rules (`##`) from easylist, easyprivacy in `cosmetic-rules.json` (built by `scripts/pack-cosmetic.mjs`).
- Cosmetic sample (generic `##` only) in `cosmetic-sample.json` for the cosmetic agent - not applied by DNR.
- Twitch / YouTube / Kick (and related player hosts) are stripped from block targets here;
  the DNR agent still must add higher-priority allow rules for those sites.

## License choice for EasyList material

Redistributed under **GPL-3.0-or-later** (EasyList dual-license option),
with attribution to The EasyList authors. Modified (trimmed/converted) work.
The rules mix EasyList material with GPL-3.0 lists, and the project code is GPL-3.0.
