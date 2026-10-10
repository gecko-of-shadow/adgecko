#!/usr/bin/env bash
# Pack the shippable extension zip: manifest.json, src/ (debug popup included), icons/.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["version"])' "$ROOT/manifest.json")"
OUT="${1:-$ROOT/twitch-adblock-${VERSION}.zip}"

REQUIRED=(manifest.json src/popup.html src/popup.js src/general-settings.js src/general-background.js src/debug.js src/debug-bridge.js src/vendor/video-swap-new.user.js src/vendor/LICENSE-TwitchAdSolutions src/youtube.js icons/icon16.png icons/icon48.png icons/icon128.png icons/icon16-working.png icons/icon48-working.png icons/icon128-working.png icons/icon16-off.png icons/icon48-off.png icons/icon128-off.png)
for r in "${REQUIRED[@]}"; do
  [[ -f "$ROOT/$r" ]] || { echo "Missing $r"; exit 1; }
done
if [[ -f "$ROOT/popup.html" || -f "$ROOT/popup.js" ]]; then
  echo "Refuse to pack: the popup lives in src/ (zip holds manifest.json, src/, icons/ only)"
  exit 1
fi

TMP="$(mktemp -d /tmp/adblock-pack.XXXXXX)"
mkdir -p "$TMP/src/vendor" "$TMP/icons"
cp "$ROOT/manifest.json" "$TMP/"
cp "$ROOT/src/popup.html" "$ROOT/src/popup.js" "$ROOT/src/general-settings.js" "$ROOT/src/general-background.js" "$ROOT/src/debug.js" "$ROOT/src/debug-bridge.js" "$ROOT/src/youtube.js" "$TMP/src/"
cp "$ROOT/src/vendor/video-swap-new.user.js" "$ROOT/src/vendor/LICENSE-TwitchAdSolutions" "$ROOT/src/vendor/README.md" "$TMP/src/vendor/"
cp "$ROOT/icons/icon16.png" "$ROOT/icons/icon48.png" "$ROOT/icons/icon128.png" \
  "$ROOT/icons/icon16-working.png" "$ROOT/icons/icon48-working.png" "$ROOT/icons/icon128-working.png" \
  "$ROOT/icons/icon16-off.png" "$ROOT/icons/icon48-off.png" "$ROOT/icons/icon128-off.png" \
  "$TMP/icons/"

rm -f "$OUT"
(cd "$TMP" && zip -qr "$OUT" manifest.json src icons)
rm -rf "$TMP"

echo "Wrote $OUT"
unzip -l "$OUT"
