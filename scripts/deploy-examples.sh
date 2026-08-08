#!/bin/bash
#
# Convert the SpriteStudio-SDK bundled test projects (tests/Ringo,
# tests/ParticleEffect) into the .ssab assets the example app loads.
#
# Unlike the Flutter Player this repo bundles no converter: React Native has no
# editor to hook an importer into, so `.sspj` -> `.ssab` is a host-side step
# (design doc ch.5 / ch.9 G). This script is the developer convenience that runs
# the SDK submodule's own ssconverter-cli.
#
# Output lands in example/assets/ss/<stem>/ and is gitignored: it is derived
# from the submodule, so committing it would be a second copy to keep in sync.
#
# Requires the SpriteStudio-SDK submodule and a Rust toolchain (ssconverter-cli
# is built from source; the prebuilt SDK packages only ship libssconverter).
# Consumers of the npm package never run this.
#
# Usage: scripts/deploy-examples.sh [--embedded]
#   --embedded  bake textures into the .ssab instead of copying them alongside.
#               The example exercises the REFERENCE layout by default because
#               that is the one with a texture-loading path to get wrong.
#
# SDK location: $SSSDK, else ./SpriteStudio-SDK, else ../SpriteStudio-SDK.
set -euo pipefail

BASEDIR=$(dirname "$0")
ROOTDIR=$(cd "$BASEDIR/.." && pwd -P)
APP=$(basename "$0")

OUT_ROOT="${ROOTDIR}/example/assets/ss"

# "<SDK tests subdir>|<.sspj filename>". The output directory is the .sspj stem.
#
# Both are deliberate: Ringo is the character case, ParticleEffect is the worst
# case the Phase 0 measurement is about — design doc ch.8 is explicit that the
# vertex ceiling is set by effects, not by characters.
PROJECTS=(
    "Ringo|Ringo.sspj"
    "ParticleEffect|ParticleEffect.sspj"
)

EMBEDDED=""
for item in "$@"; do
    case "$item" in
        --embedded|-embedded|embedded) EMBEDDED="--embedded" ;;
        -h|--help|help)
            echo "Usage: ${APP} [--embedded]"
            echo "  --embedded  bake textures into the .ssab instead of copying them alongside"
            exit 0
            ;;
        *) echo "${APP}: unknown argument '${item}'" >&2; exit 2 ;;
    esac
done

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

if ! command -v cargo >/dev/null 2>&1; then
    echo "${APP}: cargo not found — install Rust to run the SDK's ssconverter-cli." >&2
    exit 1
fi

deploy_project() {
    local sdk_sub="$1" sspj="$2"
    local stem="${sspj%.sspj}"
    local src="${SDK_DIR}/tests/${sdk_sub}/${sspj}"
    local out="${OUT_ROOT}/${stem}"

    if [ ! -f "$src" ]; then
        echo "${APP}: ${sdk_sub}/${sspj} not found in the SDK submodule" >&2
        exit 1
    fi

    echo "Converting tests/${sdk_sub}/${sspj} ..."
    rm -rf "$out"
    mkdir -p "$out"
    # The non-embedded converter also copies the referenced textures into the
    # output, so this one call produces the complete asset tree.
    ( cd "$SDK_DIR" && cargo run -q -p ssconverter-cli -- ${EMBEDDED:+$EMBEDDED} -o "$out" "$src" )
    echo "   -> example/assets/ss/${stem}/"
}

for entry in "${PROJECTS[@]}"; do
    deploy_project "${entry%%|*}" "${entry##*|}"
done

echo "Done."
