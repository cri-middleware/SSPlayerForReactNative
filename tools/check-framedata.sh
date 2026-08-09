#!/bin/bash
#
# Guards the FrameData read path. Two checks, and they catch different things:
#
#   1. Regenerate `cpp/format/*.h` into a scratch dir and diff against the
#      committed headers. Catches schema drift — a `.fbs` change that nobody
#      regenerated for.
#   2. Build and run `tools/ssbake_check.cpp` against a real `.ssab`, under
#      ASan/UBSan, using the *committed* headers. Catches the case a diff cannot
#      see: headers that are internally consistent but stale relative to the
#      `libssruntime` in `native/`, which reads as a silently misread buffer.
#
# Host-only, and the only place flatc and the flatbuffers headers are needed as
# tools: the shipped package vendors the headers (third_party/flatbuffers) and
# has no flatc dependency.
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
FORMAT_DIR="$ROOT_DIR/packages/react-native-spritestudio/cpp/format"

SSAB="${1:-$ROOT_DIR/example/assets/ss/Ringo/Ringo.ssab}"
ANIMATION="${2:-dance}"
FRAMES="${3:-300}"

command -v flatc >/dev/null || { echo "check-framedata.sh: flatc not found (brew install flatbuffers)" >&2; exit 1; }

# Where brew keeps flatbuffers/flatbuffers.h. Only the host build needs this;
# the package builds against the vendored third_party/flatbuffers instead.
FB_INCLUDE=$(brew --prefix flatbuffers 2>/dev/null)/include
[ -d "$FB_INCLUDE" ] || FB_INCLUDE=$(brew --prefix 2>/dev/null)/include
[ -f "$FB_INCLUDE/flatbuffers/flatbuffers.h" ] || {
  echo "check-framedata.sh: flatbuffers headers not found under $FB_INCLUDE" >&2
  exit 1
}

mkdir -p "$BUILD_DIR"

echo "==> checking cpp/format/ is current"
# Same generator the real one runs, pointed at a scratch dir, so the two can
# never disagree about flatc's flags or the `_generated` rename.
rm -rf "$BUILD_DIR/format"
"$ROOT_DIR/scripts/generate-fbs-code.sh" "$BUILD_DIR/format" >/dev/null
if ! diff -ru "$FORMAT_DIR" "$BUILD_DIR/format"; then
  echo "" >&2
  echo "check-framedata.sh: cpp/format/ is stale — run: npm run generate-fbs-code" >&2
  exit 1
fi
echo "    up to date with $(basename "$SDK_DIR")'s schemas"

echo "==> building host libssruntime"
# ssruntime is no_std by default; the same two features the SDK's own
# release-*.sh pass are what supply the allocator and the panic handler.
( cd "$SDK_DIR" && cargo build -q -p ssruntime --features libc_alloc,panic-handler )

echo "==> compiling ssbake_check"
# `native/include` is cbindgen's `ssruntime.h`: the effect slots are a C-API
# client, and both this program and `cpp/SsEffect.cpp` include the real header
# rather than re-declaring the subset they use. That does tie the check to a
# `download-sdk` / `build-runtime` having run — which linking already did.
NATIVE_INCLUDE="$ROOT_DIR/packages/react-native-spritestudio/native/include"
[ -f "$NATIVE_INCLUDE/ssruntime.h" ] || {
  echo "check-framedata.sh: $NATIVE_INCLUDE/ssruntime.h not found — run: npm run download-sdk" >&2
  exit 1
}
clang++ -std=c++17 -O1 -g -fsanitize=address,undefined \
  -I"$FB_INCLUDE" -I"$NATIVE_INCLUDE" \
  "$SCRIPT_DIR/ssbake_check.cpp" \
  "$ROOT_DIR/packages/react-native-spritestudio/cpp/SsBaker.cpp" \
  "$ROOT_DIR/packages/react-native-spritestudio/cpp/SsEffect.cpp" \
  "$ROOT_DIR/packages/react-native-spritestudio/cpp/SsMask.cpp" \
  "$SDK_DIR/target/debug/libssruntime.a" \
  -o "$BUILD_DIR/ssbake_check"

echo "==> running against $(basename "$SSAB") / $ANIMATION"
"$BUILD_DIR/ssbake_check" "$SSAB" "$ANIMATION" "$FRAMES"
