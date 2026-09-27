param (
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$ArgsList
)

# Build the example app and run it on an Android device or emulator.
# PowerShell twin of run-android.sh.
#
# A wrapper over `expo prebuild` + `expo run:android`, the documented
# pair, adding:
#   * The release variant by default: the JS bundle is embedded, so no Metro has
#     to be running.
#   * The Brain and the example packs checked up front, naming the command that
#     supplies each, rather than a build that succeeds and draws nothing.
#
# Usage: scripts/run-android.ps1 [device=<name>] [config=<release|debug>]
#   device : a connected device, or an emulator (AVD) name, which Expo boots
#            (default: the one connected device; Expo asks when there are more)
#   config : release  JS embedded, no Metro (default)
#            debug    the dev client, served by Metro

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $PSCommandPath
$rootDir = Split-Path -Parent $scriptDir
$app = Split-Path -Leaf $PSCommandPath

$nativeDir = Join-Path $rootDir "packages/react-native-spritestudio/native"
$exampleDir = Join-Path $rootDir "example"

# Plain stderr and an explicit code, rather than Write-Error: under a Stop
# preference that terminates on the spot, so the exit code beside it never runs
# and 2 (bad usage) arrives as 1.
function Fail {
    param([string] $Message, [int] $Code = 1)
    [Console]::Error.WriteLine("${app}: $Message")
    exit $Code
}

$device = ""
$config = "release"

function Show-Usage {
    Write-Host "Usage: $app [options]"
    Write-Host "Options:"
    Write-Host "  device=<name>        Connected device or AVD name (default: the one"
    Write-Host "                       connected device)"
    Write-Host "  config=<config>      release (JS embedded, default) or debug (Metro)"
}

foreach ($arg in $ArgsList) {
    switch -Regex ($arg) {
        '^device=(.*)$' { $device = $Matches[1] }
        '^config=(.*)$' { $config = $Matches[1].ToLower() }
        '^(-h|--help|help)$' { Show-Usage; exit 0 }
        default { Fail "unknown argument '$arg' (options are key=value; see $app --help)" 2 }
    }
}

if ($config -notin "release", "debug") { Fail "config must be release or debug (got '$config')" 2 }

if (!(Test-Path (Join-Path $rootDir "node_modules"))) {
    Fail "node_modules is missing -- run 'pnpm install --frozen-lockfile' first"
}
if (!(Get-ChildItem -Path (Join-Path $nativeDir "libs/android/*/libssruntime.a") -ErrorAction SilentlyContinue)) {
    Fail "the Brain for Android is missing -- run 'pnpm run download-sdk'`n  (or 'pnpm run build-runtime platform=android' when changing the Brain)"
}
if (!(Get-ChildItem -Path (Join-Path $exampleDir "assets/ss") -ErrorAction SilentlyContinue)) {
    Fail "example/assets/ss is empty -- run 'pnpm run deploy-examples'"
}

# Release embeds the bundle, so no Metro: Expo would start one anyway and stay
# attached to it instead of returning.
$runArgs = @("--variant", $config)
if ($config -eq "release") { $runArgs += "--no-bundler" }
if ($device) { $runArgs += @("--device", $device) }

Set-Location $exampleDir
Write-Host ">> pnpm exec expo prebuild --platform android"
& pnpm exec expo prebuild --platform android --no-install
if ($LASTEXITCODE -ne 0) { Fail "expo prebuild failed ($LASTEXITCODE)" $LASTEXITCODE }
Write-Host ">> pnpm exec expo run:android $($runArgs -join ' ')"
& pnpm exec expo run:android @runArgs
exit $LASTEXITCODE
