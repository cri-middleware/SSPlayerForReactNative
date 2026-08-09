#!/bin/bash
#
# Generate the C++ FlatBuffers accessors for the `.ssab` asset format.
#
#   SpriteStudio-SDK/libs/ssab/fbs/ssab.fbs
#     -> packages/react-native-spritestudio/cpp/format/ssab.h
#
# Why the Player parses the `.ssab` at all: libssruntime deliberately returns
# none of the metadata rendering needs — cellmap names, texture paths, animation
# names — and tells Players to read it out of the ssab themselves
# (`20_design/20_architecture.md`). Texture loading is the first thing that
# needs it.
#
# Same shape as SSPlayerForGodot's `scripts/generate-runtime-code.sh`: flatc -c,
# and the `_generated` suffix dropped on the way into `format/`. FlatBuffers is
# used **header-only** — the generated header pulls in `flatbuffers/flatbuffers.h`
# and its reachable set is all inline, so nothing links against flatc's own
# translation units and `flatbuffers/src` never goes on the include path.
#
# The output IS committed, so a normal checkout builds without flatc — the same
# treatment as `nitrogen/`. Run this only when the schema changes; it is
# deliberately not part of build-runtime or download-sdk.
#
# Not framedata: that one stays hand-written in `cpp/SsFrameData.hpp` because
# `30_core/30_render_loop.md` §2 tells Players to read its struct vectors raw
# rather than through per-element accessors (measured at ~26x on Unity/C#), so
# generated accessors would be bypassed on the hot path anyway. The `.ssab` is
# read once per load, where that argument does not apply.
#
# Usage: scripts/generate-fbs-code.sh
#
# Prerequisites: flatc (brew install flatbuffers).
# SDK location: $SSSDK, else ./SpriteStudio-SDK, else ../SpriteStudio-SDK.
set -euo pipefail

BASEDIR=$(dirname "$0")
ROOTDIR=$(cd "$BASEDIR/.." && pwd -P)
APP=$(basename "$0")

OUT_DIR="${ROOTDIR}/packages/react-native-spritestudio/cpp/format"

if ! command -v flatc >/dev/null 2>&1; then
    echo "${APP}: flatc not found — install Google FlatBuffers (brew install flatbuffers)." >&2
    exit 1
fi

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

FBS="${SDK_DIR}/libs/ssab/fbs/ssab.fbs"
if [ ! -f "$FBS" ]; then
    echo "${APP}: ${FBS} not found in the SDK submodule" >&2
    exit 1
fi

echo "Generating C++ FlatBuffers accessors (flatc -c) ..."
mkdir -p "$OUT_DIR"
( cd "$OUT_DIR" && flatc -c "$FBS" && mv ssab_generated.h ssab.h )

echo "Generated packages/react-native-spritestudio/cpp/format/ssab.h"
echo "Done."
