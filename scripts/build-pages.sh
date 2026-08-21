#!/usr/bin/env bash
#
# Build the GitHub Pages site locally -- everything .github/workflows/pages.yml
# publishes, in the order that works.
#
#   scripts/build-pages.sh              # the tree pages.yml uploads
#   scripts/build-pages.sh serve=yes    # ... and serve it, base and all
#   scripts/build-pages.sh api=no       # prose only; keep the docs/api already there
#   scripts/build-pages.sh prepare=yes  # npm ci first, as CI does
#
# **This script implements nothing.** It is prepare-docs.sh then build-docs.sh,
# which are the pair every repository in the SpriteStudio family spells the same
# way, and it exists so that one command reproduces the workflow and so that CI
# and a local build cannot drift. Where the siblings' build-pages assembles the
# site with other outputs beside it -- examples, a converter, rustdoc -- there is
# nothing else to assemble here: the Pages tree *is* the VitePress site, and
# pages.yml uploads docs/.vitepress/dist directly.
#
# So the reasons live one level down, at the site they bind: why TypeDoc must run
# before VitePress, why one build covers both locales, why there is no base=
# option, and why a dead link fails while an #anchor does not, are all in
# build-docs.sh's header. Why the docs need no Brain is in prepare-docs.sh's.
#
# What this does NOT reproduce is the deploy job (actions/deploy-pages) -- there
# is no local equivalent of publishing.
#
# Not an npm script: the entries in package.json are `.js` shims over a `.sh` +
# `.ps1` pair, because naming a `.sh` there shuts Windows contributors out. This
# script has no `.ps1` twin, so it stays out of package.json and pages.yml calls
# it by path -- but both halves have one, so a Windows contributor runs them
# directly (`npm run prepare-docs`, `npm run build-docs`).
set -euo pipefail

APP="$(basename "$0")"
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

DIST="docs/.vitepress/dist"

# --- options --------------------------------------------------------------
PREPARE="auto"
API="yes"
SERVE="no"
PORT="4173"

usage () {
  echo "Usage: $APP [options]"
  echo "$APP options:"
  echo "  prepare=<auto|yes|no>   Run scripts/prepare-docs.sh -- 'npm ci' -- first"
  echo "                          (default: $PREPARE). auto = only when node_modules is"
  echo "                          missing. yes forces it, which is what a changed"
  echo "                          package-lock.json needs; no is for CI, where the"
  echo "                          install is a step of its own."
  echo "  api=<yes|no>            Regenerate the API reference with TypeDoc first"
  echo "                          (default: $API). See scripts/build-docs.sh --help."
  echo "  serve=<yes|no>          Serve the built site when the build is done (default:"
  echo "                          $SERVE). Foreground; Ctrl-C to stop."
  echo "  port=<n>                Port for serve=yes (default: $PORT)"
  echo "  -h | --help             Show this help"
  echo ""
  echo "Output: $DIST -- the exact tree pages.yml uploads, both locales in the one"
  echo "build."
  echo ""
  echo "This is prepare-docs.sh then build-docs.sh, and nothing else. Run either on its"
  echo "own with 'npm run prepare-docs' / 'npm run build-docs'."
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
        prepare) PREPARE="$(printf '%s' "$value" | tr '[:upper:]' '[:lower:]')" ;;
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

case "$PREPARE" in auto|yes|no) ;; *) echo "$APP: prepare must be auto, yes or no (got '$PREPARE')" >&2; exit 2 ;; esac
case "$API" in yes|no) ;; *) echo "$APP: api must be yes or no (got '$API')" >&2; exit 2 ;; esac
case "$SERVE" in yes|no) ;; *) echo "$APP: serve must be yes or no (got '$SERVE')" >&2; exit 2 ;; esac
case "$PORT" in ''|*[!0-9]*) echo "$APP: port must be a number (got '$PORT')" >&2; exit 2 ;; esac

SERVE_NOTE=""
[ "$SERVE" = "no" ] || SERVE_NOTE=" (port $PORT)"

echo "options"
echo "  prepare => $PREPARE"
echo "  api     => $API"
echo "  serve   => $SERVE$SERVE_NOTE"
echo ""

# --- preflight ------------------------------------------------------------
# Only what this script itself needs to find; prepare-docs.sh and build-docs.sh
# each check their own toolchain.
if [ ! -f "$ROOT_DIR/docs/package.json" ]; then
  echo "$APP: docs/package.json not found -- is this the SSPlayerForReactNative repo?" >&2
  exit 1
fi

cd "$ROOT_DIR"

# --- prepare --------------------------------------------------------------
# npm workspaces hoist into the root node_modules, docs/node_modules included --
# so the root is what to probe.
case "$PREPARE" in
  yes)
    echo ">> scripts/prepare-docs.sh"
    scripts/prepare-docs.sh
    echo ""
    ;;
  auto)
    if [ -d "$ROOT_DIR/node_modules" ]; then
      echo "$APP: node_modules present; skipping the install (prepare=yes forces it)"
      echo ""
    else
      echo ">> scripts/prepare-docs.sh"
      scripts/prepare-docs.sh
      echo ""
    fi
    ;;
  no) ;;
esac

# --- build ----------------------------------------------------------------
# serve=yes ends in an exec, so this is deliberately the last thing that runs.
echo ">> scripts/build-docs.sh api=$API serve=$SERVE port=$PORT"
exec scripts/build-docs.sh "api=$API" "serve=$SERVE" "port=$PORT"
