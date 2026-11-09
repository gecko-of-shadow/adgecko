#!/usr/bin/env bash
# Release smoke for Adgecko: package, security, hosts, deno, light fuzz.
# Local only — does not phone home. Requires deno, python3, and ripgrep (rg).
#
# General-adblock beta (Phase 0): allows declarativeNetRequest + storage + alarms
# (one 3 h alarm) and, once configured, one signed-feed host; packs
# src/rules/*, and refuses stronger host/read permissions, background workers,
# and any chrome.* use in stream playback files.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
EXPECT_VERSION=""
ZIP=""
DIR=""
CLEANUP=0
TMP_ROOT=""

usage() {
  cat <<EOF
Usage:
  $(basename "$0") [--expect-version X.Y.Z] [--dir PATH | --zip PATH.zip]

Defaults: --dir is the repo root, --expect-version is read from that tree's manifest.

Checks: shippable file allowlist, narrow permissions (DNR+storage+alarms), Twitch/YouTube
host coverage, stream-site DNR exclusions, no eval/innerHTML/identity/trackers outside
rules, no chrome.* in playback files, deno test (when test/ is present), vendor parse.
EOF
  exit 2
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --expect-version) EXPECT_VERSION="${2:-}"; shift 2 ;;
    --zip) ZIP="${2:-}"; shift 2 ;;
    --dir) DIR="${2:-}"; shift 2 ;;
    -h|--help) usage ;;
    *) echo "Unknown arg: $1"; usage ;;
  esac
done

[[ -z "$ZIP" || -z "$DIR" ]] || { echo "Pass only one of --zip / --dir"; exit 2; }

for bin in deno python3 rg; do
  if ! command -v "$bin" >/dev/null 2>&1; then
    echo "Missing required tool: $bin"
    echo "Install Deno from https://deno.land and ensure rg (ripgrep) is on PATH."
    exit 2
  fi
done

if [[ -n "$ZIP" ]]; then
  command -v unzip >/dev/null 2>&1 || { echo "Missing unzip"; exit 2; }
  TMP_ROOT="$(mktemp -d /tmp/adblock-gate.XXXXXX)"
  CLEANUP=1
  unzip -q -o "$ZIP" -d "$TMP_ROOT"
  if [[ -f "$TMP_ROOT/manifest.json" ]]; then
    PKG="$TMP_ROOT"
  else
    inner="$(find "$TMP_ROOT" -maxdepth 2 -name manifest.json | head -1)"
    [[ -n "$inner" ]] || { echo "FAIL: no manifest.json in zip"; exit 1; }
    PKG="$(dirname "$inner")"
  fi
  TEST_ROOT=""
  STRICT_TREE=1
else
  PKG="${DIR:-$ROOT}"
  TEST_ROOT="$PKG"
  STRICT_TREE=0
fi

if [[ -z "$EXPECT_VERSION" ]]; then
  EXPECT_VERSION="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["version"])' "$PKG/manifest.json")"
fi

FAILS=0
pass() { echo "PASS  $*"; }
fail() { echo "FAIL  $*"; FAILS=$((FAILS + 1)); }
section() { echo; echo "=== $* ==="; }

