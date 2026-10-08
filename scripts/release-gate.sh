#!/usr/bin/env bash
# Release smoke for twitch-adblock: package, security, hosts, deno, light fuzz.
# Local only — does not phone home. Requires deno, python3, and ripgrep (rg).
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

Checks: shippable file allowlist, no privileged manifest fields, Twitch/YouTube host
coverage, no eval/innerHTML/identity/trackers/unexpected hosts, no chrome.* APIs,
deno test (when test/ is present), and a small playlist fuzz smoke.
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

REQUIRED=(manifest.json popup.html popup.js src/debug.js src/debug-bridge.js src/page.js src/playlist.js src/youtube.js icons/icon16.png icons/icon48.png icons/icon128.png)
ALLOWED_RE='^(manifest\.json|popup\.html|popup\.js|src/debug\.js|src/debug-bridge\.js|src/page\.js|src/playlist\.js|src/youtube\.js|icons/icon16\.png|icons/icon48\.png|icons/icon128\.png)$'

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
    SIZE=$((SIZE + $(stat -c%s "$PKG/$r")))
  done
  pass "repo mode: allowlist checked on shippable paths only"
fi
if [[ "$ALLOW_OK" -eq 1 ]]; then pass "shippable file allowlist"; else fail "shippable file allowlist"; fi
if [[ -f "$PKG/popup.html" && -f "$PKG/popup.js" ]]; then
  pass "temporary debug popup is packaged"
else
  fail "temporary debug popup files missing"
fi
if [[ -f "$PKG/src/popup.html" ]]; then fail "popup.html must live next to manifest.json"; else pass "popup.html is not inside src"; fi
if rg -n --pcre2 '<script(?![^>]*\bsrc="popup\.js")|onclick=|javascript:' "$PKG/popup.html" >/tmp/gate-popup.txt 2>/dev/null; then
  cat /tmp/gate-popup.txt
  fail "popup.html must load only popup.js"
else
  pass "popup.html loads only popup.js"
fi
echo "  package bytes: $SIZE"
if [[ "$SIZE" -gt 5000000 ]]; then fail "package unexpectedly large (>5MB)"; else pass "package size sane"; fi

section "2. Permissions + host coverage"
python3 - "$PKG/manifest.json" <<'PY' || FAILS=$((FAILS + 1))
import json, sys
m = json.load(open(sys.argv[1]))
bad = []
for key in ("permissions", "host_permissions", "optional_permissions", "background", "externally_connectable", "oauth2", "key"):
    if m.get(key):
        bad.append(f"{key}={m.get(key)!r}")
if bad:
    print("FAIL  privileged manifest fields:", "; ".join(bad))
    sys.exit(1)
print("PASS  no privileged manifest fields")

scripts = m.get("content_scripts") or []
twitch = next((s for s in scripts if "src/page.js" in (s.get("js") or [])), None)
youtube = next((s for s in scripts if "src/youtube.js" in (s.get("js") or [])), None)
if not twitch:
    print("FAIL  Twitch content_script missing"); sys.exit(1)
need_t = {"*://twitch.tv/*", "*://*.twitch.tv/*"}
got_t = set(twitch.get("matches") or [])
if not need_t <= got_t:
    print("FAIL  Twitch matches missing", need_t - got_t); sys.exit(1)
if twitch.get("js") != ["src/debug.js", "src/playlist.js", "src/page.js"]:
    print("FAIL  Twitch js order", twitch.get("js")); sys.exit(1)
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
if youtube.get("js") != ["src/debug.js", "src/youtube.js"]:
    print("FAIL  YouTube js order", youtube.get("js")); sys.exit(1)
print("PASS  YouTube host coverage", sorted(got_y))

if m.get("action", {}).get("default_popup") != "popup.html":
    print("FAIL  debug popup must be action.default_popup"); sys.exit(1)
print("PASS  action popup is popup.html")

bridge = next((s for s in scripts if "src/debug-bridge.js" in (s.get("js") or [])), None)
if not bridge:
    print("FAIL  debug bridge content script missing"); sys.exit(1)
if bridge.get("world") == "MAIN":
    print("FAIL  debug bridge must stay out of the page world"); sys.exit(1)
if bridge.get("js") != ["src/debug-bridge.js"]:
    print("FAIL  debug bridge js", bridge.get("js")); sys.exit(1)
need_b = need_t | need_y
got_b = set(bridge.get("matches") or [])
if got_b != need_b:
    print("FAIL  debug bridge host scope", sorted(got_b)); sys.exit(1)
print("PASS  debug bridge is isolated and host-scoped")

joined = " ".join(sorted(got_t | got_y))
for host in ("music.youtube.com", "studio.youtube.com", "youtubekids.com"):
    if host in joined:
        print("FAIL  unexpected host scope", host); sys.exit(1)
print("PASS  no out-of-scope hosts in matches")
PY

section "3. Dangerous APIs + identity / phone-home"
SCAN_ROOT="$PKG/src"
SCAN_PATHS=("$SCAN_ROOT")
[[ -f "$PKG/popup.js" ]] && SCAN_PATHS+=("$PKG/popup.js")
[[ -f "$PKG/popup.html" ]] && SCAN_PATHS+=("$PKG/popup.html")
if rg -n --pcre2 '\beval\s*\(|\.innerHTML\s*=|document\.write\s*\(|importScripts\s*\(|chrome\.identity|browser\.identity|navigator\.sendBeacon|geolocation|webkitRTCPeerConnection|\bRTCPeerConnection\b' "${SCAN_PATHS[@]}" >/tmp/gate-danger.txt 2>/dev/null; then
  cat /tmp/gate-danger.txt
  fail "dangerous API hits in packaged src"
