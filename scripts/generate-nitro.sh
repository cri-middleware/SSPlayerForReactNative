#!/bin/bash
#
# Run nitrogen over the Layer 1 spec and refresh packages/react-native-ssplayer/nitrogen/.
#
# The generated tree IS committed (same treatment as the Unity Player's
# SSRuntimeMethods.g.cs and the Flutter Player's ffigen output): consumers must
# not need nitrogen to build. **Never hand-edit anything under nitrogen/** —
# change src/specs/*.nitro.ts and re-run this.
#
# Usage: scripts/generate-nitro.sh

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd -P)
ROOT_DIR=$(cd "$SCRIPT_DIR/.." && pwd -P)
PKG_DIR="$ROOT_DIR/packages/react-native-ssplayer"

if [ ! -d "$ROOT_DIR/node_modules/nitrogen" ]; then
  echo "generate-nitro.sh: nitrogen is not installed — run 'npm install' first." >&2
  exit 1
fi

cd "$PKG_DIR"
"$ROOT_DIR/node_modules/.bin/nitrogen" --logLevel info

echo "==> nitrogen output refreshed in packages/react-native-ssplayer/nitrogen/"
