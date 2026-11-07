cmake_minimum_required(VERSION 3.22.1)
project(SsPlayer)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

set(PACKAGE_ROOT "${CMAKE_SOURCE_DIR}/..")
set(NATIVE_DIR "${PACKAGE_ROOT}/native")

# The Brain is never committed — download-sdk or build-runtime places it — so
# fail here with the fix rather than with an unresolved-symbol wall at link time.
set(SSRUNTIME_LIB "${NATIVE_DIR}/libs/android/${ANDROID_ABI}/libssruntime.a")
if(NOT EXISTS "${SSRUNTIME_LIB}")
  # Two very different causes, and the message has to tell them apart: the SDK
  # is not installed at all, or it is installed and simply does not build this
  # ABI. 32-bit `x86` is the second — emulator-only, no meaningful device share,
  # and `x86_64` already covers the emulator — but it is in Expo's default
  # `reactNativeArchitectures`, so an app reaches it without ever asking.
  if(EXISTS "${NATIVE_DIR}/libs/android")
    message(FATAL_ERROR
      "The SpriteStudio runtime does not ship a ${ANDROID_ABI} slice.\n"
      "Drop it from `reactNativeArchitectures` in android/gradle.properties, or pass\n"
      "    ./gradlew <task> -PreactNativeArchitectures=arm64-v8a,x86_64\n"
      "(An Expo app using the config plugin has this removed for it at prebuild.)\n"
      "Expected at: ${SSRUNTIME_LIB}")
  endif()
  message(FATAL_ERROR
    "libssruntime.a for ${ANDROID_ABI} is missing.\n"
    "Install it first with either:\n"
    "    scripts/download-sdk.sh                              (pinned release, no Rust needed)\n"
    "    scripts/build-runtime.sh platform=android build=debug (from the submodule)\n"
    "Expected at: ${SSRUNTIME_LIB}")
endif()

add_library(SsPlayer SHARED
  ../cpp/SsAssets.cpp
  ../cpp/SsBaker.cpp
  ../cpp/SsEffect.cpp
  ../cpp/SsInstance.cpp
  ../cpp/SsMask.cpp
  ../cpp/SsRNSkiaInterop.cpp
  ../cpp/SsSkiaDraw.cpp
  ../cpp/HybridSsResource.cpp
  ../cpp/HybridSsContext.cpp
  ../cpp/HybridSsRuntime.cpp
  # Android only: the `JNI_OnLoad` that registers the Hybrid Objects. Nitrogen
  # generates the registration but not its caller.
  ../cpp/SsPlayerJni.cpp
)

target_include_directories(SsPlayer PRIVATE
  ../cpp
  "${NATIVE_DIR}/include"
  # FlatBuffers, header-only: cpp/format/{ssab,framedata}.h (flatc output,
  # committed) pull in flatbuffers/flatbuffers.h and their reachable set is all
  # inline, so nothing links against flatc's own translation units and
  # flatbuffers/src stays off the path. The vendored version must match the
  # flatc that generated them — the headers static_assert on it.
  ../third_party/flatbuffers/include
)

# Drawing straight into RN Skia's SkCanvas needs RN Skia's own
# C++ plus the Skia headers it includes, and it needs Skia's symbols to resolve
# at link time.
#
# Both come from RN Skia's own prefab. Its Android build links `libskia.a` (and
# skshaper/skottie/...) statically into `librnskia.so` and publishes that as a
# prefab module named `rnskia`, with the headers laid out under
# `react-native-skia/` — its own flattened, Skia's `include/` tree preserved. So
# linking that one target supplies the API *and* the symbols, with exactly one
# copy of Skia in the process: ours would be a second set of Skia's globals if
# we linked the archives ourselves.
#
# Two include dirs on purpose. The root lets `#include <react-native-skia/...>`
# work; the `react-native-skia` subdir lets the unqualified `#include
# "JsiSkCanvas.h"` in SsRNSkiaInterop.cpp work the same way it does on iOS, and
# those headers' own `#include "include/core/SkCanvas.h"` then resolves relative
# to the including file.
# The prefab package is named after the Gradle project, `react-native-skia`.
find_package(react-native-skia CONFIG QUIET)
if(TARGET react-native-skia::rnskia)
  set(RNSKIA_TARGET react-native-skia::rnskia)
endif()