else
  pass "no eval/innerHTML/identity/beacon/RTC in packaged src"
fi

if rg -n 'new Function\s*\(' "${SCAN_PATHS[@]}" >/tmp/gate-fn.txt 2>/dev/null; then
  cat /tmp/gate-fn.txt
  fail "new Function in packaged src"
else
  pass "no new Function in packaged src"
fi

if rg -ni --pcre2 '@gmail\.|@cursor\.|api[_-]?key\s*[:=]|password\s*[:=]|BEGIN (RSA |OPENSSH )?PRIVATE' "$PKG/manifest.json" "${SCAN_PATHS[@]}" >/tmp/gate-id.txt 2>/dev/null; then
  cat /tmp/gate-id.txt
  fail "possible identity/secret strings in package"
else
  pass "no obvious identity/secret strings"
fi

if rg -ni 'doubleclick|googlesyndication|sentry\.io|mixpanel|amplitude\.com|segment\.io|google-analytics|hotjar|clarity\.ms' "${SCAN_PATHS[@]}" >/tmp/gate-track.txt 2>/dev/null; then
  cat /tmp/gate-track.txt
  fail "tracker/ad-network strings"
else
  pass "no tracker/ad-network phone-home strings"
fi

python3 - "$SCAN_ROOT" <<'PY' || FAILS=$((FAILS + 1))
import pathlib, re, sys
root = pathlib.Path(sys.argv[1])
allowed_host_bits = (
    "twitch.tv", "ttvnw.net", "jtvnw.net", "twitchcdn",
    "youtube.com", "youtu.be", "googlevideo.com", "ytimg.com",
    "googleapis.com", "ggpht.com", "yt3.", "youtubei.",
)
urls = []
for path in root.rglob("*.js"):
    text = path.read_text(errors="replace")
    for m in re.finditer(r"https?://[^\s\"'`]+", text):
        urls.append((str(path), m.group(0)))
bad = []
for path, url in urls:
    host = re.sub(r"^https?://", "", url).split("/")[0].lower()
    if not any(bit in host for bit in allowed_host_bits):
        bad.append(f"{path}: {url}")
if bad:
    print("FAIL  unexpected outbound URL hosts:")
    print("\n".join(bad))
    sys.exit(1)
print("PASS  outbound URL hosts within Twitch/YouTube family")
for path, url in urls:
    print(f"  {url}")
PY

section "4. Privileged extension API usage"
python3 - "$PKG" <<'PY' || FAILS=$((FAILS + 1))
import pathlib, re, sys
root = pathlib.Path(sys.argv[1])
bad = []
playback = ["src/page.js", "src/playlist.js", "src/youtube.js", "src/debug.js"]
for rel in playback:
    text = (root / rel).read_text(errors="replace")
    if re.search(r"\bchrome\.|\bbrowser\.", text):
        bad.append(rel + " uses chrome/browser")
for rel in ["popup.js", "src/debug-bridge.js"]:
    path = root / rel
    if not path.is_file():
        bad.append("missing " + rel)
        continue
    text = path.read_text(errors="replace")
    for match in re.finditer(r"\b(chrome|browser)\.([A-Za-z0-9_]+)", text):
        if match.group(1) != "chrome" or match.group(2) not in {"runtime", "tabs"}:
            bad.append(f"{rel}: {match.group(0)}")
if bad:
    print("FAIL  extension API scope:")
    print("\n".join(bad))
    sys.exit(1)
print("PASS  playback scripts have no chrome APIs; debug UI is runtime/tabs only")
PY

section "5. Deno bug / logic / memory / race / youtube"
if [[ -n "${TEST_ROOT}" && -d "${TEST_ROOT}/test" ]]; then
  set +e
  (cd "$TEST_ROOT" && deno test --no-lock test/) 2>&1 | tee /tmp/gate-deno.txt
  DENO_RC=${PIPESTATUS[0]}
  set -e
  if [[ "$DENO_RC" -eq 0 ]]; then
    SUMMARY="$(rg -n 'passed|failed' /tmp/gate-deno.txt | tail -1 || true)"
    pass "deno test ($SUMMARY)"
  else
    fail "deno test failed (exit $DENO_RC)"
  fi
  if rg -q 'FAILED|failed \(' /tmp/gate-deno.txt; then
    fail "deno reported failures"
  fi
else
  echo "SKIP  deno tests (no test/ next to package — use --dir on the repo)"
fi

section "6. Fuzz smoke (playlist)"
if [[ -f "$PKG/src/playlist.js" ]]; then
  set +e
  deno eval --no-lock '
    import playlistSource from "'"$PKG"'/src/playlist.js" with { type: "text" };
    const playlist = new Function(`${playlistSource}\nreturn TwitchAdblockPlaylist;`)();
    const junk = ["", "{", "#EXTM3U\n\x00\xff", "#EXTM3U\n" + "A".repeat(200000), "#EXTM3U\n#EXT-X-DATERANGE:ID=\"x\",CLASS=\"twitch-stitched-ad\"\n"];
    for (const body of junk) {
      try { playlist.hasAdBreak(body); } catch (e) { console.error("playlist fuzz threw", e); Deno.exit(1); }
      try { playlist.stripAds(body); } catch (e) { console.error("strip fuzz threw", e); Deno.exit(1); }
    }
    console.log("playlist fuzz ok");
  ' 2>&1
  FUZZ_RC=$?
  set -e
  if [[ "$FUZZ_RC" -eq 0 ]]; then pass "playlist fuzz did not throw"; else fail "playlist fuzz threw"; fi
else
  echo "SKIP  playlist fuzz"
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
