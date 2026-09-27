#!/bin/bash
#
# Build the example app and run it on an iOS simulator or a connected iPhone.
#
# A wrapper over `expo prebuild` + `expo run:ios`, the documented pair,
# adding what those leave to you:
#   * Release by default: the JS bundle is embedded, so no Metro has to be
#     running.
#   * With no device named, a simulator booted here first. Expo's own boot of a
#     shut-down simulator fails (`simctl boot ... exited with non-zero code: 2`).
#   * The Brain and the example packs checked up front, naming the command that
#     supplies each, rather than a build that succeeds and draws nothing.
#
# A physical iPhone needs a signing team; Expo asks for one when the project
# has none. macOS and Xcode only, so there is no .ps1 twin.
#
# Usage: scripts/run-ios.sh [device=<name|udid>] [config=<release|debug>]
#   device : a simulator or a connected iPhone, by name or UDID
#            (default: the booted simulator, else the first available iPhone)
#   config : release  JS embedded, no Metro (default)
#            debug    the dev client, served by Metro
set -euo pipefail

BASEDIR=$(dirname "$0")
ROOTDIR=$(cd "$BASEDIR/.." && pwd -P)
APP=$(basename "$0")

NATIVE_DIR="${ROOTDIR}/packages/react-native-spritestudio/native"
EXAMPLE_DIR="${ROOTDIR}/example"

DEVICE=""
CONFIG="release"

usage() {
    echo "Usage: ${APP} [options]"
    echo "Options:"
    echo "  device=<name|udid>   Simulator or connected iPhone (default: booted"
    echo "                       simulator, else the first available iPhone)"
    echo "  config=<config>      release (JS embedded, default) or debug (Metro)"
}

for item in "$@"; do
    case "$item" in
        device=*) DEVICE="${item#device=}" ;;
        config=*) CONFIG="${item#config=}" ;;
        -h|--help|help) usage; exit 0 ;;
        *) echo "${APP}: unknown argument '${item}'" >&2; usage; exit 2 ;;
    esac
done

case "$CONFIG" in
    release) CONFIGURATION="Release" ;;
    debug)   CONFIGURATION="Debug" ;;
    *) echo "${APP}: config must be release or debug (got '${CONFIG}')" >&2; exit 2 ;;
esac

if [ "$(uname -s)" != "Darwin" ]; then
    echo "${APP}: iOS builds need macOS and Xcode" >&2
    exit 1
fi
if [ ! -d "${ROOTDIR}/node_modules" ]; then
    echo "${APP}: node_modules is missing -- run 'pnpm install --frozen-lockfile' first" >&2
    exit 1
fi
if [ ! -d "${NATIVE_DIR}/libs/ios/libssruntime.xcframework" ]; then
    echo "${APP}: the Brain for iOS is missing -- run 'pnpm run download-sdk'" >&2
    echo "  (or 'pnpm run build-runtime platform=ios' when changing the Brain)" >&2
    exit 1
fi
if [ -z "$(ls -A "${EXAMPLE_DIR}/assets/ss" 2>/dev/null)" ]; then
    echo "${APP}: example/assets/ss is empty -- run 'pnpm run deploy-examples'" >&2
    exit 1
fi

if [ -z "$DEVICE" ]; then
    # Booted first, then any iPhone; the runtime that owns it does not matter.
    DEVICE=$(xcrun simctl list devices available -j | node -e '
        const { devices } = JSON.parse(require("fs").readFileSync(0, "utf8"))
        const phones = Object.values(devices).flat().filter((d) => /^iPhone/.test(d.name))
        const pick = phones.find((d) => d.state === "Booted") ?? phones[0]
        if (pick) console.log(pick.udid)
    ')
    if [ -z "$DEVICE" ]; then
        echo "${APP}: no iPhone simulator is available -- install a runtime with" >&2
        echo "  'xcodebuild -downloadPlatform iOS', or name a device with device=<name|udid>" >&2
        exit 1
    fi
    if ! xcrun simctl list devices booted | grep -q "$DEVICE"; then
        echo ">> booting simulator ${DEVICE}"
        xcrun simctl boot "$DEVICE"
    fi
    # Only the window: the simulator runs without it, and not every Xcode ships it.
    open -a Simulator > /dev/null 2>&1 || true
    xcrun simctl bootstatus "$DEVICE" -b > /dev/null
fi

# Release embeds the bundle, so no Metro: Expo would start one anyway and stay
# attached to it instead of returning.
RUN_ARGS=(--configuration "$CONFIGURATION" --device "$DEVICE")
if [ "$CONFIG" = "release" ]; then
    RUN_ARGS+=(--no-bundler)
fi

cd "$EXAMPLE_DIR"
echo ">> pnpm exec expo prebuild --platform ios"
pnpm exec expo prebuild --platform ios --no-install
echo ">> pnpm exec expo run:ios ${RUN_ARGS[*]}"
exec pnpm exec expo run:ios "${RUN_ARGS[@]}"
