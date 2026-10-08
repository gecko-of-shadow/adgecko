#!/usr/bin/env bash
# Pack the shippable extension zip (manifest, debug popup, src, icons).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["version"])' "$ROOT/manifest.json")"
OUT="${1:-$ROOT/twitch-adblock-${VERSION}.zip}"

REQUIRED=(manifest.json popup.html popup.js src/debug.js src/debug-bridge.js src/page.js src/playlist.js src/youtube.js icons/icon16.png icons/icon48.png icons/icon128.png)
for r in "${REQUIRED[@]}"; do
  [[ -f "$ROOT/$r" ]] || { echo "Missing $r"; exit 1; }
done
if [[ -f "$ROOT/src/popup.html" ]]; then
  echo "Refuse to pack: popup.html must live next to manifest.json"
  exit 1
fi

TMP="$(mktemp -d /tmp/adblock-pack.XXXXXX)"
mkdir -p "$TMP/src" "$TMP/icons"
cp "$ROOT/manifest.json" "$ROOT/popup.html" "$ROOT/popup.js" "$TMP/"
cp "$ROOT/src/debug.js" "$ROOT/src/debug-bridge.js" "$ROOT/src/page.js" "$ROOT/src/playlist.js" "$ROOT/src/youtube.js" "$TMP/src/"
cp "$ROOT/icons/icon16.png" "$ROOT/icons/icon48.png" "$ROOT/icons/icon128.png" "$TMP/icons/"

rm -f "$OUT"
(cd "$TMP" && zip -qr "$OUT" manifest.json popup.html popup.js src icons)
rm -rf "$TMP"

echo "Wrote $OUT"
unzip -l "$OUT"
