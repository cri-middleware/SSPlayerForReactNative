#!/bin/bash
#
# Compiles the Nitro glue on the host, so a change confined to it is caught
# without an iOS or an Android build: HybridSs*.cpp, SsAssets.cpp,
# SsRNSkiaInterop.cpp, SsPlayerJni.cpp and nitrogen/generated/. The other
# cpp/ units have checks of their own (check-framedata, check-mask, ...).
#
# A syntax check (-fsyntax-only), not a link: it says nothing about whether a
# platform build links, and the Kotlin under android/src needs Gradle either way.
#
# Two halves, each skipped with a note when its toolchain is missing:
#
#   * iOS — Xcode's clang against the iphoneos SDK, macOS only: the cpp/ units,
#     nitrogen/generated/shared, and nitrogen/generated/ios's .cpp and .mm.
#   * Android — the NDK's clang for arm64: the cpp/ units, SsPlayerJni.cpp,
#     nitrogen/generated/shared and nitrogen/generated/android. SsPlayerJni.cpp
#     and the generated OnLoad also need the fbjni headers, which only a Gradle
#     build unpacks; without one they are skipped.
#
# Every cpp/ unit twice, with direct Skia drawing on and off, because the
# podspec and CMakeLists.txt build it either way.
#
# `<NitroModules/…>` is the one include no search path reaches: CocoaPods' header
# map and the Android prefab flatten Nitro's cpp/ and its platform sources into
# one directory. This builds the same flat directory out of symlinks.
#
# Usage: tools/check-glue.sh [ndk=<path>]
#   ndk  Android NDK root (default: $ANDROID_NDK_HOME, else the newest under
#        $ANDROID_HOME/ndk or the SDK's default location)

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd -P)
ROOT_DIR=$(cd "$SCRIPT_DIR/.." && pwd -P)
PKG_DIR="$ROOT_DIR/packages/react-native-spritestudio"
BUILD_DIR="$ROOT_DIR/tools/.build/glue"
GEN_DIR="$PKG_DIR/nitrogen/generated"

NDK_OVERRIDE=""
for arg in "$@"; do
  case "$arg" in
    ndk=*) NDK_OVERRIDE="${arg#ndk=}" ;;
    *) echo "check-glue.sh: unknown argument '$arg' (usage: tools/check-glue.sh [ndk=<path>])" >&2; exit 2 ;;
  esac
done

# Resolved as Node would from the package: under pnpm nothing is hoisted.
resolve_pkg() { (cd "$2" && node -p "require('path').dirname(require.resolve('$1/package.json'))" 2> /dev/null) || true; }
NITRO=$(resolve_pkg react-native-nitro-modules "$PKG_DIR")
RN=$(resolve_pkg react-native "$PKG_DIR")
RNSKIA=$(resolve_pkg @shopify/react-native-skia "$PKG_DIR")
for pair in "react-native-nitro-modules:$NITRO" "react-native:$RN" "@shopify/react-native-skia:$RNSKIA"; do
  [ -n "${pair#*:}" ] || { echo "check-glue.sh: ${pair%%:*} is not installed — run pnpm install" >&2; exit 1; }
done
[ -f "$PKG_DIR/native/include/ssruntime.h" ] || {
  echo "check-glue.sh: native/include/ssruntime.h not found — run: pnpm run download-sdk" >&2
  exit 1
}

# One flat NitroModules/ per platform: Nitro's cpp/, then that platform's
# sources over it — the two platforms each have a UIThreadDispatcher.hpp.
flatten() {
  local out="$BUILD_DIR/$1/NitroModules"
  shift
  rm -rf "$out"
  mkdir -p "$out"
  local dir file
  for dir in "$@"; do
    while IFS= read -r file; do
      ln -sf "$file" "$out/$(basename "$file")"
    done < <(find "$dir" -name '*.hpp' -o -name '*.h')
  done
}

SDK_VERSION=$(tr -d '[:space:]' < "$ROOT_DIR/scripts/SDK_VERSION.txt")
COMMON=(
  -std=c++20 -fsyntax-only
  "-DSSPLAYER_SDK_VERSION=\"$SDK_VERSION\""
  -I"$PKG_DIR/cpp" -I"$GEN_DIR/shared/c++"
  -I"$PKG_DIR/native/include" -I"$PKG_DIR/third_party/flatbuffers/include"
  -I"$RN/ReactCommon/jsi" -I"$RN/ReactCommon" -I"$RN/ReactCommon/callinvoker"
)
# The three directories both platform builds add for RN Skia.
SKIA_ON=(-DSSPLAYER_ENABLE_SKIA_DIRECT=1 -I"$RNSKIA/cpp" -I"$RNSKIA/cpp/api" -I"$RNSKIA/cpp/skia")
SKIA_OFF=(-DSSPLAYER_ENABLE_SKIA_DIRECT=0)

CPP_UNITS=(HybridSsContext HybridSsResource HybridSsRuntime SsAssets SsRNSkiaInterop)

failures=0
checked=0
# check <label> <compiler...> -- <args...>
check() {
  local label="$1"
  shift
  local log="$BUILD_DIR/last.log"
  if "$@" > "$log" 2>&1; then
    checked=$((checked + 1))
  else
    failures=$((failures + 1))
    echo "  FAIL $label"
    grep -m 5 'error' "$log" | sed 's/^/       /'
  fi
}

mkdir -p "$BUILD_DIR"

