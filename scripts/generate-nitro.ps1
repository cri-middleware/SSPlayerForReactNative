# Run nitrogen over the Layer 1 spec and refresh
# packages/react-native-ssplayer/nitrogen/.
#
# The generated tree IS committed (same treatment as the Unity Player's
# SSRuntimeMethods.g.cs and the Flutter Player's ffigen output): consumers must
# not need nitrogen to build. Never hand-edit anything under nitrogen/ — change
# src/specs/*.nitro.ts and re-run this.

$ErrorActionPreference = "Stop"

$baseDirectory = Split-Path -Parent $PSCommandPath
$rootDirectory = Split-Path -Parent $baseDirectory
$packageDir = "$rootDirectory/packages/react-native-ssplayer"
$nitrogen = "$rootDirectory/node_modules/.bin/nitrogen.cmd"

if (-not (Test-Path "$rootDirectory/node_modules/nitrogen")) {
    Write-Error "nitrogen is not installed - run 'npm install' first."
    exit 1
}
if (-not (Test-Path $nitrogen)) {
    $nitrogen = "$rootDirectory/node_modules/.bin/nitrogen"
}

Push-Location $packageDir
try {
    & $nitrogen --logLevel info
    if ($LASTEXITCODE -ne 0) { throw "nitrogen failed" }
} finally {
    Pop-Location
}

Write-Host "==> nitrogen output refreshed in packages/react-native-ssplayer/nitrogen/"
