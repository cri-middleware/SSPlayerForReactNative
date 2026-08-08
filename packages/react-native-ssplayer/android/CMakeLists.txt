cmake_minimum_required(VERSION 3.22.1)
project(SsPlayer)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

set(PACKAGE_ROOT "${CMAKE_SOURCE_DIR}/..")
set(NATIVE_DIR "${PACKAGE_ROOT}/native")

# The Brain is never committed (design doc ch.7) — fail here with the fix rather
# than with an unresolved-symbol wall at link time.
set(SSRUNTIME_LIB "${NATIVE_DIR}/libs/android/${ANDROID_ABI}/libssruntime.a")
if(NOT EXISTS "${SSRUNTIME_LIB}")
  message(FATAL_ERROR
    "libssruntime.a for ${ANDROID_ABI} is missing.\n"
    "Install it first with either:\n"
    "    scripts/download-sdk.sh                              (pinned release, no Rust needed)\n"
    "    scripts/build-runtime.sh platform=android build=debug (from the submodule)\n"
    "Expected at: ${SSRUNTIME_LIB}")
endif()

add_library(SsPlayer SHARED
  ../cpp/SsBaker.cpp
  ../cpp/SsSkiaBridge.cpp
  ../cpp/SsSkiaDraw.cpp
  ../cpp/HybridSsResource.cpp
  ../cpp/HybridSsContext.cpp
  ../cpp/HybridSsRuntime.cpp
)

target_include_directories(SsPlayer PRIVATE
  ../cpp
  "${NATIVE_DIR}/include"
  # FlatBuffers, header-only: cpp/format/ssab.h (flatc output, committed) pulls
  # in flatbuffers/flatbuffers.h and its reachable set is all inline, so nothing
  # links against flatc's own translation units and flatbuffers/src stays off
  # the path. Same arrangement as SSPlayerForGodot's ss_player/sources.py.
  ../third_party/flatbuffers/include
)

# Variant (c) — drawing straight into RN Skia's SkCanvas — needs RN Skia's own
# C++ plus the Skia headers it includes. Walk upwards for the package rather
# than assuming a path, since npm may hoist it to the workspace root.
#
# Android is not wired for it yet: even with the headers, libSsPlayer.so would
# have to resolve Skia's symbols out of libskia.a, and RN Skia's Android build
# does not publish a prefab for that. Until it does, Android builds with the
# flag off and drawInto() reports itself unavailable rather than link-failing.
set(SSPLAYER_ENABLE_SKIA_DIRECT 0)
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
