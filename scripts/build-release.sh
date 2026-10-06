#!/bin/bash
#
# Build the release locally and publish none of it: the tarball `release.sh`
# would attach to the draft Release, packed where you can look inside it, with
# SHA256SUMS over it and the checks that have to pass before it goes out.
#
#   scripts/build-release.sh                      # the whole thing
#   scripts/build-release.sh sdk=build            # compile the Brain here instead
#   scripts/build-release.sh skip=install,checks  # iterate
#   scripts/build-release.sh out=/tmp/rel         # somewhere else
#
# `release.sh` is this with the draft Release on the end. This bumps nothing and
# tags nothing: the tarball carries the version the tree has right now.
#
# **Only the pinned SDK release can be packed.** `download-sdk` writes
# native/VERSION and native/BUILD_MODE; `build-runtime` deletes both, because a
# local Brain comes from a submodule commit that moves — and `prepack` refuses a
# tarball without them (ROADMAP.md, "The pinned SDK release does not exist
# yet"). So `sdk=build` is a REHEARSAL: every stage runs, `lib/` is built, and
# the pack is a dry run that reports the file list an upload would carry. No
# archive, deliberately — there is no way around that gate and this does not
# invent one.
#
# What verification catches, from inside the finished archive rather than off
# the disk `prepack` reads:
#
#   lib/ absent — main and types point into it, and it is gitignored, so a pack
#   that skipped `bob build` ships a package with no entry point.
#
#   Half a Brain — `build-runtime` without Xcode writes the Android slices and
#   no xcframework. That package installs and then fails to link on iOS.
#
#   A licence left behind. The FlatBuffers one got away exactly here: `files`
#   listed the headers and stopped short of the text beside them.
#
#   android/ carrying its own build output — `files` takes a directory whole,
#   which is how that entry once packed 2.8 GB of `.cxx`.
set -euo pipefail

APP=$(basename "$0")
BASEDIR=$(dirname "$0")
SCRIPTDIR=$(cd "$BASEDIR" && pwd -P)
ROOTDIR=$(cd "$BASEDIR/.." && pwd -P)
PKG_DIR="${ROOTDIR}/packages/react-native-spritestudio"

STAGES="install sdk codegen checks pack"

# What `build-runtime` writes and the podspec/CMake read. The Brain ships no
# 32-bit x86.
ANDROID_ABIS="arm64-v8a armeabi-v7a x86_64"

# --- options ----------------------------------------------------------------

OUT="release-dist"
SDK="download"
SKIP=""
VERIFY="yes"
CLEAN=""   # resolved after parsing: no when a stage is skipped, yes otherwise

usage () {
    echo "Usage: ${APP} [options]"
    echo "${APP} options:"
    echo "  out=<dir>               Where the artifacts and SHA256SUMS land (default:"
    echo "                          ${OUT}). Relative paths resolve against the"
    echo "                          current directory."
    echo "  sdk=<download|build|skip>"
    echo "                          Where the Brain comes from (default: ${SDK})."
    echo "                          download = download-sdk.sh, the release pinned in"
    echo "                          scripts/SDK_VERSION.txt — the only source a"
    echo "                          shippable tarball can have. build ="
    echo "                          build-runtime.sh in release mode, from the"
    echo "                          submodule (needs rustup + the NDK, and Xcode for"
    echo "                          the iOS half) — the way through while that release"
    echo "                          does not exist, at the cost of the tarball itself."
    echo "                          skip = keep native/ as it stands."
    echo "  skip=<a,b,...>          Stages to leave out. One or more of:"
    echo "                          ${STAGES}"
    echo "  verify=<yes|no>         Re-open what was built and check it (default:"
    echo "                          ${VERIFY})."
    echo "  clean=<yes|no>          Delete <out> first (default: yes, or no when skip="
    echo "                          is given, so a partial run keeps the rest)."
        echo "  in=                     Accepted and ignored here. The family's build-release"
    echo "                          scripts share out= clean= verify= in= sdk= skip=,"
    echo "                          so one command line drives all of them."
echo "  -h | --help             Show this help"
    echo ""
    echo "Stages:"
    echo "  install   pnpm install --frozen-lockfile"
    echo "  sdk       the Brain in packages/*/native (not in git), per sdk="
    echo "  codegen   re-run nitrogen and flatc, and require no diff"
    echo "  checks    typecheck and the host checks that need no device"
    echo "  pack      npm pack -> <out>/npm, or a dry run -> <out>/rehearsal"
    echo ""
    echo "Output: <out>/npm/<name>-<version>.tgz and its .files listing when the Brain"
    echo "is the pinned release; <out>/rehearsal/ with the listing alone when it is a"
    echo "local build. Either way <out>/manifest.json says which, and SHA256SUMS covers"
    echo "the lot."
    echo ""
    echo "This builds a release; it does not make one. Nothing here publishes, tags,"
    echo "commits or bumps a version."
}

