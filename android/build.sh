#!/bin/sh
set -eu
cd "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
: "${ANDROID_SDK_ROOT:?Set ANDROID_SDK_ROOT}"
: "${LUMAX_KEYSTORE:?Set LUMAX_KEYSTORE to your signing key}"
: "${LUMAX_KEY_ALIAS:=androiddebugkey}"
: "${LUMAX_KEYSTORE_PASS:?Set LUMAX_KEYSTORE_PASS}"
out="${1:-$(pwd)/build/lumax.apk}"
sdk="$ANDROID_SDK_ROOT"
tools="$sdk/build-tools/34.0.0"
platform="$sdk/platforms/android-34/android.jar"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT HUP INT TERM
mkdir -p "$tmp/classes" "$tmp/dex" "$tmp/assets" "$(dirname "$out")"
cp assets/* "$tmp/assets/"
cp ../src/com.spinoff.lumahome/assets/alpine.jpg "$tmp/assets/backdrop.jpg"
"$tools/aapt2" compile --dir res -o "$tmp/res.zip"
"$tools/aapt2" link --manifest AndroidManifest.xml -I "$platform" -A "$tmp/assets" \
  -o "$tmp/base.apk" "$tmp/res.zip"
javac --release 8 -classpath "$platform" -d "$tmp/classes" src/dev/lumax/*.java
jar cf "$tmp/classes.jar" -C "$tmp/classes" .
"$tools/d8" --lib "$platform" --min-api 26 --output "$tmp/dex" "$tmp/classes.jar"
(cd "$tmp/dex" && zip -q "$tmp/base.apk" classes.dex)
"$tools/zipalign" -f 4 "$tmp/base.apk" "$tmp/aligned.apk"
"$tools/apksigner" sign --ks "$LUMAX_KEYSTORE" --ks-key-alias "$LUMAX_KEY_ALIAS" \
  --ks-pass env:LUMAX_KEYSTORE_PASS --out "$out" "$tmp/aligned.apk"
"$tools/apksigner" verify "$out"
printf '%s\n' "$out"
