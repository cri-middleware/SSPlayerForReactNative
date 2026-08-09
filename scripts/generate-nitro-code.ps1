# Run nitrogen over the Layer 1 spec and refresh
# packages/react-native-spritestudio/nitrogen/.
#
# Named after the tool the way the Flutter Player's generate-ffigen-code.ps1 is,
# rather than generate-runtime-code.ps1: the sibling Players' script of that
# name generates bindings *from the SDK* (flatc / csbindgen), while this one
# runs nitrogen over a spec this repo owns.
#
# The generated tree IS committed, the same treatment as the Unity Player's
# SSRuntimeMethods.g.cs and the Flutter Player's ffigen output: consumers must
# not need nitrogen to build. NEVER hand-edit anything under nitrogen/ — change
# src/specs/*.nitro.ts and re-run this.

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $PSCommandPath
$rootDir = Split-Path -Parent $scriptDir
$app = Split-Path -Leaf $PSCommandPath

$packageDir = Join-Path $rootDir "packages/react-native-spritestudio"

if (-not (Test-Path (Join-Path $rootDir "node_modules/nitrogen"))) {
    Write-Error "$app`: nitrogen is not installed - run 'npm install' first."
    exit 1
}

# npm writes both a .cmd shim and an extensionless one; prefer the .cmd on
# Windows and fall back for pwsh on a POSIX host.
$nitrogen = Join-Path $rootDir "node_modules/.bin/nitrogen.cmd"
if (-not (Test-Path $nitrogen)) {
    $nitrogen = Join-Path $rootDir "node_modules/.bin/nitrogen"
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
