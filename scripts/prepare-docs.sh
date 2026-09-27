#!/usr/bin/env bash
#
# Install what the documentation site needs in order to build.
#
#   scripts/prepare-docs.sh            # pnpm install --frozen-lockfile, from the lockfile
#   scripts/prepare-docs.sh frozen=no  # pnpm install, letting the lockfile move
#
# One thing, where the sibling players need two: **node_modules, and nothing
# else.** SSPlayerForWeb has to put the SDK wasm on disk before its docs build,
# because its packages' sources import it and TypeDoc resolves those imports.
# Nothing here does. TypeDoc reads `packages/*/src` as TypeScript and VitePress
# renders markdown -- neither runs a line of it -- so **the docs need no Brain,
# no Rust and no platform toolchain**, and `pnpm run download-sdk` is not part of
# this path. That is also why .github/workflows/pages.yml checks out without
# submodules and still publishes a complete site.
#
# pnpm installs every workspace from the root, docs/ included, so the root is
# both what to install and what to probe.
#
# The -docs suffix keeps this apart from the scripts that build and release the
# player, and every repository in the SpriteStudio family spells the pair the
# same way -- even where the implementations have nothing in common (this one
# and SSPlayerForWeb's wrap pnpm, the SDK's wraps a Python virtualenv).
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
  echo "  frozen=<yes|no>         Install from pnpm-lock.yaml as it stands, failing rather"
  echo "                          than updating it (default: $FROZEN). frozen=no lets it"
  echo "                          move, which is what adding a dependency needs."
  echo "  -h | --help             Show this help"
  echo ""
  echo "Installs every workspace from the root, docs/ included."
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

if ! command -v pnpm > /dev/null 2>&1; then
  echo "$APP: pnpm not found (this repo pins it in package.json's packageManager)" >&2
  echo "$APP: enable it with 'corepack enable', or install it from https://pnpm.io" >&2
  exit 1
fi

# Every workspace path is relative to the repo root, so run from there however
# the script was invoked.
cd "$ROOT_DIR"

# --- install --------------------------------------------------------------
if [ "$FROZEN" = "yes" ]; then
  echo ">> pnpm install --frozen-lockfile"
  pnpm install --frozen-lockfile
else
  echo ">> pnpm install"
  pnpm install
fi

echo ""
echo "$APP: done"
echo "$APP: build the site:  scripts/build-docs.sh"
echo "$APP: live preview:    pnpm run docs:dev"
