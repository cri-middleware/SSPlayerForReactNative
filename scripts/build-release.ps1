param (
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$ArgsList
)

# Build the release locally and publish none of it: the tarball a release would
# upload, packed where you can look inside it, with SHA256SUMS over it and the
# checks that have to pass before it goes out.
#
#   scripts\build-release.ps1                      # the whole thing
#   scripts\build-release.ps1 sdk=build            # compile the Brain here instead
#   scripts\build-release.ps1 skip=install,checks  # iterate
#
# Unlike release.ps1 this DOES run on Windows. A release cannot skip the host
# checks, which link a libskia with no Windows slice, but BUILDING the tarball to
# look at is a useful thing to do -- and sdk=download carries the iOS half,
# since the release archive holds every slice. With sdk=build only Xcode makes
# that half, and what the verification will not do is call an Android-only
# package shippable.
#
# Only the pinned SDK release can be packed: download-sdk writes native\VERSION
# and native\BUILD_MODE, build-runtime deletes both, and prepack refuses a
# tarball without them. So sdk=build is a REHEARSAL -- every stage runs, lib\ is
# built, and the pack is a dry run that reports the file list an upload would
# carry.
#
# Two stages are thinner here than in build-release.sh, and say so as they run:
# the host checks are bash + a host libskia with no Windows slice, and flatc is
# optional on both.

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $PSCommandPath
$rootDir = Split-Path -Parent $scriptDir
$app = Split-Path -Leaf $PSCommandPath
$pkgDir = Join-Path $rootDir "packages/react-native-spritestudio"

# Plain stderr and an explicit code, rather than Write-Error: under a Stop
# preference that terminates on the spot, so the exit code beside it never runs
# and 2 (bad usage) arrives as 1.
function Fail {
    param([string] $Message, [int] $Code = 1)
    [Console]::Error.WriteLine("${app}: $Message")
    exit $Code
}

$stages = @("install", "sdk", "codegen", "checks", "pack")

# What build-runtime writes and the podspec/CMake read. The Brain ships no
# 32-bit x86.
$androidAbis = @("arm64-v8a", "armeabi-v7a", "x86_64")

# --- options --------------------------------------------------------------

$out = "release-dist"
$sdk = "download"
$skip = @()
$verify = "yes"
$clean = ""   # resolved after parsing: no when a stage is skipped, yes otherwise

function Show-Usage {
    Write-Host "Usage: $app [options]"
    Write-Host "$app options:"
    Write-Host "  out=<dir>               Where the artifacts and SHA256SUMS land (default:"
    Write-Host "                          $out). Relative paths resolve against the"
    Write-Host "                          current directory."
    Write-Host "  sdk=<download|build|skip>"
    Write-Host "                          Where the Brain comes from (default: $sdk)."
    Write-Host "                          download = download-sdk.ps1, the release pinned in"
    Write-Host "                          scripts\SDK_VERSION.txt -- the only source a"
    Write-Host "                          shippable tarball can have, and the only one that"
    Write-Host "                          carries the iOS half on Windows. build ="
    Write-Host "                          build-runtime.ps1 in release mode, from the"
    Write-Host "                          submodule (needs rustup + the NDK) -- ANDROID ONLY"
    Write-Host "                          here, and the tarball itself is out of reach."
    Write-Host "                          skip = keep native\ as it stands."
    Write-Host "  skip=<a,b,...>          Stages to leave out. One or more of:"
    Write-Host "                          $($stages -join ' ')"
    Write-Host "  verify=<yes|no>         Re-open what was built and check it (default:"
    Write-Host "                          $verify)."
    Write-Host "  clean=<yes|no>          Delete <out> first (default: yes, or no when skip="
    Write-Host "                          is given, so a partial run keeps the rest)."
        Write-Host "  in=                     Accepted and ignored here. The family's build-release"
    Write-Host "                          scripts share out= clean= verify= in= sdk= skip=,"
    Write-Host "                          so one command line drives all of them."
Write-Host "  -h | --help             Show this help"
    Write-Host ""
    Write-Host "Stages:"
    Write-Host "  install   pnpm install --frozen-lockfile"
    Write-Host "  sdk       the Brain in packages\*\native (not in git), per sdk="
    Write-Host "  codegen   re-run nitrogen and flatc, and require no diff"
    Write-Host "  checks    typecheck and the checks that run on Windows"
    Write-Host "  pack      npm pack -> <out>\npm, or a dry run -> <out>\rehearsal"
    Write-Host ""
    Write-Host "Output: <out>\npm\<name>-<version>.tgz and its .files listing when the Brain"
    Write-Host "is the pinned release; <out>\rehearsal\ with the listing alone when it is a"
    Write-Host "local build. Either way <out>\manifest.json says which, and SHA256SUMS covers"
    Write-Host "the lot."
    Write-Host ""
    Write-Host "This builds a release; it does not make one. Nothing here publishes, tags,"
    Write-Host "commits or bumps a version -- and 'pnpm run release' is macOS only besides."
}