if(DEFINED RNSKIA_TARGET)
  set(SSPLAYER_ENABLE_SKIA_DIRECT 1)

  # Library from the prefab, headers from RN Skia's source tree — not from the
  # prefab's own header set, which does not compile. Its `prepareHeaders` task
  # flattens `cpp/**` into one directory, so `cpp/jsi/JSIConverter.h` lands as
  # `JSIConverter.h` while `JsiSkConverters.h` still includes it as
  # `"jsi/JSIConverter.h"`. Anything that pulls that in fails to compile.
  #
  # The source tree keeps the structure, and these are the same three paths the
  # podspec uses on iOS, so both platforms resolve `#include "JsiSkCanvas.h"`
  # the same way. Derived from the prefab's include dir rather than guessed,
  # because where the package sits depends on the package manager.
  get_target_property(RNSKIA_INCLUDE ${RNSKIA_TARGET} INTERFACE_INCLUDE_DIRECTORIES)
  string(REGEX REPLACE "/android/build/headers/rnskia/?$" "" RNSKIA_ROOT "${RNSKIA_INCLUDE}")
  if(NOT EXISTS "${RNSKIA_ROOT}/cpp/api")
    message(FATAL_ERROR
      "SsPlayer: could not locate RN Skia's cpp/ from '${RNSKIA_INCLUDE}'. "
      "Its prefab header layout changed — see the comment above.")
  endif()
  target_include_directories(SsPlayer PRIVATE
    "${RNSKIA_ROOT}/cpp"       # JsiSkCanvas.h, JsiSkPaint.h
    "${RNSKIA_ROOT}/cpp/api"   # their siblings, included unqualified
    "${RNSKIA_ROOT}/cpp/skia"  # satisfies RN Skia's "include/core/..." includes
    "${RNSKIA_ROOT}/cpp/dawn/include"  # webgpu_cpp.h, which JsiSkImage.h reaches through RNDawnContext.h
  )

  # The defines react-native-skia compiles its own sources with. Skia's headers
  # declare the Graphite API only under SK_GRAPHITE, and the RN Skia headers
  # above include it, so every unit here sees Skia the way RN Skia does.
  target_compile_definitions(SsPlayer PRIVATE
    SK_GRAPHITE
    SK_IMAGE_READ_PIXELS_DISABLE_LEGACY_API
    SK_DISABLE_LEGACY_SHAPER_FACTORY
  )

  # `librnskia.so` is not enough on its own. Skia is built with hidden
  # visibility and exports only what `SK_API` marks, so `SkCanvas::drawVertices`
  # resolves out of the prefab while `SkVertices::MakeCopy` and
  # `sk_abort_no_print` sit in the same .so as *local* symbols (`nm -C` shows
  # them as `t`, not `T`) and do not. RN Skia ships `JsiSkVertices.h`, whose
  # inline code calls `MakeCopy`, so any consumer of its prefab hits this.
  #
  # A static archive after the shared library closes the gap without a second
  # Skia: the linker takes everything the .so exports from the .so, and pulls
  # only the still-undefined leaf objects out of `libskia.a`. Those are
  # self-contained value types with no global state — an `SkVertices` this side
  # builds is consumed by `drawVertices` over there, which is safe because both
  # sides are the same Skia build compiled against the same headers.
  #
  # Order matters: the archive has to come after the prefab target below, or the
  # linker satisfies everything from the archive and there really are two Skias.
  # RN Skia's own dependency, so it sits in the node_modules that holds RN Skia:
  # the hoisted tree under npm, RN Skia's store entry under pnpm.
  get_filename_component(RNSKIA_NODE_MODULES "${RNSKIA_ROOT}/.." ABSOLUTE)
  set(SKIA_ARCHIVE "${RNSKIA_NODE_MODULES}/react-native-skia-graphite-android/libs/${ANDROID_ABI}/libskia.a")
  if(NOT EXISTS "${SKIA_ARCHIVE}")
    message(FATAL_ERROR "SsPlayer: libskia.a not found at ${SKIA_ARCHIVE}")
  endif()
  add_library(skia_static STATIC IMPORTED)
  set_target_properties(skia_static PROPERTIES IMPORTED_LOCATION "${SKIA_ARCHIVE}")

  message(STATUS "SsPlayer: direct Skia drawing ON (${RNSKIA_TARGET})")
else()
  # Without RN Skia's prefab there is nothing to resolve `SkCanvas` against.
  # Build with the flag off so the module still loads and only `drawInto()`
  # reports itself unavailable, rather than failing the whole link.
  set(SSPLAYER_ENABLE_SKIA_DIRECT 0)
  message(WARNING "SsPlayer: rnskia prefab not found — drawInto() will be unavailable")
endif()

target_compile_definitions(SsPlayer PRIVATE
  SSPLAYER_SDK_VERSION="${SSPLAYER_SDK_VERSION}"
  SSPLAYER_ENABLE_SKIA_DIRECT=${SSPLAYER_ENABLE_SKIA_DIRECT}
)

# Static: the Brain's objects land inside libSsPlayer.so, so there is no second
# .so to package and no dlopen ordering to get right.
add_library(ssruntime STATIC IMPORTED)
set_target_properties(ssruntime PROPERTIES IMPORTED_LOCATION "${SSRUNTIME_LIB}")

# Pulls in the nitrogen-generated sources, the RN/JSI/fbjni prefabs and the
# NitroModules core, and adds them to the SsPlayer target defined above.
include("${PACKAGE_ROOT}/nitrogen/generated/android/SsPlayer+autolinking.cmake")

target_link_libraries(SsPlayer
  ssruntime
  android
  log
)

if(DEFINED RNSKIA_TARGET)
  # Shared first, archive second — see the note where `skia_static` is defined.
  target_link_libraries(SsPlayer ${RNSKIA_TARGET} skia_static)
endif()