REQUIRED=(
  manifest.json
  src/popup.html
  src/popup.js
  src/popup.css
  src/general-settings.js
  src/general-background.js
  src/vendor/video-swap-new.user.js
  src/vendor/LICENSE-TwitchAdSolutions
  src/youtube.js
  src/kick.js
  src/rules/general-network.json
  src/rules/ubo-youtube-network.json
  src/rules/threat-network.json
  src/rules/threat-snapshot.json
  src/rules/cosmetic-rules.json
  src/rules/dnr-merge-meta.json
  src/rules/CREDIT-EasyList.txt
  src/rules/LICENSES.md
  src/vendor/ubo-youtube.js
  src/vendor/ubo-youtube-isolated.js
  src/vendor/ubo-youtube.css
  src/vendor/LICENSE-uBlock.md
  src/vendor/LICENSE-uBlock-GPLv3.txt
  src/general/filter-options.js
  src/general/update.js
  src/general/cosmetic-parse.js
  src/settings/features.js
  src/settings/flags.js
  src/settings.html
  src/settings.js
  src/guards/clipboard.js
  src/guards/popups.js
  src/threat/psl.js
  src/threat/protected-hosts.js
  src/threat/compile.js
  src/feed/config.js
  src/feed/keys.js
  src/feed/canonical.js
  src/feed/schema.js
  src/feed/verify.js
  src/feed/compile.js
  src/feed/client.js
  src/general-exclude-hosts.js
  src/cosmetic.js
  src/cosmetic-hide.css
  src/youtube-ads.css
  src/twitch-directory-ads.js
  src/LICENSE-EasyList.txt
  icons/icon16.png
  icons/icon48.png
  icons/icon128.png
  icons/icon16-working.png
  icons/icon48-working.png
  icons/icon128-working.png
  icons/icon16-off.png
  icons/icon48-off.png
  icons/icon128-off.png
)
# Shippable paths. Cosmetic hide, popup worker, list rules, and stream exclusion module.
# Must cover every path scripts/lib/package_files.py derives (test/packaging.test.js
# checks that); settings page, guards, threat tier and signed-feed client added 2026-11-02.
ALLOWED_RE='^(manifest\.json|src/popup\.html|src/popup\.js|src/popup\.css|src/settings\.html|src/settings\.js|src/settings/(features|flags)\.js|src/guards/(clipboard|popups)\.js|src/threat/(psl|protected-hosts|compile)\.js|src/feed/(config|keys|canonical|schema|verify|compile|client)\.js|src/rules/threat-(network|snapshot|meta)\.json|src/general-exclude-hosts\.js|src/general-settings\.js|src/general-background\.js|src/general/(cosmetic|cosmetic-parse|exclusions|filter-options|toggles|update)\.js|src/vendor/video-swap-new\.user\.js|src/vendor/LICENSE-TwitchAdSolutions|src/vendor/README\.md|src/vendor/ubo-youtube(-isolated)?\.js|src/vendor/ubo-youtube\.css|src/vendor/ubo-youtube-meta\.json|src/vendor/LICENSE-uBlock\.md|src/vendor/LICENSE-uBlock-GPLv3\.txt|src/rules/ubo-youtube-network\.json|src/youtube\.js|src/kick\.js|src/rules/general-network\.json|src/rules/CREDIT-EasyList\.txt|src/rules/LICENSES\.md|src/rules/README\.md|src/rules/meta\.json|src/rules/dnr-merge-meta\.json|src/rules/cosmetic-sample\.json|src/rules/cosmetic-rules\.json|src/cosmetic\.js|src/cosmetic\.css|src/cosmetic-hide\.css|src/youtube-ads\.css|src/twitch-directory-ads\.js|src/LICENSE-EasyList\.txt|icons/icon(16|48|128)(-working|-off)?\.png)$'

# YouTube is the beta script (spinner + search cards). The Twitch vendor stays at main.
PLAYBACK_FILES=(
  src/vendor/video-swap-new.user.js
  src/kick.js
)

section "1. Package allowlist + version"
VERSION="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["version"])' "$PKG/manifest.json")"
if [[ "$VERSION" == "$EXPECT_VERSION" ]]; then
  pass "manifest version $VERSION"
else
  fail "manifest version $VERSION != expected $EXPECT_VERSION"
fi

# Tag integrity hint when running from a git checkout
if [[ -d "$PKG/.git" ]] || git -C "$PKG" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  TAG="v${EXPECT_VERSION}"
  if git -C "$PKG" rev-parse "$TAG" >/dev/null 2>&1; then
    TAG_VER="$(git -C "$PKG" show "$TAG:manifest.json" 2>/dev/null | python3 -c 'import json,sys; print(json.load(sys.stdin)["version"])' 2>/dev/null || true)"
    if [[ -z "$TAG_VER" ]]; then
      echo "SKIP  could not read manifest from git tag $TAG"
    elif [[ "$TAG_VER" != "$EXPECT_VERSION" ]]; then
      fail "git tag $TAG has manifest version $TAG_VER (prefer the release zip over this tag)"
    else
      pass "git tag $TAG matches expected version"
    fi
  else
    echo "SKIP  no local git tag $TAG yet"
  fi
fi

ALLOW_OK=1
for r in "${REQUIRED[@]}"; do
  if [[ ! -f "$PKG/$r" ]]; then
    echo "  missing: $r"
    ALLOW_OK=0
  fi