foreach ($arg in $ArgsList) {
    switch -Regex ($arg) {
        '^out=(.*)$'    { $out = $Matches[1] }
        # Lower-cased, because these are keywords rather than paths.
        '^sdk=(.*)$'    { $sdk = $Matches[1].ToLower() }
        '^verify=(.*)$' { $verify = $Matches[1].ToLower() }
        '^clean=(.*)$'  { $clean = $Matches[1].ToLower() }
        '^skip=(.*)$'   { $skip = $Matches[1].ToLower() -split ',' | Where-Object { $_ } }
        '^(-h|--help|help)$' { Show-Usage; exit 0 }
        # Accepted so one command line drives build-release in every repository
        # of the family; this one has no use for it.
        '^in=' { [Console]::Error.WriteLine("${app}: in= does not apply here; ignored") }
        default { Fail "unknown argument '$arg' (options are key=value; see $app --help)" 2 }
    }
}

if ($sdk -notin "download", "build", "skip") { Fail "sdk must be download, build or skip (got '$sdk')" 2 }
if ($verify -notin "yes", "no") { Fail "verify must be yes or no (got '$verify')" 2 }
foreach ($name in $skip) {
    if ($name -notin $stages) { Fail "unknown stage '$name' in skip= (stages: $($stages -join ' '))" 2 }
}

if (-not $clean) { $clean = if ($skip.Count -gt 0) { "no" } else { "yes" } }
if ($clean -notin "yes", "no") { Fail "clean must be yes or no (got '$clean')" 2 }

# Resolve out= against the invoking directory, before anything cds away from it.
if (-not [System.IO.Path]::IsPathRooted($out)) { $out = Join-Path (Get-Location).Path $out }
$out = [System.IO.Path]::GetFullPath($out)
# clean=yes deletes this path.
if ($out -eq [System.IO.Path]::GetPathRoot($out) -or $out -eq $rootDir) {
    Fail "refusing to use '$out' as out= (it is deleted when clean=yes)" 2
}

function Test-Skipping { param([string] $Name) return $skip -contains $Name }

# Invoke-Stage <name> <what it does> -- true when the stage should run.
function Invoke-Stage {
    param([string] $Name, [string] $What)
    Write-Host ""
    if (Test-Skipping $Name) {
        Write-Host ">> [$Name] skipped"
        return $false
    }
    Write-Host ">> [$Name] $What"
    return $true
}

function Invoke-Checked {
    param([string] $What, [scriptblock] $Body)
    & $Body
    if ($LASTEXITCODE -ne 0) { Fail "$What failed ($LASTEXITCODE)" $LASTEXITCODE }
}

$failed = @()
function Add-Failure { param([string] $Message) $script:failed += $Message }

# --- preflight ------------------------------------------------------------

if (!(Test-Path (Join-Path $pkgDir "package.json"))) {
    Fail "packages\react-native-spritestudio\package.json not found -- is this the SSPlayerForReactNative repo?"
}
foreach ($tool in @("node", "pnpm", "npm", "git")) {
    if (!(Get-Command $tool -ErrorAction SilentlyContinue)) { Fail "$tool not found" }
}
# bsdtar, which is how the finished archive is read back (Windows 10 1803+).
if (!(Get-Command tar -ErrorAction SilentlyContinue)) {
    Fail "tar not found -- it is what re-opens the tarball (Windows 10 1803 or newer ships it)"
}

function Get-Sha256($file) { (Get-FileHash -Algorithm SHA256 -Path $file).Hash.ToLower() }

