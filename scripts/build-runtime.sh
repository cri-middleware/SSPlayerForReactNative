#!/bin/bash
#
# Build the Brain (libssruntime) from the SpriteStudio-SDK submodule and place it
# where the npm package's native builds expect it.
#
# This is the DEVELOPER path, for when you are changing the Brain. The normal
# path is `scripts/download-sdk.sh`, which pulls the pinned SDK release and
# needs no Rust toolchain at all (design doc ch.7).
#
# Both produce the SAME layout under native/ — the one the release archive
# already has — so the podspec and the Android CMake never need to know which
# one ran.
#
# We take the STATIC slices on purpose (design doc ch.7): the iOS podspec vendors
# `libssruntime.xcframework` (a `.a` per platform variant) and the Android CMake
# links `libssruntime.a` into the Nitro module's own `.so`. Same choice as the
# Unity and Godot Players; the dynamic build exists for Ren'Py.
#
# Usage: scripts/build-runtime.sh [platform=<p>] [build=<m>] [ndk=<path>]
#   platform : ios | android | all        (default: all)
#   build    : debug | release            (default: debug)
#   ndk      : Android NDK root           (default: $ANDROID_NDK_HOME if it
#              exists, else the newest under $ANDROID_HOME/ndk)
#
# Outputs (all under packages/react-native-ssplayer/native/, git-ignored):
#   native/include/ssruntime.h                      <- cbindgen output, C-API header
#   native/libs/ios/libssruntime.xcframework        <- device arm64 + simulator fat
#   native/libs/android/arm64-v8a/libssruntime.a
#   native/libs/android/armeabi-v7a/libssruntime.a
#   native/libs/android/x86_64/libssruntime.a
#   native/VERSION                                  <- "<tag>+submodule-<sha>"
#
# Prerequisites:
#   ios      : Xcode, rustup targets aarch64-apple-ios{,-sim} x86_64-apple-ios
#   android  : Android NDK, `cargo install cargo-ndk`, rustup targets
#              aarch64-linux-android armv7-linux-androideabi x86_64-linux-android

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd -P)
ROOT_DIR=$(cd "$SCRIPT_DIR/.." && pwd -P)
SDK_DIR="$ROOT_DIR/SpriteStudio-SDK"
DEST="$ROOT_DIR/packages/react-native-ssplayer/native"

# The pinned SDK release tag. Single source of truth for "which libssruntime is
# this Player built against" — the .ssab format and the C-API are both tied to
# it (design doc ch.7), so the README's compatibility table quotes this file.
SDK_VERSION_FILE="$SCRIPT_DIR/SDK_VERSION.txt"

PLATFORM="all"
BUILD_MODE="debug"
NDK_OVERRIDE=""

usage() { sed -n '/^# Usage:/,/^# Prerequisites:/p' "$0" | sed 's/^# \{0,1\}//'; }

for item in "$@"; do
  case "$item" in
    platform=*) PLATFORM="${item#platform=}" ;;
    build=*)    BUILD_MODE="${item#build=}" ;;
    ndk=*)      NDK_OVERRIDE="${item#ndk=}" ;;
    -h|--help|help) usage; exit 0 ;;
    *) echo "build-runtime.sh: unknown arg '$item'" >&2; usage; exit 2 ;;
  esac
done

case "$BUILD_MODE" in
  debug|release) ;;
  *) echo "build-runtime.sh: build must be debug or release (got '$BUILD_MODE')" >&2; exit 2 ;;
esac

if [ ! -f "$SDK_DIR/Cargo.toml" ]; then
  echo "build-runtime.sh: SpriteStudio-SDK submodule is empty." >&2
  echo "  run: git submodule update --init --recursive" >&2
  exit 1
fi

log() { printf '==> %s\n' "$*"; }

# The C-API header is emitted by libs/ssruntime/build.rs (cbindgen) on every
# cargo build, so it always exists by the time a platform build finishes. It is
# platform-agnostic — one copy serves both the podspec and the Android CMake.
place_header() {
  local src="$SDK_DIR/libs/ssruntime/target/ssruntime.h"
  [ -f "$src" ] || { echo "build-runtime.sh: expected cbindgen header at $src" >&2; exit 1; }
  mkdir -p "$DEST/include"
  cp "$src" "$DEST/include/ssruntime.h"
  log "header  -> native/include/ssruntime.h"
}

