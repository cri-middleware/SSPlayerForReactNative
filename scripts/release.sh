#!/bin/bash
#
# Everything that has to be true before `npm publish`, in the order it has to
# be true in — then the publish.
#
# **macOS only, and that is not a portability oversight.** The tarball carries
# the Brain's iOS xcframework, which only Xcode can build, so a release from
# anywhere else would ship an Android-only package that installs and then fails
# to link on iOS. `build-runtime.ps1` says the same thing about Windows.
#
# What this does NOT do: bump the version or tag. Those are decisions, and a
# script that made them would have to guess which.
#
# Usage: scripts/release.sh [--dry-run] [--otp <code>]
#   --dry-run  everything up to and including `npm pack`, no publish
#   --otp      forwarded to npm publish for 2FA

set -e

BASEDIR=$(dirname "$0")
SCRIPTDIR=$(cd "$BASEDIR" && pwd -P)
ROOTDIR=$(cd "$BASEDIR/.." && pwd -P)
PKG_DIR="${ROOTDIR}/packages/react-native-spritestudio"
APP=$(basename "$0")

DRY_RUN=""
OTP=""
while [ $# -gt 0 ]; do
    case "$1" in
        --dry-run) DRY_RUN="1" ;;
        --otp) shift; OTP="$1" ;;
        -h|--help)
            echo "Usage: ${APP} [--dry-run] [--otp <code>]"
            exit 0 ;;
        *) echo "${APP}: unknown argument '$1'" >&2; exit 2 ;;
    esac
    shift
done

step() { echo ""; echo "==> $1"; }
die() { echo "" >&2; echo "${APP}: $1" >&2; exit 1; }

[ "$(uname)" = "Darwin" ] || die "macOS only — the iOS xcframework in the tarball needs Xcode"

# --- 1. the tree ------------------------------------------------------------
#
# A dirty tree is the one way a published tarball can contain something that is
# in no commit, which is unreproducible in the exact way a release must not be.
step "checking the working tree"
[ -z "$(git -C "$ROOTDIR" status --porcelain)" ] || die "working tree is dirty — commit or stash first"
BRANCH=$(git -C "$ROOTDIR" rev-parse --abbrev-ref HEAD)
[ "$BRANCH" = "main" ] || echo "    note: on '${BRANCH}', not main"

# Both submodules, for two different reasons. The vendored flatbuffers headers
# go *in* the tarball, and an uninitialised submodule is an empty directory that
# packs as a package whose C++ cannot compile. The SDK is not shipped at all,
# but the host checks below build a host Brain out of it.
git -C "$ROOTDIR" submodule update --init \
    packages/react-native-spritestudio/third_party/flatbuffers SpriteStudio-SDK
echo "    submodules initialised"

# --- 2. the Brain -----------------------------------------------------------
#
# The pinned **release**, not a local build. `build-runtime` builds whatever the
# submodule happens to be checked out at, and the gitlink tracks an internal
# branch — so publishing one would ship a Brain from a commit that moves and
# that nobody outside can reproduce. It leaves no version behind for exactly
# that reason, which is also what stops this step from being skipped.
#
# It also settles the build mode: a release asset is a release build, which is
# what prepack insists on.
#
# This is the step that fails while the SDK has no release tag. That is the
# correct failure: there is nothing to publish against yet.
step "installing the pinned Brain"
"${SCRIPTDIR}/download-sdk.sh"

# --- 3. generated code ------------------------------------------------------
#
# Both generators are committed output, so what matters is that the tree matches
# what the current inputs would produce. A stale nitrogen/ ships bindings that
# disagree with the spec; a stale cpp/format/ reads FrameData at the wrong
# offsets, silently.
step "checking the generated code is current"
"${SCRIPTDIR}/generate-nitro-code.sh" >/dev/null
git -C "$ROOTDIR" diff --exit-code -- packages/react-native-spritestudio/nitrogen >/dev/null \
    || die "nitrogen/ is stale — commit the regenerated output"
echo "    nitrogen/ current"

if command -v flatc >/dev/null 2>&1; then
    "${SCRIPTDIR}/generate-fbs-code.sh" >/dev/null
    git -C "$ROOTDIR" diff --exit-code -- packages/react-native-spritestudio/cpp/format >/dev/null \
        || die "cpp/format/ is stale — commit the regenerated output"
    echo "    cpp/format/ current"
else
    echo "    cpp/format/ SKIPPED (no flatc) — run 'pnpm run check-framedata' before releasing"
fi

# --- 4. the checks ----------------------------------------------------------
#
# The ones that run without a device. They are the difference between "it
# compiles" and "it draws what it drew last time".
step "typecheck"
( cd "$ROOTDIR" && pnpm run typecheck )

step "host checks"
( cd "$ROOTDIR" && pnpm run check-framedata && pnpm run check-mask && pnpm run check-shader && pnpm run check-hidden )

# --- 5. the tarball ---------------------------------------------------------
#
# `prepack` runs `bob build` and then refuses anything the consumer could not
# use — a debug Brain, missing licences, an empty flatbuffers include, `files`
# naming a path that is not there.
step "packing"
( cd "$PKG_DIR" && npm pack --dry-run )

if [ -n "$DRY_RUN" ]; then
    echo ""
    echo "Dry run: everything passed, nothing published."
    exit 0
fi

# --- 6. publish -------------------------------------------------------------
step "publishing"
if [ -n "$OTP" ]; then
    ( cd "$PKG_DIR" && npm publish --otp "$OTP" )
else
    ( cd "$PKG_DIR" && npm publish )
fi

VERSION=$(node -p "require('${PKG_DIR}/package.json').version")
echo ""
echo "Published react-native-spritestudio@${VERSION}."
echo "Tag it if that is the convention: git tag v${VERSION} && git push origin v${VERSION}"
