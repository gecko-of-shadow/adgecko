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

**The one Curben list we use: URLhaus data, no OpenPhish (owner decision
#18b, 2026-11-02).** `urlhaus_hosts` is curbengh's urlhaus-filter: abuse.ch
URLhaus malware hosts (data CC0 1.0; the urlhaus-filter repository is CC0 1.0
and MIT). It is the only list from Curben's malware-filter project in this
extension, fetched only from
`https://malware-filter.gitlab.io/malware-filter/urlhaus-filter-hosts-online.txt`.
It is kept because it adds about 546 malware hosts that the other lists do not
have (about 2 of 548 overlap with uBO badware / Dandelion, checked
2026-11-02), and direct abuse.ch exports now need an Auth-Key, so there is no
keyless replacement. `scripts/lib/curben_check.py` enforces the exception: the
release gate and `test/no-openphish.test.js` fail on any other Curben list or
mirror, Curben's phishing list, or any OpenPhish source.

**uBO badware's OpenPhish section is dropped too (owner decision, 2026-11-04).**
uBO's `badware.txt` has a section headed `! openphish` (16 filters when checked).
The packer and the list refresh skip that section, from its header to the next
comment line, so it is neither packed nor brought back by a refresh. A host stays
blocked only if another list has it on its own (one did: `vzla-qr.com`, from
HaGeZi, in the general rules, not in the threat tier).

**Smaller phishing coverage (owner decision #13, 2026-11-02):** Curben's
phishing-filter is not used anywhere, because it is curated from OpenPhish. That
list was about 30,000 of the roughly 45,000 packed malware/phishing domains.
There is no phishing list of its own any more: phishing pages are blocked only
when uBO badware, Dandelion Sprout's Anti-Malware List or the EasyList-family
lists name them. Chrome Safe Browsing remains the backstop for phishing pages. The repo ships
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
(`co.uk`) are rejected too.

**Public suffixes and shared platforms (security review M-3).**
`src/threat/psl.js` holds the Public Suffix List's explicit names (every
two-label ICANN rule, every PRIVATE rule up to three labels and the bases of
wildcard rules; about 7,000 names, 82 KB, loaded only by the service worker
and the settings page, never by web pages; generated by
`scripts/build-psl-subset.mjs` from a PSL copy you download yourself,
MPL-2.0) plus a hand-kept list of shared-hosting, cloud, CDN and big-platform
parents (`github.io`, `pages.dev`, `amazonaws.com`,
`blogspot.com`, `cloudfront.net`, `docs.google.com`, ...). A threat host is
rejected when it is one of those names or a parent of one, so one bad list
line cannot black out a whole country domain or platform; a customer's own
host (`evil.github.io`, `d123.cloudfront.net`) can still be blocked. IPv4
literals in private, loopback, link-local, shared (CGNAT) and multicast ranges
are rejected too. The same check guards the signed feed and the "Allow this
domain" box (which therefore refuses `github.io` but accepts `me.github.io`).
Without the data file loaded, nothing is accepted. Rules with four or more
labels are left out (UNVERIFIED blast radius, small). The packed threat
ruleset was rebuilt with this check: 15,920 hosts (`pisz.pl`, `ru.com`,
`webhop.me`, `3utilities.com`, `cprapid.com` and `fastvps-server.com` are
public suffixes and are no longer blocked as a whole). After the list repack
of 2026-11-09 03:01 UTC it holds 15,827 hosts in 198 rules.

**Per-refresh cap.** One list refresh may add at most 2,500 new threat hosts
and at most 20% of the previous set (the last refreshed set, or the packed
`threat` ruleset on the first refresh). A bigger jump keeps the previous rules
and shows the reason; the same jump (within 10%) on the next refresh is
accepted as real.

The ordinary list tier skips ICANN public suffixes (`co.uk`) and non-public
IPv4 addresses too (security review L-3), at refresh time and in the packer;
private suffixes and shared-platform parents (`github.io`, dynamic-DNS
parents) stay up to the lists there. That tier is priority 1 and blocks
opening a page (main_frame) only for an explicit `$doc` / `$document` list
entry, also when another list blocks the same host as a whole domain (fixed
2026-11-03: the merge used to drop such entries, so about 500 EasyList ad
servers opened when visited directly). A filter with only negated types
(`$~script`, `$~stylesheet,third-party`) never blocks opening its host
(fixed 2026-11-03: Chrome matches a rule with only `excludedResourceTypes`
for page loads too, so `main_frame` is now always in that list). Stream and
player hosts (`protected-hosts.js`) and a small list of affiliate
redirectors people click on purpose (`NAV_EXEMPT` in
`src/general/filter-options.js`) never get a navigation block from this
tier. "Allow this site" in the popup lifts it for links followed from that
site; Settings -> "Allow this domain" lifts it everywhere, also for a typed
address. The packed `general-network.json` was repacked on 2026-11-03
(20:37Z) with both fixes; it no longer holds `pisz.pl` or `0.0.0.1`.
The current pack is 2026-11-09 03:01 UTC (`src/rules/meta.json`).

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
