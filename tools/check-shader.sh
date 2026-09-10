#!/bin/bash
#
# Guards the `ss-*` integration-shader path — the compile and the arithmetic,
# which nothing else reaches. See tools/ssshader_check.cpp for why the runtime's
# own fallback makes a broken shader invisible.
#
# macOS only, same reason as check-mask.sh: it links the host `libskia.a` that
# RN Skia ships, which has a macOS slice and no Linux one. Needs `npm install`
# for that library; unlike the other two checks it needs neither flatc nor a
# Rust toolchain, because it never loads a `.ssab`.
#
# Usage: tools/check-shader.sh

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd -P)
ROOT_DIR=$(cd "$SCRIPT_DIR/.." && pwd -P)
BUILD_DIR="$ROOT_DIR/tools/.build"
PKG_DIR="$ROOT_DIR/packages/react-native-spritestudio"
RNSKIA="$ROOT_DIR/node_modules/@shopify/react-native-skia"

[ "$(uname)" = "Darwin" ] || { echo "check-shader.sh: macOS only (RN Skia ships no host libskia for this platform)" >&2; exit 1; }

# Two places, because RN Skia 2.11 moved the binaries out of the main package:
# `react-native-skia-apple-macos` is what npm installs, and the podspec copies it
# into `@shopify/react-native-skia/libs/macos/` — so that copy exists only once a
# `pod install` has run. Prefer it anyway, so the check links what the app links.
SKIA_LIB="$RNSKIA/libs/macos/libskia.xcframework/macos-arm64_x86_64/libskia.a"
SKIA_PKG="$ROOT_DIR/node_modules/react-native-skia-apple-macos/libs/libskia.xcframework/macos-arm64_x86_64/libskia.a"
[ -f "$SKIA_LIB" ] || SKIA_LIB="$SKIA_PKG"
[ -f "$SKIA_LIB" ] || { echo "check-shader.sh: no host libskia at $SKIA_PKG — run npm install" >&2; exit 1; }

mkdir -p "$BUILD_DIR"

echo "==> compiling ssshader_check"
# The vendored flatbuffers headers: `SsPartColor.hpp` reads its coefficient row
# out of `format/framedata.h`, so the FrameData accessors are on the path even
# though this check never opens a `.ssab`.
clang++ -std=c++20 -O1 -g \
  -I"$RNSKIA/cpp/skia" \
  -I"$PKG_DIR/third_party/flatbuffers/include" \
  -I"$PKG_DIR/cpp" \
  "$SCRIPT_DIR/ssshader_check.cpp" \
  "$SKIA_LIB" \
  -framework CoreFoundation -framework CoreGraphics -framework CoreText -framework CoreServices \
  -o "$BUILD_DIR/ssshader_check"

echo "==> running"
"$BUILD_DIR/ssshader_check"
