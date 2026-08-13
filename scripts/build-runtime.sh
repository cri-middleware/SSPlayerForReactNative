#!/bin/bash
#
# Build the Brain (libssruntime) from the SpriteStudio-SDK submodule and install
# it into the npm package's native/ directory.
#
# This is the DEVELOPER path, for when you are changing the Brain itself. The
# normal path is scripts/download-sdk.sh, which installs the pinned SDK release
# and needs no Rust toolchain at all (design doc ch.7).
#
# Both write the SAME layout under packages/react-native-spritestudio/native/ — the
# one the release archive already has — so the podspec and the Android CMake
# never need to know which one ran:
#
#   native/libs/ios/libssruntime.xcframework   (device arm64 + simulator fat)
#   native/libs/android/<abi>/libssruntime.a   (arm64-v8a, armeabi-v7a, x86_64)
#   native/include/ssruntime.h                 (cbindgen output, the C-API)
#   (and *removes* native/VERSION and native/BUILD_MODE — see place_version)
#   native/LICENSE.md, native/THIRD-PARTY-LICENSES.ssruntime.md
#
# STATIC slices on purpose (design doc ch.7): the iOS podspec vendors the
# xcframework's `.a` slices and the Android CMake links libssruntime.a into the
# Nitro module's own .so. Same choice as the Unity and Godot Players; the
# dynamic build exists for Ren'Py.
#
# Usage: scripts/build-runtime.sh [platform=<p>] [build=<m>] [ndk=<path>]
#   platform : ios android all   (default: all)
#   build    : debug release     (default: debug)
#   ndk      : Android NDK root  (default: $ANDROID_NDK_HOME if it exists,
#              else the newest under $ANDROID_HOME/ndk)
#
# Measure in release. A debug libssruntime swamps every other cost and flattens
# the differences a benchmark exists to find (docs/phase0-spike.md).
#
# Prerequisites:
#   ios     : Xcode, rustup targets aarch64-apple-ios{,-sim} x86_64-apple-ios
#   android : Android NDK, `cargo install cargo-ndk`, rustup targets
#             aarch64-linux-android armv7-linux-androideabi x86_64-linux-android
#
# SDK location: $SSSDK, else ./SpriteStudio-SDK, else ../SpriteStudio-SDK.
set -euo pipefail

BASEDIR=$(dirname "$0")
SCRIPTDIR=$(cd "$BASEDIR" && pwd -P)
ROOTDIR=$(cd "$BASEDIR/.." && pwd -P)
APP=$(basename "$0")

TARGET_DIR="${ROOTDIR}/packages/react-native-spritestudio/native"
# The pinned SDK release tag, shared with download-sdk.sh. The .ssab format and
# the C-API are both tied to it (design doc ch.7).
VERSION_FILE="${SCRIPTDIR}/SDK_VERSION.txt"

PLATFORM="all"
BUILD_MODE="debug"
NDK_OVERRIDE=""

usage() {
    echo "Usage: ${APP} [options]"
    echo "Options:"
    echo "  platform=<platform>  Target platform (ios, android, all)"
    echo "  build=<build>        Build mode (debug, release)"
    echo "  ndk=<path>           Android NDK root"
}

for item in "$@"; do
    case "$item" in
        platform=*) PLATFORM="${item#platform=}" ;;
        build=*)    BUILD_MODE="${item#build=}" ;;
        ndk=*)      NDK_OVERRIDE="${item#ndk=}" ;;
        -h|--help|help) usage; exit 0 ;;
        *) echo "${APP}: unknown argument '${item}'" >&2; usage; exit 2 ;;
    esac
done

case "$BUILD_MODE" in
    debug|release) ;;
    *) echo "${APP}: build must be debug or release (got '${BUILD_MODE}')" >&2; exit 2 ;;
esac

SDK_DIR="${SSSDK:-}"
if [ -z "$SDK_DIR" ]; then
    for cand in "${ROOTDIR}/SpriteStudio-SDK" "${ROOTDIR}/../SpriteStudio-SDK"; do
        if [ -f "${cand}/Cargo.toml" ]; then SDK_DIR=$(cd "$cand" && pwd -P); break; fi
    done
fi
if [ -z "$SDK_DIR" ] || [ ! -f "${SDK_DIR}/Cargo.toml" ]; then
    echo "${APP}: SpriteStudio-SDK not found." >&2
    echo "  run: git submodule update --init --recursive   (or set SSSDK)" >&2
    exit 1
fi

# The C-API header is emitted by libs/ssruntime/build.rs (cbindgen) on every
# cargo build, so it exists by the time any platform build finishes. It is
# platform-agnostic — one copy serves both the podspec and the Android CMake.
place_header() {
    local src="${SDK_DIR}/libs/ssruntime/target/ssruntime.h"
    if [ ! -f "$src" ]; then
        echo "${APP}: expected the cbindgen header at ${src}" >&2
        exit 1
    fi
    mkdir -p "${TARGET_DIR}/include"
    cp "$src" "${TARGET_DIR}/include/ssruntime.h"
    echo "  include/ssruntime.h"
}

