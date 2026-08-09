#!/bin/bash
#
# Build and run tools/ssbake_check.cpp — the guard that keeps the hand-written
# FlatBuffers offsets in cpp/SsFrameData.hpp in agreement with framedata.fbs.
#
# Host-only, and it is the *only* place flatc and the flatbuffers headers are
# needed: the shipped package deliberately has neither as a dependency.
#
# Usage: tools/check-framedata.sh [ssab] [animation] [frames]
#   ssab       default: example/assets/ss/Ringo/Ringo.ssab
#   animation  default: dance
#   frames     default: 300
#
# Prerequisites: flatc and the flatbuffers C++ headers (brew install flatbuffers).

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd -P)
ROOT_DIR=$(cd "$SCRIPT_DIR/.." && pwd -P)
SDK_DIR="$ROOT_DIR/SpriteStudio-SDK"
BUILD_DIR="$ROOT_DIR/tools/.build"

SSAB="${1:-$ROOT_DIR/example/assets/ss/Ringo/Ringo.ssab}"
ANIMATION="${2:-dance}"
FRAMES="${3:-300}"

command -v flatc >/dev/null || { echo "check-framedata.sh: flatc not found (brew install flatbuffers)" >&2; exit 1; }

# Where brew keeps flatbuffers/flatbuffers.h.
FB_INCLUDE=$(brew --prefix flatbuffers 2>/dev/null)/include
[ -d "$FB_INCLUDE" ] || FB_INCLUDE=$(brew --prefix 2>/dev/null)/include
[ -f "$FB_INCLUDE/flatbuffers/flatbuffers.h" ] || {
  echo "check-framedata.sh: flatbuffers headers not found under $FB_INCLUDE" >&2
  exit 1
}

mkdir -p "$BUILD_DIR"

echo "==> generating framedata_generated.h"
flatc --cpp -o "$BUILD_DIR" "$SDK_DIR/libs/ssruntime/fbs/framedata.fbs"

echo "==> building host libssruntime"
# ssruntime is no_std by default; the same two features the SDK's own
# release-*.sh pass are what supply the allocator and the panic handler.
( cd "$SDK_DIR" && cargo build -q -p ssruntime --features libc_alloc,panic-handler )

echo "==> compiling ssbake_check"
clang++ -std=c++17 -O1 -g -fsanitize=address,undefined \
  -I"$BUILD_DIR" -I"$FB_INCLUDE" \
  "$SCRIPT_DIR/ssbake_check.cpp" \
  "$ROOT_DIR/packages/react-native-spritestudio/cpp/SsBaker.cpp" \
  "$SDK_DIR/target/debug/libssruntime.a" \
  -o "$BUILD_DIR/ssbake_check"

echo "==> running against $(basename "$SSAB") / $ANIMATION"
"$BUILD_DIR/ssbake_check" "$SSAB" "$ANIMATION" "$FRAMES"
