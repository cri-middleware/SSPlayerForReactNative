#!/bin/bash
#
# Guards the slot stepping rule: instance and effect slots step from the part
# list, never from `draw_order`, and a hidden effect part's step builds no
# particles yet loses no time. See tools/sshidden_check.cpp for why that is the
# rule and what a regression looks like.
#
# Host-only, and needs no flatc: it builds against the committed cpp/format/
# headers and the host libssruntime, like the ASan half of check-framedata.sh.
#
# Usage: tools/check-hidden.sh [ssab] [animation] [ticks] [effect-ssab] [effect-animation]
#   ssab              default: example/assets/ss/overall/Instance.ssab
#   animation         default: anime_1
#   ticks             default: 130
#   effect-ssab       default: example/assets/ss/overall/Effect.ssab
#   effect-animation  default: anime_1

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd -P)
ROOT_DIR=$(cd "$SCRIPT_DIR/.." && pwd -P)
SDK_DIR="$ROOT_DIR/SpriteStudio-SDK"
BUILD_DIR="$ROOT_DIR/tools/.build"
PKG_DIR="$ROOT_DIR/packages/react-native-spritestudio"

SSAB="${1:-$ROOT_DIR/example/assets/ss/overall/Instance.ssab}"
ANIMATION="${2:-anime_1}"
TICKS="${3:-130}"
EFFECT_SSAB="${4:-$ROOT_DIR/example/assets/ss/overall/Effect.ssab}"
EFFECT_ANIMATION="${5:-anime_1}"

NATIVE_INCLUDE="$PKG_DIR/native/include"
[ -f "$NATIVE_INCLUDE/ssruntime.h" ] || {
  echo "check-hidden.sh: $NATIVE_INCLUDE/ssruntime.h not found — run: pnpm run download-sdk" >&2
  exit 1
}

mkdir -p "$BUILD_DIR"

echo "==> building host libssruntime"
( cd "$SDK_DIR" && cargo build -q -p ssruntime-ffi --features libc_alloc,panic-handler )

echo "==> compiling sshidden_check"
# The vendored flatbuffers headers: this reads FrameData through the committed
# cpp/format/, which is what the package ships against.
clang++ -std=c++17 -O1 -g -fsanitize=address,undefined \
  -I"$PKG_DIR/third_party/flatbuffers/include" \
  -I"$NATIVE_INCLUDE" \
  -I"$PKG_DIR/cpp" \
  "$SCRIPT_DIR/sshidden_check.cpp" \
  "$PKG_DIR/cpp/SsEffect.cpp" \
  "$PKG_DIR/cpp/SsInstance.cpp" \
  "$PKG_DIR/cpp/SsMask.cpp" \
  "$SDK_DIR/target/debug/libssruntime.a" \
  -o "$BUILD_DIR/sshidden_check"

echo "==> running against $(basename "$SSAB") / $ANIMATION," \
  "$(basename "$EFFECT_SSAB") / $EFFECT_ANIMATION"
( cd "$ROOT_DIR" && "$BUILD_DIR/sshidden_check" "$SSAB" "$ANIMATION" "$TICKS" \
    "$EFFECT_SSAB" "$EFFECT_ANIMATION" )
