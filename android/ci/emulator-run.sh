#!/usr/bin/env bash
# CI only (GitHub runner): run the device tests of Adgecko Shield on an
# Android emulator (docs/android/PLAN.md section 6.8, E2 and E3).
#   bash android/ci/emulator-run.sh <api level>
# Steps: KVM, emulator and system image, AVD, boot, then
#   :app:connectedDebugAndroidTest (vector runner on ART)
#   :app:installDebug :probe:connectedDebugAndroidTest (VPN test from another app)
# logcat goes to android/build/ci/ also on a failure.
# The KVM udev steps and the image names are from memory (plan 11.3).
set -euo pipefail
API="${1:?usage: emulator-run.sh <api level>}"
: "${ANDROID_HOME:?ANDROID_HOME is not set}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="$ROOT/android/build/ci"
mkdir -p "$OUT"
SDKM="$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager"
AVDM="$ANDROID_HOME/cmdline-tools/latest/bin/avdmanager"
ADB="$ANDROID_HOME/platform-tools/adb"
IMAGE="system-images;android-${API};google_apis;x86_64"

echo "== KVM"
echo 'KERNEL=="kvm", GROUP="kvm", MODE="0666", OPTIONS+="static_node=kvm"' | sudo tee /etc/udev/rules.d/99-kvm4all.rules >/dev/null
sudo udevadm control --reload-rules
sudo udevadm trigger --name-match=kvm
ls -l /dev/kvm || true

echo "== SDK packages: emulator, platform-tools, $IMAGE"
yes | "$SDKM" --licenses >/dev/null || true
"$SDKM" --install "emulator" "platform-tools" "$IMAGE" >/dev/null

echo "== AVD"
echo "no" | "$AVDM" create avd --force -n shield -k "$IMAGE" >/dev/null

save_logcat() {
  "$ADB" logcat -d > "$OUT/logcat-api${API}.txt" 2>/dev/null || true
  "$ADB" logcat -d -s AdgeckoShield:V AdgeckoShieldProbe:V > "$OUT/logcat-shield-api${API}.txt" 2>/dev/null || true
  "$ADB" emu kill >/dev/null 2>&1 || true
}
trap save_logcat EXIT

echo "== Boot"
"$ANDROID_HOME/emulator/emulator" -avd shield -no-window -no-audio -no-boot-anim -no-snapshot \
  -gpu swiftshader_indirect -camera-back none -camera-front none > "$OUT/emulator-api${API}.txt" 2>&1 &
"$ADB" wait-for-device
booted=""
for _ in $(seq 1 180); do
  booted="$("$ADB" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')"
  [ "$booted" = "1" ] && break
  sleep 5
done
if [ "$booted" != "1" ]; then
  echo "emulator did not boot within 15 minutes (infrastructure failure)"
  exit 3
fi
"$ADB" shell settings put global window_animation_scale 0
"$ADB" shell settings put global transition_animation_scale 0
"$ADB" shell settings put global animator_duration_scale 0
"$ADB" shell input keyevent 82 || true
echo "API $API booted. Private DNS mode: $("$ADB" shell settings get global private_dns_mode | tr -d '\r')"

cd "$ROOT"
status=0
echo "== E2: vector runner on ART"
./android/gradlew -p android --no-daemon :app:connectedDebugAndroidTest || status=1
echo "== E3: VPN test from the probe app"
./android/gradlew -p android --no-daemon :app:installDebug :probe:connectedDebugAndroidTest || status=1
exit "$status"
