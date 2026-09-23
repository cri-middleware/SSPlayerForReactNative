#!/bin/bash
#
# Convert the SpriteStudio-SDK bundled test projects (tests/overall, tests/Ringo,
# tests/ParticleEffect, tests/Doll) into the .ssab assets the example app loads.
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
# Usage: scripts/deploy-examples.sh [embedded=yes|no]
#   embedded=yes  bake textures into the .ssab instead of copying them alongside.
#                 Default no: the example exercises the REFERENCE layout, which
#                 is the one with a texture-loading path to get wrong.
#
# SDK location: $SSSDK, else ./SpriteStudio-SDK, else ../SpriteStudio-SDK.
set -euo pipefail

BASEDIR=$(dirname "$0")
ROOTDIR=$(cd "$BASEDIR/.." && pwd -P)
APP=$(basename "$0")

OUT_ROOT="${ROOTDIR}/example/assets/ss"

# "<SDK tests subdir>|<.sspj filename>". The output directory is the .sspj stem.
#
# All of them are deliberate:
#   overall         — the SDK's own reference layout, one .ssab per feature
#                     (Basic, Mesh, Mask, Effect, BlendMode, ...). `Basic.ssab`
#                     is the plain-Normal-parts case, so it is the asset that
#                     says whether the render path itself works before any
#                     character's authoring choices are in the picture.
#   Ringo           — the character case.
#   ParticleEffect  — the worst case for vertex count; design doc ch.8 is
#                     explicit that the ceiling is set by effects, not by
#                     characters.
PROJECTS=(
    "overall|overall.sspj"
    "Ringo|Ringo.sspj"
    "ParticleEffect|ParticleEffect.sspj"
    "Doll|Doll.sspj"
)

# Projects supplied **locally** rather than by the SDK, as
# "<dir under example/SpriteStudio_Source>|<.sspj filename>|<output dir name>".
#
# `example/SpriteStudio_Source/` is not in this repository — it is third-party
# sample art, and the licence to redistribute it is not ours to give. Everything
# here is therefore **optional**: a project whose directory is absent is
# reported and skipped, and the example, the asset manifest and `check-mask`
# all work without it. See README.md for where to get them.
#
# Only one so far, and the reason it is not in the SDK's tests is worth stating:
# the SDK's samples keep masks and instance parts in separate files —
# `allPartsV7/mask` has 289 writer-frames and no instances, `allPartsV7/instanse`
# has an instance and no mask — so **nothing upstream exercises a mask that has
# to reach into an instance child**.
# This is the official SpriteStudio basic sample for exactly that.
LOCAL_DEPLOYED=()
LOCAL_PROJECTS=(
    "Mask|Mask.sspj|MaskInstance"
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
# conversion, to exercise a route the other three subjects already cover. The
# Player screen disables the toggle for that subject and says why, rather than
# offering it and pointing at a directory nothing produced.
EMBEDDED_PROJECTS=(
    "overall|overall.sspj|overall-embedded"
    "Ringo|Ringo.sspj|Ringo-embedded"
    "Doll|Doll.sspj|Doll-embedded"
)

EMBEDDED=""
for item in "$@"; do
    case "$item" in
        embedded=*)
            case "${item#*=}" in
                yes|true|1) EMBEDDED="--embedded" ;;
                no|false|0) EMBEDDED="" ;;
                *) echo "${APP}: embedded= takes yes or no, not '${item#*=}'" >&2; exit 2 ;;
            esac
            ;;
        -h|--help|help)
            echo "Usage: ${APP} [embedded=yes|no]"
            echo "  embedded=yes  bake textures into the .ssab instead of copying them alongside"
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

# `deploy_project <source root> <subdir> <.sspj> [out name] [--embedded]`.
# The root is a parameter because the projects now come from two places; the
# converter does not care which.
deploy_project() {
    local src_root="$1" sub="$2" sspj="$3"
    local out_name="${4:-${sspj%.sspj}}"
    local embedded="${5-$EMBEDDED}"
    local src="${src_root}/${sub}/${sspj}"
    local out="${OUT_ROOT}/${out_name}"

    if [ ! -f "$src" ]; then
        echo "${APP}: ${sub}/${sspj} not found under ${src_root}" >&2
        exit 1
    fi

    echo "Converting ${sub}/${sspj}${embedded:+ (embedded)} ..."
    rm -rf "$out"
    mkdir -p "$out"
    # The non-embedded converter also copies the referenced textures into the
    # output, so this one call produces the complete asset tree.
    ( cd "$SDK_DIR" && cargo run -q -p ssconverter-cli -- ${embedded:+$embedded} -o "$out" "$src" )
    echo "   -> example/assets/ss/${out_name}/"
}

SDK_TESTS="${SDK_DIR}/tests"
LOCAL_SRC="${ROOTDIR}/example/SpriteStudio_Source"

for entry in "${PROJECTS[@]}"; do
    IFS='|' read -r sdk_sub sspj <<< "$entry"
    deploy_project "$SDK_TESTS" "$sdk_sub" "$sspj"
done

for entry in "${LOCAL_PROJECTS[@]}"; do
    IFS='|' read -r sub sspj out_name <<< "$entry"
    if [ ! -d "${LOCAL_SRC}/${sub}" ]; then
        echo "== ${out_name}: skipped, ${LOCAL_SRC}/${sub} is not here"
        echo "   That project is third-party sample art this repository does not"
        echo "   ship. Everything else is unaffected; see README.md to add it."
        continue
    fi
    deploy_project "$LOCAL_SRC" "$sub" "$sspj" "$out_name"
    LOCAL_DEPLOYED+=("$out_name")
done

for entry in "${EMBEDDED_PROJECTS[@]}"; do
    IFS='|' read -r sdk_sub sspj out_name <<< "$entry"
    deploy_project "$SDK_TESTS" "$sdk_sub" "$sspj" "$out_name" "--embedded"
done

# The manifest last, because it is a description of the tree above and the app
# reads its whole subject list out of it. Regenerating here rather than leaving
# it to a second command is what keeps "I converted a pack and it did not appear"
# from being a state you can reach at all — including the reverse, a pack the
# manifest still names after the project supplying it went away.
#
# It is committed in its **without-optional-packs** state, so deploying one of
# those leaves `example/src/ss-assets.ts` modified on purpose. Do not commit it.
echo "Refreshing example/src/ss-assets.ts ..."
( cd "${ROOTDIR}/example" && node ../packages/react-native-spritestudio/bin/spritestudio.js \
    assets --out src/ss-assets.ts )
if [ ${#LOCAL_DEPLOYED[@]} -gt 0 ]; then
    echo "   ${LOCAL_DEPLOYED[*]} came from example/SpriteStudio_Source/, so this file"
    echo "   now differs from the committed one. That is expected — do not commit it."
fi

echo "Done."
