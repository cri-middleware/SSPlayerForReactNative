#!/bin/bash
#
# Generate the C++ FlatBuffers accessors for the three schemas this Player reads.
#
#   SpriteStudio-SDK/libs/ssab/fbs/ssab.fbs
#     -> packages/react-native-spritestudio/cpp/format/ssab.h
#   SpriteStudio-SDK/libs/ssruntime/fbs/framedata.fbs
#     -> packages/react-native-spritestudio/cpp/format/framedata.h
#   SpriteStudio-SDK/libs/ssruntime/fbs/effect_draw_plan.fbs
#     -> packages/react-native-spritestudio/cpp/format/effect_draw_plan.h
#
# Why the Player parses the `.ssab` at all: libssruntime deliberately returns
# none of the metadata rendering needs — cellmap names, texture paths, animation
# names — and tells Players to read it out of the ssab themselves
# (`20_design/20_architecture.md`). Texture loading is the first thing that
# needs it.
#
# `effect_draw_plan` is the same thing one kind at a time: an Effect part's
# geometry does not ride the per-frame SoA at all, it comes back from
# `ss_effect_slot_step` as its own buffer.
#
# `framedata` is the Brain's per-frame output, read on the hot path. Generated
# accessors are the right tool there too, contrary to what this script used to
# say: flatc's C++ struct fields are direct member reads through `EndianScalar`
# (a no-op on little-endian), and `Vector<const T*>::Data()` hands back the
# contiguous pointer, so `30_core/30_render_loop.md` §2's "read the struct
# vectors raw" is satisfied *through* the generated code rather than around it.
# The ~26x figure that argument leaned on is a Unity/C# measurement, where each
# accessor is a ByteBuffer read; it does not carry to C++.
#
# Same shape as SSPlayerForGodot's `scripts/generate-fbs-code.sh`: flatc -c,
# and the `_generated` suffix dropped on the way into `format/`. FlatBuffers is
# used **header-only** — the generated header pulls in `flatbuffers/flatbuffers.h`
# and its reachable set is all inline, so nothing links against flatc's own
# translation units and `flatbuffers/src` never goes on the include path.
#
# The output IS committed, so a normal checkout builds without flatc — the same
# treatment as `nitrogen/`. Run this only when the schema changes; it is
# deliberately not part of build-runtime or download-sdk.
#
# The committed headers must match the Brain in `native/`, not merely whatever
# the submodule is checked out at: a stale `framedata.h` misreads the buffer
# silently. `tools/check-framedata.sh` is the guard — it regenerates and diffs.
#
# Usage: scripts/generate-fbs-code.sh
#
# Prerequisites: flatc (brew install flatbuffers).
# SDK location: $SSSDK, else ./SpriteStudio-SDK, else ../SpriteStudio-SDK.
set -euo pipefail

BASEDIR=$(dirname "$0")
ROOTDIR=$(cd "$BASEDIR/.." && pwd -P)
APP=$(basename "$0")

# `tools/check-framedata.sh` reuses this script with the output pointed at a
# scratch directory, so the guard and the generator can never disagree about
# flatc's flags or the `_generated` rename.
OUT_DIR="${1:-${ROOTDIR}/packages/react-native-spritestudio/cpp/format}"

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

# "<schema path relative to the SDK>:<stem>". The stem is both flatc's output
# prefix (`<stem>_generated.h`) and the name we keep.
SCHEMAS="libs/ssab/fbs/ssab.fbs:ssab libs/ssruntime/fbs/framedata.fbs:framedata libs/ssruntime/fbs/effect_draw_plan.fbs:effect_draw_plan"

for entry in $SCHEMAS; do
    rel="${entry%:*}"
    if [ ! -f "${SDK_DIR}/${rel}" ]; then
        echo "${APP}: ${SDK_DIR}/${rel} not found in the SDK submodule" >&2
        exit 1
    fi
done

echo "Generating C++ FlatBuffers accessors (flatc -c) ..."
mkdir -p "$OUT_DIR"
for entry in $SCHEMAS; do
    rel="${entry%:*}"
    stem="${entry##*:}"
    ( cd "$OUT_DIR" && flatc -c "${SDK_DIR}/${rel}" && mv "${stem}_generated.h" "${stem}.h" )
    echo "  ${stem}.h"
done

echo "Generated into ${OUT_DIR}"
echo "Done."
