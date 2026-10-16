#!/bin/bash
#
# Guards when a root player keeps ticking: `cpp/SsTick.hpp`'s rule, run against
# the host Brain on a stack laid case by case. See tools/ssmotion_check.cpp for
# what a regression looks like either way.
#
# Host-only, and needs neither flatc nor Skia: it builds against the committed
# cpp/format/ headers and the host libssruntime, like check-hidden.sh.
#
# Usage: tools/check-motion.sh [ssab] [once-animation] [loop-animation]
#   ssab            default: example/assets/ss/Ringo/Ringo.ssab
#   once-animation  default: attack1
#   loop-animation  default: wait1

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd -P)
ROOT_DIR=$(cd "$SCRIPT_DIR/.." && pwd -P)
SDK_DIR="$ROOT_DIR/SpriteStudio-SDK"
BUILD_DIR="$ROOT_DIR/tools/.build"
PKG_DIR="$ROOT_DIR/packages/react-native-spritestudio"

SSAB="${1:-$ROOT_DIR/example/assets/ss/Ringo/Ringo.ssab}"
ONCE="${2:-attack1}"
LOOP="${3:-wait1}"

NATIVE_INCLUDE="$PKG_DIR/native/include"
[ -f "$NATIVE_INCLUDE/ssruntime.h" ] || {
  echo "check-motion.sh: $NATIVE_INCLUDE/ssruntime.h not found — run: pnpm run download-sdk" >&2
  exit 1
}

mkdir -p "$BUILD_DIR"

echo "==> building host libssruntime"
( cd "$SDK_DIR" && cargo build -q -p ssruntime-ffi --features libc_alloc,panic-handler )

echo "==> compiling ssmotion_check"
clang++ -std=c++17 -O1 -g -fsanitize=address,undefined \
  -I"$PKG_DIR/third_party/flatbuffers/include" \
  -I"$NATIVE_INCLUDE" \
  -I"$PKG_DIR/cpp" \
  "$SCRIPT_DIR/ssmotion_check.cpp" \
  "$SDK_DIR/target/debug/libssruntime.a" \
  -o "$BUILD_DIR/ssmotion_check"

echo "==> running against $(basename "$SSAB") / $ONCE, $LOOP"
( cd "$ROOT_DIR" && "$BUILD_DIR/ssmotion_check" "$SSAB" "$ONCE" "$LOOP" )
