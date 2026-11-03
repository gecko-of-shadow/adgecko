# Third-party filter list licenses

This directory ships **trimmed / converted** copies of public filter lists
for Chrome MV3 `declarativeNetRequest`. Full upstream lists are not reproduced.

Packed at: `2026-11-03T16:31:25Z` (UTC).

## Required credit

> Filter lists derived from **The EasyList authors** (EasyList / EasyPrivacy).

Additional credits: **Peter Lowe** (ad/tracking server list);
**abuse.ch URLhaus** data via **urlhaus-filter** / malware-filter packaging.

## The one Curben list (owner decision #18b)

`urlhaus_hosts` is curbengh's urlhaus-filter (malware-filter project):
URLhaus malware-host data from abuse.ch (CC0 1.0); the urlhaus-filter
repository is CC0 1.0 and MIT. It is the only list from that project that
Gecko Adblock uses, fetched only from
`https://malware-filter.gitlab.io/malware-filter/urlhaus-filter-hosts-online.txt`.
No phishing-feed data: the project's phishing list stays dropped (owner
decisions #13 and #18b). `scripts/lib/curben_check.py` enforces this in the
release gate and the tests.

## Sources

### peter_lowe

- URL: `https://pgl.yoyo.org/adservers/serverlist.php?hostformat=adblockplus&showintro=0&mimetype=plaintext`
- Role: `ads_trackers`
- SHA-256 of downloaded bytes: `ac9b7773f0d84b95e23218f997a7b2d30496e084014188de05f4d0f663628c5f`
- License / terms: Peter Lowe's list - free for personal/non-commercial use; credit required. See https://pgl.yoyo.org/as/ (check page for current terms).

### urlhaus_hosts

- URL: `https://malware-filter.gitlab.io/malware-filter/urlhaus-filter-hosts-online.txt`
- Role: `malware_threat`
- SHA-256 of downloaded bytes: `c9b96653c47dc63233ade9162c0b2f2197e963b294d6b8757ed5a3e050fa3874`
- License / terms: urlhaus-filter by curbengh (malware-filter project) - repository CC0 1.0 and MIT License; URLhaus data by abuse.ch - CC0 1.0 (not endorsed by abuse.ch). The one Curben list we use (owner decision #18b): URLhaus malware data only. https://gitlab.com/malware-filter/urlhaus-filter

### easylist

- URL: `https://easylist.to/easylist/easylist.txt`
- Role: `ads`
- SHA-256 of downloaded bytes: `d912796ac23f0c7853d403e6310d8c475ea09506999238ee04fe4fa09d266a87`
- License / terms: EasyList - dual-licensed GNU GPL-3.0-or-later OR CC BY-SA 3.0-or-later. Credit: "The EasyList authors". https://easylist.to/pages/licence.html

### easyprivacy

- URL: `https://easylist.to/easylist/easyprivacy.txt`
- Role: `privacy`
- SHA-256 of downloaded bytes: `37f707f0256710cfcbb182bd062c181bd4179b78ef6db7ba6d60f045291ce676`
- License / terms: EasyPrivacy - same EasyList dual license (GPL-3.0-or-later OR CC BY-SA 3.0-or-later). Credit: "The EasyList authors".

### hagezi_pro_mini

- URL: `https://raw.githubusercontent.com/hagezi/dns-blocklists/main/adblock/pro.mini.txt`
- Role: `ads_trackers`
- SHA-256 of downloaded bytes: `f89f7c45d08b84724bae9eb16923d600df60dbe0a76bbfe680049035336d9421`
- License / terms: HaGeZi DNS Blocklists (Pro mini) - GPL-3.0 (repository LICENSE, checked 2026-11-02). Credit: HaGeZi. https://github.com/hagezi/dns-blocklists

### ublock_badware

- URL: `https://ublockorigin.github.io/uAssets/filters/badware.txt`
- Role: `malware_threat`
- SHA-256 of downloaded bytes: `eeafc77b6eef9188fc01ffebb74f67c532bddc3367f92a27263fc71aa02ea33c`
- License / terms: uBlock Origin badware filters (uAssets) - GPL-3.0 (repository LICENSE, checked 2026-11-02). Credit: Raymond Hill and uBlock Origin contributors. https://github.com/uBlockOrigin/uAssets

### dandelion_antimalware

- URL: `https://raw.githubusercontent.com/DandelionSprout/adfilt/master/Dandelion%20Sprout%27s%20Anti-Malware%20List.txt`
- Role: `malware_threat`
- SHA-256 of downloaded bytes: `1b0b456c66792d1cacf42274693d99c14355085c685df903c0f0841aee80773e`
- License / terms: Dandelion Sprout's Anti-Malware List - Dandelicence v1.4 (use and redistribution with or without changes and with or without commercial purpose; keep the licence text or a link to it; checked 2026-11-02): https://github.com/DandelionSprout/adfilt/blob/master/LICENSE.md. Credit: Dandelion Sprout.

### adguard_base

- URL: `https://filters.adtidy.org/extension/ublock/filters/2_without_easylist.txt`
- Role: `ads`
- SHA-256 of downloaded bytes: `8c86453e82f03cf2ec26e8c406c6fa3fb8115bc8e8ce5eefba44c6bd503f9875`
- License / terms: AdGuard Base filter (EasyList already removed) - GPL-3.0 (AdguardFilters repository LICENSE, checked 2026-11-02). Credit: AdGuard. https://github.com/AdguardTeam/AdguardFilters

## How we use them

- Network blocking only in `general-network.json` (domain -> DNR `requestDomains`).
- Cosmetic sample (generic `##` only) in `cosmetic-sample.json` for the cosmetic agent - not applied by DNR.
- Twitch / YouTube / Kick (and related player hosts) are stripped from block targets here;
  the DNR agent still must add higher-priority allow rules for those sites.

## License choice for EasyList material

Redistributed under **CC BY-SA 3.0-or-later** (EasyList dual-license option),
with attribution to The EasyList authors. Modified (trimmed/converted) work.
