# Generate the C++ FlatBuffers accessors for the two schemas this Player reads.
#
#   SpriteStudio-SDK/libs/ssab/fbs/ssab.fbs
#     -> packages/react-native-spritestudio/cpp/format/ssab.h
#   SpriteStudio-SDK/libs/ssruntime/fbs/framedata.fbs
#     -> packages/react-native-spritestudio/cpp/format/framedata.h
#
# Why the Player parses the `.ssab` at all: libssruntime deliberately returns
# none of the metadata rendering needs - cellmap names, texture paths, animation
# names - and tells Players to read it out of the ssab themselves
# (20_design/20_architecture.md). Texture loading is the first thing that needs
# it.
#
# framedata is the Brain's per-frame output, read on the hot path. Generated
# accessors are the right tool there too, contrary to what this script used to
# say: flatc's C++ struct fields are direct member reads through EndianScalar (a
# no-op on little-endian), and Vector<const T*>::Data() hands back the
# contiguous pointer, so 30_core/30_render_loop.md section 2's "read the struct
# vectors raw" is satisfied through the generated code rather than around it.
# The ~26x figure that argument leaned on is a Unity/C# measurement, where each
# accessor is a ByteBuffer read; it does not carry to C++.
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
# The committed headers must match the Brain in native/, not merely whatever the
# submodule is checked out at: a stale framedata.h misreads the buffer silently.
# tools/check-framedata.sh is the guard - it regenerates and diffs. That guard is
# macOS/Linux-only, so on Windows treat a schema bump as needing a check on CI.
#
# Usage: scripts/generate-fbs-code.ps1 [outDir]
#
# Prerequisites: flatc.
# SDK location: $env:SSSDK, else .\SpriteStudio-SDK, else ..\SpriteStudio-SDK.

param([string]$OutDir)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $PSCommandPath
$rootDir = Split-Path -Parent $scriptDir
$app = Split-Path -Leaf $PSCommandPath

if (-not $OutDir) { $OutDir = Join-Path $rootDir "packages/react-native-spritestudio/cpp/format" }

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

# The stem is both flatc's output prefix (<stem>_generated.h) and the name we keep.
$schemas = @(
    @{ Path = "libs/ssab/fbs/ssab.fbs";            Stem = "ssab" },
    @{ Path = "libs/ssruntime/fbs/framedata.fbs";  Stem = "framedata" }
)

foreach ($schema in $schemas) {
    $fbs = Join-Path $sdkDir $schema.Path
    if (-not (Test-Path $fbs)) {
        Write-Error "$app`: $fbs not found in the SDK submodule"
        exit 1
    }
}

Write-Host "Generating C++ FlatBuffers accessors (flatc -c) ..."
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
Push-Location $OutDir
try {
    foreach ($schema in $schemas) {
        $fbs = Join-Path $sdkDir $schema.Path
        flatc -c $fbs
        if ($LASTEXITCODE -ne 0) { throw "flatc failed for $fbs" }
        Move-Item -Force "$($schema.Stem)_generated.h" "$($schema.Stem).h"
        Write-Host "  $($schema.Stem).h"
    }
} finally {
    Pop-Location
}

Write-Host "Generated into $OutDir"
Write-Host "Done."
