#!/bin/bash
#
# The release, from a checkout of its tag: `build-release.sh` with the options a
# release takes, then the draft GitHub Release carrying the two tarballs it
# checked and SHA256SUMS. `release.yml` runs this very script when dispatched from a tag
# with upload_release on, so a release cut on a Mac and one cut by CI are the
# same build and the same draft.
#
#   git switch --detach v7.0.1 && pnpm run release
#
# What this does NOT do: anything public. When release.yml runs this, it stages
# the tarballs on npm afterwards; cut on a Mac, they go to npm by hand.
# Approving or publishing it, and publishing the draft, are permanent: steps 6
# and 7 of RELEASING.md, after the draft has been looked at.
#
# **macOS only, and not by oversight.** `check-mask` / `check-shader` link the
# host `libskia.a` RN Skia ships with a macOS slice and no other, and
# build-release.sh skips them anywhere else — which a release cannot afford. It
# skips what needs `flatc` the same way, so that is required here too.

set -euo pipefail

APP=$(basename "$0")
BASEDIR=$(dirname "$0")
SCRIPTDIR=$(cd "$BASEDIR" && pwd -P)
ROOTDIR=$(cd "$BASEDIR/.." && pwd -P)
PKG_DIR="${ROOTDIR}/packages/react-native-spritestudio"
UI_DIR="${ROOTDIR}/packages/react-native-spritestudio-ui"
OUT="${ROOTDIR}/release-dist"

die () { echo "${APP}: $1" >&2; exit 1; }

[ $# -eq 0 ] || { echo "Usage: ${APP}   (no arguments — see RELEASING.md)" >&2; exit 2; }

[ "$(uname)" = "Darwin" ] || die "macOS only — check-mask and check-shader link a libskia with no other slice"
for tool in gh flatc; do
    command -v "$tool" >/dev/null 2>&1 || die "${tool} not found"
done

PKG_NAME=$(node -p "require('${PKG_DIR}/package.json').name")
VERSION=$(node -p "require('${PKG_DIR}/package.json').version")
TAG="v${VERSION}"
# npm's tarball name, as build-release.sh spells it.
TGZ="${OUT}/npm/$(printf '%s' "$PKG_NAME" | sed 's|^@||; s|/|-|g')-${VERSION}.tgz"
UI_NAME=$(node -p "require('${UI_DIR}/package.json').name")
UI_TGZ="${OUT}/npm/$(printf '%s' "$UI_NAME" | sed 's|^@||; s|/|-|g')-${VERSION}.tgz"

# --- the checkout -----------------------------------------------------------
#
# The tag as origin has it, and nothing else. The draft attaches files to that
# tag, so a tarball built from any other tree would be published under a name
# that does not describe it.
#
# Both submodules first, so the tree is compared with them where the tag puts
# them: the vendored flatbuffers headers go in the tarball, and the host checks
# build a host Brain out of the SDK.
git -C "$ROOTDIR" submodule update --init \
    packages/react-native-spritestudio/third_party/flatbuffers SpriteStudio-SDK
[ -z "$(git -C "$ROOTDIR" status --porcelain)" ] || die "the working tree is dirty — commit or stash first"

HEAD=$(git -C "$ROOTDIR" rev-parse HEAD)
# An annotated tag lists twice, and its peeled `^{}` line, the commit, sorts last.
REMOTE=$(git -C "$ROOTDIR" ls-remote origin "refs/tags/${TAG}" "refs/tags/${TAG}^{}" | awk '{ c = $1 } END { print c }')
[ -n "$REMOTE" ] || die "origin has no tag ${TAG} — tag main and push the tag first"
[ "$REMOTE" = "$HEAD" ] || die "HEAD is not ${TAG} — run 'git switch --detach ${TAG}' first"

gh api 'repos/{owner}/{repo}' --silent || die "gh cannot reach this repository — run 'gh auth login'"

echo "${APP}: releasing ${TAG} from ${HEAD}"

# --- the build --------------------------------------------------------------
#
# Every option spelled out, so a release cannot change because a default did.
"${SCRIPTDIR}/build-release.sh" sdk=download out="$OUT" verify=yes clean=yes

for f in "$TGZ" "$UI_TGZ"; do
    [ -f "$f" ] || die "the build produced no $(basename "$f")"
done

# --- the draft --------------------------------------------------------------
#
# A Release that is already there is left alone: delete a draft to have it made
# again.
echo ""
if gh release view "$TAG" >/dev/null 2>&1; then
    echo "${APP}: ${TAG} already has a Release — nothing to draft."
else
    args=(--verify-tag --title "SpriteStudio Player for React Native ${TAG}" --generate-notes --draft)
    channel="$("${SCRIPTDIR}/release-channel.sh" "$TAG")"
    [ "$channel" != prerelease ] || args+=(--prerelease)
    # A patch to an earlier line: the notes start from the full release before
    # it in that line, not from the newest release.
    if [ "$channel" = old ]; then
        previous=$(git -C "$ROOTDIR" tag --list "${TAG%.*}.*" --sort=v:refname |
            awk -v tag="$TAG" '$0 == tag { print previous; exit } $0 !~ /-|[0-9](a|b|rc)[0-9]+$/ { previous = $0 }')
        [ -z "$previous" ] || args+=(--notes-start-tag "$previous")
    fi
    gh release create "$TAG" "$TGZ" "$UI_TGZ" "${OUT}/SHA256SUMS" "${args[@]}"
    echo "${APP}: drafted ${TAG}."
fi
echo "${APP}: nothing is public yet — publishing is steps 6 and 7 of RELEASING.md."
