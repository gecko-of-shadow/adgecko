# Nightly 0.3.5 progress (2026-11-13)

Fix wave results (each bug has a regression test in test/nightly-*.test.js):

## update (review ok: True, repaired: False)
- #0 fixed: Malware blocking: switching the threat tier or the whole extension off and on again no longer drops a refreshed malware host set that was already accepted.
- #1 fixed: List refresh: a refresh where no list reached its server (offline, captive portal) is now reported as a failure, does not count as a successful run, and is retried after 30 minutes instead of 12 hours.
- #2 fixed: Malware blocking: with the ad lists switched off, a list refresh now still installs the freshly downloaded malware (threat) rules.
- #35 fixed: Filter lists: a $badfilter in one list (for example AdGuard's fix for totaladblock.com) now cancels the same filter in every other list, in the packed rules and in list refreshes.
- #36 held back (owner decision, see CHANGELOG 0.3.5): Twitch: Twitch's ad host ads.twitch.tv (edge.ads.twitch.tv) is now blocked by the packed rules, as the Twitch allow rule's carve-out intended.
- #37 fixed: Filter lists: an unconditional list exception such as @@||content.ingbank.pl^ now lifts another list's whole-domain block of that same host.

## background (review ok: True, repaired: False)
- #3 fixed: List updates: a manual 'Update lists' click during an automatic refresh now waits for it and then runs its own full update, instead of reporting success for a skipped run.
- #4 fixed: Allowed sites: each allowed site now uses one allow rule (not one each for http and https), and the rule count is capped to the range that is cleaned up, so 'Block again' keeps working with very many allowed sites.

## feed (review ok: True, repaired: False)
- #5 fixed: Threat feed: a feed that has not changed since the last check no longer shows a false replay-attack warning, and the last-check time now updates.

## clipboard (review ok: True, repaired: False)
- #6 fixed: Clipboard guard: a page can no longer slip a command past the clipboard.write check with a custom array iterator or by swapping an item during the check.
- #7 fixed: Clipboard guard: a page copy handler can no longer put a command on the clipboard through clipboardData.items.add.
- #8 fixed: Clipboard guard: now catches the PowerShell pipeline form (irm URL | iex) and the macOS form bash -c "$(curl ...)".
- #9 fixed: Clipboard guard: a command can no longer be hidden behind 20000 characters of leading padding.
- #12 fixed: Clipboard guard: a right-click no longer lets the page write a command for 30 s. The context menu now authorises only the browser's own Copy of your selection.

## popups (review ok: False, repaired: True)
- #10 fixed: Popup guard: a pop-under that opens on mousedown or pointerdown, opens up to 5 s after the click, or hides the click from the page with a window-level stopPropagation is now judged by the clicked element and blocked when the click was on plain page content.
- #11 fixed: Popup guard: in about:blank, srcdoc and blob: frames, a page's own call to window.open with a relative or protocol-relative address is now resolved against the frame's real base address, so a cross-site pop-up opened without a click is blocked and same-site pop-ups still open (calls from a parent window into a child frame are not covered yet).
- #13 fixed: Popup guard: a site reached with a trailing dot in its address (for example news.example.) is now treated as the same site as news.example, so its own pop-ups are no longer blocked.

## ui (review ok: True, repaired: False)
- #14 fixed: Popup and site switches: an Allow on a parent domain now also counts on a subdomain that has its own Fix entry, so the popup no longer says Protected while list blocking is off there.
- #15 fixed: Popup: Allow this site and Fix this site on a subdomain now change only that subdomain, not the parent domain and all its other subdomains.
- #16 fixed: Popup: a double click on Fix this site no longer loses what the switches were before, so No turns them back on.
- #17 fixed: Popup: an unanswered Did that fix it? question is no longer lost when you fix another site, and Allow this site undoes an unanswered Fix so Block again does not leave the clipboard guard off.
- #18 fixed: Settings: the Allow this domain box now accepts Unicode (IDN) domain names and stores them in punycode form.
- #19 fixed: Settings: the Remove and Reset buttons in the allowed-domain and per-site lists keep keyboard focus; after a removal focus moves to the next row.
- #28 fixed: Threat allow list: Allow this domain now accepts internationalized (Unicode) domain names and converts them to punycode.

## cosmetic (review ok: False, repaired: True)
- #22 fixed: Cosmetic filters: generic hide rules that hide the whole page (selector lists, body:has(), html:is(.a, html), *:lang()) are dropped, while scoped rules such as div:is(.ad,.banner), :where(.ad) and a[title="x :root"] are kept.
- #20 fixed: Cosmetic filters: a "~host" exclusion on a hide rule only stops that rule on that host and no longer cancels other rules that hide the same element there.
- #21 fixed: Cosmetic filters: an old fallback style sheet that finishes loading late no longer overwrites newer rules.
- #23 fixed: Cosmetic filters: a "~host#@#selector" exception no longer turns into an exception on every site.
- #24 fixed: Cosmetic filters: a generic "#@#selector" exception in one list now also cancels the same generic hide rule from the other lists.
- #25 fixed: Cosmetic filters: a Unicode (IDN) host in a rule's domain list is converted to punycode, so the rule's other hosts are no longer lost.

## threat (review ok: True, repaired: False)
- #26 fixed: Threat protection: three-label public suffixes such as k12.ca.us and act.edu.au, and the children of wildcard suffixes such as nakahara.kawasaki.jp, can no longer be blocked as a whole or typed into the Allow this domain box.
- #27 fixed: Threat protection: regional Amazon S3 endpoints such as s3.us-east-2.amazonaws.com can no longer be blocked as a whole, so one list line cannot black out every bucket in a region.
- #29 fixed: Threat protection: a threat list can no longer block a parent domain of a captcha never-block host, which would block that captcha widget too.

## youtube (review ok: True, repaired: False)
- #30 fixed: YouTube: the menus, Share, Save and other dialogs now open after the "Experiencing interruptions?" toast has appeared once. Before this fix, they stayed hidden until the page reloaded.
- #31 fixed: YouTube: when one video server fails and another server is available, Adgecko no longer reports that all servers failed. This prevents an unnecessary video reload.
- #33 fixed: YouTube: the "Saved" and "Link copied" toasts now show after Adgecko hid an "Experiencing interruptions?" toast in the same toast element.

## kick (review ok: True, repaired: False)
- #32 held back (src/kick.js frozen; patch in docs/proposals): Kick: a post-roll cover that was hidden while it showed no video is now shown again when the ad ends and only the ad controls are removed.
- #34 held back (src/kick.js frozen; patch in docs/proposals): Kick: the banner-collapse path no longer hides a box that holds the video player, and every box it collapses is shown again when its ad frame leaves or the Kick switch goes off.

## Status
- Superseded: see CHANGELOG.md "## 0.3.5" and TODO.md.
