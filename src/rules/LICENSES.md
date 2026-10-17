# Third-party filter list licenses

This directory ships **trimmed / converted** copies of public filter lists
for Chrome MV3 `declarativeNetRequest`. Full upstream lists are not reproduced.

Packed at: `2026-10-17T00:18:55Z` (UTC).

## Required credit

> Filter lists derived from **The EasyList authors** (EasyList / EasyPrivacy).

Additional credits: **Peter Lowe** (ad/tracking server list);
**abuse.ch URLhaus** data via **urlhaus-filter** / malware-filter packaging.

## Sources

### peter_lowe

- URL: `https://pgl.yoyo.org/adservers/serverlist.php?hostformat=adblockplus&showintro=0&mimetype=plaintext`
- Role: `ads_trackers`
- SHA-256 of downloaded bytes: `d80faa52f2871c95bc224adba1676da5b69d3aeb03094f2bcd431d4ac4fad28d`
- License / terms: Peter LoweΓÇÖs list ΓÇö free for personal/non-commercial use; credit required. See https://pgl.yoyo.org/as/ (check page for current terms).

### urlhaus_hosts

- URL: `https://malware-filter.gitlab.io/malware-filter/urlhaus-filter-hosts-online.txt`
- Role: `malware_threat`
- SHA-256 of downloaded bytes: `756fbe728ca940ae0ad402b250a91cbecf05bccbda88dc6ba1adfda212c27d93`
- License / terms: urlhaus-filter (curbengh / malware-filter) ΓÇö CC BY-NC-SA 4.0 for the filter packaging; URLhaus data from abuse.ch. Attribution required. https://gitlab.com/malware-filter/urlhaus-filter

### easylist

- URL: `https://easylist.to/easylist/easylist.txt`
- Role: `ads`
- SHA-256 of downloaded bytes: `96c7bde591373a3485bde745c69569bdeea55d81eadb886db6ba502a49e8c2f3`
- License / terms: EasyList ΓÇö dual-licensed GNU GPL-3.0-or-later OR CC BY-SA 3.0-or-later. Credit: ΓÇ£The EasyList authorsΓÇ¥. https://easylist.to/pages/licence.html

### easyprivacy

- URL: `https://easylist.to/easylist/easyprivacy.txt`
- Role: `privacy`
- SHA-256 of downloaded bytes: `0256f929201407119a40b7e82d5c3d393bab537b49d24e67fe5a9d10b6653678`
- License / terms: EasyPrivacy ΓÇö same EasyList dual license (GPL-3.0-or-later OR CC BY-SA 3.0-or-later). Credit: ΓÇ£The EasyList authorsΓÇ¥.

### hagezi_pro_mini

- URL: `https://raw.githubusercontent.com/hagezi/dns-blocklists/main/adblock/pro.mini.txt`
- Role: `ads_trackers`
- SHA-256 of downloaded bytes: `2a9fc2a4d6d8fe14f04a3f434727c6fc36ee214dd642d10f489e03251e0fecd6`
- License / terms: HaGeZi Pro mini — see https://github.com/hagezi/dns-blocklists for the current license. Credit: HaGeZi.

### ublock_badware

- URL: `https://ublockorigin.github.io/uAssets/filters/badware.txt`
- Role: `malware_threat`
- SHA-256 of downloaded bytes: `dbb7b3a6e20266b92fb35e940a4ace8e023259078a3d6a2f716eaebc9b653d0f`
- License / terms: uBlock Origin badware filters — GPL-3.0. Credit: Raymond Hill and uBlock Origin contributors.

### dandelion_antimalware

- URL: `https://raw.githubusercontent.com/DandelionSprout/adfilt/master/Dandelion%20Sprout%27s%20Anti-Malware%20List.txt`
- Role: `malware_threat`
- SHA-256 of downloaded bytes: `80b39c7222b46707cea98cb5c4c9ddbb4ba29a2d6aeeaf41f0fa175adf3bb1df`
- License / terms: Dandelion Sprout's Anti-Malware List — see https://github.com/DandelionSprout/adfilt for the current license. Credit: Dandelion Sprout.

### curben_phishing

- URL: `https://malware-filter.gitlab.io/malware-filter/phishing-filter.txt`
- Role: `malware_threat`
- SHA-256 of downloaded bytes: `c46f7d27fe71c419f0f080d2231f4d7b6badf8bdb9b7cbffd828d34eaacc6550`
- License / terms: phishing-filter (curbengh / malware-filter). Attribution required. https://gitlab.com/malware-filter/phishing-filter

### adguard_base

- URL: `https://filters.adtidy.org/extension/ublock/filters/2_without_easylist.txt`
- Role: `ads`
- SHA-256 of downloaded bytes: `8491a07b6bb6d639c4b2592fffc988ef3659c56737f54945d7ca982ffa714e39`
- License / terms: AdGuard Base filter (EasyList already removed) — GPL-3.0. Credit: AdGuard.

## How we use them

- Network blocking only in `general-network.json` (domain ΓåÆ DNR `requestDomains`).
- Cosmetic sample (generic `##` only) in `cosmetic-sample.json` for the cosmetic agent ΓÇö not applied by DNR.
- Twitch / YouTube / Kick (and related player hosts) are stripped from block targets here;
  the DNR agent still must add higher-priority allow rules for those sites.

## License choice for EasyList material

Redistributed under **CC BY-SA 3.0-or-later** (EasyList dual-license option),
with attribution to The EasyList authors. Modified (trimmed/converted) work.
