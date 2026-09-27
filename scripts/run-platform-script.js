const { spawnSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')

/**
 * Runs `scripts/<name>.sh` or `scripts/<name>.ps1` depending on the host OS.
 *
 * package.json scripts must not name a `.sh` directly — that breaks every Windows
 * contributor. Same shape as SSPlayerForWeb's shims, with the spawn logic in
 * one place so the four entry points beside this file stay one-liners.
 *
 * Extra arguments are forwarded **verbatim**. The `.ps1` scripts take
 * `[Parameter(ValueFromRemainingArguments)]` and parse the same `key=value` and
 * `--flag` spellings their `.sh` counterparts do (the pattern SSPlayerForWeb's
 * build-runtime.ps1 uses), so one command line works everywhere and this shim
 * never has to rewrite what the caller typed.
 *
 * @param {string} name  script base name, e.g. "download-sdk"
 * @param {string[]} [extraArgs]  defaults to this process's own arguments
 */
function runPlatformScript(name, extraArgs = process.argv.slice(2)) {
  const scriptsDir = __dirname
  const isWin = os.platform() === 'win32'
  const script = path.join(scriptsDir, `${name}.${isWin ? 'ps1' : 'sh'}`)

  if (!fs.existsSync(script)) {
    console.error(
      `[${name}] no ${isWin ? 'PowerShell' : 'shell'} implementation at ${script}`
    )
    process.exit(1)
  }

  const command = isWin ? 'powershell' : 'bash'
  const commandArgs = isWin
    ? ['-ExecutionPolicy', 'Bypass', '-File', script, ...extraArgs]
    : [script, ...extraArgs]

  console.log(`[${name}] running on ${os.platform()} via ${path.basename(script)}`)

  const result = spawnSync(command, commandArgs, { stdio: 'inherit' })
  process.exit(result.status !== null ? result.status : 1)
}

module.exports = { runPlatformScript }
