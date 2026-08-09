param (
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$ArgsList
)

# Convert the SpriteStudio-SDK bundled test projects (tests/overall, tests/Ringo,
# tests/ParticleEffect) into the .ssab assets the example app loads.
#
# Unlike the Flutter Player this repo bundles no converter: React Native has no
# editor to hook an importer into, so `.sspj` -> `.ssab` is a host-side step
# (design doc ch.5 / ch.9 G). This script is the developer convenience that runs
# the SDK submodule's own ssconverter-cli.
#
# Output lands in example/assets/ss/<stem>/ and is gitignored: it is derived
# from the submodule, so committing it would be a second copy to keep in sync.
#
# Requires the SpriteStudio-SDK submodule and a Rust toolchain. Consumers of the
# npm package never run this.
#
# Usage: scripts/deploy-examples.ps1 [--embedded]
#   --embedded  bake textures into the .ssab instead of copying them alongside
#
# SDK location: $env:SSSDK, else .\SpriteStudio-SDK, else ..\SpriteStudio-SDK.

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $PSCommandPath
$rootDir = Split-Path -Parent $scriptDir
$app = Split-Path -Leaf $PSCommandPath

$outRoot = Join-Path $rootDir "example/assets/ss"

# The output directory is the .sspj stem. All three are deliberate:
#   overall         - the SDK's own reference layout, one .ssab per feature
#                     (Basic, Mesh, Mask, Effect, BlendMode, ...). Basic.ssab is
#                     the plain-Normal-parts case, so it is the asset that says
#                     whether the render path itself works before any
#                     character's authoring choices are in the picture.
#   Ringo           - the character case.
#   ParticleEffect  - the worst case the Phase 0 measurement is about; design
#                     doc ch.8 is explicit that the vertex ceiling is set by
#                     effects, not by characters.
$projects = @(
    @{ Dir = "overall"; Sspj = "overall.sspj" },
    @{ Dir = "Ringo"; Sspj = "Ringo.sspj" },
    @{ Dir = "ParticleEffect"; Sspj = "ParticleEffect.sspj" }
)

# Always converted with textures baked in, whatever --embedded says for the rest.
#
# The example needs one of each, because the two texture-supply modes reach
# different distances on React Native. A reference pack's sibling image has to be
# findable at runtime, and Metro only ships what a require() names - so reference
# is the mode with a loading path to get wrong, and embedded is the one that is
# self-contained everywhere. Keeping both means the example exercises both
# branches of SsTextureLoader.
$embeddedProjects = @(
    @{ Dir = "overall"; Sspj = "overall.sspj"; Out = "overall-embedded" }
)

# Accept both spellings: the .js shim forwards arguments verbatim, so the same
# `npm run deploy-examples -- --embedded` works on every OS.
$embedded = $false
foreach ($arg in $ArgsList) {
    switch -Regex ($arg) {
        '^(--embedded|-embedded|embedded)$' { $embedded = $true }
        '^(-h|--help|help)$' {
            Write-Host "Usage: $app [--embedded]"
            Write-Host "  --embedded  bake textures into the .ssab instead of copying them alongside"
            exit 0
        }
        default { Write-Error "$app`: unknown argument '$arg'"; exit 2 }
    }
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

if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
    Write-Error "$app`: cargo not found - install Rust to run the SDK's ssconverter-cli."
    exit 1
}

function Deploy-Project($dir, $sspj, $outName, $bake) {
    $src = Join-Path $sdkDir "tests/$dir/$sspj"
    $out = Join-Path $outRoot $outName

    if (-not (Test-Path $src)) {
        Write-Error "$app`: $dir/$sspj not found in the SDK submodule"
        exit 1
    }

    $suffix = if ($bake) { " (embedded)" } else { "" }
    Write-Host "Converting tests/$dir/$sspj$suffix ..."
    if (Test-Path $out) { Remove-Item -Recurse -Force $out }
    New-Item -ItemType Directory -Force -Path $out | Out-Null

    # The non-embedded converter also copies the referenced textures into the
    # output, so this one call produces the complete asset tree.
    Push-Location $sdkDir
    try {
        if ($bake) {
            cargo run -q -p ssconverter-cli -- --embedded -o $out $src
        } else {
            cargo run -q -p ssconverter-cli -- -o $out $src
        }
        if ($LASTEXITCODE -ne 0) { throw "ssconverter-cli failed for $src" }
    } finally {
        Pop-Location
    }
    Write-Host "   -> example/assets/ss/$outName/"
}

foreach ($project in $projects) {
    $stem = [System.IO.Path]::GetFileNameWithoutExtension($project.Sspj)
    Deploy-Project $project.Dir $project.Sspj $stem $embedded
}

foreach ($project in $embeddedProjects) {
    Deploy-Project $project.Dir $project.Sspj $project.Out $true
}

Write-Host "Done."