while [ $# -gt 0 ]; do
    item="$1"
    shift
    case "$item" in
        -h|--help|help) usage; exit 0 ;;
        *=*)
            key="${item%%=*}"
            value="${item#*=}"
            case "$key" in
                out)    OUT="$value" ;;
                # Lower-cased, because these are keywords rather than paths.
                sdk)    SDK=$(printf '%s' "$value" | tr '[:upper:]' '[:lower:]') ;;
                verify) VERIFY=$(printf '%s' "$value" | tr '[:upper:]' '[:lower:]') ;;
                clean)  CLEAN=$(printf '%s' "$value" | tr '[:upper:]' '[:lower:]') ;;
                skip)   SKIP=$(printf '%s' "$value" | tr ',' ' ') ;;
                # Accepted so one command line drives build-release in every repository
                # of the family; this one has no use for them.
                in) echo "${APP}: ${key}= does not apply here; ignored" >&2 ;;
                *) echo "${APP}: unknown option '${key}' (see ${APP} --help)" >&2; exit 2 ;;
            esac
            ;;
        *) echo "${APP}: unknown argument '${item}' (options are key=value; see ${APP} --help)" >&2; exit 2 ;;
    esac
done

case "$SDK" in
    download|build|skip) ;;
    *) echo "${APP}: sdk must be download, build or skip (got '${SDK}')" >&2; exit 2 ;;
esac
case "$VERIFY" in
    yes|no) ;;
    *) echo "${APP}: verify must be yes or no (got '${VERIFY}')" >&2; exit 2 ;;
esac

for name in $SKIP; do
    case " ${STAGES} " in
        *" ${name} "*) ;;
        *) echo "${APP}: unknown stage '${name}' in skip= (stages: ${STAGES})" >&2; exit 2 ;;
    esac
done

if [ -z "$CLEAN" ]; then
    if [ -n "$SKIP" ]; then CLEAN="no"; else CLEAN="yes"; fi
fi
case "$CLEAN" in
    yes|no) ;;
    *) echo "${APP}: clean must be yes or no (got '${CLEAN}')" >&2; exit 2 ;;
esac