# --- iOS ---------------------------------------------------------------------
echo "==> iOS"
if [ "$(uname)" = "Darwin" ] && IOS_SDK=$(xcrun --sdk iphoneos --show-sdk-path 2> /dev/null); then
  flatten ios "$NITRO/cpp" "$NITRO/ios"
  IOS_MIN=$(sed -n 's/.*:ios => "\([0-9.]*\)".*/\1/p' "$PKG_DIR/SsPlayer.podspec")
  IOS=(xcrun --sdk iphoneos clang++ -target "arm64-apple-ios${IOS_MIN}" -isysroot "$IOS_SDK"
       "${COMMON[@]}" -I"$BUILD_DIR/ios" -I"$GEN_DIR/ios")
  for unit in "${CPP_UNITS[@]}"; do
    check "ios $unit.cpp (Skia on)" "${IOS[@]}" "${SKIA_ON[@]}" "$PKG_DIR/cpp/$unit.cpp"
    check "ios $unit.cpp (Skia off)" "${IOS[@]}" "${SKIA_OFF[@]}" "$PKG_DIR/cpp/$unit.cpp"
  done
  for file in "$GEN_DIR"/shared/c++/*.cpp "$GEN_DIR"/ios/*.cpp; do
    check "ios ${file#"$GEN_DIR"/}" "${IOS[@]}" "${SKIA_OFF[@]}" "$file"
  done
  for file in "$GEN_DIR"/ios/*.mm; do
    check "ios ${file#"$GEN_DIR"/}" "${IOS[@]}" "${SKIA_OFF[@]}" -x objective-c++ "$file"
  done
else
  echo "  SKIPPED: needs macOS and Xcode's iphoneos SDK."
fi

# --- Android -----------------------------------------------------------------
echo "==> Android"
resolve_ndk() {
  local candidate
  for candidate in "$NDK_OVERRIDE" "${ANDROID_NDK_HOME:-}" "${ANDROID_NDK_ROOT:-}"; do
    [ -n "$candidate" ] && [ -d "$candidate/toolchains" ] && { echo "$candidate"; return; }
  done
  local sdk
  for sdk in "${ANDROID_HOME:-}" "${ANDROID_SDK_ROOT:-}" "$HOME/Library/Android/sdk" "$HOME/Android/Sdk"; do
    [ -n "$sdk" ] || continue
    candidate=$(ls -d "$sdk"/ndk/*/ 2> /dev/null | sort -V | tail -1 || true)
    [ -n "$candidate" ] && { echo "${candidate%/}"; return; }
  done
  # Found nothing: an empty answer, not a failure — `set -e` would end the
  # script here, silently, instead of reporting the half skipped.
  return 0
}
NDK=$(resolve_ndk)
NDK_CXX=""
[ -n "$NDK" ] && NDK_CXX=$(ls "$NDK"/toolchains/llvm/prebuilt/*/bin/clang++ 2> /dev/null | head -1 || true)
if [ -n "$NDK_CXX" ]; then
  flatten android "$NITRO/cpp" "$NITRO/android/src/main/cpp"
  # The definitions nitrogen's generated CMake adds to the whole library, read
  # out of it so a regeneration that changes them is followed here too.
  GEN_DEFINES=()
  while IFS= read -r define; do
    GEN_DEFINES+=("$define")
  done < <(grep -o -e '-D[A-Za-z_][A-Za-z0-9_]*\(=[0-9]*\)\{0,1\}' "$GEN_DIR/android/SsPlayer+autolinking.cmake")
  # The API level CMakeLists.txt inherits from the app is at least 24.
  ANDROID=("$NDK_CXX" --target=aarch64-linux-android24 "${COMMON[@]}" "${GEN_DEFINES[@]}"
           -I"$BUILD_DIR/android")
  for unit in "${CPP_UNITS[@]}"; do
    check "android $unit.cpp (Skia on)" "${ANDROID[@]}" "${SKIA_ON[@]}" "$PKG_DIR/cpp/$unit.cpp"
    check "android $unit.cpp (Skia off)" "${ANDROID[@]}" "${SKIA_OFF[@]}" "$PKG_DIR/cpp/$unit.cpp"
  done
  for file in "$GEN_DIR"/shared/c++/*.cpp; do
    check "android ${file#"$GEN_DIR"/}" "${ANDROID[@]}" "${SKIA_OFF[@]}" "$file"
  done
  # Only a Gradle build unpacks fbjni's prefab; the newest such unpacking wins.
  FBJNI=$(ls -td "$HOME"/.gradle/caches/*/transforms/*/transformed/fbjni-*/prefab/modules/fbjni/include \
            2> /dev/null | head -1 || true)
  if [ -n "$FBJNI" ]; then
    JNI=("${ANDROID[@]}" "${SKIA_OFF[@]}" -I"$FBJNI" -I"$GEN_DIR/android")
    check "android SsPlayerJni.cpp" "${JNI[@]}" "$PKG_DIR/cpp/SsPlayerJni.cpp"
    for file in "$GEN_DIR"/android/*.cpp; do
      check "android ${file#"$GEN_DIR"/}" "${JNI[@]}" "$file"
    done
  else
    echo "  SKIPPED SsPlayerJni.cpp and nitrogen/generated/android: no fbjni headers"
    echo "  in ~/.gradle/caches. One Android build (pnpm run run-android) unpacks them."
  fi
else
  echo "  SKIPPED: no Android NDK found. Set ANDROID_NDK_HOME, or pass ndk=<path>."
fi

if [ "$failures" -gt 0 ]; then
  echo ""
  echo "FAILED: $failures of $((checked + failures)) units did not compile" >&2
  exit 1
fi
echo ""
echo "OK: $checked units compile"
