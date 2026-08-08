#!/bin/bash
#
# Install the pinned SpriteStudio-SDK release into the npm package's native/
# directory.
#
# THIS IS THE NORMAL PATH. It needs no Rust toolchain and no submodule — just
# curl and unzip — which is what lets someone who has never touched the SDK
# build the package (design doc ch.7). scripts/build-runtime.sh is the other
# path: building the Brain from the submodule while working on it.
#
# The STATIC archive: the iOS podspec vendors the xcframework's `.a` slices and
# the Android CMake links libssruntime.a into the Nitro module's own .so. Same
# choice as the Unity and Godot Players; the dynamic build exists for Ren'Py.
#
# Usage: scripts/download-sdk.sh [--force]
#   --force  re-install even when native/VERSION already matches
set -e

BASEDIR=$(dirname "$0")
SCRIPTDIR=$(cd "$BASEDIR" && pwd -P)
ROOTDIR=$(cd "$BASEDIR/.." && pwd -P)
APP=$(basename "$0")

TARGET_DIR="${ROOTDIR}/packages/react-native-ssplayer/native"
VERSION_FILE="${SCRIPTDIR}/SDK_VERSION.txt"
CURRENT_VERSION_FILE="${TARGET_DIR}/VERSION"
# Downloaded zips are cached here (gitignored) so a re-run that needs the same
# version reuses them instead of re-downloading tens of MB.
CACHE_DIR="${SCRIPTDIR}/.sdk-cache"

FORCE=""
for item in "$@"; do
    case "$item" in
        --force|-force|force) FORCE=1 ;;
        -h|--help|help)
            echo "Usage: ${APP} [--force]"
            echo "  --force  re-install even when native/VERSION already matches"
            exit 0
            ;;
        *) echo "${APP}: unknown argument '${item}'" >&2; exit 2 ;;
    esac
done

if [ ! -f "$VERSION_FILE" ]; then
    echo "${APP}: missing ${VERSION_FILE}" >&2
    exit 1
fi
TARGET_VERSION=$(tr -d ' \r\n' < "$VERSION_FILE")

# A build-runtime.sh install stamps "<tag>+submodule-<sha>", which never compares
# equal to the bare tag — so a local Brain build is replaced here rather than
# silently kept while claiming to be the release.
if [ -z "$FORCE" ] && [ -f "$CURRENT_VERSION_FILE" ]; then
    CURRENT_VERSION=$(tr -d ' \r\n' < "$CURRENT_VERSION_FILE")
    if [ "$CURRENT_VERSION" = "$TARGET_VERSION" ]; then
        echo "SDK $TARGET_VERSION is already up to date. Skipping download."
        exit 0
    fi
fi

BASE_URL="https://github.com/cri-middleware/SpriteStudio-SDK/releases/download/${TARGET_VERSION}"
ASSET="spritestudio-sdk-static-libs.zip"
# Keep the release asset's own name so it matches the SHA256SUMS entry directly.
ZIP_FILE="${CACHE_DIR}/${ASSET}"
SUMS_FILE="${CACHE_DIR}/SHA256SUMS"

echo "Target SDK Version: ${TARGET_VERSION}"
mkdir -p "$CACHE_DIR"

sha256_of() {
    if command -v sha256sum >/dev/null 2>&1; then
        sha256sum "$1" | awk '{print $1}'
    else
        shasum -a 256 "$1" | awk '{print $1}'
    fi
}

# Fetch the checksum manifest (small): it both verifies integrity and decides
# whether an already-cached zip can be reused without re-downloading.
echo "Downloading checksum manifest: ${BASE_URL}/SHA256SUMS"
curl -fL -o "$SUMS_FILE" "${BASE_URL}/SHA256SUMS"
EXPECTED=$(awk -v n="$ASSET" '$2 == n {print $1}' "$SUMS_FILE")
if [ -z "$EXPECTED" ]; then
    echo "ERROR: no checksum entry for ${ASSET} in SHA256SUMS" >&2
    exit 1
fi

# Reuse the cached zip when it already matches the manifest; otherwise download.
if [ -f "$ZIP_FILE" ] && [ "$(sha256_of "$ZIP_FILE")" = "$EXPECTED" ]; then
    echo "Reusing cached ${ASSET}"
else
    echo "Downloading SDK: ${BASE_URL}/${ASSET}"
    curl -fL -o "$ZIP_FILE" "${BASE_URL}/${ASSET}"
    if [ "$(sha256_of "$ZIP_FILE")" != "$EXPECTED" ]; then
        echo "ERROR: checksum mismatch for ${ASSET}" >&2
        rm -f "$ZIP_FILE"
        exit 1
    fi
fi
echo "Checksum OK: ${ASSET}"

# The release archive is a flat tree (libs/, include/, bindings/, VERSION,
# LICENSE.md, …) with no wrapper directory, so it extracts straight into
# native/ — exactly the layout the podspec and the Android CMake read, and the
# one build-runtime.sh also writes.
echo "Extracting SDK..."
rm -rf "$TARGET_DIR"
mkdir -p "$TARGET_DIR"
unzip -q -o "$ZIP_FILE" -d "$TARGET_DIR"

# The archive's own VERSION holds the SDK commit hash; overwrite it with the tag
# so the skip check above compares like with like.
echo "$TARGET_VERSION" > "$CURRENT_VERSION_FILE"

echo "Done."
