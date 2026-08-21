#!/usr/bin/env bash
#
# Install what the documentation site needs in order to build.
#
#   scripts/prepare-docs.sh            # npm ci, from the lockfile
#   scripts/prepare-docs.sh frozen=no  # npm install, letting the lockfile move
#
# One thing, where the sibling players need two: **node_modules, and nothing
# else.** SSPlayerForWeb has to put the SDK wasm on disk before its docs build,
# because its packages' sources import it and TypeDoc resolves those imports.
# Nothing here does. TypeDoc reads `packages/*/src` as TypeScript and VitePress
# renders markdown -- neither runs a line of it -- so **the docs need no Brain,
# no Rust and no platform toolchain**, and `npm run download-sdk` is not part of
# this path. That is also why .github/workflows/pages.yml checks out without
# submodules and still publishes a complete site.
#
# npm workspaces hoist into the *root* node_modules, docs/ included, so the root
# is both what to install and what to probe. Installing inside docs/ instead
# gets you a second, isolated tree that VitePress will happily use and TypeDoc
# will not.
#
# The -docs suffix keeps this apart from the scripts that build and release the
# player, and every repository in the SpriteStudio family spells the pair the
# same way -- even where the implementations have nothing in common (this one
# wraps npm, SSPlayerForWeb wraps pnpm, the SDK wraps a Python virtualenv).
#
# Then: scripts/build-docs.sh, which runs TypeDoc and VitePress.
set -euo pipefail

APP="$(basename "$0")"
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# --- options --------------------------------------------------------------
FROZEN="yes"

usage () {
  echo "Usage: $APP [options]"
  echo "$APP options:"
  echo "  frozen=<yes|no>         Install with 'npm ci', i.e. fail rather than update"
  echo "                          package-lock.json (default: $FROZEN). frozen=no runs"
  echo "                          'npm install', which is what adding a dependency needs."
  echo "  -h | --help             Show this help"
  echo ""
  echo "Installs into the *root* node_modules -- npm workspaces hoist, docs/ included."
  echo ""
  echo "No Brain, no Rust, no platform toolchain: TypeDoc reads TypeScript sources and"
  echo "VitePress renders markdown, so neither ever loads the native runtime. This runs"
  echo "on any OS with Node."
  echo ""
  echo "Building the site is scripts/build-docs.sh, not this script."
}

while [ $# -gt 0 ]; do
  item="$1"
  shift

  case "$item" in
    -h|--help|help)
      usage
      exit 0
      ;;
    *=*)
      key="${item%%=*}"
      value="$(printf '%s' "${item#*=}" | tr '[:upper:]' '[:lower:]')"
      case "$key" in
        frozen) FROZEN="$value" ;;
        *)
          echo "$APP: unknown option '$key' (see $APP --help)" >&2
          exit 2
          ;;
      esac
      ;;
    *)
      echo "$APP: unknown argument '$item' (options are key=value; see $APP --help)" >&2
      exit 2
      ;;
  esac
done

case "$FROZEN" in
  yes|no) ;;
  *) echo "$APP: frozen must be yes or no (got '$FROZEN')" >&2; exit 2 ;;
esac

echo "options"
echo "  frozen => $FROZEN"
echo ""

# --- preflight ------------------------------------------------------------
if [ ! -f "$ROOT_DIR/docs/package.json" ]; then
  echo "$APP: docs/package.json not found -- is this the SSPlayerForReactNative repo?" >&2
  exit 1
fi

if ! command -v npm > /dev/null 2>&1; then
  echo "$APP: npm not found -- install Node 20 or newer (package.json engines; CI uses 22)" >&2
  echo "$APP: https://nodejs.org" >&2
  exit 1
fi

# Every workspace path is relative to the repo root, so run from there however
# the script was invoked.
cd "$ROOT_DIR"

# --- install --------------------------------------------------------------
if [ "$FROZEN" = "yes" ]; then
  echo ">> npm ci"
  npm ci
else
  echo ">> npm install"
  npm install
fi

echo ""
echo "$APP: done"
echo "$APP: build the site:  scripts/build-docs.sh"
echo "$APP: live preview:    npm run docs:dev"
