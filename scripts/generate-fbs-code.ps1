# Generate the C++ FlatBuffers accessors for the `.ssab` asset format.
#
#   SpriteStudio-SDK/libs/ssab/fbs/ssab.fbs
#     -> packages/react-native-spritestudio/cpp/format/ssab.h
#
# Why the Player parses the `.ssab` at all: libssruntime deliberately returns
# none of the metadata rendering needs - cellmap names, texture paths, animation
# names - and tells Players to read it out of the ssab themselves
# (20_design/20_architecture.md). Texture loading is the first thing that needs
# it.
#
# Same shape as SSPlayerForGodot's scripts/generate-runtime-code.sh: flatc -c,
# and the _generated suffix dropped on the way into format/. FlatBuffers is used
# header-only - the generated header pulls in flatbuffers/flatbuffers.h and its
# reachable set is all inline, so nothing links against flatc's own translation
# units and flatbuffers/src never goes on the include path.
#
# The output IS committed, so a normal checkout builds without flatc - the same
# treatment as nitrogen/. Run this only when the schema changes.
#
# Not framedata: that one stays hand-written in cpp/SsFrameData.hpp because
# 30_core/30_render_loop.md section 2 tells Players to read its struct vectors
# raw rather than through per-element accessors, so generated accessors would be
# bypassed on the hot path anyway. The .ssab is read once per load.
#
# Usage: scripts/generate-fbs-code.ps1
#
# Prerequisites: flatc.
# SDK location: $env:SSSDK, else .\SpriteStudio-SDK, else ..\SpriteStudio-SDK.

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $PSCommandPath
$rootDir = Split-Path -Parent $scriptDir
$app = Split-Path -Leaf $PSCommandPath

$outDir = Join-Path $rootDir "packages/react-native-spritestudio/cpp/format"

if (-not (Get-Command flatc -ErrorAction SilentlyContinue)) {
    Write-Error "$app`: flatc not found - install Google FlatBuffers."
    exit 1
}

$sdkDir = $env:SSSDK
if (-not $sdkDir) {
    foreach ($candidate in @((Join-Path $rootDir "SpriteStudio-SDK"), (Join-Path $rootDir "../SpriteStudio-SDK"))) {
        if (Test-Path (Join-Path $candidate "Cargo.toml")) { $sdkDir = (Resolve-Path $candidate).Path; break }
    }
}
if (-not $sdkDir -or -not (Test-Path (Join-Path $sdkDir "Cargo.toml"))) {
    Write-Error "$app`: SpriteStudio-SDK not found. Run: git submodule update --init --recursive (or set SSSDK)"
    exit 1
}

$fbs = Join-Path $sdkDir "libs/ssab/fbs/ssab.fbs"
if (-not (Test-Path $fbs)) {
    Write-Error "$app`: $fbs not found in the SDK submodule"
    exit 1
}

Write-Host "Generating C++ FlatBuffers accessors (flatc -c) ..."
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
Push-Location $outDir
try {
    flatc -c $fbs
    if ($LASTEXITCODE -ne 0) { throw "flatc failed for $fbs" }
    Move-Item -Force ssab_generated.h ssab.h
} finally {
    Pop-Location
}

Write-Host "Generated packages/react-native-spritestudio/cpp/format/ssab.h"
Write-Host "Done."