# By bytes, not by culture: build-release.sh sorts with LC_ALL=C, and the two
# listings are worth being the same file.
function Sort-Ordinal {
    param([string[]] $Items)
    $sorted = [string[]] $Items
    [Array]::Sort($sorted, [StringComparer]::Ordinal)
    return ,$sorted
}

# Read back below, and a copy ships beside the artifact -- the working file
# itself has no business in <out>.
$work = Join-Path ([System.IO.Path]::GetTempPath()) ("build-release-" + [System.Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $work -Force | Out-Null

$pkgJson = Get-Content (Join-Path $pkgDir "package.json") -Raw | ConvertFrom-Json
$pkgName = $pkgJson.name
$version = $pkgJson.version
$pinned = (Get-Content (Join-Path $scriptDir "SDK_VERSION.txt")).Trim()
# npm's tarball name: the scope's @ dropped, its / turned into a dash.
$tgz = ($pkgName -replace '^@', '' -replace '/', '-') + "-$version.tgz"
$base = $tgz -replace '\.tgz$', ''
$entriesFile = Join-Path $work "entries"

Write-Host "options"
Write-Host "  out    => $out"
Write-Host "  sdk    => $sdk"
Write-Host "  skip   => $(if ($skip.Count) { $skip -join ' ' } else { '(nothing)' })"
Write-Host "  verify => $verify"
Write-Host "  clean  => $clean"
Write-Host ""
Write-Host "package"
Write-Host "  $pkgName $version"
Write-Host "  SDK pinned at $pinned"

if ($sdk -eq "build" -and -not (Test-Skipping "sdk") -and
    !(Test-Path (Join-Path $rootDir "SpriteStudio-SDK/libs/ssruntime"))) {
    [Console]::Error.WriteLine("${app}: sdk=build needs SpriteStudio-SDK/libs/ssruntime -- the submodule is not checked out")
    Fail "fix it with 'git submodule update --init --recursive'"
}

# The vendored headers go IN the tarball, and an uninitialised submodule is an
# empty directory that packs as a package whose C++ cannot compile.
Invoke-Checked "git submodule update" {
    & git -C $rootDir submodule update --init packages/react-native-spritestudio/third_party/flatbuffers | Out-Null
}

if ($clean -eq "yes" -and (Test-Path $out)) { Remove-Item -Recurse -Force $out }
New-Item -ItemType Directory -Path $out -Force | Out-Null

Push-Location $rootDir
try {

# --- install ---------------------------------------------------------------
if (Invoke-Stage "install" "pnpm install --frozen-lockfile") {
    Invoke-Checked "pnpm install --frozen-lockfile" { & pnpm install --frozen-lockfile }
}

# --- the Brain -------------------------------------------------------------
$sdkWhat = switch ($sdk) {
    "download" { "install the pinned release ($pinned)" }
    "build"    { "build the Brain from the submodule (release, Android only)" }
    "skip"     { "keep packages\*\native as it stands" }
}
if (Invoke-Stage "sdk" $sdkWhat) {
    switch ($sdk) {
        "download" {
            & powershell -ExecutionPolicy Bypass -File (Join-Path $scriptDir "download-sdk.ps1")
            if ($LASTEXITCODE -ne 0) {
                [Console]::Error.WriteLine("")
                [Console]::Error.WriteLine("${app}: the pinned SDK release $pinned could not be installed.")
                Fail "sdk=build rehearses everything that does not need it." $LASTEXITCODE
            }
        }
        "build" {
            # Release, always: prepack refuses a debug Brain and a release asset
            # is a release build. build-runtime.ps1 refuses iOS outright, so
            # what comes out is the Android half and the verification says so.
            Write-Host "   Windows -- Android slices only (the xcframework needs Xcode)"
            Invoke-Checked "build-runtime.ps1" { & powershell -ExecutionPolicy Bypass -File (Join-Path $scriptDir "build-runtime.ps1") build=release }
        }
        "skip" { Write-Host "   sdk=skip" }
    }
}

if (!(Test-Path (Join-Path $pkgDir "native/libs"))) {
    [Console]::Error.WriteLine("${app}: packages\react-native-spritestudio\native\libs is missing -- the Brain is not installed")
    Fail "run with sdk=download, or sdk=build to compile it from the submodule"
}

$brainVersion = "(none)"
$brainMode = "(none)"
$versionPath = Join-Path $pkgDir "native/VERSION"
$modePath = Join-Path $pkgDir "native/BUILD_MODE"
if (Test-Path $versionPath) { $brainVersion = (Get-Content $versionPath).Trim() }
if (Test-Path $modePath) { $brainMode = (Get-Content $modePath).Trim() }

# An older release still sitting in native\ would pack as this one.
if ($brainVersion -ne "(none)" -and $brainVersion -ne $pinned) {
    [Console]::Error.WriteLine("${app}: native\ holds SDK $brainVersion, but scripts\SDK_VERSION.txt pins $pinned")
    Fail "run with sdk=download to install the pinned one"
}

# The one question that decides what this run can produce.
$shippable = if ($brainVersion -ne "(none)" -and $brainMode -eq "release") { "yes" } else { "no" }

Write-Host ""
Write-Host "brain"
Write-Host "  version => $brainVersion"
Write-Host "  mode    => $brainMode"
if ($shippable -eq "yes") {
    Write-Host "  => the pinned release: this run packs a tarball"
} else {
    Write-Host "  => a local build: prepack refuses to pack one, so this run is a REHEARSAL"
}

# --- generated code --------------------------------------------------------
#
# Both generators are committed, so a stale one ships bindings that disagree
# with the spec, or reads FrameData at the wrong offsets.
if (Invoke-Stage "codegen" "re-run the generators and require no diff") {
    Invoke-Checked "generate-nitro-code.ps1" { & powershell -ExecutionPolicy Bypass -File (Join-Path $scriptDir "generate-nitro-code.ps1") | Out-Null }
    & git -C $rootDir diff --exit-code -- packages/react-native-spritestudio/nitrogen | Out-Null
    if ($LASTEXITCODE -ne 0) { Fail "nitrogen\ is stale -- commit the regenerated output" }
    Write-Host "   nitrogen\ current"

    if (Get-Command flatc -ErrorAction SilentlyContinue) {
        Invoke-Checked "generate-fbs-code.ps1" { & powershell -ExecutionPolicy Bypass -File (Join-Path $scriptDir "generate-fbs-code.ps1") | Out-Null }
        & git -C $rootDir diff --exit-code -- packages/react-native-spritestudio/cpp/format | Out-Null
        if ($LASTEXITCODE -ne 0) { Fail "cpp\format\ is stale -- commit the regenerated output" }
        Write-Host "   cpp\format\ current"
    } else {
        Write-Host "   cpp\format\ SKIPPED (no flatc)"
    }
}

# --- the checks ------------------------------------------------------------
if (Invoke-Stage "checks" "typecheck and the checks that run here") {
    Invoke-Checked "pnpm run typecheck" { & pnpm run typecheck }
    Invoke-Checked "pnpm run check-web-barrel" { & pnpm run check-web-barrel }
    # The other four are bash, and two of them link a host libskia RN Skia
    # ships for macOS alone. Run them there before releasing.
    Write-Host "   check-framedata / check-mask / check-shader / check-hidden SKIPPED (macOS or Linux only)"
}

# --- the pack --------------------------------------------------------------
#
# `npm pack` runs prepack, which is `bob build` and then the guard that refuses
# anything a consumer could not use. The rehearsal runs those two by hand
# instead: --ignore-scripts is what lets the listing be produced at all once the
# guard has had its say.
$packed = ""

if (Invoke-Stage "pack" "pack $tgz") {
    if ($shippable -eq "yes") {
        New-Item -ItemType Directory -Path (Join-Path $out "npm") -Force | Out-Null
        Push-Location $pkgDir
        try {
            Invoke-Checked "npm pack" { & npm pack --pack-destination (Join-Path $out "npm") --foreground-scripts }
        } finally { Pop-Location }
        $packed = Join-Path $out "npm/$tgz"
        if (!(Test-Path $packed)) { Fail "npm pack did not produce $tgz" }
        # The archive's own paths, with npm's wrapper directory dropped.
        $entries = Sort-Ordinal @((& tar -tzf $packed) |
            ForEach-Object { $_ -replace '^package/', '' } |
            Where-Object { $_ -and -not $_.EndsWith('/') })
        [IO.File]::WriteAllText($entriesFile, ($entries -join "`n") + "`n")
        Copy-Item $entriesFile (Join-Path $out "npm/$base.files")
        Write-Host "   npm\$tgz"
    } else {
        New-Item -ItemType Directory -Path (Join-Path $out "rehearsal") -Force | Out-Null
        Invoke-Checked "pnpm run build" { & pnpm --filter $pkgName run build }

        # prepack's own report, kept: its refusal is the interesting half. Only
        # the missing BUILD_MODE is expected -- anything else it finds would
        # have stopped a real pack too, and still does.
        $report = Join-Path $out "rehearsal/$base.prepack.txt"
        Push-Location $pkgDir
        try {
            & node scripts/prepack.mjs *>&1 | Out-File -FilePath $report -Encoding utf8
            $prepackStatus = $LASTEXITCODE
        } finally { Pop-Location }
        if ($prepackStatus -ne 0) {
            # Exactly one problem, and it is the missing marker. Its own count
            # line is what says so -- anything else it found would have stopped
            # a real pack too, and still does.
            $reportText = Get-Content $report -Raw
            $match = [regex]::Match($reportText, 'prepack: (\d+) problem')
            if (-not $match.Success -or $match.Groups[1].Value -ne "1" -or
                $reportText -notmatch 'native/BUILD_MODE is missing') {
                Get-Content $report | ForEach-Object { [Console]::Error.WriteLine($_) }
                Fail "prepack refuses this tree for more than the local Brain"
            }
            Write-Host "   prepack refuses it, as designed (a local Brain is not the pinned release)"
        }

        $packJson = Join-Path $out "rehearsal/$base.pack.json"
        Push-Location $pkgDir
        try {
            & npm pack --dry-run --ignore-scripts --json | Out-File -FilePath $packJson -Encoding utf8
            if ($LASTEXITCODE -ne 0) { Fail "npm pack --dry-run failed ($LASTEXITCODE)" }
        } finally { Pop-Location }
        $dry = (Get-Content $packJson -Raw | ConvertFrom-Json)[0]
        [IO.File]::WriteAllText($entriesFile, ((Sort-Ordinal $dry.files.path) -join "`n") + "`n")
        Copy-Item $entriesFile (Join-Path $out "rehearsal/$base.files")
        Write-Host ("   {0} entries, {1:N1} MB unpacked" -f $dry.entryCount, ($dry.unpackedSize / 1MB))
        Write-Host "   rehearsal\$base.files -- no archive (see the header of this script)"
    }
}

# --- the manifest ----------------------------------------------------------
#
# What this run produced, as data rather than as a listing to be read.
Write-Host ""
Write-Host ">> [manifest] writing manifest.json"
$manifest = [ordered]@{
    shippable = ($shippable -eq "yes")
    package   = [ordered]@{ name = $pkgName; version = $version }
    brain     = [ordered]@{ source = $sdk; version = $brainVersion; mode = $brainMode; pinned = $pinned }
    npm       = @()
}
if (Test-Path (Join-Path $out "npm/$tgz")) {
    $manifest.npm = @([ordered]@{ package = $pkgName; version = $version; file = "npm/$tgz" })
}
[IO.File]::WriteAllText((Join-Path $out "manifest.json"), ($manifest | ConvertTo-Json -Depth 5) + "`n")
Write-Host "   shippable: $shippable"

# --- checksums -------------------------------------------------------------
#
# Over whatever is in <out>, not over what this run produced: with clean=no an
# earlier run's artifacts are still there, and half a SHA256SUMS is worse than
# none.
$sumsFiles = Sort-Ordinal @(Get-ChildItem -Path $out -Recurse -File |
    Where-Object { $_.Name -ne "SHA256SUMS" } |
    ForEach-Object { $_.FullName.Substring($out.Length + 1).Replace('\', '/') })

Write-Host ""
if ($sumsFiles.Count -eq 0) {
    Write-Host ">> [checksums] nothing in $out to sum"
    Write-Host ""
    Fail "every stage that produces a file was skipped -- nothing was built."
}
Write-Host ">> [checksums] writing SHA256SUMS"
# The same `<hash>  <name>` lines sha256sum writes, so build-release.sh's
# SHA256SUMS and this one are the same file.
$lines = $sumsFiles | ForEach-Object { "$(Get-Sha256 (Join-Path $out $_))  $_" }
[IO.File]::WriteAllText((Join-Path $out "SHA256SUMS"), ($lines -join "`n") + "`n")
Write-Host "   $($sumsFiles.Count) file(s)"

# --- verify ----------------------------------------------------------------

$entryList = @()
function Test-Entry { param([string] $Path) return $entryList -contains $Path }
function Test-Prefix { param([string] $Path) return @($entryList | Where-Object { $_.StartsWith($Path) }).Count -gt 0 }

if ($verify -eq "yes" -and (Test-Path $entriesFile)) {
    Write-Host ""
    Write-Host ">> [verify] reading back what would be uploaded"
    $entryList = @(Get-Content $entriesFile | Where-Object { $_ })

    # 1. the entry points. main/types live in lib\, which is gitignored build
    #    output -- this is where a pack that skipped `bob build` shows up.
    foreach ($f in @("lib/module/index.js", "lib/typescript/index.d.ts")) {
        if (!(Test-Entry $f)) { Add-Failure "$f is not in the package (did bob build run?)" }
    }

    # 2. what package.json points at, whatever it points at today.
    foreach ($key in @("main", "types", "module", "react-native", "source", "browser")) {
        $target = $pkgJson.$key
        if ($target -and !(Test-Entry $target)) {
            Add-Failure "package.json points at '$target', which is not in the package"
        }
    }

    # 3. every path the files allow-list promises.
    foreach ($entry in $pkgJson.files) {
        # Globs are npm's to expand.
        if ($entry.Contains('*')) { continue }
        # Absent by construction for a local Brain, which is what makes a
        # rehearsal a rehearsal.
        if ($entry -in "native/VERSION", "native/BUILD_MODE" -and $shippable -ne "yes") { continue }
        if (!(Test-Entry $entry) -and !(Test-Prefix "$entry/")) {
            Add-Failure "'$entry' is in the files allow-list but not in the package"
        }
    }

    # 4. the Brain, both platforms. A package with one of them installs and then
    #    fails to link on the other -- so this is fatal, except in the one case
    #    where the host was never able to produce the iOS half.
    if (Test-Prefix "native/libs/ios/libssruntime.xcframework/") {
        if (@($entryList | Where-Object { $_ -like "native/libs/ios/libssruntime.xcframework/*.a" -or $_ -like "native/libs/ios/libssruntime.xcframework/*/*.a" }).Count -eq 0) {
            Add-Failure "the iOS xcframework carries no static library"
        }
    } elseif ($shippable -eq "yes" -or $sdk -ne "build") {
        Add-Failure "no iOS xcframework in the package (build it on macOS, or use sdk=download)"
    } else {
        Write-Host "   note: no iOS xcframework -- Windows cannot build one, and only sdk=download carries it"
    }
    foreach ($abi in $androidAbis) {
        if (!(Test-Entry "native/libs/android/$abi/libssruntime.a")) {
            Add-Failure "no Android $abi slice in the package"
        }
    }
    if (!(Test-Entry "native/include/ssruntime.h")) { Add-Failure "native/include/ssruntime.h is missing -- cpp/ includes it" }

    # 5. the licences the package promises to carry. THIRD_PARTY_NOTICES.md
    #    names all three as files to redistribute.
    foreach ($f in @("native/LICENSE.md", "native/THIRD-PARTY-LICENSES.ssruntime.md", "third_party/flatbuffers/LICENSE")) {
        if (!(Test-Entry $f)) { Add-Failure "$f is missing -- THIRD_PARTY_NOTICES.md names it as a file to redistribute" }
    }
    if (!(Test-Entry "third_party/flatbuffers/include/flatbuffers/flatbuffers.h")) {
        Add-Failure "the vendored flatbuffers headers are missing (submodule not initialised?)"
    }

    # 6. the native glue a consumer builds, and the generated halves of it.
    if (!(Test-Prefix "cpp/format/")) { Add-Failure "cpp/format/ is missing -- the FlatBuffers accessors are generated and committed" }
    if (!(Test-Prefix "nitrogen/generated/")) { Add-Failure "nitrogen/generated/ is missing -- the Nitro bindings" }
    if (@($entryList | Where-Object { $_ -like "*.podspec" }).Count -eq 0) {
        Add-Failure "no podspec in the package -- CocoaPods has nothing to read"
    }
    foreach ($f in @("android/CMakeLists.txt", "android/build.gradle", "app.plugin.js", "nitro.json")) {
        if (!(Test-Entry $f)) { Add-Failure "$f is missing" }
    }

    # 7. build output that rode along. `files` takes a directory whole.
    foreach ($bad in @("android/build/", "android/.cxx/", "node_modules/", "example/")) {
        if (Test-Prefix $bad) { Add-Failure "'$bad' is in the package -- a files entry is taking a directory whole" }
    }

    # 8. what the archive says about itself. Only a real one can be asked.
    if ($packed) {
        Push-Location $work
        try {
            & tar -xzf $packed package/package.json package/native/BUILD_MODE package/native/VERSION 2>$null | Out-Null
        } finally { Pop-Location }
        $inner = Get-Content (Join-Path $work "package/package.json") -Raw
        $innerJson = $inner | ConvertFrom-Json
        if ($innerJson.name -ne $pkgName) { Add-Failure "the tarball says name $($innerJson.name), expected $pkgName" }
        if ($innerJson.version -ne $version) { Add-Failure "the tarball says version $($innerJson.version), expected $version" }
        if ($innerJson.private -eq $true) { Add-Failure "the tarball is marked private -- it cannot go to npm" }
        # A local path or a workspace protocol resolves in this repo and nowhere
        # else.
        if ($inner -match '"(workspace|file|link):') {
            Add-Failure "the tarball has a workspace:/file:/link: range in its dependencies"
        }
        $packedMode = (Get-Content (Join-Path $work "package/native/BUILD_MODE")).Trim()
        $packedSdk = (Get-Content (Join-Path $work "package/native/VERSION")).Trim()
        if ($packedMode -ne "release") { Add-Failure "the tarball carries a '$packedMode' Brain -- a debug build ships as a slow player with nothing to say why" }
        if ($packedSdk -ne $pinned) { Add-Failure "the tarball carries SDK '$packedSdk', expected the pinned $pinned" }
    }

    foreach ($line in (Get-Content (Join-Path $out "SHA256SUMS"))) {
        $expected, $name = $line -split '  ', 2
        if ((Get-Sha256 (Join-Path $out $name)) -ne $expected) { Add-Failure "SHA256SUMS does not verify for $name" }
    }

    if ($failed.Count -gt 0) {
        [Console]::Error.WriteLine("")
        [Console]::Error.WriteLine("${app}: what is in $out is not shippable:")
        foreach ($f in $failed) { [Console]::Error.WriteLine("  $f") }
        exit 1
    }
    Write-Host "   all checks passed"
} elseif ($verify -eq "no") {
    Write-Host ""
    Write-Host ">> [verify] verify=no -- nothing was checked"
} else {
    Write-Host ""
    Write-Host ">> [verify] nothing to read back -- the pack stage did not run"
}

# --- done ------------------------------------------------------------------
Write-Host ""
Write-Host "${app}: done -> $out"
Write-Host ""
# Assigned first: Sort-Ordinal hands back the array as ONE object, which a
# foreach over the call itself would take whole.
$listing = Sort-Ordinal @(Get-ChildItem -Path $out -Recurse -File |
    ForEach-Object { $_.FullName.Substring($out.Length + 1).Replace('\', '/') })
foreach ($rel in $listing) {
    Write-Host ("  {0,10}  {1}" -f (Get-Item (Join-Path $out $rel)).Length, $rel)
}
Write-Host ""
if ($shippable -eq "yes") {
    Write-Host "${app}: nothing was published, and nothing can be from here -- 'pnpm run release'"
    Write-Host "${app}: is macOS only (release.ps1 says why). This tarball is for looking at:"
    if ($packed) {
        Write-Host "  npx create-expo-app scratch; cd scratch"
        Write-Host "  npm i $packed; npx expo prebuild --platform android"
    }
} else {
    Write-Host "${app}: REHEARSAL -- no tarball. The Brain in native\ is a local build, and"
    Write-Host "${app}: prepack refuses to pack one. Everything else ran; $base.files is"
    Write-Host "${app}: what an upload would have carried."
}

} finally {
    Pop-Location
    if (Test-Path $work) { Remove-Item -Recurse -Force $work }
}
