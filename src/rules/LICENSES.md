# Third-party filter list licenses

This directory ships **trimmed / converted** copies of public filter lists
for Chrome MV3 `declarativeNetRequest`. Full upstream lists are not reproduced.

Packed at: `2026-11-09T03:01:28Z` (UTC).

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
- SHA-256 of downloaded bytes: `68fd03880a70202368484e675c3989b0519b0c019af664f9676ab17cc302e708`
- License / terms: Peter Lowe's list - free for personal/non-commercial use; credit required. See https://pgl.yoyo.org/as/ (check page for current terms).

### urlhaus_hosts

- URL: `https://malware-filter.gitlab.io/malware-filter/urlhaus-filter-hosts-online.txt`
- Role: `malware_threat`
- SHA-256 of downloaded bytes: `32d5055d6be549d3fa61095773d558976de64fc684593c04b7650014ad354c75`
- License / terms: urlhaus-filter by curbengh (malware-filter project) - repository CC0 1.0 and MIT License; URLhaus data by abuse.ch - CC0 1.0 (not endorsed by abuse.ch). The one Curben list we use (owner decision #18b): URLhaus malware data only. https://gitlab.com/malware-filter/urlhaus-filter

### easylist

- URL: `https://easylist.to/easylist/easylist.txt`
- Role: `ads`
- SHA-256 of downloaded bytes: `5fd80d41b45871d591af0e1d613179548515fde68fa3d5ef530c7dd0974295ce`
- License / terms: EasyList - dual-licensed GNU GPL-3.0-or-later OR CC BY-SA 3.0-or-later. Credit: "The EasyList authors". https://easylist.to/pages/licence.html

### easyprivacy

- URL: `https://easylist.to/easylist/easyprivacy.txt`
- Role: `privacy`
- SHA-256 of downloaded bytes: `c8fbdef081769be7de2e3cd438bee7d579af0f7ed12986377ec4ef36bacd58ed`
- License / terms: EasyPrivacy - same EasyList dual license (GPL-3.0-or-later OR CC BY-SA 3.0-or-later). Credit: "The EasyList authors".

### hagezi_pro_mini

- URL: `https://raw.githubusercontent.com/hagezi/dns-blocklists/main/adblock/pro.mini.txt`
- Role: `ads_trackers`
- SHA-256 of downloaded bytes: `a88c1ee35789339a6c5ff35c0bcdf34d568059a9a7b2f47a163c87a93ebb58ae`
- License / terms: HaGeZi DNS Blocklists (Pro mini) - GPL-3.0 (repository LICENSE, checked 2026-11-02). Credit: HaGeZi. https://github.com/hagezi/dns-blocklists

### ublock_badware

- URL: `https://ublockorigin.github.io/uAssets/filters/badware.txt`
- Role: `malware_threat`
- SHA-256 of downloaded bytes: `5183a92da27a5e3cee2cd5245776204e076a628dc07fa9accd160fd216782f9d`
- License / terms: uBlock Origin badware filters (uAssets) - GPL-3.0 (repository LICENSE, checked 2026-11-02). Credit: Raymond Hill and uBlock Origin contributors. https://github.com/uBlockOrigin/uAssets

### dandelion_antimalware

- URL: `https://raw.githubusercontent.com/DandelionSprout/adfilt/master/Dandelion%20Sprout%27s%20Anti-Malware%20List.txt`
- Role: `malware_threat`
- SHA-256 of downloaded bytes: `e7c7f6bbd7565fd918a8890e3b3520aa6a7f142c22ac0a879bfe46fd76824007`
- License / terms: Dandelion Sprout's Anti-Malware List - Dandelicence v1.4 (use and redistribution with or without changes and with or without commercial purpose; keep the licence text or a link to it; checked 2026-11-02): https://github.com/DandelionSprout/adfilt/blob/master/LICENSE.md. Credit: Dandelion Sprout.

### adguard_base

- URL: `https://filters.adtidy.org/extension/ublock/filters/2_without_easylist.txt`
- Role: `ads`
- SHA-256 of downloaded bytes: `10d666ef90498b219e699f698a603bb3d38cd90e06df9bb8e4af729bd63f2040`
- License / terms: AdGuard Base filter (EasyList already removed) - GPL-3.0 (AdguardFilters repository LICENSE, checked 2026-11-02). Credit: AdGuard. https://github.com/AdguardTeam/AdguardFilters

## How we use them

- Network blocking only in `general-network.json` (domain -> DNR `requestDomains`).
- Cosmetic sample (generic `##` only) in `cosmetic-sample.json` for the cosmetic agent - not applied by DNR.
- Twitch / YouTube / Kick (and related player hosts) are stripped from block targets here;
  the DNR agent still must add higher-priority allow rules for those sites.

## License choice for EasyList material

Redistributed under **CC BY-SA 3.0-or-later** (EasyList dual-license option),
with attribution to The EasyList authors. Modified (trimmed/converted) work.
