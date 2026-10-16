#!/bin/bash
#
# Guards the `ss-*` integration-shader path — the compile and the arithmetic,
# which nothing else reaches. See tools/ssshader_check.cpp for why the runtime's
# own fallback makes a broken shader invisible.
#
# macOS only, same reason as check-mask.sh: it links the host `libskia.a` that
# RN Skia ships, which has a macOS slice and no Linux one. Needs `pnpm install`
# for that library; unlike the other two checks it needs neither flatc nor a
# Rust toolchain, because it never loads a `.ssab`.
#
# Usage: tools/check-shader.sh

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd -P)
ROOT_DIR=$(cd "$SCRIPT_DIR/.." && pwd -P)
BUILD_DIR="$ROOT_DIR/tools/.build"
PKG_DIR="$ROOT_DIR/packages/react-native-spritestudio"
# Resolved as Node would from the package: under pnpm neither RN Skia nor its
# macOS binaries sit in the root node_modules.
resolve_pkg() { (cd "$2" && node -p "require('path').dirname(require.resolve('$1/package.json'))" 2> /dev/null) || true; }
RNSKIA=$(resolve_pkg react-native-skia "$PKG_DIR")

[ "$(uname)" = "Darwin" ] || { echo "check-shader.sh: macOS only (RN Skia ships no host libskia for this platform)" >&2; exit 1; }

[ -n "$RNSKIA" ] || { echo "check-shader.sh: react-native-skia is not installed — run pnpm install" >&2; exit 1; }

# Two places, because RN Skia keeps its binaries out of the main package:
# `react-native-skia-graphite-apple-macos` is RN Skia's own dependency, and the
# podspec copies it into `react-native-skia/libs/macos/` — so that copy exists
# only once a `pod install` has run. Prefer it anyway, so the check links what
# the app links.
SKIA_LIB="$RNSKIA/libs/macos/libskia.xcframework/macos-arm64_x86_64/libskia.a"
SKIA_PKG="$(resolve_pkg react-native-skia-graphite-apple-macos "$RNSKIA")/libs/libskia.xcframework/macos-arm64_x86_64/libskia.a"
[ -f "$SKIA_LIB" ] || SKIA_LIB="$SKIA_PKG"
[ -f "$SKIA_LIB" ] || { echo "check-shader.sh: no host libskia at $SKIA_PKG — run pnpm install" >&2; exit 1; }

mkdir -p "$BUILD_DIR"

echo "==> compiling ssshader_check"
# The vendored flatbuffers headers: `SsPartColor.hpp` reads its coefficient row
# out of `format/framedata.h`, so the FrameData accessors are on the path even
# though this check never opens a `.ssab`.
# The defines RN Skia builds libskia with, so this unit declares Skia the way
# the library was compiled.
clang++ -std=c++20 -O1 -g \
  -DSK_GRAPHITE=1 -DSK_IMAGE_READ_PIXELS_DISABLE_LEGACY_API=1 -DSK_DISABLE_LEGACY_SHAPER_FACTORY=1 \
  -I"$RNSKIA/cpp/skia" \
  -I"$PKG_DIR/third_party/flatbuffers/include" \
  -I"$PKG_DIR/cpp" \
  "$SCRIPT_DIR/ssshader_check.cpp" \
  "$SKIA_LIB" \
  -framework CoreFoundation -framework CoreGraphics -framework CoreText -framework CoreServices \
  -o "$BUILD_DIR/ssshader_check"

echo "==> running"
"$BUILD_DIR/ssshader_check"