# The release archive ships these next to the binaries, and the npm package
# redistributes the Brain — so a submodule build has to place them too, or a
# locally built package would ship without the notices it owes.
place_licenses() {
    cp "${SDK_DIR}/LICENSE.md" "${TARGET_DIR}/" 2>/dev/null || true
    cp "${SDK_DIR}/target/licenses/THIRD-PARTY-LICENSES.ssruntime.md" "${TARGET_DIR}/" 2>/dev/null || true
    if [ ! -f "${TARGET_DIR}/THIRD-PARTY-LICENSES.ssruntime.md" ]; then
        echo "  (no THIRD-PARTY-LICENSES.ssruntime.md — run the SDK's scripts/generate-licenses.sh)"
    fi
}

# Stamp the version next to the binaries it describes — the same file
# Neither file is written here, and both are removed if they are lying around.
#
# They describe *the pinned release*: `download-sdk.sh` writes the tag it
# installed and `release` for the mode, because a release asset is one by
# construction. A local build is neither. Writing a stamp for it meant inventing
# one — this used to be "<tag>+submodule-<sha>" — and every consumer of the file
# then had to know that spelling: `download-sdk.sh` so its skip check would not
# leave a local build in place while calling it the release, `prepack` so it
# would not publish one. No sibling Player writes a version from its
# build-runtime at all, and this is why.
#
# Removing them says the same thing with nothing to interpret. `download-sdk.sh`
# reinstalls because there is no version to match, `prepack` refuses because
# there is no mode to read, and the podspec and build.gradle already fall back
# to "unknown" — which is what `SsRuntime.version` should say about a Brain that
# came from a working tree.
place_version() {
    rm -f "${TARGET_DIR}/VERSION" "${TARGET_DIR}/BUILD_MODE"
    echo "  VERSION / BUILD_MODE removed (a local build is not the pinned release)"
}

build_ios() {
    echo "Building iOS (${BUILD_MODE}) via the SDK's release-ios-xcframework.sh..."
    ( cd "$SDK_DIR" && bash scripts/release-ios-xcframework.sh "$BUILD_MODE" )

    local src="${SDK_DIR}/target/xcframework/static/libssruntime.xcframework"
    if [ ! -d "$src" ]; then
        echo "${APP}: expected ${src}" >&2
        exit 1
    fi
    mkdir -p "${TARGET_DIR}/libs/ios"
    rm -rf "${TARGET_DIR}/libs/ios/libssruntime.xcframework"
    cp -R "$src" "${TARGET_DIR}/libs/ios/"
    echo "  libs/ios/libssruntime.xcframework"
}

# cargo-ndk reads ANDROID_NDK_HOME. A shell profile pointing at an NDK that is
# not installed makes it fail with a bare "No such file or directory", so
# resolve a usable root here: the explicit ndk= argument, then the environment
# if it actually exists, then the newest side-by-side install under $ANDROID_HOME.
resolve_ndk() {
    local candidate
    for candidate in "$NDK_OVERRIDE" "${ANDROID_NDK_HOME:-}" "${ANDROID_NDK_ROOT:-}"; do
        if [ -n "$candidate" ] && [ -f "${candidate}/source.properties" ]; then
            printf '%s' "$candidate"
            return 0
        fi
    done

    local sdk="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/Library/Android/sdk}}"
    candidate=$(ls -d "${sdk}"/ndk/*/ 2>/dev/null | sort -V | tail -1)
    if [ -n "$candidate" ] && [ -f "${candidate}source.properties" ]; then
        printf '%s' "${candidate%/}"
        return 0
    fi

    echo "${APP}: no Android NDK found." >&2
    echo "  set ANDROID_NDK_HOME, or pass ndk=/path/to/android-ndk" >&2
    return 1
}

build_android() {
    local ndk
    ndk=$(resolve_ndk)
    export ANDROID_NDK_HOME="$ndk"
    export ANDROID_NDK_ROOT="$ndk"
    echo "Building Android (${BUILD_MODE}) via the SDK's release-android.sh, NDK ${ndk}..."
    ( cd "$SDK_DIR" && bash scripts/release-android.sh "$BUILD_MODE" )

    local pair triple abi src
    for pair in \
        "aarch64-linux-android:arm64-v8a" \
        "armv7-linux-androideabi:armeabi-v7a" \
        "x86_64-linux-android:x86_64"; do
        triple="${pair%%:*}"
        abi="${pair##*:}"
        src="${SDK_DIR}/target/${triple}/${BUILD_MODE}/libssruntime.a"
        if [ ! -f "$src" ]; then
            echo "${APP}: expected ${src}" >&2
            exit 1
        fi
        mkdir -p "${TARGET_DIR}/libs/android/${abi}"
        cp "$src" "${TARGET_DIR}/libs/android/${abi}/libssruntime.a"
        echo "  libs/android/${abi}/libssruntime.a"
    done
}

case "$PLATFORM" in
    ios)     build_ios ;;
    android) build_android ;;
    all)     build_ios; build_android ;;
    *) echo "${APP}: platform must be ios, android or all (got '${PLATFORM}')" >&2; exit 2 ;;
esac

place_header
place_licenses
place_version

echo "Done."
