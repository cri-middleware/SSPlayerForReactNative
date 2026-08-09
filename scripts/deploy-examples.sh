#!/bin/bash
#
# Convert the SpriteStudio-SDK bundled test projects (tests/overall, tests/Ringo,
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
# All three are deliberate:
#   overall         — the SDK's own reference layout, one .ssab per feature
#                     (Basic, Mesh, Mask, Effect, BlendMode, ...). `Basic.ssab`
#                     is the plain-Normal-parts case, so it is the asset that
#                     says whether the render path itself works before any
#                     character's authoring choices are in the picture.
#   Ringo           — the character case.
#   ParticleEffect  — the worst case the Phase 0 measurement is about; design
#                     doc ch.8 is explicit that the vertex ceiling is set by
#                     effects, not by characters.
PROJECTS=(
    "overall|overall.sspj"
    "Ringo|Ringo.sspj"
    "ParticleEffect|ParticleEffect.sspj"
)

# "<SDK tests subdir>|<.sspj filename>|<output dir name>", always converted with
# textures baked in, whatever `--embedded` says for the rest.
#
# The example needs both conversions of every pack it shows, because the two
# texture-supply modes reach different distances on React Native. A reference
# pack's sibling image has to be findable at runtime, and Metro only ships what
# a `require()` names — so reference is the mode with a loading path to get
# wrong, and embedded is the one that is self-contained everywhere. Keeping both
# means the example exercises both branches of `SsTextureLoader`, and it has to
# be per pack rather than once overall: the Player screen's texture toggle
# applies to whichever subject is selected, so a pack with only one conversion
# would make that toggle silently do nothing for it.
#
# `ParticleEffect` is the deliberate exception. Embedding bakes the atlas into
# every `.ssab` that names it, and its two atlases are 1.9 MB and 2.8 MB across
# 41 packs — roughly 150 MB of app assets, against 5.2 MB for the reference
# conversion, to exercise a route the other two subjects already cover. The
# Player screen disables the toggle for that subject and says why, rather than
# offering it and pointing at a directory nothing produced.
EMBEDDED_PROJECTS=(
    "overall|overall.sspj|overall-embedded"
    "Ringo|Ringo.sspj|Ringo-embedded"
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
    local out_name="${3:-${sspj%.sspj}}"
    local embedded="${4-$EMBEDDED}"
    local src="${SDK_DIR}/tests/${sdk_sub}/${sspj}"
    local out="${OUT_ROOT}/${out_name}"

    if [ ! -f "$src" ]; then
        echo "${APP}: ${sdk_sub}/${sspj} not found in the SDK submodule" >&2
        exit 1
    fi

    echo "Converting tests/${sdk_sub}/${sspj}${embedded:+ (embedded)} ..."
    rm -rf "$out"
    mkdir -p "$out"
    # The non-embedded converter also copies the referenced textures into the
    # output, so this one call produces the complete asset tree.
    ( cd "$SDK_DIR" && cargo run -q -p ssconverter-cli -- ${embedded:+$embedded} -o "$out" "$src" )
    echo "   -> example/assets/ss/${out_name}/"
}

for entry in "${PROJECTS[@]}"; do
    IFS='|' read -r sdk_sub sspj <<< "$entry"
    deploy_project "$sdk_sub" "$sspj"
done

for entry in "${EMBEDDED_PROJECTS[@]}"; do
    IFS='|' read -r sdk_sub sspj out_name <<< "$entry"
    deploy_project "$sdk_sub" "$sspj" "$out_name" "--embedded"
done

echo "Done."
