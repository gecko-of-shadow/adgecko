#!/usr/bin/env bash
# Pack the shippable extension zip: manifest.json, src/ (debug popup + rules), icons/.
# Does not pack docs/, test/, or scripts/. Never rewrites playback sources.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["version"])' "$ROOT/manifest.json")"
OUT="${1:-$ROOT/twitch-adblock-${VERSION}.zip}"

REQUIRED=(
  manifest.json
  src/popup.html
  src/popup.js
  src/debug.js
  src/debug-bridge.js
  src/vendor/video-swap-new.user.js
  src/vendor/LICENSE-TwitchAdSolutions
  src/youtube.js
  src/rules/general-network.json
  src/rules/CREDIT-EasyList.txt
  src/rules/LICENSES.md
  src/general-exclude-hosts.js
  icons/icon16.png
  icons/icon48.png
  icons/icon128.png
)
for r in "${REQUIRED[@]}"; do
  [[ -f "$ROOT/$r" ]] || { echo "Missing $r"; exit 1; }
done
if [[ -f "$ROOT/popup.html" || -f "$ROOT/popup.js" ]]; then
  echo "Refuse to pack: the popup lives in src/ (zip holds manifest.json, src/, icons/ only)"
  exit 1
fi

# Optional cosmetic files (Phase 0 depth: hide leftover boxes). Packed when present.
OPTIONAL=()
[[ -f "$ROOT/src/cosmetic.js" ]] && OPTIONAL+=("src/cosmetic.js")
[[ -f "$ROOT/src/cosmetic.css" ]] && OPTIONAL+=("src/cosmetic.css")

TMP="$(mktemp -d /tmp/adblock-pack.XXXXXX)"
mkdir -p "$TMP/src/vendor" "$TMP/src/rules" "$TMP/icons"
cp "$ROOT/manifest.json" "$TMP/"
cp "$ROOT/src/popup.html" "$ROOT/src/popup.js" "$ROOT/src/debug.js" "$ROOT/src/debug-bridge.js" "$ROOT/src/youtube.js" "$TMP/src/"
cp "$ROOT/src/general-exclude-hosts.js" "$TMP/src/"
cp "$ROOT/src/vendor/video-swap-new.user.js" "$ROOT/src/vendor/LICENSE-TwitchAdSolutions" "$ROOT/src/vendor/README.md" "$TMP/src/vendor/"
cp "$ROOT/src/rules/general-network.json" "$ROOT/src/rules/CREDIT-EasyList.txt" "$ROOT/src/rules/LICENSES.md" "$TMP/src/rules/"
# Optional list-pack / merge metadata (not required to load).
[[ -f "$ROOT/src/rules/meta.json" ]] && cp "$ROOT/src/rules/meta.json" "$TMP/src/rules/"
[[ -f "$ROOT/src/rules/dnr-merge-meta.json" ]] && cp "$ROOT/src/rules/dnr-merge-meta.json" "$TMP/src/rules/"
for opt in "${OPTIONAL[@]+"${OPTIONAL[@]}"}"; do
  mkdir -p "$TMP/$(dirname "$opt")"
  cp "$ROOT/$opt" "$TMP/$opt"
done
cp "$ROOT/icons/icon16.png" "$ROOT/icons/icon48.png" "$ROOT/icons/icon128.png" "$TMP/icons/"

rm -f "$OUT"
pack_with_windows_tar() {
  local win_tar="/c/Windows/System32/tar.exe"
  [[ -x "$win_tar" ]] || return 1
  local win_out="$OUT"
  if command -v cygpath >/dev/null 2>&1; then
    win_out="$(cygpath -w "$OUT")"
  fi
  (cd "$TMP" && "$win_tar" -a -cf "$win_out" manifest.json src icons)
}

if command -v zip >/dev/null 2>&1; then
  (cd "$TMP" && zip -qr "$OUT" manifest.json src icons)
elif pack_with_windows_tar; then
  : # bsdtar on Windows writes a real zip when the name ends in .zip
else
  echo "Missing zip. On Windows, System32 tar.exe is also acceptable; otherwise install Info-ZIP."
  rm -rf "$TMP"
  exit 1
fi
rm -rf "$TMP"

echo "Wrote $OUT"
if command -v unzip >/dev/null 2>&1 && unzip -t "$OUT" >/dev/null 2>&1; then
  unzip -l "$OUT"
elif [[ -x /c/Windows/System32/tar.exe ]]; then
  /c/Windows/System32/tar.exe -tf "$(command -v cygpath >/dev/null && cygpath -w "$OUT" || echo "$OUT")"
fi