# Stamp the version next to the binaries it describes — the same file
# download-sdk.sh writes, and the one the podspec and Android CMake read.
#
# The stamp is "<pinned tag>+submodule-<sha>", never the bare tag. Two reasons:
# it is honest about what these binaries actually are, and download-sdk.sh's
# skip check compares against the bare tag — so a later download-sdk.sh run
# replaces a local build instead of leaving it in place while calling it the
# release.
place_version() {
  [ -f "$SDK_VERSION_FILE" ] || { echo "build-runtime.sh: missing $SDK_VERSION_FILE" >&2; exit 1; }
  local tag sha
  tag=$(tr -d ' \r\n' < "$SDK_VERSION_FILE")
  sha=$(cd "$SDK_DIR" && git rev-parse --short HEAD 2>/dev/null || echo unknown)
  mkdir -p "$DEST"
  printf '%s+submodule-%s\n' "$tag" "$sha" > "$DEST/VERSION"
  log "version -> native/VERSION ($tag+submodule-$sha)"
}

build_ios() {
  log "ios ($BUILD_MODE): delegating to SDK scripts/release-ios-xcframework.sh"
  ( cd "$SDK_DIR" && bash scripts/release-ios-xcframework.sh "$BUILD_MODE" )

  local src="$SDK_DIR/target/xcframework/static/libssruntime.xcframework"
  [ -d "$src" ] || { echo "build-runtime.sh: missing $src" >&2; exit 1; }

  mkdir -p "$DEST/libs/ios"
  rm -rf "$DEST/libs/ios/libssruntime.xcframework"
  cp -R "$src" "$DEST/libs/ios/"
  log "ios     -> native/libs/ios/libssruntime.xcframework"
}

# cargo-ndk reads ANDROID_NDK_HOME. A shell profile pointing at an NDK that is
# not installed makes it fail with a bare "No such file or directory", so resolve
# a usable root here instead: the explicit ndk= argument, then the environment if
# it actually exists, then the newest side-by-side install under $ANDROID_HOME.
resolve_ndk() {
  local candidate
  for candidate in "$NDK_OVERRIDE" "${ANDROID_NDK_HOME:-}" "${ANDROID_NDK_ROOT:-}"; do
    if [ -n "$candidate" ] && [ -f "$candidate/source.properties" ]; then
      printf '%s' "$candidate"
      return 0
    fi
  done

  local sdk="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/Library/Android/sdk}}"
  candidate=$(ls -d "$sdk"/ndk/*/ 2>/dev/null | sort -V | tail -1)
  if [ -n "$candidate" ] && [ -f "${candidate}source.properties" ]; then
    printf '%s' "${candidate%/}"
    return 0
  fi

  echo "build-runtime.sh: no Android NDK found." >&2
  echo "  set ANDROID_NDK_HOME, or pass ndk=/path/to/android-ndk" >&2
  return 1
}

build_android() {
  local ndk
  ndk=$(resolve_ndk)
  export ANDROID_NDK_HOME="$ndk"
  export ANDROID_NDK_ROOT="$ndk"
  log "android ($BUILD_MODE): NDK $ndk"
  log "android ($BUILD_MODE): delegating to SDK scripts/release-android.sh"
  ( cd "$SDK_DIR" && bash scripts/release-android.sh "$BUILD_MODE" )

  local pair triple abi src
  for pair in \
      "aarch64-linux-android:arm64-v8a" \
      "armv7-linux-androideabi:armeabi-v7a" \
      "x86_64-linux-android:x86_64"; do
    triple="${pair%%:*}"
    abi="${pair##*:}"
    src="$SDK_DIR/target/$triple/$BUILD_MODE/libssruntime.a"
    [ -f "$src" ] || { echo "build-runtime.sh: missing $src" >&2; exit 1; }
    mkdir -p "$DEST/libs/android/$abi"
    cp "$src" "$DEST/libs/android/$abi/libssruntime.a"
    log "android -> native/libs/android/$abi/libssruntime.a"
  done
}

case "$PLATFORM" in
  ios)     build_ios ;;
  android) build_android ;;
  all)     build_ios; build_android ;;
  *) echo "build-runtime.sh: platform must be ios, android or all (got '$PLATFORM')" >&2; exit 2 ;;
esac

place_header
place_version
log "done ($PLATFORM, $BUILD_MODE)"
