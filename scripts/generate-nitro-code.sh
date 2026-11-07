#!/bin/bash
#
# Run nitrogen over the Layer 1 spec and refresh
# packages/react-native-spritestudio/nitrogen/.
#
# Named after the tool rather than generate-fbs-code.sh: that script runs flatc over the SDK's schemas, while this one runs nitrogen over a
# spec this repo owns.
#
# The generated tree IS committed: consumers must
# not need nitrogen to build. NEVER hand-edit anything under nitrogen/ — change
# src/specs/*.nitro.ts and re-run this.
#
# Usage: scripts/generate-nitro-code.sh
set -euo pipefail

BASEDIR=$(dirname "$0")
ROOTDIR=$(cd "$BASEDIR/.." && pwd -P)
APP=$(basename "$0")

PKG_DIR="${ROOTDIR}/packages/react-native-spritestudio"

# A devDependency of the package, so its bin is the package's, not the root's.
NITROGEN="${PKG_DIR}/node_modules/.bin/nitrogen"
if [ ! -x "$NITROGEN" ]; then
    echo "${APP}: nitrogen is not installed — run 'pnpm install' first." >&2
    exit 1
fi

( cd "$PKG_DIR" && "$NITROGEN" --logLevel info )

echo "Generated into packages/react-native-spritestudio/nitrogen/"
echo "Done."