# Resolve out= against the invoking directory, before anything cds away from it.
case "$OUT" in
    /*) ;;
    *)  OUT="${PWD}/${OUT}" ;;
esac
# clean=yes deletes this path.
if [ "$OUT" = "/" ] || [ "$OUT" = "$ROOTDIR" ]; then
    echo "${APP}: refusing to use '${OUT}' as out= (it is deleted when clean=yes)" >&2
    exit 2
fi

skipping () {
    case " ${SKIP} " in
        *" $1 "*) return 0 ;;
    esac
    return 1
}

# stage <name> <what it does> — true when the stage should run.
stage () {
    local name="$1"
    shift
    echo ""
    if skipping "$name"; then
        echo ">> [${name}] skipped"
        return 1
    fi
    echo ">> [${name}] $*"
    return 0
}

FAILED=""
fail () {
    FAILED="${FAILED}
  $1"
}

# --- preflight --------------------------------------------------------------

[ -f "${PKG_DIR}/package.json" ] || {
    echo "${APP}: ${PKG_DIR}/package.json not found — is this the SSPlayerForReactNative repo?" >&2
    exit 1
}

for tool in node pnpm npm tar git; do
    command -v "$tool" >/dev/null 2>&1 || { echo "${APP}: ${tool} not found" >&2; exit 1; }
done

# Linux has sha256sum, macOS has shasum. Both write `<hash>  <name>` and take
# -c, so SHA256SUMS is the same file either way.
if command -v sha256sum >/dev/null 2>&1; then
    sha256 () { sha256sum "$@"; }
elif command -v shasum >/dev/null 2>&1; then
    sha256 () { shasum -a 256 "$@"; }
else
    echo "${APP}: neither sha256sum nor shasum found" >&2
    exit 1
fi

# Read back below, and a copy ships beside the artifact — the working file
# itself has no business in <out>.
WORK=$(mktemp -d)
trap 'rm -rf "${WORK}"' EXIT
ENTRIES="${WORK}/entries"

HOST=$(uname)
PKG_NAME=$(node -p "require('${PKG_DIR}/package.json').name")
VERSION=$(node -p "require('${PKG_DIR}/package.json').version")
PINNED=$(tr -d ' \r\n' < "${SCRIPTDIR}/SDK_VERSION.txt")
# npm's tarball name: the scope's @ dropped, its / turned into a dash.
TGZ=$(printf '%s' "$PKG_NAME" | sed 's|^@||; s|/|-|g')-${VERSION}.tgz
BASE="${TGZ%.tgz}"

echo "options"
echo "  out    => ${OUT}"
echo "  sdk    => ${SDK}"
echo "  skip   => ${SKIP:-(nothing)}"
echo "  verify => ${VERIFY}"
echo "  clean  => ${CLEAN}"
echo ""
echo "package"
echo "  ${PKG_NAME} ${VERSION}"
echo "  SDK pinned at ${PINNED}"

if [ "$SDK" = "build" ] && ! skipping sdk && [ ! -d "${ROOTDIR}/SpriteStudio-SDK/libs/ssruntime" ]; then
    echo "${APP}: sdk=build needs SpriteStudio-SDK/libs/ssruntime — the submodule is not checked out" >&2
    echo "${APP}: fix it with 'git submodule update --init --recursive'" >&2
    exit 1
fi

# The vendored headers go IN the tarball, and an uninitialised submodule is an
# empty directory that packs as a package whose C++ cannot compile.
git -C "$ROOTDIR" submodule update --init \
    packages/react-native-spritestudio/third_party/flatbuffers >/dev/null

if [ "$CLEAN" = "yes" ]; then
    rm -rf "$OUT"
fi
mkdir -p "$OUT"

cd "$ROOTDIR"

# --- install ----------------------------------------------------------------
if stage install "pnpm install --frozen-lockfile"; then
    pnpm install --frozen-lockfile
fi

# --- the Brain --------------------------------------------------------------
case "$SDK" in
    download) sdk_what="install the pinned release (${PINNED})" ;;
    build)    sdk_what="build the Brain from the submodule (release)" ;;
    skip)     sdk_what="keep packages/*/native as it stands" ;;
esac
if stage sdk "$sdk_what"; then
    case "$SDK" in
        download)
            # While the SDK has no release tag this 404s, and that is the
            # correct failure — there is nothing to publish against yet.
            "${SCRIPTDIR}/download-sdk.sh" || {
                echo "" >&2
                echo "${APP}: the pinned SDK release ${PINNED} could not be installed." >&2
                echo "${APP}: sdk=build rehearses everything that does not need it." >&2
                exit 1
            }
            ;;
        build)
            # Release, always: prepack refuses a debug Brain and a release asset
            # is a release build. Only Xcode can produce the iOS half, so
            # elsewhere this builds the Android slices and the verification
            # below reports the tarball as the half-platform one it is.
            if [ "$HOST" = "Darwin" ]; then
                "${SCRIPTDIR}/build-runtime.sh" build=release
            else
                echo "   not macOS — Android slices only (the xcframework needs Xcode)"
                "${SCRIPTDIR}/build-runtime.sh" build=release platform=android
            fi
            ;;
        skip)
            echo "   sdk=skip"
            ;;
    esac
