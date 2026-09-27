#!/usr/bin/env pwsh
#
# Build the GitHub Pages site locally -- everything .github/workflows/pages.yml
# publishes, in the order that works. PowerShell twin of build-pages.sh.
#
#   scripts/build-pages.ps1              # the tree pages.yml uploads
#   scripts/build-pages.ps1 serve=yes    # ... and serve it, base and all
#   scripts/build-pages.ps1 api=no       # prose only; keep the docs/api already there
#   scripts/build-pages.ps1 prepare=yes  # the install first, as CI does
#
# **This script implements nothing.** It is prepare-docs then build-docs, which
# are the pair every repository in the SpriteStudio family spells the same way,
# and it exists so that one command reproduces the workflow and so that CI and a
# local build cannot drift. Where the siblings' build-pages assembles the site
# with other outputs beside it -- examples, a converter, rustdoc -- there is
# nothing else to assemble here: the Pages tree *is* the VitePress site, and
# pages.yml uploads docs/.vitepress/dist directly.
#
# So the reasons live one level down, at the site they bind: why TypeDoc must run
# before VitePress, why one build covers both locales, why there is no base=
# option, and why a dead link fails while an #anchor does not, are all in
# build-docs.sh's header. Why the docs need no Brain is in prepare-docs.sh's.
#
# What this does NOT reproduce is the deploy job (actions/deploy-pages) -- there
# is no local equivalent of publishing.
$ErrorActionPreference = "Stop"

$APP = Split-Path -Leaf $PSCommandPath
$ROOT_DIR = Split-Path -Parent (Split-Path -Parent $PSCommandPath)

$DIST = "docs/.vitepress/dist"

function Fail {
    param([string] $Message, [int] $Code = 1)
    [Console]::Error.WriteLine("${APP}: $Message")
    exit $Code
}

# --- options --------------------------------------------------------------
$opts = [ordered]@{
    prepare = "auto"
    api     = "yes"
    serve   = "no"
    port    = "4173"
}

function Show-Usage {
    Write-Host "Usage: $APP [options]"
    Write-Host "$APP options:"
    Write-Host "  prepare=<auto|yes|no>   Run scripts/prepare-docs.ps1 -- the install -- first"
    Write-Host "                          (default: auto). auto = only when node_modules is"
    Write-Host "                          missing. yes forces it, which is what a changed"
    Write-Host "                          pnpm-lock.yaml needs; no is for CI, where the"
    Write-Host "                          install is a step of its own."
    Write-Host "  api=<yes|no>            Regenerate the API reference with TypeDoc first"
    Write-Host "                          (default: yes). See scripts/build-docs.ps1 --help."
    Write-Host "  serve=<yes|no>          Serve the built site when the build is done (default:"
    Write-Host "                          no). Foreground; Ctrl-C to stop."
    Write-Host "  port=<n>                Port for serve=yes (default: 4173)"
    Write-Host "  -h | --help             Show this help"
    Write-Host ""
    Write-Host "Output: $DIST -- the exact tree pages.yml uploads, both locales in the one"
    Write-Host "build."
    Write-Host ""
    Write-Host "This is prepare-docs then build-docs, and nothing else. Run either on its"
    Write-Host "own with 'pnpm run prepare-docs' / 'pnpm run build-docs'."
    Write-Host ""
    Write-Host "Neither the Brain nor a platform toolchain is needed. TypeDoc reads TypeScript"
    Write-Host "sources and VitePress renders markdown, so this runs on any OS with Node."
}

foreach ($item in $args) {
    if ($item -in "-h", "--help", "help") {
        Show-Usage
        exit 0
    } elseif ($item -match "=") {
        $key, $value = $item -split "=", 2
        if (-not $opts.Contains($key)) {
            Fail "unknown option '$key' (see $APP --help)" 2
        }
        # Lower-cased where the option is a keyword; port= is not.
        $opts[$key] = if ($key -eq "port") { $value } else { $value.ToLower() }
    } else {
        Fail "unknown argument '$item' (options are key=value; see $APP --help)" 2
    }
}

if ($opts.prepare -notin @("auto", "yes", "no")) { Fail "prepare must be auto, yes or no (got '$($opts.prepare)')" 2 }
if ($opts.api   -notin @("yes", "no"))           { Fail "api must be yes or no (got '$($opts.api)')" 2 }
if ($opts.serve -notin @("yes", "no"))           { Fail "serve must be yes or no (got '$($opts.serve)')" 2 }
if ($opts.port -notmatch '^\d+$')                { Fail "port must be a number (got '$($opts.port)')" 2 }

$serveNote = if ($opts.serve -eq "no") { "" } else { " (port $($opts.port))" }

Write-Host "options"
Write-Host "  prepare => $($opts.prepare)"
Write-Host "  api     => $($opts.api)"
Write-Host "  serve   => $($opts.serve)$serveNote"
Write-Host ""

# --- preflight ------------------------------------------------------------
# Only what this script itself needs to find; prepare-docs and build-docs each
# check their own toolchain.
if (-not (Test-Path (Join-Path $ROOT_DIR "docs/package.json"))) {
    Fail "docs/package.json not found -- is this the SSPlayerForReactNative repo?"
}

Push-Location $ROOT_DIR
try {
    $prepareScript = Join-Path $ROOT_DIR "scripts/prepare-docs.ps1"
    $buildScript = Join-Path $ROOT_DIR "scripts/build-docs.ps1"

    # --- prepare ----------------------------------------------------------
    # pnpm installs every workspace from the root, docs/ included -- so the
    # root's node_modules is what to probe.
    $runPrepare = switch ($opts.prepare) {
        "yes"  { $true }
        "no"   { $false }
        "auto" {
            if (Test-Path (Join-Path $ROOT_DIR "node_modules")) {
                Write-Host "${APP}: node_modules present; skipping the install (prepare=yes forces it)"
                Write-Host ""
                $false
            } else { $true }
        }
    }

    if ($runPrepare) {
        Write-Host ">> scripts/prepare-docs.ps1"
        & $prepareScript
        if ($LASTEXITCODE -ne 0) { Fail "prepare-docs.ps1 failed ($LASTEXITCODE)" $LASTEXITCODE }
        Write-Host ""
    }

    # --- build ------------------------------------------------------------
    # serve=yes runs in the foreground, so this is deliberately the last thing.
    Write-Host ">> scripts/build-docs.ps1 api=$($opts.api) serve=$($opts.serve) port=$($opts.port)"
    & $buildScript "api=$($opts.api)" "serve=$($opts.serve)" "port=$($opts.port)"
    $code = $LASTEXITCODE
} finally {
    Pop-Location
}
exit $code
