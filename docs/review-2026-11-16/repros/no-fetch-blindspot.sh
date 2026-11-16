#!/usr/bin/env bash
# Repro: test/no-background-fetch.test.js "packaged scripts do not auto-fetch filter lists"
# scans three dead modules but not the live content scripts. Add a list fetch to the
# live src/cosmetic.js in a scratch copy and run that test file: it still passes.
set -u
R=docs/review-2026-11-16/repros/repo-nofetch
rm -rf "$R"; mkdir -p "$R"
(cd . && tar --exclude=.git --exclude=docs -cf - .) | (cd "$R" && tar xf -)
printf '\nfetch("https://easylist.to/easylist/easylist.txt");\n' >> "$R/src/cosmetic.js"
printf '\nfetch("https://filters.adtidy.org/x.txt");\n' >> "$R/src/settings.js"
cd "$R" && /opt/node22/bin/deno test --no-lock --allow-read --allow-run --allow-env test/no-background-fetch.test.js 2>&1 | tail -3