fi

[ -d "${PKG_DIR}/native/libs" ] || {
    echo "${APP}: packages/react-native-spritestudio/native/libs is missing — the Brain is not installed" >&2
    echo "${APP}: run with sdk=download, or sdk=build to compile it from the submodule" >&2
    exit 1
}

BRAIN_VERSION="(none)"
BRAIN_MODE="(none)"
[ -f "${PKG_DIR}/native/VERSION" ] && BRAIN_VERSION=$(tr -d ' \r\n' < "${PKG_DIR}/native/VERSION")
[ -f "${PKG_DIR}/native/BUILD_MODE" ] && BRAIN_MODE=$(tr -d ' \r\n' < "${PKG_DIR}/native/BUILD_MODE")

# An older release still sitting in native/ would pack as this one.
if [ "$BRAIN_VERSION" != "(none)" ] && [ "$BRAIN_VERSION" != "$PINNED" ]; then
    echo "${APP}: native/ holds SDK ${BRAIN_VERSION}, but scripts/SDK_VERSION.txt pins ${PINNED}" >&2
    echo "${APP}: run with sdk=download to install the pinned one" >&2
    exit 1
fi

# The one question that decides what this run can produce.
if [ "$BRAIN_VERSION" != "(none)" ] && [ "$BRAIN_MODE" = "release" ]; then
    SHIPPABLE="yes"
else
    SHIPPABLE="no"
fi

echo ""
echo "brain"
echo "  version => ${BRAIN_VERSION}"
echo "  mode    => ${BRAIN_MODE}"
if [ "$SHIPPABLE" = "yes" ]; then
    echo "  => the pinned release: this run packs a tarball"
else
    echo "  => a local build: prepack refuses to pack one, so this run is a REHEARSAL"
fi

# --- generated code ---------------------------------------------------------
#
# Both generators are committed, so a stale one ships bindings that disagree
# with the spec, or reads FrameData at the wrong offsets.
if stage codegen "re-run the generators and require no diff"; then
    "${SCRIPTDIR}/generate-nitro-code.sh" >/dev/null
    git -C "$ROOTDIR" diff --exit-code -- packages/react-native-spritestudio/nitrogen >/dev/null \
        || { echo "${APP}: nitrogen/ is stale — commit the regenerated output" >&2; exit 1; }
    echo "   nitrogen/ current"

    if command -v flatc >/dev/null 2>&1; then
        "${SCRIPTDIR}/generate-fbs-code.sh" >/dev/null
        git -C "$ROOTDIR" diff --exit-code -- packages/react-native-spritestudio/cpp/format >/dev/null \
            || { echo "${APP}: cpp/format/ is stale — commit the regenerated output" >&2; exit 1; }
        echo "   cpp/format/ current"
    else
        echo "   cpp/format/ SKIPPED (no flatc)"
    fi
fi

# --- the checks -------------------------------------------------------------
#
# The ones that run without a device: the difference between "it compiles" and
# "it draws what it drew last time".
if stage checks "typecheck and the host checks"; then
    pnpm run typecheck
    pnpm run check-web-barrel

    if command -v flatc >/dev/null 2>&1; then
        pnpm run check-framedata
    else
        echo "   check-framedata SKIPPED (no flatc)"
    fi

    pnpm run check-hidden

    # Both link the host libskia RN Skia ships, which has no Linux slice.
    if [ "$HOST" = "Darwin" ]; then
        pnpm run check-mask
        pnpm run check-shader
    else
        echo "   check-mask / check-shader SKIPPED (macOS only)"
    fi
fi

# --- the pack ---------------------------------------------------------------
#
# `npm pack` runs prepack, which is `bob build` and then the guard that refuses
# anything a consumer could not use. The rehearsal runs those two by hand
# instead: --ignore-scripts is what lets the listing be produced at all once the
# guard has had its say.
PACKED=""

