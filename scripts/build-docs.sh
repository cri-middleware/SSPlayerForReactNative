#!/usr/bin/env bash
#
# Build the documentation site: TypeDoc, then VitePress.
#
#   scripts/build-docs.sh              # -> docs/.vitepress/dist
#   scripts/build-docs.sh api=no       # skip TypeDoc; prose changes only
#   scripts/build-docs.sh serve=yes    # ... and serve it, base path and all
#
# TypeDoc has to run first: it writes the markdown under docs/api that VitePress
# then renders, and that directory is generated, git-ignored and absent from a
# fresh clone. api=no is for the common case where only prose moved.
#
# One build, both locales. VitePress resolves docs/ja through its own i18n
# support, so unlike the Zensical siblings there is no locale option here and no
# order to get right.
#
# TypeDoc fails the build on an error and VitePress fails on a dead link, so a
# page pointing at a heading somebody renamed does not reach the site. **Neither
# checks #anchors**, and nothing builds the docs on a pull request (pages.yml
# runs on a published release and on dispatch), so this run is the only gate
# there is.
#
# **No base= option, unlike SSPlayerForWeb's twin.** `base` is written into
# docs/.vitepress/config.mts rather than read from the environment, so every
# build here is already for the published path (/SSPlayerForReactNative/) and
# there is nothing to pass. That is also why serve=yes goes through `vitepress
# preview` instead of any static server: served from a root, every asset URL in
# the built tree 404s.
#
# What this does NOT build: the package. The site does not consume it -- TypeDoc
# reads packages/*/src, not lib/ -- so `npm run build` is not part of this path.
#
# `vitepress dev` is deliberately not wrapped: it validates nothing and is a
# foreground process with no arguments worth defaulting. `npm run docs:dev`.
#
# Install the toolchain first with scripts/prepare-docs.sh; the whole Pages tree,
# install included, is scripts/build-pages.sh.
set -euo pipefail

APP="$(basename "$0")"
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

DIST="docs/.vitepress/dist"

# --- options --------------------------------------------------------------
API="yes"
SERVE="no"
PORT="4173"

usage () {
  echo "Usage: $APP [options]"
  echo "$APP options:"
  echo "  api=<yes|no>            Regenerate the API reference with TypeDoc first"
  echo "                          (default: $API). api=no builds the prose and whatever"
  echo "                          docs/api already holds -- much faster, and enough when"
  echo "                          nothing under packages/*/src has changed. It fails if"
  echo "                          docs/api was never generated at all."
  echo "  serve=<yes|no>          Serve the built site when the build is done (default:"
  echo "                          $SERVE), through 'vitepress preview' so it is served"
  echo "                          under the base path the deployed site uses."
  echo "                          Foreground; Ctrl-C to stop."
  echo "  port=<n>                Port for serve=yes (default: $PORT)"
  echo "  -h | --help             Show this help"
  echo ""
  echo "Output: $DIST -- both locales in the one build, English at the root and Japanese"
  echo "under /ja/. A dead link fails the build, which is the only gate there is: nothing"
  echo "builds the docs on a pull request. #anchors are checked by nobody."
  echo ""
  echo "There is no base= option: docs/.vitepress/config.mts writes the base path itself."
  echo ""
  echo "Neither the Brain nor a platform toolchain is needed. TypeDoc reads TypeScript"
  echo "sources and VitePress renders markdown, so this runs on any OS with Node."
  echo ""
  echo "Install first with scripts/prepare-docs.sh."
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
      value="${item#*=}"
      case "$key" in
        # Lower-cased where the option is a keyword; port= is not.
        api)   API="$(printf '%s' "$value" | tr '[:upper:]' '[:lower:]')" ;;
        serve) SERVE="$(printf '%s' "$value" | tr '[:upper:]' '[:lower:]')" ;;
        port)  PORT="$value" ;;
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

case "$API" in yes|no) ;; *) echo "$APP: api must be yes or no (got '$API')" >&2; exit 2 ;; esac
case "$SERVE" in yes|no) ;; *) echo "$APP: serve must be yes or no (got '$SERVE')" >&2; exit 2 ;; esac
case "$PORT" in ''|*[!0-9]*) echo "$APP: port must be a number (got '$PORT')" >&2; exit 2 ;; esac

SERVE_NOTE=""
[ "$SERVE" = "no" ] || SERVE_NOTE=" (port $PORT)"

echo "options"
echo "  api   => $API"
echo "  serve => $SERVE$SERVE_NOTE"
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

# npm workspaces hoist into the root node_modules, docs/ included -- so the root
# is what to probe, and prepare-docs.sh is what fills it.
if [ ! -d "$ROOT_DIR/node_modules" ]; then
  echo "$APP: node_modules is missing -- run 'scripts/prepare-docs.sh' first" >&2
  exit 1
fi

# Every workspace path is relative to the repo root, so build from there however
# the script was invoked.
cd "$ROOT_DIR"

step () {
  echo ""
  echo ">> $*"
  "$@"
}

# --- build ----------------------------------------------------------------
if [ "$API" = "yes" ]; then
  # The root's `docs` script, so the build is defined once, in package.json:
  # typedoc, then vitepress build.
  step npm run docs
else
  if [ ! -d "$ROOT_DIR/docs/api" ]; then
    echo "$APP: api=no, but docs/api does not exist -- it is generated and git-ignored," >&2
    echo "$APP: so the first build in a clone has to be api=yes" >&2
    exit 1
  fi
  step npm exec --workspace docs -- vitepress build
fi

# --- what landed ----------------------------------------------------------
echo ""
echo "$APP: done -> $DIST"
report () { # <path> <label>
  if [ -e "$ROOT_DIR/$1" ]; then
    echo "  $2: $1"
  else
    echo "  $2: MISSING ($1)"
  fi
}
report "$DIST/index.html" "en "
report "$DIST/ja/index.html" "ja "
report "$DIST/api/index.html" "api"

# --- serve ----------------------------------------------------------------
echo ""
if [ "$SERVE" = "yes" ]; then
  echo "$APP: 'vitepress preview' serves under the site's base path -- open the URL it"
  echo "$APP: prints, not the bare host. Ctrl-C to stop."
  echo ""
  exec npm exec --workspace docs -- vitepress preview --port "$PORT"
else
  echo "$APP: serve it (under the base path, which a plain static server will not do):"
  echo "$APP:   $APP serve=yes"
  echo "$APP:   npm exec --workspace docs -- vitepress preview"
fi
