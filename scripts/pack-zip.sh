#!/usr/bin/env bash
# Pack the shippable extension zip: manifest.json, src/, icons/.
# Does not pack docs/, test/, or scripts/. Never rewrites playback sources.
#
# The file list is DERIVED by scripts/lib/package_files.py from manifest.json
# (service worker, content scripts js/css, rulesets, popup/options pages,
# icons), the worker's importScripts(...) targets, the pages' <script>/<link>
# targets, package-local paths the code fetches (chrome.runtime.getURL), and
# the licence/credit files. A file the extension loads cannot be left out.
# After packing, the zip is checked to hold exactly that list.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["version"])' "$ROOT/manifest.json")"
OUT="${1:-$ROOT/adgecko-${VERSION}.zip}"
# The zip is written from a temp folder: make a relative output path absolute.
case "$OUT" in
  /*|[A-Za-z]:*) ;;
  *) OUT="$PWD/$OUT" ;;
esac
LIST_PY="$ROOT/scripts/lib/package_files.py"

if [[ -f "$ROOT/popup.html" || -f "$ROOT/popup.js" ]]; then
  echo "Refuse to pack: the popup lives in src/ (zip holds manifest.json, src/, icons/ only)"
  exit 1
fi

# Fails (and prints each missing path) if anything the manifest, the worker or
# a page names is not in the tree.
# tr: python3 on Windows prints CRLF. pipefail keeps python's exit status.
if ! FILE_LIST="$(python3 "$LIST_PY" --root "$ROOT" | tr -d '\r')"; then
  echo "$FILE_LIST"
  echo "Refuse to pack: derived package files are missing"
  exit 1
fi
mapfile -t FILES <<<"$FILE_LIST"
for f in "${FILES[@]}"; do
  case "$f" in
    manifest.json|src/*|icons/*) ;;
    *) echo "Refuse to pack: $f is outside manifest.json, src/, icons/"; exit 1 ;;
  esac
done

TMP="$(mktemp -d "${TMPDIR:-/tmp}/adblock-pack.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT
for f in "${FILES[@]}"; do
  mkdir -p "$TMP/$(dirname "$f")"
  cp "$ROOT/$f" "$TMP/$f"
done

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
  exit 1
fi

ZIP_ARG="$OUT"
if command -v cygpath >/dev/null 2>&1; then
  ZIP_ARG="$(cygpath -m "$OUT")"
fi
python3 "$LIST_PY" --root "$ROOT" --check-zip "$ZIP_ARG"
echo "Wrote $OUT (${#FILES[@]} files)"
