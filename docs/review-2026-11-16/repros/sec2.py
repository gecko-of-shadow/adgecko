import json, sys
m = json.load(open(sys.argv[1]))
rules_path = sys.argv[2]
bad = []
# DNR + storage, plus the popup UI worker. No host access and no auto-update.
forbidden_keys = ("externally_connectable", "oauth2", "key")
LIST_HOSTS = ["https://easylist.to/*", "https://pgl.yoyo.org/*", "https://malware-filter.gitlab.io/*", "https://ublockorigin.github.io/*", "https://easylist-downloads.adblockplus.org/*", "https://secure.fanboy.co.nz/*", "https://raw.githubusercontent.com/hagezi/dns-blocklists/*", "https://raw.githubusercontent.com/DandelionSprout/adfilt/*", "https://filters.adtidy.org/extension/ublock/*"]
# Signed threat feed: exactly one extra host, and only once src/feed/config.js
# sets FEED_ORIGIN (a bare https origin). Dormant (empty) = list hosts only.
import os, re as _re
FEED_HOSTS = []
_cfg = os.path.join(os.path.dirname(sys.argv[1]), "src", "feed", "config.js")
if os.path.isfile(_cfg):
    _m = _re.search(r'FEED_ORIGIN\s*=\s*"([^"]*)"', open(_cfg, encoding="utf-8").read())
    if _m and _m.group(1):
        if not _re.fullmatch(r"https://[a-z0-9.-]+", _m.group(1)):
            bad.append(f"FEED_ORIGIN must be a bare https origin, got {_m.group(1)!r}")
        else:
            FEED_HOSTS = [_m.group(1) + "/*"]
if (m.get("host_permissions") or []) not in ([], LIST_HOSTS, LIST_HOSTS + FEED_HOSTS):
    bad.append(f"host_permissions must be only the filter-list hosts (plus the configured feed host), got {m.get('host_permissions')!r}")
for key in forbidden_keys:
    if m.get(key):
        bad.append(f"{key}={m.get(key)!r}")

perms = m.get("permissions") or []
if not isinstance(perms, list):
    bad.append(f"permissions must be a list, got {type(perms).__name__}")
    perms = []
allowed_perms = {"declarativeNetRequest", "storage", "alarms"}  # alarms: the 3 h gecko-refresh alarm
forbidden_perms = {
    "declarativeNetRequestWithHostAccess",
    "declarativeNetRequestFeedback",
    "webRequest",
    "webRequestBlocking",
    "scripting",
    "tabs",
    "activeTab",
    "history",
    "cookies",
    "management",
    "debugger",
    "proxy",
    "downloads",
    "unlimitedStorage",
    "notifications",
    "<all_urls>",
}
extra = [p for p in perms if p not in allowed_perms]
missing = [p for p in ("declarativeNetRequest", "storage") if p not in perms]
dangerous = [p for p in perms if p in forbidden_perms]
if missing:
    bad.append("missing permissions: " + ", ".join(missing))
if extra:
    bad.append("unexpected permissions: " + ", ".join(extra))
if dangerous:
    bad.append("forbidden permissions: " + ", ".join(dangerous))

# Hard rule: no optional permissions of any kind (they could be requested
# later without a new install-time warning).
for key in ("optional_permissions", "optional_host_permissions"):
    if key in m:
        bad.append(f"{key} is not allowed, got {m.get(key)!r}")

dnr = m.get("declarative_net_request") or {}
resources = dnr.get("rule_resources") or []
if not resources:
    bad.append("declarative_net_request.rule_resources missing")
else:
    ids = [r.get("id") for r in resources]
    # Popup / GeneralSettings.RULESET_ID is "general" (path stays general-network.json).
    if "general" not in ids:
        bad.append("rule_resources must include id general")
    for r in resources:
        path = r.get("path") or ""
        if not path.startswith("src/rules/") or not path.endswith(".json"):
            bad.append(f"ruleset path out of src/rules/: {path!r}")
        if r.get("id") == "general" and r.get("enabled") is not True:
            bad.append("general ruleset must be enabled by default (Phase 0 default On)")
        if r.get("id") == "general" and path != "src/rules/general-network.json":
            bad.append(f"general ruleset path must be src/rules/general-network.json, got {path!r}")

bg = m.get("background") or {}
if bg.get("service_worker") != "src/general-background.js":
    bad.append(f"background={bg!r} (want service_worker src/general-background.js)")
if bad:
    print("FAIL  privileged / permission fields:", "; ".join(bad))
    sys.exit(1)
