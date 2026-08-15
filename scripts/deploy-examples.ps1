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
#   ParticleEffect  - the worst case for vertex count; design
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
#
# ParticleEffect is the deliberate exception. Embedding bakes the atlas into
# every .ssab that names it, and its two atlases are 1.9 MB and 2.8 MB across 41
# packs - roughly 150 MB of app assets, against 5.2 MB for the reference
# conversion, to exercise a route the other two subjects already cover. The
# Player screen disables the toggle for that subject and says why.
$embeddedProjects = @(
    @{ Dir = "overall"; Sspj = "overall.sspj"; Out = "overall-embedded" }
    @{ Dir = "Ringo"; Sspj = "Ringo.sspj"; Out = "Ringo-embedded" }
)

# Projects supplied **locally** rather than by the SDK.
#
# example\SpriteStudio_Source\ is not in this repository - it is third-party
# sample art, and the licence to redistribute it is not ours to give. Everything
# here is therefore optional: a project whose directory is absent is reported
# and skipped, and the example, the asset manifest and check-mask all work
# without it. See README.md for where to get them.
#
# Only one so far, and the reason it is not in the SDK's tests is worth stating:
# the SDK's samples keep masks and instance parts in separate files, so nothing
# upstream exercises a mask that has to reach into an instance child - which is
# what 40_components/40_mask.md 2-6 specifies. This is the official OPTPiX basic
# sample for exactly that.
$localDeployed = @()
$localProjects = @(
    @{ Dir = "Mask"; Sspj = "Mask.sspj"; Out = "MaskInstance" }
)
$localSrc = Join-Path $rootDir "example/SpriteStudio_Source"

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

# The source root is a parameter because the projects come from two places; the
# converter does not care which.
function Deploy-Project($dir, $sspj, $outName, $bake, $srcRoot) {
    if (-not $srcRoot) { $srcRoot = Join-Path $sdkDir "tests" }
    $src = Join-Path $srcRoot "$dir/$sspj"
    $out = Join-Path $outRoot $outName

    if (-not (Test-Path $src)) {
        Write-Error "$app`: $dir/$sspj not found under $srcRoot"
        exit 1
    }

    $suffix = if ($bake) { " (embedded)" } else { "" }
    Write-Host "Converting $dir/$sspj$suffix ..."
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

foreach ($project in $localProjects) {
    $dir = Join-Path $localSrc $project.Dir
    if (-not (Test-Path $dir)) {
        Write-Host "== $($project.Out): skipped, $dir is not here"
        Write-Host "   That project is third-party sample art this repository does not"
        Write-Host "   ship. Everything else is unaffected; see README.md to add it."
        continue
    }
    Deploy-Project $project.Dir $project.Sspj $project.Out $embedded $localSrc
    $localDeployed += $project.Out
}

# The manifest last, because it is a description of the tree above and the app
# reads its whole subject list out of it. Regenerating here rather than leaving
# it to a second command is what keeps "I converted a pack and it did not appear"
# from being a state you can reach at all - including the reverse, a pack the
# manifest still names after the project supplying it went away.
#
# It is committed in its without-optional-packs state, so deploying one of those
# leaves example\src\ss-assets.ts modified on purpose. Do not commit it.
Write-Host "Refreshing example/src/ss-assets.ts ..."
Push-Location (Join-Path $rootDir "example")
try {
    node ../packages/react-native-spritestudio/bin/spritestudio.js assets --out src/ss-assets.ts
    if ($LASTEXITCODE -ne 0) { throw "assets manifest generation failed" }
} finally {
    Pop-Location
}
if ($localDeployed.Count -gt 0) {
    Write-Host "   $($localDeployed -join ', ') came from example\SpriteStudio_Source\, so this"
    Write-Host "   file now differs from the committed one. That is expected - do not commit it."
}

Write-Host "Done."
