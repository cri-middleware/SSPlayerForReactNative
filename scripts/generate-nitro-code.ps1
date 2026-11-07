# Run nitrogen over the Layer 1 spec and refresh
# packages/react-native-spritestudio/nitrogen/.
#
# Named after the tool rather than generate-fbs-code.ps1: that script runs flatc over the SDK's schemas, while this one runs nitrogen over a
# spec this repo owns.
#
# The generated tree IS committed: consumers must
# not need nitrogen to build. NEVER hand-edit anything under nitrogen/ — change
# src/specs/*.nitro.ts and re-run this.

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $PSCommandPath
$rootDir = Split-Path -Parent $scriptDir
$app = Split-Path -Leaf $PSCommandPath

$packageDir = Join-Path $rootDir "packages/react-native-spritestudio"

# A devDependency of the package, so its bin is the package's, not the root's.
# pnpm writes both a .cmd shim and an extensionless one; prefer the .cmd on
# Windows and fall back for pwsh on a POSIX host.
$binDir = Join-Path $packageDir "node_modules/.bin"
$nitrogen = Join-Path $binDir "nitrogen.cmd"
if (-not (Test-Path $nitrogen)) {
    $nitrogen = Join-Path $binDir "nitrogen"
}
if (-not (Test-Path $nitrogen)) {
    Write-Error "$app`: nitrogen is not installed - run 'pnpm install' first."
    exit 1
}

Push-Location $packageDir
try {
    & $nitrogen --logLevel info
    if ($LASTEXITCODE -ne 0) { throw "nitrogen failed" }
} finally {
    Pop-Location
}

Write-Host "Generated into packages/react-native-spritestudio/nitrogen/"
Write-Host "Done."