print("PASS  permissions are storage + declarativeNetRequest + alarms; UI worker only; list hosts (+ configured feed host) only")

scripts = m.get("content_scripts") or []
twitch = next((s for s in scripts if "src/vendor/video-swap-new.user.js" in (s.get("js") or [])), None)
youtube = next((s for s in scripts if "src/youtube.js" in (s.get("js") or [])), None)
kick = next((s for s in scripts if "src/kick.js" in (s.get("js") or [])), None)
if not twitch:
    print("FAIL  Twitch content_script missing"); sys.exit(1)
need_t = {"*://twitch.tv/*", "*://*.twitch.tv/*"}
got_t = set(twitch.get("matches") or [])
if not need_t <= got_t:
    print("FAIL  Twitch matches missing", need_t - got_t); sys.exit(1)
if twitch.get("js") != ["src/vendor/video-swap-new.user.js"]:
    print("FAIL  Twitch js order", twitch.get("js")); sys.exit(1)
if twitch.get("world") != "MAIN":
    print("FAIL  Twitch world", twitch.get("world")); sys.exit(1)
if twitch.get("run_at") != "document_start":
    print("FAIL  Twitch run_at", twitch.get("run_at")); sys.exit(1)
if twitch.get("all_frames") is not True:
    print("FAIL  Twitch all_frames", twitch.get("all_frames")); sys.exit(1)
print("PASS  Twitch host coverage", sorted(got_t))

if not youtube:
    print("FAIL  YouTube content_script missing"); sys.exit(1)
need_y = {"*://www.youtube.com/*", "*://m.youtube.com/*", "*://youtube.com/*"}
got_y = set(youtube.get("matches") or [])
if not need_y <= got_y:
    print("FAIL  YouTube matches missing", need_y - got_y); sys.exit(1)
if youtube.get("world") != "MAIN":
    print("FAIL  YouTube world", youtube.get("world")); sys.exit(1)
if youtube.get("all_frames") is True:
    print("FAIL  YouTube should not use all_frames"); sys.exit(1)
if youtube.get("js") != ["src/youtube.js"]:
    print("FAIL  YouTube js order", youtube.get("js")); sys.exit(1)
print("PASS  YouTube host coverage", sorted(got_y))

if not kick:
    print("FAIL  Kick content_script missing"); sys.exit(1)
need_k = {"*://kick.com/*", "*://*.kick.com/*"}
got_k = set(kick.get("matches") or [])
if not need_k <= got_k:
    print("FAIL  Kick matches missing", need_k - got_k); sys.exit(1)
if kick.get("js") != ["src/kick.js"]:
    print("FAIL  Kick js", kick.get("js")); sys.exit(1)
if kick.get("world") != "MAIN":
    print("FAIL  Kick world", kick.get("world")); sys.exit(1)
if kick.get("run_at") != "document_start":
    print("FAIL  Kick run_at", kick.get("run_at")); sys.exit(1)
if kick.get("all_frames") is not True:
    print("FAIL  Kick should cover embed frames"); sys.exit(1)
print("PASS  Kick host coverage", sorted(got_k))

if m.get("action", {}).get("default_popup") != "src/popup.html":
    print("FAIL  action popup must be src/popup.html"); sys.exit(1)
print("PASS  action popup is src/popup.html")

for script in scripts:
    loaded = script.get("js") or []
    if "src/debug.js" in loaded or "src/debug-bridge.js" in loaded:
        print("FAIL  debug script still loaded", loaded); sys.exit(1)
print("PASS  debug scripts are not loaded")

joined = " ".join(sorted(got_t | got_y | got_k))
for host in ("music.youtube.com", "studio.youtube.com", "youtubekids.com"):
    if host in joined:
        print("FAIL  unexpected host scope", host); sys.exit(1)
print("PASS  no out-of-scope hosts in matches")

