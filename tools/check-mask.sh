#!/bin/bash
#
# Guards the mask draw path — the Skia half, which `check-framedata.sh` does not
# reach. See tools/ssmask_check.cpp for what it checks and why each check exists.
#
# macOS only: it links the host `libskia.a` that RN Skia ships, which has a macOS
# slice and no Linux one. Needs `npm install` (for that library) and a Rust
# toolchain (for the host libssruntime, same as check-framedata.sh).
#
# Usage: tools/check-mask.sh [ssab] [animation] [frame]
#   ssab       default: example/assets/ss/overall/Mask.ssab
#   animation  default: anime_1
#   frame      default: 30

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd -P)
ROOT_DIR=$(cd "$SCRIPT_DIR/.." && pwd -P)
SDK_DIR="$ROOT_DIR/SpriteStudio-SDK"
BUILD_DIR="$ROOT_DIR/tools/.build"
PKG_DIR="$ROOT_DIR/packages/react-native-spritestudio"
RNSKIA="$ROOT_DIR/node_modules/@shopify/react-native-skia"

SSAB="${1:-$ROOT_DIR/example/assets/ss/overall/Mask.ssab}"
ANIMATION="${2:-anime_1}"
FRAME="${3:-30}"

[ "$(uname)" = "Darwin" ] || { echo "check-mask.sh: macOS only (RN Skia ships no host libskia for this platform)" >&2; exit 1; }

SKIA_LIB="$RNSKIA/libs/macos/libskia.xcframework/macos-arm64_x86_64/libskia.a"
[ -f "$SKIA_LIB" ] || { echo "check-mask.sh: $SKIA_LIB not found — run npm install" >&2; exit 1; }

mkdir -p "$BUILD_DIR"

echo "==> building host libssruntime"
( cd "$SDK_DIR" && cargo build -q -p ssruntime-ffi --features libc_alloc,panic-handler )

echo "==> compiling ssmask_check"
# SSPLAYER_ENABLE_SKIA_DIRECT=1 so the guarded draw path is the one under test —
# with it off, DrawBakedFrame is a stub that returns 0 and every check passes
# vacuously.
clang++ -std=c++20 -O1 -g \
  -DSSPLAYER_ENABLE_SKIA_DIRECT=1 \
  -I"$RNSKIA/cpp/skia" \
  -I"$PKG_DIR/third_party/flatbuffers/include" \
  -I"$PKG_DIR/cpp" \
  "$SCRIPT_DIR/ssmask_check.cpp" \
  "$PKG_DIR/cpp/SsBaker.cpp" \
  "$PKG_DIR/cpp/SsMask.cpp" \
  "$PKG_DIR/cpp/SsSkiaDraw.cpp" \
  "$SDK_DIR/target/debug/libssruntime.a" \
  "$SKIA_LIB" \
  -framework CoreFoundation -framework CoreGraphics -framework CoreText -framework CoreServices \
  -o "$BUILD_DIR/ssmask_check"

echo "==> running"
( cd "$ROOT_DIR" && "$BUILD_DIR/ssmask_check" "$SSAB" "$ANIMATION" "$FRAME" )