done
if [[ "$STRICT_TREE" -eq 1 ]]; then
  mapfile -t FILES < <(find "$PKG" -type f | sed "s|^$PKG/||" | sort)
  for f in "${FILES[@]}"; do
    if ! [[ "$f" =~ $ALLOWED_RE ]]; then
      echo "  unexpected: $f"
      ALLOW_OK=0
    fi
  done
  SIZE="$(du -sb "$PKG" | awk '{print $1}')"
else
  SIZE=0
  for r in "${REQUIRED[@]}"; do
    SIZE=$((SIZE + $(stat -c%s "$PKG/$r" 2>/dev/null || stat -f%z "$PKG/$r")))
  done
  pass "repo mode: allowlist checked on shippable paths only"
fi
if [[ "$ALLOW_OK" -eq 1 ]]; then pass "shippable file allowlist"; else fail "shippable file allowlist"; fi
# Every file the manifest (worker, content scripts, rulesets, pages, icons), the
# worker's importScripts(...) and the pages' <script>/<link> name must be in the
# package; importScripts may take string literals only.
if DERIVE_OUT="$(python3 "$ROOT/scripts/lib/package_files.py" --root "$PKG" 2>&1 | tr -d '\r')"; then
  pass "every manifest / importScripts / page path is in the package ($(printf '%s\n' "$DERIVE_OUT" | wc -l | tr -d ' ') files)"
else
  printf '%s\n' "$DERIVE_OUT"
  fail "manifest / importScripts paths missing from the package"
fi
# --zip: the zip must hold exactly the derived list (nothing extra either).
# Repo mode cannot do this: the tree holds docs/, test/ and scripts/ too.
# The list is derived from this checkout when it is at the zip's version (the
# zip cannot vouch for itself: an optional file is "derived" once it is in the
# tree); otherwise from the unzipped tree, which still rejects every file the
# manifest, worker and pages do not name.
if [[ -n "$ZIP" ]]; then
  DERIVE_ROOT="$PKG"
  ROOT_VERSION="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["version"])' "$ROOT/manifest.json" 2>/dev/null || true)"
  if [[ "$ROOT_VERSION" == "$EXPECT_VERSION" ]]; then
    DERIVE_ROOT="$ROOT"
    echo "  deriving the package list from this checkout (manifest $ROOT_VERSION)"
  else
    echo "  checkout is at ${ROOT_VERSION:-?}, zip at $EXPECT_VERSION: deriving the package list from the zip itself"
  fi
  if CHECK_OUT="$(python3 "$ROOT/scripts/lib/package_files.py" --root "$DERIVE_ROOT" --check-zip "$ZIP" 2>&1 | tr -d '\r')"; then
    pass "zip holds exactly the derived package files, nothing else"
  else
    printf '%s\n' "$CHECK_OUT"
    fail "zip contents differ from the derived package list"
  fi
fi
if [[ -f "$PKG/src/popup.html" && -f "$PKG/src/popup.js" ]]; then
  pass "popup is packaged"
else
  fail "popup files missing"
fi
if [[ -f "$PKG/popup.html" || -f "$PKG/popup.js" ]]; then fail "popup must live in src/ (zip holds manifest.json, src/, icons/ only)"; else pass "popup lives in src/"; fi
if rg -n --pcre2 '<script(?![^>]*\bsrc="popup\.js")|onclick=|javascript:' "$PKG/src/popup.html" >/tmp/gate-popup.txt 2>/dev/null; then
  cat /tmp/gate-popup.txt
  fail "popup.html must load only popup.js"
else
  pass "popup.html loads only popup.js"
fi
echo "  package bytes: $SIZE"
# 0.2.20 packed five more network lists: general-network.json grew from 2.3MB to
# 5.2MB. Repo mode sums only REQUIRED (~5.5MB); --zip counts every shipped file
# (~6.7MB, ~0.3MB under this limit). 7MB still catches a runaway list pack.
# 2026-11-03: the threat ruleset + snapshot (~0.7MB) and src/threat/psl.js
# (82KB) brought the zip to ~6.96MB; 7.5MB keeps the runaway-pack check.
if [[ "$SIZE" -gt 7500000 ]]; then fail "package unexpectedly large (>7.5MB)"; else pass "package size sane"; fi