# Optional cosmetic content script: must exclude stream families if present.
cosmetic = next((s for s in scripts if "src/cosmetic.js" in (s.get("js") or [])), None)
if cosmetic:
    excl = set(cosmetic.get("exclude_matches") or [])
    # Minimum hard-excludes (cosmetic branch may list a broader YouTube/Kick family).
    need_excl = {
        "*://twitch.tv/*", "*://*.twitch.tv/*",
        "*://youtube.com/*", "*://*.youtube.com/*",
        "*://youtu.be/*", "*://*.youtu.be/*",
        "*://kick.com/*", "*://*.kick.com/*",
    }
    if not need_excl <= excl:
        print("FAIL  cosmetic exclude_matches missing", sorted(need_excl - excl)); sys.exit(1)
    if cosmetic.get("world") == "MAIN":
        print("FAIL  cosmetic must not run in MAIN world on general pages"); sys.exit(1)
    css = cosmetic.get("css") or []
    if "src/cosmetic-hide.css" in css:
        print("PASS  cosmetic content script lists cosmetic-hide.css")
    # CSS may also be fetched via chrome.runtime.getURL from cosmetic.js.
    print("PASS  cosmetic content script excludes Twitch/YouTube/Kick")
else:
    print("SKIP  cosmetic content script not present yet")

# DNR rules: budget + hard-exclude stream families (initiator + video hosts).
rules = json.load(open(rules_path))
if not isinstance(rules, list):
    print("FAIL  general-network.json must be a JSON array"); sys.exit(1)
if len(rules) > 30000:
    print("FAIL  rule count", len(rules), "> Chrome guaranteed 30000"); sys.exit(1)
print("PASS  rule count", len(rules), "<= 30000")

ids = [r.get("id") for r in rules]
if len(ids) != len(set(ids)):
    print("FAIL  duplicate DNR rule ids"); sys.exit(1)

blob = json.dumps(rules).lower()
need_site = ("twitch.tv", "youtube.com", "youtu.be", "kick.com")
need_video = ("ttvnw.net", "googlevideo.com", "live-video.net")
missing_site = [h for h in need_site if h not in blob]
missing_video = [h for h in need_video if h not in blob]
if missing_site or missing_video:
    print("FAIL  DNR skip list incomplete:", "sites=", missing_site, "video=", missing_video)
    sys.exit(1)

# Require at least one high-priority allow / allowAllRequests covering each family.
def is_allow(rule):
    return (rule.get("action") or {}).get("type") in ("allow", "allowAllRequests")

allows = [r for r in rules if is_allow(r) and int(r.get("priority") or 0) >= 9000]
allow_blob = json.dumps(allows).lower()
for h in need_site + need_video:
    if h not in allow_blob:
        print("FAIL  high-priority allow rules missing host", h); sys.exit(1)
print("PASS  DNR hard-excludes Twitch + YouTube family + Kick (incl. video hosts)")

# Kick read-only note: v0.2.4 beta content script is kick.com only; IVS worker is
# same-origin; live-video.net is the Amazon IVS media host used beside Kick.
print("PASS  Kick video host live-video.net included from beta/IVS read-only pass")

# Security review M-9: every packed ruleset (not only general-network.json) is
# a JSON array of well-formed rules with unique ids, and the enabled ones stay
# under Chrome's guaranteed 30,000 static rules together.
import os as _os
ALLOWED_ACTIONS = {"block", "allow", "allowAllRequests", "upgradeScheme", "redirect", "modifyHeaders"}
total_enabled = 0
for res in resources:
    rpath = _os.path.join(_os.path.dirname(sys.argv[1]), res.get("path") or "")
    try:
        rs = json.load(open(rpath, encoding="utf-8"))
    except Exception as e:
        print("FAIL  ruleset", res.get("id"), "is not readable JSON:", e); sys.exit(1)
    if not isinstance(rs, list):
        print("FAIL  ruleset", res.get("id"), "is not a JSON array"); sys.exit(1)
    rids = [r.get("id") for r in rs if isinstance(r, dict)]
    if len(rids) != len(rs) or len(set(rids)) != len(rids) or not all(isinstance(i, int) and i >= 1 for i in rids):
        print("FAIL  ruleset", res.get("id"), "has missing, non-integer or duplicate rule ids"); sys.exit(1)
    for r in rs:
        if not isinstance(r.get("condition"), dict) or (r.get("action") or {}).get("type") not in ALLOWED_ACTIONS:
            print("FAIL  ruleset", res.get("id"), "rule", r.get("id"), "has a bad action or condition"); sys.exit(1)
        if (r.get("action") or {}).get("type") in ("redirect", "modifyHeaders"):
            print("FAIL  ruleset", res.get("id"), "rule", r.get("id"), "redirects or edits headers (not allowed)"); sys.exit(1)
    if res.get("enabled"):
        total_enabled += len(rs)
if total_enabled > 30000:
    print("FAIL  enabled static rules", total_enabled, "> 30000"); sys.exit(1)
print("PASS  every ruleset well formed;", total_enabled, "enabled static rules")
