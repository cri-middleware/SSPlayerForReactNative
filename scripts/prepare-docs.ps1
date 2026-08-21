param (
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$ArgsList
)

# Install what the documentation site needs in order to build.
# PowerShell twin of prepare-docs.sh.
#
# One thing, where the sibling players need two: node_modules, and nothing else.
# SSPlayerForWeb has to put the SDK wasm on disk before its docs build, because
# its packages' sources import it and TypeDoc resolves those imports. Nothing
# here does. TypeDoc reads packages/*/src as TypeScript and VitePress renders
# markdown -- neither runs a line of it -- so THE DOCS NEED NO BRAIN, no Rust
# and no platform toolchain, and download-sdk is not part of this path. Which is
# also why pages.yml checks out without submodules and still publishes a
# complete site.
#
# npm workspaces hoist into the ROOT node_modules, docs/ included, so the root
# is both what to install and what to probe.
#
# Usage: scripts/prepare-docs.ps1 [frozen=<yes|no>]
#   frozen : yes  npm ci, failing rather than updating package-lock.json (default)
#            no   npm install, which is what adding a dependency needs
#
# Then: scripts/build-docs.ps1, which runs TypeDoc and VitePress.

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $PSCommandPath
$rootDir = Split-Path -Parent $scriptDir
$app = Split-Path -Leaf $PSCommandPath

# Plain stderr and an explicit code, rather than Write-Error: under a Stop
# preference that terminates on the spot, so the exit code beside it never runs
# and 2 (bad usage) arrives as 1.
function Fail {
    param([string] $Message, [int] $Code = 1)
    [Console]::Error.WriteLine("${app}: $Message")
    exit $Code
}

$frozen = "yes"

function Show-Usage {
    Write-Host "Usage: $app [options]"
    Write-Host "$app options:"
    Write-Host "  frozen=<yes|no>         Install with 'npm ci', i.e. fail rather than update"
    Write-Host "                          package-lock.json (default: yes). frozen=no runs"
    Write-Host "                          'npm install', which is what adding a dependency needs."
    Write-Host "  -h | --help             Show this help"
    Write-Host ""
    Write-Host "Installs into the *root* node_modules -- npm workspaces hoist, docs/ included."
    Write-Host ""
    Write-Host "No Brain, no Rust, no platform toolchain: TypeDoc reads TypeScript sources and"
    Write-Host "VitePress renders markdown, so neither ever loads the native runtime."
    Write-Host ""
    Write-Host "Building the site is scripts/build-docs.ps1, not this script."
}

foreach ($arg in $ArgsList) {
    switch -Regex ($arg) {
        '^frozen=(.*)$' { $frozen = $Matches[1].ToLower() }
        '^(-h|--help|help)$' { Show-Usage; exit 0 }
        default { Fail "unknown argument '$arg' (options are key=value; see $app --help)" 2 }
    }
}

if ($frozen -notin "yes", "no") { Fail "frozen must be yes or no (got '$frozen')" 2 }

Write-Host "options"
Write-Host "  frozen => $frozen"
Write-Host ""

# --- preflight ------------------------------------------------------------
if (!(Test-Path (Join-Path $rootDir "docs/package.json"))) {
    Fail "docs/package.json not found -- is this the SSPlayerForReactNative repo?"
}

if (!(Get-Command npm -ErrorAction SilentlyContinue)) {
    [Console]::Error.WriteLine("${app}: npm not found -- install Node 20 or newer (package.json engines; CI uses 22)")
    Fail "https://nodejs.org"
}

function Invoke-Checked {
    param([string] $What, [scriptblock] $Body)
    & $Body
    if ($LASTEXITCODE -ne 0) { Fail "$What failed ($LASTEXITCODE)" $LASTEXITCODE }
}

# Every workspace path is relative to the repo root, so run from there however
# the script was invoked.
Push-Location $rootDir
try {
    if ($frozen -eq "yes") {
        Write-Host ">> npm ci"
        Invoke-Checked "npm ci" { & npm ci }
    } else {
        Write-Host ">> npm install"
        Invoke-Checked "npm install" { & npm install }
    }
} finally {
    Pop-Location
}

Write-Host ""
Write-Host "${app}: done"
Write-Host "${app}: build the site:  scripts/build-docs.ps1"
Write-Host "${app}: live preview:    npm run docs:dev"
