param (
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$ArgsList
)

# Build the documentation site: TypeDoc, then VitePress.
# PowerShell twin of build-docs.sh.
#
# TypeDoc has to run first: it writes the markdown under docs/api that VitePress
# then renders, and that directory is generated, git-ignored and absent from a
# fresh clone. api=no is for the common case where only prose moved.
#
# One build, both locales. VitePress resolves docs/ja through its own i18n
# support, so unlike the Zensical siblings there is no locale option here.
#
# TypeDoc fails the build on an error and VitePress fails on a dead link, so a
# page pointing at a heading somebody renamed does not reach the site. NEITHER
# CHECKS #anchors.
#
# NO base= OPTION, unlike SSPlayerForWeb's twin. `base` is written into
# docs/.vitepress/config.mts rather than read from the environment, so every
# build here is already for the published path and there is nothing to pass.
# That is also why serve=yes goes through `vitepress preview`: served from a
# root, every asset URL in the built tree 404s.
#
# Usage: scripts/build-docs.ps1 [api=<yes|no>] [serve=<yes|no>] [port=<n>]
#   api   : yes  regenerate docs/api with TypeDoc first (default)
#           no   prose only, keeping whatever docs/api already holds
#   serve : yes  serve the built tree afterwards, under its base path
#   port  : port for serve=yes (default 4173)
#
# Install the toolchain first with scripts/prepare-docs.ps1.

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $PSCommandPath
$rootDir = Split-Path -Parent $scriptDir
$app = Split-Path -Leaf $PSCommandPath

$dist = "docs/.vitepress/dist"

# Plain stderr and an explicit code, rather than Write-Error: under a Stop
# preference that terminates on the spot, so the exit code beside it never runs
# and 2 (bad usage) arrives as 1.
function Fail {
    param([string] $Message, [int] $Code = 1)
    [Console]::Error.WriteLine("${app}: $Message")
    exit $Code
}

$api = "yes"
$serve = "no"
$port = "4173"

function Show-Usage {
    Write-Host "Usage: $app [options]"
    Write-Host "$app options:"
    Write-Host "  api=<yes|no>            Regenerate the API reference with TypeDoc first"
    Write-Host "                          (default: yes). api=no builds the prose and whatever"
    Write-Host "                          docs/api already holds -- much faster, and enough when"
    Write-Host "                          nothing under packages/*/src has changed. It fails if"
    Write-Host "                          docs/api was never generated at all."
    Write-Host "  serve=<yes|no>          Serve the built site when the build is done (default:"
    Write-Host "                          no), through 'vitepress preview' so it is served"
    Write-Host "                          under the base path the deployed site uses."
    Write-Host "                          Foreground; Ctrl-C to stop."
    Write-Host "  port=<n>                Port for serve=yes (default: 4173)"
    Write-Host "  -h | --help             Show this help"
    Write-Host ""
    Write-Host "Output: $dist -- both locales in the one build, English at the root and Japanese"
    Write-Host "under /ja/. A dead link fails the build; #anchors are checked by nobody."
    Write-Host ""
    Write-Host "There is no base= option: docs/.vitepress/config.mts writes the base path itself."
    Write-Host ""
    Write-Host "Neither the Brain nor a platform toolchain is needed. TypeDoc reads TypeScript"
    Write-Host "sources and VitePress renders markdown, so this runs on any OS with Node."
    Write-Host ""
    Write-Host "Install first with scripts/prepare-docs.ps1."
}

foreach ($arg in $ArgsList) {
    switch -Regex ($arg) {
        # Lower-cased where the option is a keyword; port= is not.
        '^api=(.*)$'   { $api = $Matches[1].ToLower() }
        '^serve=(.*)$' { $serve = $Matches[1].ToLower() }
        '^port=(.*)$'  { $port = $Matches[1] }
        '^(-h|--help|help)$' { Show-Usage; exit 0 }
        default { Fail "unknown argument '$arg' (options are key=value; see $app --help)" 2 }
    }
}

if ($api -notin "yes", "no") { Fail "api must be yes or no (got '$api')" 2 }
if ($serve -notin "yes", "no") { Fail "serve must be yes or no (got '$serve')" 2 }
if ($port -notmatch '^\d+$') { Fail "port must be a number (got '$port')" 2 }

$serveNote = if ($serve -eq "no") { "" } else { " (port $port)" }

Write-Host "options"
Write-Host "  api   => $api"
Write-Host "  serve => $serve$serveNote"
Write-Host ""

# --- preflight ------------------------------------------------------------
if (!(Test-Path (Join-Path $rootDir "docs/package.json"))) {
    Fail "docs/package.json not found -- is this the SSPlayerForReactNative repo?"
}

if (!(Get-Command pnpm -ErrorAction SilentlyContinue)) {
    [Console]::Error.WriteLine("${app}: pnpm not found (this repo pins it in package.json's packageManager)")
    Fail "enable it with 'corepack enable', or install it from https://pnpm.io"
}

# pnpm installs every workspace from the root, docs/ included -- so the root's
# node_modules is what to probe, and prepare-docs.ps1 is what fills it.
if (!(Test-Path (Join-Path $rootDir "node_modules"))) {
    Fail "node_modules is missing -- run 'scripts/prepare-docs.ps1' first"
}

function Invoke-Checked {
    param([string] $What, [scriptblock] $Body)
    & $Body
    if ($LASTEXITCODE -ne 0) { Fail "$What failed ($LASTEXITCODE)" $LASTEXITCODE }
}

# Every workspace path is relative to the repo root, so build from there however
# the script was invoked.
Push-Location $rootDir
try {
    # --- build ------------------------------------------------------------
    if ($api -eq "yes") {
        # The root's `docs` script, so the build is defined once, in package.json:
        # typedoc, then vitepress build.
        Write-Host ""
        Write-Host ">> pnpm run docs"
        Invoke-Checked "docs build" { & pnpm run docs }
    } else {
        if (!(Test-Path (Join-Path $rootDir "docs/api"))) {
            [Console]::Error.WriteLine("${app}: api=no, but docs/api does not exist -- it is generated and git-ignored,")
            Fail "so the first build in a clone has to be api=yes"
        }
        Write-Host ""
        Write-Host ">> pnpm --filter docs exec vitepress build"
        Invoke-Checked "docs build" { & pnpm --filter docs exec vitepress build }
    }

    # --- what landed ------------------------------------------------------
    Write-Host ""
    Write-Host "${app}: done -> $dist"
    function Write-Report {
        param([string] $Path, [string] $Label)
        if (Test-Path (Join-Path $rootDir $Path)) {
            Write-Host "  ${Label}: $Path"
        } else {
            Write-Host "  ${Label}: MISSING ($Path)"
        }
    }
    Write-Report "$dist/index.html" "en "
    Write-Report "$dist/ja/index.html" "ja "
    Write-Report "$dist/api/index.html" "api"

    # --- serve ------------------------------------------------------------
    Write-Host ""
    if ($serve -eq "yes") {
        Write-Host "${app}: 'vitepress preview' serves under the site's base path -- open the URL it"
        Write-Host "${app}: prints, not the bare host. Ctrl-C to stop."
        Write-Host ""
        & pnpm --filter docs exec vitepress preview --port $port
        exit $LASTEXITCODE
    } else {
        Write-Host "${app}: serve it (under the base path, which a plain static server will not do):"
        Write-Host "${app}:   $app serve=yes"
        Write-Host "${app}:   pnpm --filter docs exec vitepress preview"
    }
} finally {
    Pop-Location
}
