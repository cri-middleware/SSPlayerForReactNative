#!/usr/bin/env bash
#
# Convert the SDK's bundled test projects into .ssab assets for example/.
#
# Unlike the Flutter Player, this repo bundles no converter: React Native has no
# editor to hook an importer into, so `.sspj` -> `.ssab` is a host-side step
# (design doc ch.5 / ch.9 G). This script is the developer convenience that runs
# the SDK submodule's own `ssconverter-cli` — it needs the Rust toolchain, same
# as scripts/build-runtime.sh. Consumers of the npm package never run either.
#
# Output lands in example/assets/ss/<stem>/ and is git-ignored: it is derived
# from the submodule, so committing it would be a second copy to keep in sync.
#
# Usage: scripts/deploy-examples.sh [--embedded]
#   --embedded  bake textures into the .ssab instead of copying them alongside.
#               The example exercises the REFERENCE layout by default because
#               that is the one with a texture-loading path to get wrong.
#
# SDK location: $SSSDK, else ./SpriteStudio-SDK, else ../SpriteStudio-SDK.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd -P)"
OUT_ROOT="$ROOT_DIR/example/assets/ss"

# "<SDK tests subdir>|<.sspj filename>". The output directory is the .sspj stem.
#
# Both are deliberate: Ringo is the character case, ParticleEffect is the
# worst case the Phase 0 measurement is actually about — design doc ch.8 is
# explicit that the vertex ceiling is set by effects, not by characters.
PROJECTS=(
  "Ringo|Ringo.sspj"
  "ParticleEffect|ParticleEffect.sspj"
)

EMBEDDED=""
for arg in "$@"; do
  case "$arg" in
    --embedded) EMBEDDED="--embedded" ;;
    -h|--help) sed -n '/^# Usage:/,/^# SDK location/p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "deploy-examples.sh: unknown arg '$arg'" >&2; exit 2 ;;
  esac
done

SDK_DIR="${SSSDK:-}"
if [ -z "$SDK_DIR" ]; then
  for cand in "$ROOT_DIR/SpriteStudio-SDK" "$ROOT_DIR/../SpriteStudio-SDK"; do
    if [ -f "$cand/Cargo.toml" ]; then SDK_DIR="$(cd "$cand" && pwd -P)"; break; fi
  done
fi
[ -n "$SDK_DIR" ] && [ -f "$SDK_DIR/Cargo.toml" ] || {
  echo "deploy-examples.sh: SpriteStudio-SDK not found." >&2
  echo "  run: git submodule update --init --recursive   (or set SSSDK)" >&2
  exit 1
}

command -v cargo >/dev/null || {
  echo "deploy-examples.sh: cargo not found — install Rust to run the SDK's ssconverter-cli." >&2
  exit 1
}

deploy_project() {
  local sdk_sub="$1" sspj="$2"
  local stem="${sspj%.sspj}"
  local src="$SDK_DIR/tests/$sdk_sub/$sspj"
  local out="$OUT_ROOT/$stem"

  [ -f "$src" ] || {
    echo "deploy-examples.sh: $sdk_sub/$sspj not found in the SDK submodule" >&2
    exit 1
  }

  echo "==> converting tests/$sdk_sub/$sspj"
  rm -rf "$out"
  mkdir -p "$out"
  # The non-embedded converter also copies the referenced textures into the
  # output, so this one call produces the complete asset tree.
  ( cd "$SDK_DIR" && cargo run -q -p ssconverter-cli -- ${EMBEDDED:+$EMBEDDED} -o "$out" "$src" )
  echo "    -> example/assets/ss/$stem/"
}

for entry in "${PROJECTS[@]}"; do
  deploy_project "${entry%%|*}" "${entry##*|}"
done

echo "deploy-examples.sh: done."