section "1b. Playback files untouched"
PLAYBACK_OK=1
if git -C "$PKG" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  BASE_REF=""
  if git -C "$PKG" rev-parse --verify origin/main >/dev/null 2>&1; then
    BASE_REF="origin/main"
  elif git -C "$PKG" rev-parse --verify main >/dev/null 2>&1; then
    BASE_REF="main"
  fi
  if [[ -n "$BASE_REF" ]]; then
    for rel in "${PLAYBACK_FILES[@]}"; do
      if ! git -C "$PKG" cat-file -e "$BASE_REF:$rel" 2>/dev/null; then
        echo "  SKIP  $rel missing on $BASE_REF"
        continue
      fi
      if ! git -C "$PKG" diff --quiet "$BASE_REF" -- "$rel"; then
        echo "  modified vs $BASE_REF: $rel"
        PLAYBACK_OK=0
      fi
    done
    if [[ "$PLAYBACK_OK" -eq 1 ]]; then
      pass "playback files match $BASE_REF (no content diff)"
    else
      fail "playback files must not change (Twitch vendor / kick.js)"
    fi
  else
    echo "SKIP  no main ref for playback diff"
  fi
else
  echo "SKIP  playback git diff (not a git checkout)"
fi
for rel in "${PLAYBACK_FILES[@]}"; do
  if [[ ! -f "$PKG/$rel" ]]; then
    fail "missing playback file $rel"
  fi
done
if [[ -f "$PKG/src/debug.js" || -f "$PKG/src/debug-bridge.js" ]]; then
  fail "debug log files must stay out of the package"
else
  pass "debug log is not packaged"
fi
if rg -n 'Copy debug|id="debug-on"|id="debug-status"' "$PKG/src/popup.html" >/dev/null 2>&1; then
  fail "popup still has the debug section"
else
  pass "popup has no debug section"
fi

section "2. Permissions + host coverage + DNR"
python3 - "$PKG/manifest.json" "$PKG/src/rules/general-network.json" <<'PY' || FAILS=$((FAILS + 1))
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
PY

section "2c. Curben / phishing-feed sources (owner decisions #13, #18b)"
# The one Curben (curbengh / malware-filter) list allowed is urlhaus-filter
# (URLhaus data, CC0), source urlhaus_hosts, fetched only from
# https://malware-filter.gitlab.io/malware-filter/urlhaus-filter-hosts-online.txt
# Any other list or mirror of that project, its phishing list, or any phishing
# feed source fails here. The same checker runs in the deno suite.
CURBEN_ARGS=(--root "$PKG" --gate "$ROOT/scripts/release-gate.sh")
if [[ -f "$ROOT/scripts/pack-filter-lists.py" ]]; then
  CURBEN_ARGS+=(--packer "$ROOT/scripts/pack-filter-lists.py")
fi
if python3 "$ROOT/scripts/lib/curben_check.py" "${CURBEN_ARGS[@]}"; then
  :
else
  fail "Curben/phishing-feed source rule (only urlhaus-filter from malware-filter.gitlab.io)"
fi

section "3. Dangerous APIs + identity / phone-home"
SCAN_ROOT="$PKG/src"
# video-swap-new (pixeltris) needs eval(workerString) to boot the player worker
# blob and one innerHTML write for the in-player "Blocking ads" banner. Allow only
# those two known lines in the vendored userscript; everything else still fails.
# importScripts is allowed only in the service worker, only on a line that
# holds nothing but the call's string literals (so no other call can hide on
# that line; follow-up review). rg is line-based: the continuation line has
# no importScripts token, and the package check in section 1 parses the whole
# call and rejects anything but literals.
DANGER_PAT='\beval\s*\(|\.innerHTML\s*=|document\.write\s*\(|importScripts\s*\(|chrome\.identity|browser\.identity|navigator\.sendBeacon|geolocation|webkitRTCPeerConnection|\bRTCPeerConnection\b'
# Scan JS under src/ but skip rules JSON (not JS). Cosmetic may use style injection.
if rg -n --pcre2 "$DANGER_PAT" "$SCAN_ROOT" --glob '*.js' >/tmp/gate-danger-raw.txt 2>/dev/null; then
  set +e
  rg -v 'video-swap-new\.user\.js:[0-9]+:.*eval\(workerString\)' /tmp/gate-danger-raw.txt \
    | rg -v 'video-swap-new\.user\.js:[0-9]+:.*adBlockDiv\.innerHTML = ' \
    | rg -v --pcre2 'general-background\.js:[0-9]+:importScripts\((\s*"[^"\\]*"\s*,?)+\s*(\);)?\s*\r?$' \
    >/tmp/gate-danger.txt
  set -e
  if [[ -s /tmp/gate-danger.txt ]]; then
    cat /tmp/gate-danger.txt
    fail "dangerous API hits in packaged src"
  else
    pass "no unexpected eval/innerHTML/identity/beacon/RTC (video-swap-new worker eval + banner allowed)"
  fi
