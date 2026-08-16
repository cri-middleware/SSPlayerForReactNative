#!/usr/bin/env bash
#
# Build the GitHub Pages site locally -- everything .github/workflows/pages.yml
# publishes: the TypeDoc reference into docs/api, then the VitePress site (both
# locales, English at the root and Japanese under /ja/) into docs/.vitepress/dist,
# which is the directory the workflow uploads.
#
#   scripts/build-pages.sh              # the tree pages.yml uploads
#   scripts/build-pages.sh serve=yes    # ... and serve it, base and all
#   scripts/build-pages.sh api=no       # prose only; keep the docs/api already there
#   scripts/build-pages.sh install=yes  # npm ci first, as CI does
#
# One build, both locales: VitePress resolves docs/ja through its own i18n
# support, so unlike the Zensical siblings there is no locale option here and no
# order to get right. What there is instead is TypeDoc, which has to run first --
# it writes the markdown under docs/api that VitePress then renders, and that
# directory is generated, git-ignored and absent from a fresh clone.
#
# TypeDoc fails the build on an error and VitePress fails on a dead link, so a
# page pointing at a heading somebody renamed does not reach the site. Neither
# checks #anchors, and nothing builds the docs on a pull request (pages.yml runs
# on a published release and on dispatch), so this run is the only gate there is.
#
# serve=yes is the reason to prefer this over `npm run docs`: the built site is
# served under its base path (/SSPlayerForReactNative/, set in
# docs/.vitepress/config.mts), which is how a reader meets it and is not what
# `npm run docs:dev` shows you.
#
# What this does NOT reproduce is the deploy job (actions/deploy-pages) -- there
# is no local equivalent of publishing.
#
# Not an npm script: the entries in package.json are `.js` shims over a `.sh` +
# `.ps1` pair, because naming a `.sh` there shuts Windows contributors out. This
# script has no `.ps1` twin yet, so it stays out of package.json and pages.yml
# calls it by path.
set -euo pipefail

APP="$(basename "$0")"
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

DIST="docs/.vitepress/dist"

# --- options --------------------------------------------------------------
INSTALL="auto"
API="yes"
SERVE="no"
PORT="4173"

usage () {
  echo "Usage: $APP [options]"
  echo "$APP options:"
  echo "  install=<auto|yes|no>   Run 'npm ci' first (default: $INSTALL)."
  echo "                          auto = only when node_modules is missing. yes forces"
  echo "                          it, which is what a changed package-lock.json needs;"
  echo "                          no is for CI, where it is a step of its own."
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
  echo "Output: $DIST -- the exact tree pages.yml uploads, both locales in the one"
  echo "build. A dead link fails it, which is the only gate there is: nothing builds the"
  echo "docs on a pull request."
  echo ""
  echo "Neither the Brain nor a platform toolchain is needed. TypeDoc reads TypeScript"
  echo "sources and VitePress renders markdown, so this runs on any OS with Node."
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
        install) INSTALL="$(printf '%s' "$value" | tr '[:upper:]' '[:lower:]')" ;;
        api)     API="$(printf '%s' "$value" | tr '[:upper:]' '[:lower:]')" ;;
        serve)   SERVE="$(printf '%s' "$value" | tr '[:upper:]' '[:lower:]')" ;;
        port)    PORT="$value" ;;
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

case "$INSTALL" in auto|yes|no) ;; *) echo "$APP: install must be auto, yes or no (got '$INSTALL')" >&2; exit 2 ;; esac
case "$API" in yes|no) ;; *) echo "$APP: api must be yes or no (got '$API')" >&2; exit 2 ;; esac
case "$SERVE" in yes|no) ;; *) echo "$APP: serve must be yes or no (got '$SERVE')" >&2; exit 2 ;; esac
case "$PORT" in ''|*[!0-9]*) echo "$APP: port must be a number (got '$PORT')" >&2; exit 2 ;; esac

SERVE_NOTE=""
[ "$SERVE" = "no" ] || SERVE_NOTE=" (port $PORT)"

echo "options"
echo "  install => $INSTALL"
echo "  api     => $API"
echo "  serve   => $SERVE$SERVE_NOTE"
echo ""

# --- preflight ------------------------------------------------------------
if [ ! -f "$ROOT_DIR/docs/package.json" ]; then
  echo "$APP: docs/package.json not found -- is this the SSPlayerForReactNative repo?" >&2
  exit 1
fi

if ! command -v npm > /dev/null 2>&1; then
  echo "$APP: npm not found -- install Node 22 or newer (https://nodejs.org)" >&2
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

# --- install --------------------------------------------------------------
# npm workspaces hoist into the root node_modules, docs/node_modules included --
# so the root is what to probe, and `npm ci` at the root is what installs the
# docs toolchain.
case "$INSTALL" in
  yes)
    step npm ci
    ;;
  auto)
    if [ -d "$ROOT_DIR/node_modules" ]; then
      echo "$APP: node_modules present; skipping npm ci (install=yes forces it)"
    else
      step npm ci
    fi
    ;;
  no) ;;
esac

# --- build ----------------------------------------------------------------
if [ "$API" = "yes" ]; then
  # The root's documented entry point, so this script and the Verification table
  # in AGENTS.md run the same thing: typedoc, then vitepress build.
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
