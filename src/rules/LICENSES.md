# Third-party filter list licenses

This directory ships **trimmed / converted** copies of public filter lists
for Chrome MV3 `declarativeNetRequest`. Full upstream lists are not reproduced.

Packed at: `2026-11-02T23:58:33Z` (UTC).

## Required credit

> Filter lists derived from **The EasyList authors** (EasyList / EasyPrivacy).

Additional credits: **Peter Lowe** (ad/tracking server list);
**abuse.ch URLhaus** data via **urlhaus-filter** / malware-filter packaging.

## Sources

### peter_lowe

- URL: `https://pgl.yoyo.org/adservers/serverlist.php?hostformat=adblockplus&showintro=0&mimetype=plaintext`
- Role: `ads_trackers`
- SHA-256 of downloaded bytes: `ac9b7773f0d84b95e23218f997a7b2d30496e084014188de05f4d0f663628c5f`
- License / terms: Peter LoweΓÇÖs list ΓÇö free for personal/non-commercial use; credit required. See https://pgl.yoyo.org/as/ (check page for current terms).

### urlhaus_hosts

- URL: `https://malware-filter.gitlab.io/malware-filter/urlhaus-filter-hosts-online.txt`
- Role: `malware_threat`
- SHA-256 of downloaded bytes: `9a72012249c3876b3e3838b8f9345cd2fff67d5cf6ff6fd4cd657e10bb378adc`
- License / terms: urlhaus-filter (curbengh / malware-filter) ΓÇö CC BY-NC-SA 4.0 for the filter packaging; URLhaus data from abuse.ch. Attribution required. https://gitlab.com/malware-filter/urlhaus-filter

### easylist

- URL: `https://easylist.to/easylist/easylist.txt`
- Role: `ads`
- SHA-256 of downloaded bytes: `a1288ac542b6881f67a21c6c973d95b4f058eb65b28fe7a07d9906ca7e877816`
- License / terms: EasyList ΓÇö dual-licensed GNU GPL-3.0-or-later OR CC BY-SA 3.0-or-later. Credit: ΓÇ£The EasyList authorsΓÇ¥. https://easylist.to/pages/licence.html

### easyprivacy

- URL: `https://easylist.to/easylist/easyprivacy.txt`
- Role: `privacy`
- SHA-256 of downloaded bytes: `a528a9d9fc3f467edc9ec40be115ae6aab7aa1ecc25bba6858822a29a2b36706`
- License / terms: EasyPrivacy ΓÇö same EasyList dual license (GPL-3.0-or-later OR CC BY-SA 3.0-or-later). Credit: ΓÇ£The EasyList authorsΓÇ¥.

### hagezi_pro_mini

- URL: `https://raw.githubusercontent.com/hagezi/dns-blocklists/main/adblock/pro.mini.txt`
- Role: `ads_trackers`
- SHA-256 of downloaded bytes: `78c9ff1c5df4ce2ff20334393228a215beee0f7ed4874eb9c9030313a27649d0`
- License / terms: HaGeZi Pro mini — see https://github.com/hagezi/dns-blocklists for the current license. Credit: HaGeZi.

### ublock_badware

- URL: `https://ublockorigin.github.io/uAssets/filters/badware.txt`
- Role: `malware_threat`
- SHA-256 of downloaded bytes: `eeafc77b6eef9188fc01ffebb74f67c532bddc3367f92a27263fc71aa02ea33c`
- License / terms: uBlock Origin badware filters — GPL-3.0. Credit: Raymond Hill and uBlock Origin contributors.

### dandelion_antimalware

- URL: `https://raw.githubusercontent.com/DandelionSprout/adfilt/master/Dandelion%20Sprout%27s%20Anti-Malware%20List.txt`
- Role: `malware_threat`
- SHA-256 of downloaded bytes: `1b0b456c66792d1cacf42274693d99c14355085c685df903c0f0841aee80773e`
- License / terms: Dandelion Sprout's Anti-Malware List — see https://github.com/DandelionSprout/adfilt for the current license. Credit: Dandelion Sprout.

### adguard_base

- URL: `https://filters.adtidy.org/extension/ublock/filters/2_without_easylist.txt`
- Role: `ads`
- SHA-256 of downloaded bytes: `607d881783544b06bff3d171acab04866876e97c0a587c58c48f6a17a87e4c71`
- License / terms: AdGuard Base filter (EasyList already removed) — GPL-3.0. Credit: AdGuard.

## How we use them

- Network blocking only in `general-network.json` (domain ΓåÆ DNR `requestDomains`).
- Cosmetic sample (generic `##` only) in `cosmetic-sample.json` for the cosmetic agent ΓÇö not applied by DNR.
- Twitch / YouTube / Kick (and related player hosts) are stripped from block targets here;
  the DNR agent still must add higher-priority allow rules for those sites.

## License choice for EasyList material

Redistributed under **CC BY-SA 3.0-or-later** (EasyList dual-license option),
with attribution to The EasyList authors. Modified (trimmed/converted) work.