else
  pass "no eval/innerHTML/identity/beacon/RTC in packaged src"
fi

if rg -n 'new Function\s*\(' "$SCAN_ROOT" --glob '*.js' >/tmp/gate-fn.txt 2>/dev/null; then
  cat /tmp/gate-fn.txt
  fail "new Function in packaged src"
else
  pass "no new Function in packaged src"
fi

if rg -ni --pcre2 '@gmail\.|@cursor\.|api[_-]?key\s*[:=]|password\s*[:=]|BEGIN (RSA |OPENSSH )?PRIVATE' "$PKG/manifest.json" "$SCAN_ROOT" --glob '!src/rules/*' >/tmp/gate-id.txt 2>/dev/null; then
  cat /tmp/gate-id.txt
  fail "possible identity/secret strings in package"
else
  pass "no obvious identity/secret strings"
fi

# Ad-network / tracker names are allowed only inside packed DNR rules (+ credit text).
if rg -ni 'doubleclick|googlesyndication|sentry\.io|mixpanel|amplitude\.com|segment\.io|google-analytics|hotjar|clarity\.ms' "$SCAN_ROOT" --glob '*.js' >/tmp/gate-track.txt 2>/dev/null; then
  cat /tmp/gate-track.txt
  fail "tracker/ad-network strings outside rules (JS)"
else
  pass "no tracker/ad-network phone-home strings in JS"
fi
# Rules JSON is expected to name ad servers; credit file may mention list names.
pass "ad-server names permitted inside src/rules/ only"

python3 - "$SCAN_ROOT" <<'PY' || FAILS=$((FAILS + 1))
import pathlib, re, sys
root = pathlib.Path(sys.argv[1])
allowed_host_bits = (
    "easylist.to", "pgl.yoyo.org", "malware-filter.gitlab.io", "ublockorigin.github.io", "easylist-downloads.adblockplus.org", "secure.fanboy.co.nz", "filters.adtidy.org",  # filter-list refresh (host_permissions)
    "twitch.tv", "ttvnw.net", "jtvnw.net", "twitchcdn",
    "youtube.com", "youtu.be", "googlevideo.com", "ytimg.com",
    "googleapis.com", "ggpht.com", "yt3.", "youtubei.",
    "kick.com", "live-video.net", "amazon-ivs",
    # uBO's YouTube rpnt filter compares error-screen text against this help link (no request).
    "support.google.com",
    # Manual list Update (popup fetch) may reference these; still no background worker.
    "easylist.to", "pgl.yoyo.org", "raw.githubusercontent.com",
)
# Skip rules JSON / credit — those are data, not outbound fetches from playback code.
skip_parts = {"rules"}
urls = []
for path in root.rglob("*.js"):
    if "rules" in path.parts:
        continue
    for line in path.read_text(errors="replace").splitlines():
        stripped = line.lstrip()
        if stripped.startswith("//"):
            continue  # userscript headers / attribution comments are not runtime fetches
        for m in re.finditer(r"https?://[^\s\"'`]+", line):
            urls.append((str(path), m.group(0)))
bad = []
# malware-filter.gitlab.io serves exactly one allowed list (owner decision #18b).
CURBEN_URL = "https://malware-filter.gitlab.io/malware-filter/urlhaus-filter-hosts-online.txt"
for path, url in urls:
    host = re.sub(r"^https?://", "", url).split("/")[0].lower()
    if host == "example.invalid":
        continue  # relative-URL base in the exclusion helper, not a request
    if ("malware-filter" in host or "curben" in host) and url != CURBEN_URL:
        bad.append(f"{path}: {url} (only the urlhaus-filter list may come from Curben's project)")
        continue
    # Security review M-9: whole host labels, not substrings ("evil-kick.com.example"
    # used to pass because it contains "kick.com"). Entries ending in "." are
    # host prefixes (yt3., youtubei.); "twitchcdn" covers twitchcdn.net/.com.
    def host_ok(h, bit):
        if bit.endswith("."):
            return h.startswith(bit)
        if "." not in bit:
            return any(h == bit + "." + tld or h.endswith("." + bit + "." + tld) for tld in ("net", "com"))
        return h == bit or h.endswith("." + bit)
    if not any(host_ok(host, bit) for bit in allowed_host_bits):
        bad.append(f"{path}: {url}")
