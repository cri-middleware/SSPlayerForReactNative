#!/bin/bash
#
# Run nitrogen over the Layer 1 spec and refresh
# packages/react-native-ssplayer/nitrogen/.
#
# Named after the tool the way the Flutter Player's generate-ffigen-code.sh is,
# rather than generate-runtime-code.sh: the sibling Players' script of that name
# generates bindings *from the SDK* (flatc / csbindgen), while this one runs
# nitrogen over a spec this repo owns.
#
# The generated tree IS committed, the same treatment as the Unity Player's
# SSRuntimeMethods.g.cs and the Flutter Player's ffigen output: consumers must
# not need nitrogen to build. NEVER hand-edit anything under nitrogen/ — change
# src/specs/*.nitro.ts and re-run this.
#
# Usage: scripts/generate-nitro-code.sh
set -euo pipefail

BASEDIR=$(dirname "$0")
ROOTDIR=$(cd "$BASEDIR/.." && pwd -P)
APP=$(basename "$0")

PKG_DIR="${ROOTDIR}/packages/react-native-ssplayer"

if [ ! -d "${ROOTDIR}/node_modules/nitrogen" ]; then
    echo "${APP}: nitrogen is not installed — run 'npm install' first." >&2
    exit 1
fi

( cd "$PKG_DIR" && "${ROOTDIR}/node_modules/.bin/nitrogen" --logLevel info )

echo "Generated into packages/react-native-ssplayer/nitrogen/"
echo "Done."
