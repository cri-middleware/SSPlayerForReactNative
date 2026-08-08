param (
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$ArgsList
)

# Build the Brain (libssruntime) from the SpriteStudio-SDK submodule and install
# it into the npm package's native/ directory.
#
# This is the DEVELOPER path, for when you are changing the Brain itself. The
# normal path is scripts/download-sdk.ps1, which installs the pinned SDK release
# and needs no Rust toolchain at all (design doc ch.7).
#
# WINDOWS ONLY BUILDS THE ANDROID SLICE. The iOS xcframework needs Xcode, so on
# Windows the only way to get a complete native/ is download-sdk.ps1. That is
# not a gap in this script: it is what the platform allows.
#
# Usage: scripts/build-runtime.ps1 [platform=<p>] [build=<m>] [ndk=<path>]
#   platform : android all       (default: all, which means android here)
#   build    : debug release     (default: debug)
#   ndk      : Android NDK root  (default: $env:ANDROID_NDK_HOME, else the
#              newest under $env:ANDROID_HOME\ndk)
#
# Measure in release. A debug libssruntime swamps every other cost and flattens
# the differences a benchmark exists to find (docs/phase0-spike.md).
#
# SDK location: $env:SSSDK, else .\SpriteStudio-SDK, else ..\SpriteStudio-SDK.

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $PSCommandPath
$rootDir = Split-Path -Parent $scriptDir
$app = Split-Path -Leaf $PSCommandPath

$targetDir = Join-Path $rootDir "packages/react-native-ssplayer/native"
$versionFile = Join-Path $scriptDir "SDK_VERSION.txt"

$platform = "all"
$buildMode = "debug"
$ndkOverride = ""

function Show-Usage {
    Write-Host "Usage: $app [options]"
    Write-Host "Options:"
    Write-Host "  platform=<platform>  Target platform (android, all)"
    Write-Host "  build=<build>        Build mode (debug, release)"
    Write-Host "  ndk=<path>           Android NDK root"
}

foreach ($arg in $ArgsList) {
    switch -Regex ($arg) {
        '^platform=(.*)$' { $platform = $Matches[1] }
        '^build=(.*)$'    { $buildMode = $Matches[1] }
        '^ndk=(.*)$'      { $ndkOverride = $Matches[1] }
        '^(-h|--help|help)$' { Show-Usage; exit 0 }
        default { Write-Error "$app`: unknown argument '$arg'"; Show-Usage; exit 2 }
    }
}

if ($buildMode -ne "debug" -and $buildMode -ne "release") {
    Write-Error "$app`: build must be debug or release (got '$buildMode')"
    exit 2
}
if ($platform -eq "ios") {
    Write-Error "$app`: the iOS xcframework needs Xcode - use download-sdk.ps1 on Windows."
    exit 2
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

# cargo-ndk reads ANDROID_NDK_HOME. A profile pointing at an NDK that is not
# installed makes it fail with a bare "No such file or directory", so resolve a
# usable root here rather than trusting the environment blindly.
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
$env:ANDROID_NDK_HOME = $ndk
$env:ANDROID_NDK_ROOT = $ndk

Write-Host "Building Android ($buildMode) via the SDK's release-android.sh, NDK $ndk..."
Push-Location $sdkDir
try {
    # The SDK ships this step as a shell script only; Git for Windows provides
    # the bash that runs it.
    bash scripts/release-android.sh $buildMode
    if ($LASTEXITCODE -ne 0) { throw "release-android.sh failed" }
} finally {
    Pop-Location
}

$abis = @(
    @{ Triple = "aarch64-linux-android";     Abi = "arm64-v8a" },
    @{ Triple = "armv7-linux-androideabi";   Abi = "armeabi-v7a" },
    @{ Triple = "x86_64-linux-android";      Abi = "x86_64" }
)
foreach ($entry in $abis) {
    $src = Join-Path $sdkDir "target/$($entry.Triple)/$buildMode/libssruntime.a"
    if (-not (Test-Path $src)) {
        Write-Error "$app`: expected $src"
        exit 1
    }
    $dest = Join-Path $targetDir "libs/android/$($entry.Abi)"
    New-Item -ItemType Directory -Force -Path $dest | Out-Null
    Copy-Item $src (Join-Path $dest "libssruntime.a") -Force
    Write-Host "  libs/android/$($entry.Abi)/libssruntime.a"
}

# The C-API header is emitted by libs/ssruntime/build.rs (cbindgen) on every
# cargo build, so it exists by now. It is platform-agnostic.
$header = Join-Path $sdkDir "libs/ssruntime/target/ssruntime.h"
if (-not (Test-Path $header)) {
    Write-Error "$app`: expected the cbindgen header at $header"
    exit 1
}
New-Item -ItemType Directory -Force -Path (Join-Path $targetDir "include") | Out-Null
Copy-Item $header (Join-Path $targetDir "include/ssruntime.h") -Force
Write-Host "  include/ssruntime.h"

# The release archive ships these next to the binaries, and the npm package
# redistributes the Brain — so a submodule build has to place them too.
Copy-Item (Join-Path $sdkDir "LICENSE.md") $targetDir -Force -ErrorAction SilentlyContinue
Copy-Item (Join-Path $sdkDir "target/licenses/THIRD-PARTY-LICENSES.ssruntime.md") $targetDir -Force -ErrorAction SilentlyContinue

# Stamp "<pinned tag>+submodule-<sha>", never the bare tag: it is honest about
# what these binaries are, and download-sdk.ps1's skip check compares against
# the bare tag, so a later download replaces a local build rather than leaving
# it in place while calling it the release.
$tag = (Get-Content $versionFile).Trim()
Push-Location $sdkDir
try { $sha = (git rev-parse --short HEAD 2>$null) } catch { $sha = "unknown" }
finally { Pop-Location }
if (-not $sha) { $sha = "unknown" }
Set-Content -Path (Join-Path $targetDir "VERSION") -Value "$tag+submodule-$sha"
Write-Host "  VERSION ($tag+submodule-$sha)"

Write-Host "Done."
