# Session notes — 2026-10-28 (Job C: README section in plain words)

Renamed from `2026-10-28-session.md` when rebuilding on main `0a5e7c0`, because main already has a notes file with that name from the Allow-fix session.

Branch: `claude/new-session-903x8r` (based on main `c995b58`).

## Plan

- Read: `README.md`, `manifest.json`, `src/popup.html`, `src/popup.js`,
  `src/general-background.js` (allow logic), `src/cosmetic.js`,
  PR #11 diff (Allow-this-page fix + README test command), `scripts/privacy-check.py`,
  `scripts/pack-zip.sh`, releases list (install paths).
- Approach: add ONE plain-words section near the top of `README.md`
  ("Quick start in plain words"): what it does / doesn't, how to install
  (load unpacked; release zip only if a release really exists), how to allow a
  page (as it works AFTER the #11 Allow fix), and how to undo.
  Every claim gets an evidence line in the AUDIT LOG below.
- Change only `README.md` and this notes file.
- DONE = section exists; every claim has an AUDIT LOG evidence line; privacy
  check passes; tests still pass (same count as main); audits a-d done; PR open
  (or branch reported).

## AUDIT LOG



<time> | what | why | evidence
No earlier notes on branch; started fresh | Session rule START | `ls docs/agent-notes` empty before this file
Baseline tests on main | Need before/after counts | `deno test --no-lock --allow-read --allow-run --allow-env test/` -> `ok | 252 passed | 0 failed`
Install path 1: release zip v0.2.21 | Only published release; v0.2.19/v0.2.20 are drafts | GitHub list_releases: v0.2.21 draft=false; v0.2.20, v0.2.19 draft=true
Install path 2: GitHub Code -> Download ZIP | Standard GitHub feature on every repo; gives newest main incl. the Allow fix once merged | repo is on GitHub; no Web Store listing (manifest has no update_url; README names none) so Web Store NOT mentioned
Load unpacked needs folder with manifest.json at top | manifest.json is at repo root and at zip root | `ls` repo root shows manifest.json; scripts/pack-zip.sh packs manifest.json, src/, icons/ at zip root
Claim: blocks video ads on Twitch, YouTube, Kick | content_scripts | manifest.json content_scripts match twitch.tv, youtube.com, kick.com
Claim: blocks ads on other sites with public lists | DNR ruleset + list refresh | manifest.json declarative_net_request `general`; host_permissions = list hosts
Claim: hides empty ad boxes | cosmetic.js | manifest.json content script src/cosmetic.js on http/https minus stream hosts
Claim: nothing installed, no account | README Privacy (main) | README: "The extension has no account and no analytics call of its own."
Claim: baked-in sponsor still plays | README main | README: "Nothing in these files edits the video file, so a sponsorship that is part of the video still plays."
Claim: Twitch quality may dip | README main | README: "That backup ladder can be a lower resolution."
Claim: Kick sometimes plays ads | README main / kick.js | README: "Otherwise the ad plays."
Claim: YouTube Music/Kids not covered | manifest matches | manifest matches only www/m/bare youtube.com; README: "YouTube Music, youtube-nocookie.com, and YouTube Kids are outside these content scripts."
Claim: no history sent; only own downloads are lists | Privacy | src/general/update.js:221 fetch(url, {credentials: "omit"}) to list URLs; popup does not fetch. Worded "for itself" because video-swap-new talks to Twitch on Twitch pages
Claim: switch label "Block ads on ordinary sites" | popup text | src/popup.html:166
Allow described AFTER fix | Task says so; on main tab.url is empty | PR #11 diff: popup.js currentOrigin uses activeTab.pageOrigin from tabs.sendMessage({type:"pageOrigin"},{frameId:0}); cosmetic.js top frame answers
Claim: button becomes "Blocking this page", status "Allowed for this site: <origin>" | popup labels | src/popup.js:125 and :127
Claim: whole site address, not one page | origin-based | popup.js normalizeOrigin -> u.origin; general-background.js buildAllowRules initiatorDomains:[host]; cosmetic.js originAllowed(pageOrigin(...))
Claim: allow stops list blocking and box hiding | both layers honor allow | general-background.js buildAllowRules priority 10000 action allow; cosmetic.js:123 originAllowed -> removeStyle()
Claim: reload page after allow | network rules only affect new requests; cosmetic updates live | cosmetic.js storage.onChanged -> sync(); DNR rules apply to new requests only
Claim: Chrome remembers until undone | stored | popup.js savePartial({generalAllowedOrigins}) -> chrome.storage.local
Claim: Twitch/YouTube/Kick not affected | hard excludes | popup.js HARD_EXCLUDE_HOST_RE; general-background.js buildAllowRules skips GS.isHardExcludedOrigin
Claim: undo = click "Blocking this page" | toggle | popup.js allowPage click: indexOf>=0 -> splice (remove)
Grey button cases | popup render branches | popup.js:107 (no origin), :112 (hard excluded), :117 (switch off); after fix no origin on pages without cosmetic.js (stream sites, chrome:// pages, pages loaded before the extension)
Note: 0.2.21 zip lacks the fix | honesty | v0.2.21 published 2026-10-22; fix is only on PR #11 branch (not on main c995b58)
Edited one sentence in "What it does" (said button always disabled) | would contradict new section after fix | README diff line "The popup instead asks the page's top-frame content script ..."
Pin-icon step (puzzle piece) | Chrome UI, not extension code | UNVERIFIED in a real browser in this session

## Progress check 1
- Changed: README.md section added + 1 sentence updated; commit pushed. Tests on main 252/0.
- Next: run tests on branch, privacy check, release gate (main vs branch), manifest diff, independent audit.

## Audit (a) results
- Tests on branch: `deno test --no-lock --allow-read --allow-run --allow-env test/` -> 252 passed | 0 failed (main: 252 | 0).
- Privacy: `python3 scripts/privacy-check.py` -> "Privacy check passed." exit 0. Gotcha: locally PRIVACY_PATTERNS is unset, so only the generic secret patterns ran (warning printed). The CI job has the patterns.
- Manual diff scan for personal paths, emails, tokens: no hits (grep of the diff for drive-letter paths, home dirs, emails, token prefixes: no hits).
- manifest.json: `git diff main -- manifest.json` is empty (no permission/host/match changes).
- Release gate: 3 FAIL / 19 PASS on main AND branch; FAIL lines identical (`diff` of `^FAIL` lines empty). The 3 are: package size >5MB, host_permissions (expects the 6 old list hosts), unexpected outbound URL hosts. Gotcha: the size check is one of the 3, not a third host check.

## Progress check 2
- Changed: audit (a) done, all green relative to main. Independent audit subagent running.
- Next: apply real findings from audit (b), re-run (a), open PR.

## Audit (b): independent subagent review
Fresh subagent, no stake; reviewed `git diff main -- README.md` against code and PR #11 diff. Outcomes:
F1 high: section describes post-fix behaviour not on main | REJECTED as by-design (task requires describing the button AFTER the fix); mitigated: Download ZIP line now says "Once the fix is merged"; PR states it must merge after #11 | README diff "Once the fix is merged, **Download ZIP** gives you a copy with it."
F2 med: "remembers until undo" overstated | FIXED: added "If you remove the extension, or load a new copy from a different folder, the allowed sites are forgotten." | storage is chrome.storage.local (popup.js savePartial); unpacked ID depends on folder path
F3 med: scope across www/subdomains/http not explained | FIXED: added "Other addresses of the same site count separately..." | general-background.js initiatorDomains:[host]; cosmetic.js originAllowed exact origin match
F4 med: Twitch ads can still show | FIXED: added bullet | README main: "The last backup is still used if it has the marker."
F5 med: "newest version" misleading | FIXED: "newest code, which may be newer than the last numbered release. Chrome still shows the version number of that release." | PR #11 does not bump manifest version
F6 low: "downloads for itself" hedge | FIXED: "On Twitch it also asks Twitch for ad-free copies of the stream." | README Privacy: video-swap-new requests to gql.twitch.tv / usher.ttvnw.net
F7 low: grey list incomplete | FIXED: "the line under it says why" | popup.js pageStatus text set in every disabled branch
F8 low: pressed label confusing | FIXED: "That label means the site is now allowed." | popup.js:125
F9 low: "nothing installed" vs folder | FIXED: "No separate program is installed." | -
F10 low: toolbar defined late | FIXED: definition moved to install intro | -
F11 low: embedded YouTube not covered | REJECTED: not verified cleanly (static ubo-youtube DNR ruleset may still apply in frames); not adding an unverified claim | manifest declarative_net_request ubo-youtube has no frame restriction
F12 low: two "What it does" headings | FIXED: new subsection renamed "In short" | -
Re-ran audit (a) after fixes | rule (b) | tests 252 passed 0 failed; privacy-check exit 0; release-gate ^FAIL lines identical to main (3); manifest diff empty

## Audit (d): DONE check with proof
- Section exists: README diff adds "## 🦎 Start here (plain words)" with In short / What it does not do / How to install it / How to allow a page.
- Every claim has evidence: AUDIT LOG above (claims + audit-fix lines).
- Privacy check passes: exit 0 (generic secrets only locally; PRIVACY_PATTERNS unset).
- Tests still pass: 252 passed / 0 failed on main and branch.
- Audits a-d done: (a) above, (b) above, (c) AUDIT section in PR body, (d) this list.
- PR open: https://github.com/gecko-of-shadow/twitch-adblock/pull/16

## FINAL REPORT
- PR: https://github.com/gecko-of-shadow/twitch-adblock/pull/16 (branch claude/new-session-903x8r).
- Tests: main 252/0, branch 252/0.
- Release gate: 3 FAIL / 19 PASS on both, identical FAIL lines (size >5MB, host_permissions, outbound hosts).
- Privacy check: passed.
- Independent audit: 12 findings, 10 fixed, 2 rejected with reasons (see AUDIT LOG).
- UNVERIFIED: not tested in a real browser (pin step, Allow flow after fix).
- Must merge after the Allow fix (#11 or separate fix PR); expect a small README conflict with #11 (its test-command line is already on main).
- BLOCKED / UNFINISHED: none.
- Undo: close PR #16 and delete the branch; nothing was merged.

## HANDOFF
Job complete. If resuming: start a session on branch claude/new-session-903x8r, read this file; only follow-up is review comments on PR #16.

## Follow-up 2026-10-29: rebuilt on main 0a5e7c0 (after #10, #11, #17 merged)
- Rebase hit an add/add conflict on `docs/agent-notes/2026-10-28-session.md` (main has the Allow-fix session's notes). Rebuilt the branch on `origin/main` instead: README section re-applied (main's README was unchanged since c995b58: `git diff c995b58 origin/main -- README.md` empty), notes moved to this file.
- Owner asks | README edit | evidence
- Exact grey-button text | "Open a normal http(s) page to allow it. Already on one? Reload it." quoted in section and popup paragraph | src/popup.js:115
- Waiting text | "Checking this page…" mentioned | src/popup.js:116 (shown while pageChecked is false)
- Icon lines 10-15 | green gecko, amber glowing eye when on; grey icon with half-shut eye when off | icons/icon48-working.png, icons/icon48-off.png viewed; CHANGELOG: "eye glows amber ... goes grey with a sleepy eye"
- Line 26 popup paragraph | no longer "stays disabled" always; describes tabs.sendMessage origin ask | src/popup.js askPageOrigin, currentOrigin
- Removed "Once the fix is merged" wording: fix is on main now | CHANGELOG line 10
