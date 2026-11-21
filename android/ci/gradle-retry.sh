#!/usr/bin/env bash
# CI only: run the Gradle wrapper, and run it again only when Maven Central
# refused a download with HTTP 429 "Too Many Requests" (runs 8 and 10 of
# 2026-11-17). Any other failure, a test failure included, ends at once:
# a retry must not hide a real fault. At most 2 retries, 60 s and 120 s apart.
#   bash android/ci/gradle-retry.sh <gradle arguments>
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
LOG="$(mktemp)"
for attempt in 1 2 3; do
  "$ROOT/android/gradlew" -p "$ROOT/android" --no-daemon "$@" 2>&1 | tee "$LOG"
  status=${PIPESTATUS[0]}
  if [ "$status" -eq 0 ]; then
    exit 0
  fi
  if [ "$attempt" -lt 3 ] && grep -q "status code 429" "$LOG"; then
    wait_s=$((attempt * 60))
    echo "gradle-retry: Maven Central answered HTTP 429; retry $attempt of 2 in $wait_s s"
    sleep "$wait_s"
    continue
  fi
  exit "$status"
done