if bad:
    print("FAIL  unexpected outbound URL hosts:")
    print("\n".join(bad))
    sys.exit(1)
print("PASS  outbound URL hosts within Twitch/YouTube family (or known list Update hosts)")
for path, url in urls:
    print(f"  {url}")
PY

section "4. Privileged extension API usage"
python3 - "$PKG" <<'PY' || FAILS=$((FAILS + 1))
import pathlib, re, sys
root = pathlib.Path(sys.argv[1])
bad = []
playback = ["src/vendor/video-swap-new.user.js", "src/youtube.js", "src/vendor/ubo-youtube.js", "src/vendor/ubo-youtube-isolated.js"]
for rel in playback:
    text = (root / rel).read_text(errors="replace")
    if re.search(r"\bchrome\.|\bbrowser\.", text):
        bad.append(rel + " uses chrome/browser")
# Security review M-9: the page-world guards and Kick script, and the worker
# libraries (threat, feed, lists), use no extension API at all.
for rel in ["src/kick.js", "src/guards/clipboard.js", "src/guards/popups.js"] + sorted(
        str(p.relative_to(root)).replace("\\", "/") for d in ("src/threat", "src/feed") for p in (root / d).glob("*.js")) + [
        "src/general/update.js", "src/general/filter-options.js"]:
    path = root / rel
    if not path.is_file():
        continue
    code = re.sub(r"/\*.*?\*/", "", path.read_text(errors="replace"), flags=re.S)
    code = "\n".join(l for l in code.splitlines() if not l.lstrip().startswith("//"))
    if re.search(r"\b(chrome|browser)\.[A-Za-z_]", code):
        bad.append(rel + " uses chrome/browser")
allowed = {
    "src/popup.js": {"runtime", "tabs", "storage"},
    "src/general-settings.js": set(),
    "src/general-background.js": {"runtime", "storage", "action", "declarativeNetRequest", "alarms"},
    "src/cosmetic.js": {"runtime", "storage"},
    "src/settings.js": {"runtime", "storage"},
    "src/settings/features.js": set(),
    "src/settings/flags.js": {"runtime", "storage"},
    "src/twitch-directory-ads.js": {"runtime", "storage"},
    "src/general/cosmetic-parse.js": set(),
}
for rel, ok_ns in allowed.items():
    path = root / rel
    if not path.is_file():
        if rel == "src/popup.js":
            bad.append("missing " + rel)
        continue
    # Comments do not call APIs (they may name them).
    text = re.sub(r"/\*.*?\*/", "", path.read_text(errors="replace"), flags=re.S)
    text = "\n".join(l for l in text.splitlines() if not l.lstrip().startswith("//"))
    for match in re.finditer(r"\b(chrome|browser)\.([A-Za-z0-9_]+)", text):
        if match.group(1) != "chrome" or match.group(2) not in ok_ns:
            bad.append(f"{rel}: {match.group(0)}")
# No interval timers in the UI worker; exactly one alarm (gecko-refresh, the
# 3 h list/feed check), created only through REFRESH_ALARM.
bg = (root / "src/general-background.js").read_text(errors="replace")
if re.search(r"\bsetInterval\b", bg):
    bad.append("src/general-background.js must not use setInterval")
if re.search(r"chrome\.alarms\.create\((?!REFRESH_ALARM,)", bg):
    bad.append("src/general-background.js may only create the gecko-refresh alarm")
if not re.search(r'REFRESH_ALARM\s*=\s*"gecko-refresh"', (root / "src/general/update.js").read_text(errors="replace")):
    bad.append("src/general/update.js must name the one alarm gecko-refresh")
if bad:
    print("FAIL  extension API scope:")
    print("\n".join(bad))
    sys.exit(1)
