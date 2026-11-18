param (
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$ArgsList
)

# Convert the SpriteStudio-SDK bundled test projects (tests/overall, tests/Ringo,
# tests/ParticleEffect, tests/Doll), and any project put under
# example\SpriteStudio_Source\, into the .ssab assets the example app loads.
#
# This repo bundles no converter: React Native has no editor to hook an importer
# into, so `.sspj` -> `.ssab` is a host-side step. This script is the developer convenience that runs
# the SDK submodule's own ssconverter-cli.
#
# Output lands in example/assets/ss/<stem>/ and is gitignored: it is derived
# from the submodule, so committing it would be a second copy to keep in sync.
#
# Requires the SpriteStudio-SDK submodule and a Rust toolchain. Consumers of the
# npm package never run this.
#
# Usage: scripts/deploy-examples.ps1 [embedded=yes|no]
#   embedded=yes  bake textures into the .ssab instead of copying them alongside
#
# SDK location: $env:SSSDK, else .\SpriteStudio-SDK, else ..\SpriteStudio-SDK.

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $PSCommandPath
$rootDir = Split-Path -Parent $scriptDir
$app = Split-Path -Leaf $PSCommandPath

$outRoot = Join-Path $rootDir "example/assets/ss"

# The output directory is the .sspj stem. All of them are deliberate:
#   overall         - the SDK's own reference layout, one .ssab per feature
#                     (Basic, Mesh, Mask, Effect, BlendMode, ...). Basic.ssab is
#                     the plain-Normal-parts case, so it is the asset that says
#                     whether the render path itself works before any
#                     character's authoring choices are in the picture.
#   Ringo           - the character case.
#   ParticleEffect  - the worst case for vertex count: the ceiling is set
#                     by effects, not by characters.
$projects = @(
    @{ Dir = "overall"; Sspj = "overall.sspj" },
    @{ Dir = "Ringo"; Sspj = "Ringo.sspj" },
    @{ Dir = "ParticleEffect"; Sspj = "ParticleEffect.sspj" },
    @{ Dir = "Doll"; Sspj = "Doll.sspj" }
)

# Always converted with textures baked in, whatever --embedded says for the rest.
#
# The example needs one of each, because the two texture-supply modes reach
# different distances on React Native. A reference pack's image has to be
# findable at runtime, and Metro only ships what a require() names - so reference
# is the mode with a loading path to get wrong, and embedded is the one that is
# self-contained everywhere. Keeping both means the example exercises both
# branches of SsTextureLoader.
#
# ParticleEffect is the deliberate exception. Embedding bakes the atlas into
# every .ssab that names it, and its two atlases are 1.9 MB and 2.8 MB across 41
# packs - roughly 150 MB of app assets, against 5.2 MB for the reference
# conversion, to exercise a route the other three subjects already cover. The
# Viewer screen disables the toggle for that subject and says why.
$embeddedProjects = @(
    @{ Dir = "overall"; Sspj = "overall.sspj"; Out = "overall-embedded" }
    @{ Dir = "Ringo"; Sspj = "Ringo.sspj"; Out = "Ringo-embedded" }
    @{ Dir = "Doll"; Sspj = "Doll.sspj"; Out = "Doll-embedded" }
)

# Projects supplied **locally** rather than by the SDK: every directory under
# example\SpriteStudio_Source\ that holds one .sspj, converted into
# example\assets\ss\<directory name>\.
#
# example\SpriteStudio_Source\ is not in this repository, and everything in it
# is optional: the example, the asset manifest and check-mask all work without
# it. It is where a project goes to be looked at on a device - put its folder
# there, run this, and the Viewer screen offers it as local/<directory name>
# with every .ssab it converted to. Nothing in the app names it.
#
# One of them is named here, as directory -> output dir name, because a card and
# a check read it by a name of their own: SpriteStudio's basic sample Mask,
# third-party art whose licence to redistribute is not ours to give (README.md
# says where to get it). It is not in the SDK's tests because the SDK's samples
# keep masks and instance parts in separate files, so nothing upstream exercises
# a mask that has to reach into an instance child.
$localRenames = @{ "Mask" = "MaskInstance" }
$localDeployed = @()
$localSrc = Join-Path $rootDir "example/SpriteStudio_Source"

