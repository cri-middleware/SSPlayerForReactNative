param (
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$ArgsList
)

# Compiles the Skia-guarded C++ on Windows, so a change to the draw path is
# caught here rather than on a device.
#
# This is the WINDOWS COUNTERPART to tools/check-mask.sh. That script *links and
# runs* the mask path against the host libskia RN Skia ships — but that library
# has a macOS slice only, so on Windows there is nothing to link and no way to
# run it. What Windows *can* do is compile: RN Skia's headers are present under
# node_modules, and the Android NDK you already build with bundles the very
# clang the Android build uses. So this checks that the guarded translation units
# still COMPILE (syntax + codegen) with SSPLAYER_ENABLE_SKIA_DIRECT=1 — it does
# not link, and it does not render. For the render-level guarantees (the coverage
# round-trips, the path still masks) run tools/check-mask.sh on a Mac.
#
# It compiles the units whose includes are self-contained — Skia + FlatBuffers +
# this package's own cpp/. SsRNSkiaInterop.cpp is left out on purpose: it pulls
# in NitroModules/JSI headers that only exist inside a full RN build.
#
# Usage: tools/check-skia-compile.ps1 [ndk=<path>] [api=<level>] [-Object]
#   ndk      : Android NDK root  (default: $env:ANDROID_NDK_HOME, else the
#              newest under $env:ANDROID_HOME\ndk — the same resolution
#              scripts/build-runtime.ps1 does)
#   api      : Android API level to target (default: 24)
#   -Object  : emit an object file (full codegen) instead of -fsyntax-only;
#              slower, but exercises the back end too

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $PSCommandPath
$rootDir = Split-Path -Parent $scriptDir
$app = Split-Path -Leaf $PSCommandPath

$ndkOverride = ""
$apiLevel = "24"
$emitObject = $false

function Show-Usage {
    Write-Host "Usage: $app [options]"
    Write-Host "Options:"
    Write-Host "  ndk=<path>     Android NDK root"
    Write-Host "  api=<level>    Android API level to target (default: 24)"
    Write-Host "  -Object        Emit an object file (full codegen) instead of -fsyntax-only"
}

foreach ($arg in $ArgsList) {
    switch -Regex ($arg) {
        '^ndk=(.*)$'  { $ndkOverride = $Matches[1] }
        '^api=(.*)$'  { $apiLevel = $Matches[1] }
        '^-?-?Object$' { $emitObject = $true }
        '^(-h|--help|help)$' { Show-Usage; exit 0 }
        default { Write-Error "$app`: unknown argument '$arg'"; Show-Usage; exit 2 }
    }
}

# The same resolution scripts/build-runtime.ps1 uses, so this checks against the
# NDK the Android build would actually pick.
function Resolve-Ndk {
    foreach ($candidate in @($ndkOverride, $env:ANDROID_NDK_HOME, $env:ANDROID_NDK_ROOT)) {
        if ($candidate -and (Test-Path (Join-Path $candidate "source.properties"))) { return $candidate }
    }
    $sdkRoot = $env:ANDROID_HOME
    if (-not $sdkRoot) { $sdkRoot = $env:ANDROID_SDK_ROOT }
    if (-not $sdkRoot) { $sdkRoot = Join-Path $env:LOCALAPPDATA "Android/Sdk" }
    $ndkRoot = Join-Path $sdkRoot "ndk"
    if (Test-Path $ndkRoot) {
        $newest = Get-ChildItem -Directory $ndkRoot |
            Where-Object { Test-Path (Join-Path $_.FullName "source.properties") } |
            Sort-Object Name | Select-Object -Last 1
        if ($newest) { return $newest.FullName }
    }
    Write-Error "$app`: no Android NDK found. Set ANDROID_NDK_HOME, or pass ndk=<path>"
    exit 1
}

$ndk = Resolve-Ndk
$clang = Join-Path $ndk "toolchains/llvm/prebuilt/windows-x86_64/bin/clang++.exe"
if (-not (Test-Path $clang)) {
    Write-Error "$app`: no clang++ at $clang — is this a Windows NDK? Pass ndk=<path> to one."
    exit 1
}

# Resolved as Node would from the package: under pnpm RN Skia does not sit in
# the root node_modules.
Push-Location (Join-Path $rootDir "packages/react-native-spritestudio")
try {
    $rnskiaRoot = & node -p "require('path').dirname(require.resolve('@shopify/react-native-skia/package.json'))" 2> $null
} finally {
    Pop-Location
}
$rnskia = Join-Path "$rnskiaRoot" "cpp/skia"
if (-not $rnskiaRoot -or -not (Test-Path (Join-Path $rnskia "include/core/SkCanvas.h"))) {
    Write-Error "$app`: RN Skia headers not found under $rnskia — run pnpm install"
    exit 1
}

$pkgCpp = Join-Path $rootDir "packages/react-native-spritestudio/cpp"
$flatbuffers = Join-Path $rootDir "packages/react-native-spritestudio/third_party/flatbuffers/include"

# The translation units whose includes are self-contained here. The draw path
# (SsSkiaDraw.cpp) is the one with the Skia machinery; the Skia-free baker and
# mask plan compile just as cleanly and are cheap to keep honest.
$units = @("SsSkiaDraw.cpp", "SsMask.cpp", "SsBaker.cpp")

$commonArgs = @(
    "--target=aarch64-linux-android$apiLevel",
    "-std=c++20",
    "-DSSPLAYER_ENABLE_SKIA_DIRECT=1",
    # The Skia build flags RN Skia's own CMakeLists sets for the Android slice.
    "-DSK_BUILD_FOR_ANDROID", "-DSK_GL", "-DSK_GANESH",
    "-DSK_DISABLE_LEGACY_SHAPER_FACTORY", "-DSK_IMAGE_READ_PIXELS_DISABLE_LEGACY_API",
    "-I$rnskia",
    "-I$flatbuffers",
    "-I$pkgCpp"
)

$objDir = ""
if ($emitObject) {
    $objDir = Join-Path ([System.IO.Path]::GetTempPath()) ("ss-skia-check-" + [System.Guid]::NewGuid().ToString("N"))
    New-Item -ItemType Directory -Force -Path $objDir | Out-Null
}

$clangVersion = (& $clang --version | Select-Object -First 1)
Write-Host "NDK:   $ndk"
Write-Host "clang: $clangVersion"
Write-Host "mode:  $(if ($emitObject) { 'object (codegen)' } else { 'syntax-only' }), target aarch64-linux-android$apiLevel"
Write-Host ""

$failed = 0
foreach ($unit in $units) {
    $src = Join-Path $pkgCpp $unit
    if (-not (Test-Path $src)) { Write-Host ("MISS  {0} (not found)" -f $unit); $failed++; continue }

    $unitArgs = @($commonArgs)
    if ($emitObject) {
        $unitArgs += @("-c", "-O1", $src, "-o", (Join-Path $objDir ($unit + ".o")))
    } else {
        $unitArgs += @("-fsyntax-only", $src)
    }

    $output = & $clang @unitArgs 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Host ("OK    {0}" -f $unit)
    } else {
        Write-Host ("FAIL  {0}" -f $unit)
        $output | ForEach-Object { Write-Host "      $_" }
        $failed++
    }
}

if ($objDir) { Remove-Item -Recurse -Force $objDir -ErrorAction SilentlyContinue }

Write-Host ""
if ($failed -ne 0) {
    Write-Error "$app`: $failed of $($units.Count) unit(s) failed to compile"
    exit 1
}
Write-Host "$app`: all $($units.Count) unit(s) compiled clean"