if stage pack "pack ${TGZ}"; then
    if [ "$SHIPPABLE" = "yes" ]; then
        mkdir -p "${OUT}/npm"
        ( cd "$PKG_DIR" && npm pack --pack-destination "${OUT}/npm" --foreground-scripts )
        [ -f "${OUT}/npm/${TGZ}" ] || { echo "${APP}: npm pack did not produce ${TGZ}" >&2; exit 1; }
        PACKED="${OUT}/npm/${TGZ}"
        # The archive's own paths, with npm's wrapper directory dropped.
        tar -tzf "$PACKED" | sed 's|^package/||' | grep -v '/$' | LC_ALL=C sort > "$ENTRIES"
        cp "$ENTRIES" "${OUT}/npm/${BASE}.files"
        echo "   npm/${TGZ}"
    else
        mkdir -p "${OUT}/rehearsal"
        pnpm --filter "$PKG_NAME" run build

        # prepack's own report, kept: its refusal is the interesting half. Only
        # the missing BUILD_MODE is expected — anything else it finds would have
        # stopped a real pack too, and still does.
        report="${OUT}/rehearsal/${BASE}.prepack.txt"
        set +e
        ( cd "$PKG_DIR" && node scripts/prepack.mjs ) > "$report" 2>&1
        prepack_status=$?
        set -e
        if [ "$prepack_status" != "0" ]; then
            # Exactly one problem, and it is the missing marker. Its own count
            # line is what says so — anything else it found would have stopped a
            # real pack too, and still does.
            problems=$(sed -n 's/^prepack: \([0-9][0-9]*\) problem.*/\1/p' "$report" | head -1)
            if [ "$problems" != "1" ] || ! grep -q 'native/BUILD_MODE is missing' "$report"; then
                cat "$report" >&2
                echo "${APP}: prepack refuses this tree for more than the local Brain" >&2
                exit 1
            fi
            echo "   prepack refuses it, as designed (a local Brain is not the pinned release)"
        fi

        ( cd "$PKG_DIR" && npm pack --dry-run --ignore-scripts --json ) \
            > "${OUT}/rehearsal/${BASE}.pack.json"
        node -e '
            const p = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"))[0];
            require("node:fs").writeFileSync(process.argv[2],
                p.files.map((f) => f.path).sort().join("\n") + "\n");
            console.log(`   ${p.entryCount} entries, ${(p.unpackedSize / 1024 / 1024).toFixed(1)} MB unpacked`);
        ' "${OUT}/rehearsal/${BASE}.pack.json" "$ENTRIES"
        cp "$ENTRIES" "${OUT}/rehearsal/${BASE}.files"
        echo "   rehearsal/${BASE}.files — no archive (see the header of this script)"
    fi
fi

# --- the manifest -----------------------------------------------------------
#
# What this run produced, as data rather than as a listing to be read.
echo ""
echo ">> [manifest] writing manifest.json"
node -e '
    const [out, name, version, brainVersion, brainMode, source, pinned, shippable, tgz] = process.argv.slice(1);
    const { existsSync, writeFileSync } = require("node:fs");
    const manifest = {
        shippable: shippable === "yes",
        package: { name, version },
        brain: { source, version: brainVersion, mode: brainMode, pinned },
        npm: [],
    };
    if (existsSync(`${out}/npm/${tgz}`)) {
        manifest.npm.push({ package: name, version, file: `npm/${tgz}` });
    }
    writeFileSync(`${out}/manifest.json`, JSON.stringify(manifest, null, 2) + "\n");
' "$OUT" "$PKG_NAME" "$VERSION" "$BRAIN_VERSION" "$BRAIN_MODE" "$SDK" "$PINNED" "$SHIPPABLE" "$TGZ"
echo "   shippable: ${SHIPPABLE}"

# --- checksums --------------------------------------------------------------
#
# Over whatever is in <out>, not over what this run produced: with clean=no an
# earlier run's artifacts are still there, and half a SHA256SUMS is worse than
# none.
sums_files=()
while IFS= read -r f; do
    sums_files+=("$f")
done < <(cd "$OUT" && find . -type f ! -name SHA256SUMS | sed 's|^\./||' | LC_ALL=C sort)

