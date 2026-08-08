# Convert the SDK's bundled test projects into .ssab assets for example/.
#
# Unlike the Flutter Player, this repo bundles no converter: React Native has no
# editor to hook an importer into, so `.sspj` -> `.ssab` is a host-side step
# (design doc ch.5 / ch.9 G). This script is the developer convenience that runs
# the SDK submodule's own `ssconverter-cli` — it needs the Rust toolchain, same
# as scripts/build-runtime.sh. Consumers of the npm package never run either.
#
# Output lands in example/assets/ss/<stem>/ and is git-ignored: it is derived
# from the submodule, so committing it would be a second copy to keep in sync.

param(
    # Bake textures into the .ssab instead of copying them alongside. The example
    # exercises the REFERENCE layout by default because that is the one with a
    # texture-loading path to get wrong.
    [switch]$Embedded
)

$ErrorActionPreference = "Stop"

$baseDirectory = Split-Path -Parent $PSCommandPath
$rootDirectory = Split-Path -Parent $baseDirectory
$outRoot = "$rootDirectory/example/assets/ss"

# "<SDK tests subdir>|<.sspj filename>". The output directory is the .sspj stem.
#
# Both are deliberate: Ringo is the character case, ParticleEffect is the worst
# case the Phase 0 measurement is actually about — design doc ch.8 is explicit
# that the vertex ceiling is set by effects, not by characters.
$projects = @(
    @{ Dir = "Ringo"; Sspj = "Ringo.sspj" },
    @{ Dir = "ParticleEffect"; Sspj = "ParticleEffect.sspj" }
)

$sdkDir = $env:SSSDK
if (-not $sdkDir) {
    foreach ($candidate in @("$rootDirectory/SpriteStudio-SDK", "$rootDirectory/../SpriteStudio-SDK")) {
        if (Test-Path "$candidate/Cargo.toml") { $sdkDir = (Resolve-Path $candidate).Path; break }
    }
}
if (-not $sdkDir -or -not (Test-Path "$sdkDir/Cargo.toml")) {
    Write-Error "SpriteStudio-SDK not found. Run: git submodule update --init --recursive (or set SSSDK)"
    exit 1
}

if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
    Write-Error "cargo not found - install Rust to run the SDK's ssconverter-cli."
    exit 1
}

foreach ($project in $projects) {
    $stem = [System.IO.Path]::GetFileNameWithoutExtension($project.Sspj)
    $src = "$sdkDir/tests/$($project.Dir)/$($project.Sspj)"
    $out = "$outRoot/$stem"

    if (-not (Test-Path $src)) {
        Write-Error "$($project.Dir)/$($project.Sspj) not found in the SDK submodule"
        exit 1
    }

    Write-Host "==> converting tests/$($project.Dir)/$($project.Sspj)"
    if (Test-Path $out) { Remove-Item -Recurse -Force $out }
    New-Item -ItemType Directory -Force -Path $out | Out-Null

    # The non-embedded converter also copies the referenced textures into the
    # output, so this one call produces the complete asset tree.
    Push-Location $sdkDir
    try {
        if ($Embedded) {
            cargo run -q -p ssconverter-cli -- --embedded -o $out $src
        } else {
            cargo run -q -p ssconverter-cli -- -o $out $src
        }
        if ($LASTEXITCODE -ne 0) { throw "ssconverter-cli failed for $src" }
    } finally {
        Pop-Location
    }
    Write-Host "    -> example/assets/ss/$stem/"
}

Write-Host "deploy-examples.ps1: done."
