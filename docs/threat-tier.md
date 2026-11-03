# Threat tier

[← Back to the README](../README.md)

The threat tier blocks hosts that public malware lists name as known-bad, on
every page, including Twitch, YouTube and Kick pages, while the sites' own
servers and player hosts can never be blocked.

## Where the hosts come from

- **Packed:** static ruleset `threat` (`src/rules/threat-network.json`,
  enabled by default), built by `scripts/build-threat-rules.mjs` from the
  threat lists that `scripts/pack-filter-lists.py` downloads. The packer runs
  the builder at the end of every run.
- **Refreshed:** the 3-hourly list refresh rebuilds the same set as dynamic
  rules (ids 600000-609999) from the refreshed lists.
- **Signed feed:** see [feed-setup.md](feed-setup.md) (dormant until a key and
  a feed host are configured).

Lists used (role `malware_threat`): URLhaus (curbengh's urlhaus-filter), uBlock
Origin badware, Dandelion Sprout's Anti-Malware List. From each list only
whole-domain filters and `$doc` (navigation) filters count as "this host is
bad"; party- or type-limited filters stay in the ordinary list tier with their
own scope.

**Smaller phishing coverage (owner decision, 2026-11-02):** Curben's
phishing-filter is not used anywhere, because it is curated from OpenPhish. That
list was about 30,000 of the roughly 45,000 packed malware/phishing domains.
Chrome Safe Browsing remains the backstop for phishing pages. The repo ships
HaGeZi **Pro mini** (an ads/trackers list), not HaGeZi's threat-intelligence
list, so HaGeZi does not feed this tier.

## Rule shape and priority

| Rule | Priority | Notes |
| --- | --- | --- |
| Public list blocks | 1 | ordinary ads/trackers tier |
| "Allow this page" | 10,000 | does **not** let threat hosts through |
| YouTube/Kick frame `allowAllRequests`, Twitch and player-CDN allows | 2,000,000 | stream pages keep playing |
| YouTube doubleclick block | 2,000,001 | |
| **Threat blocks** | **2,000,010** | `main_frame, sub_frame, script, xmlhttprequest, ping, media, websocket, other`; 80 hosts per rule; no initiator condition |
| **User "Allow this domain"** | **2,000,020** | every resource type incl. `main_frame`; storage key `threatAllowDomains` |
| List-download allow | 3,000,000 | the extension's own downloads |

Because 2,000,010 is above the 2,000,000 stream-site allows, a threat host is
blocked inside YouTube and Kick frames (and embeds) too. Stylesheets, fonts and
images from a threat host are left to the ordinary lists.

The override uses `requestDomains`, which also matches subdomains: allowing
`example.test` also allows `www.example.test`. It only ever allows more.

## Protected hosts

`src/threat/protected-hosts.js` is the one list (also used by the feed
validator and the tests). A threat host is rejected when it is equal to or
under a protected host, or an ancestor of one (`google.com` would match
`www.google.com`). `googleapis.com`, `gstatic.com` and
`storage.googleapis.com` are protected only as themselves (and their
ancestors), so a bucket host such as `<bucket>.storage.googleapis.com` can be
blocked, but `fonts.googleapis.com` and `youtubei.googleapis.com` cannot.
Single-label hosts and two-label hosts that look like a public suffix
(`co.uk`) are rejected too; that check is a heuristic, not the full Public
Suffix List.

`youtubekids.com` and `kickusercontent.com` were added to the build prompt's
list (fail-open): they are in the manifest's stream-site exclusions.

## Switches

The lists switch, "Allow this page" and a failed list refresh do not remove
threat rules. Per-feature switches come with the settings page.

## Tests

`test/threat-tier.test.js` runs a small DNR matcher (`test/fixtures/dnr-matcher.js`)
over the shipped rule files plus the dynamic rules the worker creates. It
checks blocking on ordinary pages, YouTube and Kick frames, embeds, "allowed"
pages and navigations; the override; that protected hosts and the stream hosts
in `test/fixtures/stream-hosts.txt` are never blocked; a fuzz of protected
subdomains; and the rule limits.

Not verified in a browser: the matcher models the documented precedence, not
Chrome's code.