echo ""
if [ "${#sums_files[@]}" -eq 0 ]; then
    echo ">> [checksums] nothing in ${OUT} to sum"
    echo ""
    echo "${APP}: every stage that produces a file was skipped — nothing was built." >&2
    exit 1
fi
echo ">> [checksums] writing SHA256SUMS"
( cd "$OUT" && sha256 "${sums_files[@]}" > SHA256SUMS )
echo "   ${#sums_files[@]} file(s)"

# --- verify -----------------------------------------------------------------

has_entry () { grep -Fxq -- "$1" "$ENTRIES"; }
# Prefix rather than regex: these paths carry dots and a .xcframework.
has_prefix () { awk -v p="$1" 'index($0, p) == 1 { hit = 1; exit } END { exit !hit }' "$ENTRIES"; }

if [ "$VERIFY" = "yes" ] && [ -f "$ENTRIES" ]; then
    echo ""
    echo ">> [verify] reading back what would be uploaded"

    # 1. the entry points. main/types live in lib/, which is gitignored build
    #    output — this is where a pack that skipped `bob build` shows up.
    for f in lib/module/index.js lib/typescript/index.d.ts; do
        has_entry "$f" || fail "${f} is not in the package (did bob build run?)"
    done

    # 2. what package.json points at, whatever it points at today.
    while IFS= read -r target; do
        [ -n "$target" ] || continue
        has_entry "$target" || fail "package.json points at '${target}', which is not in the package"
    done <<< "$(node -p "
        const p = require('${PKG_DIR}/package.json');
        ['main', 'types', 'module', 'react-native', 'source', 'browser']
            .map((k) => p[k]).filter(Boolean).join('\n')
    ")"

    # 3. every path the files allow-list promises.
    while IFS= read -r entry; do
        [ -n "$entry" ] || continue
        case "$entry" in
            # Globs are npm's to expand.
            *'*'*) continue ;;
            # Absent by construction for a local Brain, which is what makes a
            # rehearsal a rehearsal.
            native/VERSION|native/BUILD_MODE) [ "$SHIPPABLE" = "yes" ] || continue ;;
        esac
        has_entry "$entry" || has_prefix "${entry}/" \
            || fail "'${entry}' is in the files allow-list but not in the package"
    done <<< "$(node -p "(require('${PKG_DIR}/package.json').files || []).join('\n')")"

    # 4. the Brain, both platforms. A package with one of them installs and then
    #    fails to link on the other — so this is fatal, except in the one case
    #    where the host was never able to produce the iOS half.
    if has_prefix "native/libs/ios/libssruntime.xcframework/"; then
        grep -q '^native/libs/ios/libssruntime\.xcframework/.*\.a$' "$ENTRIES" \
            || fail "the iOS xcframework carries no static library"
    elif [ "$SHIPPABLE" = "yes" ] || [ "$SDK" != "build" ] || [ "$HOST" = "Darwin" ]; then
        fail "no iOS xcframework in the package (build it on macOS, or use sdk=download)"
    else
        echo "   note: no iOS xcframework — ${HOST} cannot build one, and only sdk=download carries it"
    fi
    for abi in $ANDROID_ABIS; do
        has_entry "native/libs/android/${abi}/libssruntime.a" \
            || fail "no Android ${abi} slice in the package"
    done
    has_entry "native/include/ssruntime.h" || fail "native/include/ssruntime.h is missing — cpp/ includes it"

    # 5. the licences the package promises to carry. THIRD_PARTY_NOTICES.md
    #    names all three as files to redistribute.
    for f in native/LICENSE.md native/THIRD-PARTY-LICENSES.ssruntime.md third_party/flatbuffers/LICENSE; do
        has_entry "$f" || fail "${f} is missing — THIRD_PARTY_NOTICES.md names it as a file to redistribute"
    done
    has_entry "third_party/flatbuffers/include/flatbuffers/flatbuffers.h" \
        || fail "the vendored flatbuffers headers are missing (submodule not initialised?)"

    # 6. the native glue a consumer builds, and the generated halves of it.
    has_prefix "cpp/format/" || fail "cpp/format/ is missing — the FlatBuffers accessors are generated and committed"
    has_prefix "nitrogen/generated/" || fail "nitrogen/generated/ is missing — the Nitro bindings"
    grep -q '\.podspec$' "$ENTRIES" || fail "no podspec in the package — CocoaPods has nothing to read"
    for f in android/CMakeLists.txt android/build.gradle app.plugin.js nitro.json; do
        has_entry "$f" || fail "${f} is missing"
    done

    # 7. build output that rode along. `files` takes a directory whole.
    for bad in android/build/ android/.cxx/ node_modules/ example/; do
        if has_prefix "$bad"; then
            fail "'${bad}' is in the package — a files entry is taking a directory whole"
        fi
    done

    # 8. what the archive says about itself. Only a real one can be asked.
    if [ -n "$PACKED" ]; then
        manifest="${WORK}/packed.json"
        tar -xzOf "$PACKED" package/package.json > "$manifest"
        packed_name=$(node -p "require('${manifest}').name")
        packed_version=$(node -p "require('${manifest}').version")
        [ "$packed_name" = "$PKG_NAME" ] || fail "the tarball says name ${packed_name}, expected ${PKG_NAME}"
        [ "$packed_version" = "$VERSION" ] || fail "the tarball says version ${packed_version}, expected ${VERSION}"
        if [ "$(node -p "require('${manifest}').private === true")" = "true" ]; then
            fail "the tarball is marked private — it cannot go to npm"
        fi
        # A local path or a workspace protocol resolves in this repo and nowhere
        # else.
        if grep -Eq '"(workspace|file|link):' "$manifest"; then
            fail "the tarball has a workspace:/file:/link: range in its dependencies"
        fi

        packed_mode=$(tar -xzOf "$PACKED" package/native/BUILD_MODE 2>/dev/null | tr -d ' \r\n' || true)
        packed_sdk=$(tar -xzOf "$PACKED" package/native/VERSION 2>/dev/null | tr -d ' \r\n' || true)
        [ "$packed_mode" = "release" ] || fail "the tarball carries a '${packed_mode}' Brain — a debug build ships as a slow player with nothing to say why"
        [ "$packed_sdk" = "$PINNED" ] || fail "the tarball carries SDK '${packed_sdk}', expected the pinned ${PINNED}"
    fi

    ( cd "$OUT" && sha256 -c SHA256SUMS > /dev/null ) || fail "SHA256SUMS does not verify"

    if [ -n "$FAILED" ]; then
        echo "" >&2
        echo "${APP}: what is in ${OUT} is not shippable:${FAILED}" >&2
        exit 1
    fi
    echo "   all checks passed"