print("PASS  playback scripts have no chrome APIs; general UI APIs are scoped")
PY

section "5. Deno bug / logic / memory / race / youtube"
if [[ -n "${TEST_ROOT}" && -d "${TEST_ROOT}/test" ]]; then
  set +e
  # NO_COLOR: plain summary line (no escape codes in the PASS line or CI log).
  (cd "$TEST_ROOT" && NO_COLOR=1 deno test --no-lock --allow-read --allow-run --allow-env test/) 2>&1 | tee /tmp/gate-deno.txt
  DENO_RC=${PIPESTATUS[0]}
  set -e
  if [[ "$DENO_RC" -eq 0 ]]; then
    SUMMARY="$(rg 'passed|failed' /tmp/gate-deno.txt | tail -1 || true)"
    pass "deno test ($SUMMARY)"
  else
    fail "deno test failed (exit $DENO_RC)"
  fi
  # A failing test prints "... FAILED"; the summary "N failed" with N >= 1.
  # ("0 failed (3m)" must not match: with no ignored tests it ends that way.)
  if rg -q '\bFAILED\b|[1-9][0-9]* failed' /tmp/gate-deno.txt; then
    fail "deno reported failures"
  fi
else
  echo "SKIP  deno tests (no test/ next to package — use --dir on the repo)"
fi

section "6. Fuzz smoke (vendor userscript parse)"
VENDOR_JS="$PKG/src/vendor/video-swap-new.user.js"
if [[ -f "$VENDOR_JS" ]]; then
  set +e
  VENDOR_ABS="$(cd "$(dirname "$VENDOR_JS")" && pwd)/$(basename "$VENDOR_JS")"
  # Git Bash / MSYS paths like /c/Users/... must become C:/Users/... for Deno on Windows.
  if command -v cygpath >/dev/null 2>&1; then
    VENDOR_ABS="$(cygpath -m "$VENDOR_JS")"
  elif [[ "$VENDOR_ABS" =~ ^/[a-zA-Z]/ ]]; then
    drive="$(echo "${VENDOR_ABS:1:1}" | tr '[:lower:]' '[:upper:]')"
    VENDOR_ABS="${drive}:${VENDOR_ABS:2}"
  fi
  # Deno file URLs want forward slashes; avoid file:///C:/c/... double drives.
  VENDOR_URI="file:///$(printf '%s' "$VENDOR_ABS" | sed 's|\\|/|g')"
  FUZZ_JS="$(mktemp /tmp/adblock-vendor-fuzz.XXXXXX.js)"
  cat > "$FUZZ_JS" <<EOF
import source from "$VENDOR_URI" with { type: "text" };
if (!source.includes("ourTwitchAdSolutionsVersion = 23")) throw new Error("missing version gate");
if (!source.includes("AD_SIGNIFIER = 'stitched-ad'")) throw new Error("missing AD_SIGNIFIER");
if (!source.includes("function reloadTwitchPlayer")) throw new Error("missing reloadTwitchPlayer");
const body = source.replace(/^\\/\\/ ==UserScript==[\\s\\S]*?\\/\\/ ==\\/UserScript==\\s*/, "");
new Function(body);
console.log("vendor userscript parse ok");
EOF
  deno run --no-lock "$FUZZ_JS" 2>&1
  FUZZ_RC=$?
  rm -f "$FUZZ_JS"
  set -e
  if [[ "$FUZZ_RC" -eq 0 ]]; then pass "vendor userscript parse did not throw"; else fail "vendor userscript parse threw"; fi
else
  echo "SKIP  vendor userscript parse"
fi

if [[ -f "$PKG/src/youtube.js" && -n "${TEST_ROOT}" && -d "${TEST_ROOT}/test" ]]; then
  pass "youtube malformed JSON covered by deno suite"
fi

section "SUMMARY"
if [[ "$FAILS" -eq 0 ]]; then
  echo "VERDICT: CLEAN — all automated gates passed for $EXPECT_VERSION"
  RC=0
else
  echo "VERDICT: FAIL — $FAILS check(s) failed for $EXPECT_VERSION"
  RC=1
fi

if [[ "$CLEANUP" -eq 1 && -n "$TMP_ROOT" ]]; then
  rm -rf "$TMP_ROOT"
fi
exit "$RC"
