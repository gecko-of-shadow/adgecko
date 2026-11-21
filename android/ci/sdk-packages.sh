#!/usr/bin/env bash
# CI only (GitHub runner): install Android platform 36 and build-tools 36.0.0
# if the runner image does not have them (docs/android/PLAN.md section 6.8).
set -euo pipefail
: "${ANDROID_HOME:?ANDROID_HOME is not set}"
SDKM="$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager"
need=()
[ -d "$ANDROID_HOME/platforms/android-36" ] || need+=("platforms;android-36")
[ -d "$ANDROID_HOME/build-tools/36.0.0" ] || need+=("build-tools;36.0.0")
if [ "${#need[@]}" -eq 0 ]; then
  echo "sdk-packages: platform 36 and build-tools 36.0.0 are present"
  exit 0
fi
echo "sdk-packages: installing ${need[*]}"
yes | "$SDKM" --licenses >/dev/null || true
"$SDKM" --install "${need[@]}"
