# Fetch the pinned SpriteStudio-SDK release and install it into the package.
#
# THIS IS THE NORMAL PATH. It needs no Rust toolchain and no submodule, which is
# what makes the npm package installable by someone who has never touched the
# SDK (design doc ch.7). scripts/build-runtime.sh is the other path: building
# the Brain from the submodule while working on it.
#
# Windows can build the Android slice but not the iOS one, so this download is
# the only way to get a complete native/ on Windows.

param(
    # Re-install even when native/VERSION already matches.
    [switch]$Force
)

$ErrorActionPreference = "Stop"

$baseDirectory = Split-Path -Parent $PSCommandPath
$rootDirectory = Split-Path -Parent $baseDirectory
$targetDir = "$rootDirectory/packages/react-native-ssplayer/native"
$versionFile = "$baseDirectory/SDK_VERSION.txt"
$currentVersionFile = "$targetDir/VERSION"
# Downloaded zip is cached here (gitignored) so a re-run that needs the same
# version reuses it instead of re-downloading tens of MB.
$cacheDir = "$baseDirectory/.sdk-cache"

$targetVersion = (Get-Content $versionFile).Trim()

if (-not $Force -and (Test-Path $currentVersionFile)) {
    $currentVersion = (Get-Content $currentVersionFile).Trim()
    if ($currentVersion -eq $targetVersion) {
        Write-Host "SDK $targetVersion is already up to date. Skipping download."
        exit 0
    }
    # A build-runtime.sh install stamps "<tag>+submodule-<sha>", which never
    # compares equal to the tag — so a local Brain build is replaced here rather
    # than silently kept while claiming to be the release.
}

$baseUrl = "https://github.com/cri-middleware/SpriteStudio-SDK/releases/download/$targetVersion"
$asset = "spritestudio-sdk-static-libs.zip"
# Keep the release asset's own name so it matches the SHA256SUMS entry directly.
$zipFile = "$cacheDir/$asset"
$sumsFile = "$cacheDir/SHA256SUMS"

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

# The release archive is a flat tree (libs/, include/, VERSION, …) with no
# wrapper directory, so it extracts straight into native/ — which is exactly the
# layout the podspec and the Android CMake read.
Write-Host "Extracting SDK..."
if (Test-Path $targetDir) {
    Remove-Item -Recurse -Force $targetDir
}
Expand-Archive -Path $zipFile -DestinationPath $targetDir -Force

# The archive's own VERSION holds the SDK commit hash; overwrite it with the tag
# so the skip check above compares like with like.
Set-Content -Path $currentVersionFile -Value $targetVersion

Write-Host "Done."
