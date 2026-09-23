param (
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$ArgsList
)

# Install the pinned SpriteStudio-SDK release into the npm package's native/
# directory.
#
# THIS IS THE NORMAL PATH. It needs no Rust toolchain and no submodule, which is
# what lets someone who has never touched the SDK build the package (design doc
# ch.7). scripts/build-runtime.ps1 is the other path, and on Windows it can only
# produce the Android slice — so this is the only way to get a complete native/
# there.
#
# Usage: scripts/download-sdk.ps1 [--force]
#   --force  re-install even when the pinned version is already installed

$ErrorActionPreference = "Stop"
# Invoke-WebRequest's progress bar slows the download itself in Windows PowerShell 5.1.
$ProgressPreference = "SilentlyContinue"

$scriptDir = Split-Path -Parent $PSCommandPath
$rootDir = Split-Path -Parent $scriptDir
$app = Split-Path -Leaf $PSCommandPath

$targetDir = Join-Path $rootDir "packages/react-native-spritestudio/native"
$versionFile = Join-Path $scriptDir "SDK_VERSION.txt"
$currentVersionFile = Join-Path $targetDir "VERSION"
# Downloaded zips are cached here (gitignored) so a re-run that needs the same
# version reuses them instead of re-downloading tens of MB.
$cacheDir = Join-Path $scriptDir ".sdk-cache"

# Accept both spellings: the .js shim forwards arguments verbatim, so the same
# `npm run download-sdk -- --force` works on every OS.
$force = $false
foreach ($arg in $ArgsList) {
    switch -Regex ($arg) {
        '^(--force|-force|force)$' { $force = $true }
        '^(-h|--help|help)$' {
            Write-Host "Usage: $app [--force]"
            Write-Host "  --force  re-install even when the pinned version is already installed"
            exit 0
        }
        default { Write-Error "$app`: unknown argument '$arg'"; exit 2 }
    }
}

$targetVersion = (Get-Content $versionFile).Trim()

# A local build leaves no VERSION, so the check below finds nothing to compare — so a local Brain build is replaced here rather than
# silently kept while claiming to be the release.
if (-not $force -and (Test-Path $currentVersionFile)) {
    $currentVersion = (Get-Content $currentVersionFile).Trim()
    if ($currentVersion -eq $targetVersion) {
        Write-Host "SDK $targetVersion is already up to date. Skipping download."
        exit 0
    }
}

$baseUrl = "https://github.com/cri-middleware/SpriteStudio-SDK/releases/download/$targetVersion"
$asset = "spritestudio-sdk-static-libs.zip"
# Keep the release asset's own name so it matches the SHA256SUMS entry directly.
$zipFile = Join-Path $cacheDir $asset
$sumsFile = Join-Path $cacheDir "SHA256SUMS"

Write-Host "Target SDK Version: $targetVersion"
New-Item -ItemType Directory -Force -Path $cacheDir | Out-Null

function Get-Sha256($file) { (Get-FileHash -Algorithm SHA256 -Path $file).Hash.ToLower() }

# Fetch the checksum manifest (small): it both verifies integrity and decides
# whether an already-cached zip can be reused without re-downloading.
Write-Host "Downloading checksum manifest: $baseUrl/SHA256SUMS"
Invoke-WebRequest -Uri "$baseUrl/SHA256SUMS" -OutFile $sumsFile

$expected = $null
foreach ($line in Get-Content $sumsFile) {
    $parts = $line -split '\s+', 2
    if ($parts.Count -eq 2 -and $parts[1].Trim() -eq $asset) { $expected = $parts[0].ToLower(); break }
}
if (-not $expected) {
    Write-Error "No checksum entry for $asset in SHA256SUMS"
    exit 1
}

# Reuse the cached zip when it already matches the manifest; otherwise download.
if ((Test-Path $zipFile) -and ((Get-Sha256 $zipFile) -eq $expected)) {
    Write-Host "Reusing cached $asset"
} else {
    Write-Host "Downloading SDK: $baseUrl/$asset"
    Invoke-WebRequest -Uri "$baseUrl/$asset" -OutFile $zipFile
    if ((Get-Sha256 $zipFile) -ne $expected) {
        Remove-Item -Force $zipFile
        Write-Error "Checksum mismatch for $asset"
        exit 1
    }
}
Write-Host "Checksum OK: $asset"

# The release archive is a flat tree shared by every Player: libs/<platform>/
# for all seven platforms, include/, bindings/, the notices. Install only what
# this package links — the iOS and Android slices, the C-API header and the two
# notices — which is the layout the podspec and the Android CMake read, and the
# one build-runtime.ps1 writes. `files` publishes native/libs whole, so a desktop
# or web library copied here would ship in the npm tarball. A path missing from
# the archive stops the install, so a layout change surfaces here.
Write-Host "Extracting SDK..."
$tmpDir = Join-Path ([System.IO.Path]::GetTempPath()) ([System.IO.Path]::GetRandomFileName())
New-Item -ItemType Directory -Force -Path $tmpDir | Out-Null
try {
    # Expand-Archive is a script-module function: run from a session, it reads the
    # global progress preference rather than this script's.
    $savedProgress = $global:ProgressPreference
    $global:ProgressPreference = "SilentlyContinue"
    try {
        Expand-Archive -Path $zipFile -DestinationPath $tmpDir -Force
    } finally {
        $global:ProgressPreference = $savedProgress
    }
    if (Test-Path $targetDir) {
        Remove-Item -Recurse -Force $targetDir
    }
    foreach ($rel in @("libs/ios", "libs/android", "include/ssruntime.h", "LICENSE.md", "THIRD-PARTY-LICENSES.ssruntime.md")) {
        $src = Join-Path $tmpDir $rel
        if (-not (Test-Path $src)) {
            Write-Error "$app`: $rel is not in $asset -- the SDK release layout changed"
            exit 1
        }
        $dest = Join-Path $targetDir $rel
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $dest) | Out-Null
        Copy-Item -Path $src -Destination $dest -Recurse -Force
    }
} finally {
    Remove-Item -Recurse -Force $tmpDir -ErrorAction SilentlyContinue
}

# The pinned tag: the skip check above compares against it, and the podspec and
# build.gradle report it as the SDK version.
Set-Content -Path $currentVersionFile -Value $targetVersion
# A release asset is a release build by construction; prepack reads this.
Set-Content -Path (Join-Path $targetDir "BUILD_MODE") -Value "release"

Write-Host "Done."
