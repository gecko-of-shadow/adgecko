# Third-party filter list licenses

This directory ships **trimmed / converted** copies of public filter lists
for Chrome MV3 `declarativeNetRequest`. Full upstream lists are not reproduced.

Packed at: `2026-10-10T08:27:09Z` (UTC).

## Required credit

> Filter lists derived from **The EasyList authors** (EasyList / EasyPrivacy).

Additional credits: **Peter Lowe** (ad/tracking server list);
**abuse.ch URLhaus** data via **urlhaus-filter** / malware-filter packaging.

## Sources

### peter_lowe

- URL: `https://pgl.yoyo.org/adservers/serverlist.php?hostformat=adblockplus&showintro=0&mimetype=plaintext`
- Role: `ads_trackers`
- SHA-256 of downloaded bytes: `0fea40d20ee7bd83ba818dfdb6dbe148efacc99c509e03e85b65fa876d99be61`
- License / terms: Peter LoweΓÇÖs list ΓÇö free for personal/non-commercial use; credit required. See https://pgl.yoyo.org/as/ (check page for current terms).

### urlhaus_hosts

- URL: `https://malware-filter.gitlab.io/malware-filter/urlhaus-filter-hosts-online.txt`
- Role: `malware_threat`
- SHA-256 of downloaded bytes: `ae2d9fffddce124fb3e12db164f22ae01903220331e181960eaabfcf8f63cdba`
- License / terms: urlhaus-filter (curbengh / malware-filter) ΓÇö CC BY-NC-SA 4.0 for the filter packaging; URLhaus data from abuse.ch. Attribution required. https://gitlab.com/malware-filter/urlhaus-filter

### easylist

- URL: `https://easylist.to/easylist/easylist.txt`
- Role: `ads`
- SHA-256 of downloaded bytes: `5234769a759e6fc3b9770d0e4d27d9a1ebdc77cf53e07c843a3b814d6dc4f4ab`
- License / terms: EasyList ΓÇö dual-licensed GNU GPL-3.0-or-later OR CC BY-SA 3.0-or-later. Credit: ΓÇ£The EasyList authorsΓÇ¥. https://easylist.to/pages/licence.html

### easyprivacy

- URL: `https://easylist.to/easylist/easyprivacy.txt`
- Role: `privacy`
- SHA-256 of downloaded bytes: `3980f351ed08705bc12b0ded349de68da6133bea35d57676093c79d63b33296c`
- License / terms: EasyPrivacy ΓÇö same EasyList dual license (GPL-3.0-or-later OR CC BY-SA 3.0-or-later). Credit: ΓÇ£The EasyList authorsΓÇ¥.

## How we use them

- Network blocking only in `general-network.json` (domain ΓåÆ DNR `requestDomains`).
- Cosmetic sample (generic `##` only) in `cosmetic-sample.json` for the cosmetic agent ΓÇö not applied by DNR.
- Twitch / YouTube / Kick (and related player hosts) are stripped from block targets here;
  the DNR agent still must add higher-priority allow rules for those sites.

## License choice for EasyList material

Redistributed under **CC BY-SA 3.0-or-later** (EasyList dual-license option),
with attribution to The EasyList authors. Modified (trimmed/converted) work.
