# Third-party filter list licenses

This directory ships **trimmed / converted** copies of public filter lists
for Chrome MV3 `declarativeNetRequest`. Full upstream lists are not reproduced.

Packed at: `2026-10-11T04:18:30Z` (UTC).

## Required credit

> Filter lists derived from **The EasyList authors** (EasyList / EasyPrivacy).

Additional credits: **Peter Lowe** (ad/tracking server list);
**abuse.ch URLhaus** data via **urlhaus-filter** / malware-filter packaging.

## Sources

### peter_lowe

- URL: `https://pgl.yoyo.org/adservers/serverlist.php?hostformat=adblockplus&showintro=0&mimetype=plaintext`
- Role: `ads_trackers`
- SHA-256 of downloaded bytes: `637f284766fac3871396cbef076ae7f03b4de2c0bce4936fec31e5996e600c0c`
- License / terms: Peter LoweΓÇÖs list ΓÇö free for personal/non-commercial use; credit required. See https://pgl.yoyo.org/as/ (check page for current terms).

### urlhaus_hosts

- URL: `https://malware-filter.gitlab.io/malware-filter/urlhaus-filter-hosts-online.txt`
- Role: `malware_threat`
- SHA-256 of downloaded bytes: `ea6e529bf50a40297766b7f4ad7dacc3ea8389b6646d5bf260d86d63e3f03cd6`
- License / terms: urlhaus-filter (curbengh / malware-filter) ΓÇö CC BY-NC-SA 4.0 for the filter packaging; URLhaus data from abuse.ch. Attribution required. https://gitlab.com/malware-filter/urlhaus-filter

### easylist

- URL: `https://easylist.to/easylist/easylist.txt`
- Role: `ads`
- SHA-256 of downloaded bytes: `9b73b708c424d98e155236015c3eb28d585fe9f64be1da329ecb20e8373f840f`
- License / terms: EasyList ΓÇö dual-licensed GNU GPL-3.0-or-later OR CC BY-SA 3.0-or-later. Credit: ΓÇ£The EasyList authorsΓÇ¥. https://easylist.to/pages/licence.html

### easyprivacy

- URL: `https://easylist.to/easylist/easyprivacy.txt`
- Role: `privacy`
- SHA-256 of downloaded bytes: `2502b80f3f6de48956f76fc7b8e4eac27e12cc08acb7dd828cc69c688edd6633`
- License / terms: EasyPrivacy ΓÇö same EasyList dual license (GPL-3.0-or-later OR CC BY-SA 3.0-or-later). Credit: ΓÇ£The EasyList authorsΓÇ¥.

## How we use them

- Network blocking only in `general-network.json` (domain ΓåÆ DNR `requestDomains`).
- Cosmetic sample (generic `##` only) in `cosmetic-sample.json` for the cosmetic agent ΓÇö not applied by DNR.
- Twitch / YouTube / Kick (and related player hosts) are stripped from block targets here;
  the DNR agent still must add higher-priority allow rules for those sites.

## License choice for EasyList material

Redistributed under **CC BY-SA 3.0-or-later** (EasyList dual-license option),
with attribution to The EasyList authors. Modified (trimmed/converted) work.