elif [ "$VERIFY" = "no" ]; then
    echo ""
    echo ">> [verify] verify=no — nothing was checked"
else
    echo ""
    echo ">> [verify] nothing to read back — the pack stage did not run"
fi

# --- done -------------------------------------------------------------------
echo ""
echo "${APP}: done -> ${OUT}"
echo ""
( cd "$OUT" && find . -type f | sed 's|^\./||' | LC_ALL=C sort | while IFS= read -r f; do
    printf '  %10s  %s\n' "$(wc -c < "$f" | tr -d ' ')" "$f"
done )
echo ""
if [ "$SHIPPABLE" = "yes" ]; then
    echo "${APP}: nothing was published. 'pnpm run release', on the tag, is the same run with the draft Release on the end."
    if [ -n "$PACKED" ]; then
        echo ""
        echo "${APP}: try it before shipping it — install the tarball into a scratch app:"
        echo "  npx create-expo-app scratch && cd scratch"
        echo "  npm i ${PACKED} && npx expo prebuild"
    fi
else
    echo "${APP}: REHEARSAL — no tarball. The Brain in native/ is a local build, and"
    echo "${APP}: prepack refuses to pack one (ROADMAP.md, 'The pinned SDK release does"
    echo "${APP}: not exist yet'). Everything else ran; ${BASE}.files is what an upload"
    echo "${APP}: would have carried."
fi