# Plain stderr and an exit code, matching deploy-examples.sh (2 = bad usage).
# Write-Error throws under $ErrorActionPreference = "Stop", so an `exit 2` after
# one never runs and the shell sees 1.
function Fail {
    param([string] $Message, [int] $Code = 1)
    [Console]::Error.WriteLine("${app}: $Message")
    exit $Code
}

# `key=value`, as every other script here takes its options. The .js shim
# forwards arguments verbatim, so `pnpm run deploy-examples embedded=yes`
# works the same on every OS.
$embedded = $false
foreach ($arg in $ArgsList) {
    switch -Regex ($arg) {
        '^embedded=(yes|true|1)$' { $embedded = $true; break }
        '^embedded=(no|false|0)$' { $embedded = $false; break }
        '^embedded=' { Fail "embedded= takes yes or no, not '$($arg -replace '^embedded=')'" 2 }
        '^(-h|--help|help)$' {
            Write-Host "Usage: $app [embedded=yes|no]"
            Write-Host "  embedded=yes  bake textures into the .ssab instead of copying them alongside"
            exit 0
        }
        default { Fail "unknown argument '$arg'" 2 }
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

# The local projects are found before anything is converted, so a name clash
# stops the run with the tree untouched rather than half-rebuilt.
#
# An SDK project's output name is reserved: two projects writing one directory
# would leave whichever ran second, under the other one's card.
$reserved = @($projects | ForEach-Object { [System.IO.Path]::GetFileNameWithoutExtension($_.Sspj) }) +
    @($embeddedProjects | ForEach-Object { $_.Out })

$localProjects = @()
if (Test-Path $localSrc) {
    foreach ($dir in (Get-ChildItem -Path $localSrc -Directory | Sort-Object Name)) {
        $sspjs = @(Get-ChildItem -Path $dir.FullName -Filter "*.sspj" -File)
        if ($sspjs.Count -ne 1) {
            Write-Host "== $($dir.Name): skipped, a project directory holds one .sspj and this one holds $($sspjs.Count)"
            continue
        }
        $outName = if ($localRenames.ContainsKey($dir.Name)) { $localRenames[$dir.Name] } else { $dir.Name }
        if ($reserved -contains $outName) {
            Fail ("example\SpriteStudio_Source\$($dir.Name)\ would be converted into example\assets\ss\$outName\, " +
                "which an SDK project already writes. Rename the directory.")
        }
        $localProjects += @{ Dir = $dir.Name; Sspj = $sspjs[0].Name; Out = $outName }
    }
}

foreach ($dirName in $localRenames.Keys) {
    $dir = Join-Path $localSrc $dirName
    if (-not (Test-Path $dir)) {
        Write-Host "== $($localRenames[$dirName]): skipped, $dir is not here"
        Write-Host "   That project is third-party sample art this repository does not"
        Write-Host "   ship. Everything else is unaffected; see README.md to add it."
    }
}

# Every output is rebuilt, so the tree starts empty. A local project taken back
# out of SpriteStudio_Source\ would otherwise leave its directory here, and the
# manifest - which describes this tree, not the sources - would keep offering it.
if (Test-Path $outRoot) { Remove-Item -Recurse -Force $outRoot }

foreach ($project in $projects) {
    $stem = [System.IO.Path]::GetFileNameWithoutExtension($project.Sspj)
    Deploy-Project $project.Dir $project.Sspj $stem $embedded
}

foreach ($project in $embeddedProjects) {
    Deploy-Project $project.Dir $project.Sspj $project.Out $true
}

foreach ($project in $localProjects) {
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
