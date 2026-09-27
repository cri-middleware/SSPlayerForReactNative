#!/bin/bash
#
# Build the example app and run it on an Android device or emulator.
#
# A wrapper over `npx expo prebuild` + `npx expo run:android`, the documented
# pair, adding:
#   * The release variant by default: the JS bundle is embedded, so no Metro has
#     to be running.
#   * The Brain and the example packs checked up front, naming the command that
#     supplies each, rather than a build that succeeds and draws nothing.
#
# Usage: scripts/run-android.sh [device=<name>] [config=<release|debug>]
#   device : a connected device, or an emulator (AVD) name, which Expo boots
#            (default: the one connected device; Expo asks when there are more)
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
    echo "  device=<name>        Connected device or AVD name (default: the one"
    echo "                       connected device)"
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
    release|debug) ;;
    *) echo "${APP}: config must be release or debug (got '${CONFIG}')" >&2; exit 2 ;;
esac

if [ ! -d "${ROOTDIR}/node_modules" ]; then
    echo "${APP}: node_modules is missing -- run 'npm ci' first" >&2
    exit 1
fi
if ! ls "${NATIVE_DIR}"/libs/android/*/libssruntime.a > /dev/null 2>&1; then
    echo "${APP}: the Brain for Android is missing -- run 'npm run download-sdk'" >&2
    echo "  (or 'npm run build-runtime -- platform=android' when changing the Brain)" >&2
    exit 1
fi
if [ -z "$(ls -A "${EXAMPLE_DIR}/assets/ss" 2>/dev/null)" ]; then
    echo "${APP}: example/assets/ss is empty -- run 'npm run deploy-examples'" >&2
    exit 1
fi

# Release embeds the bundle, so no Metro: Expo would start one anyway and stay
# attached to it instead of returning.
RUN_ARGS=(--variant "$CONFIG")
if [ "$CONFIG" = "release" ]; then
    RUN_ARGS+=(--no-bundler)
fi
if [ -n "$DEVICE" ]; then
    RUN_ARGS+=(--device "$DEVICE")
fi

cd "$EXAMPLE_DIR"
echo ">> npx expo prebuild --platform android"
npx expo prebuild --platform android --no-install
echo ">> npx expo run:android ${RUN_ARGS[*]}"
exec npx expo run:android "${RUN_ARGS[@]}"
