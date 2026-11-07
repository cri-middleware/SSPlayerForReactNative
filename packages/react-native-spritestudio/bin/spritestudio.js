#!/usr/bin/env node
'use strict'

/**
 * `npx react-native-spritestudio assets` — writes a typed manifest of the packs
 * the app ships.
 *
 * ## Why this exists
 *
 * A source is a **path string**, because a pack is a directory and Metro cannot
 * carry one (see `SsSource`). A path string gives no completion, no type error on
 * a typo and no build failure when the file is not there: misspelled, it is a
 * runtime error at best and a silently empty canvas at worst.
 *
 * The manifest gives all three back: it is a
 * plain `as const` object, so its keys are a literal union and its values are
 * literal strings that go straight into `source`. Nothing in the library has to
 * know about it.
 *
 * Deliberately a **package bin** rather than one of `scripts/`: those wrap
 * native tooling for this repo, and this has to run in the user's app. Pure
 * Node for the same reason — there is no shell tool to pick a platform wrapper
 * for.
 *
 * Usage:
 *   npx react-native-spritestudio assets [--assets <dir>...] [--out <file>] [--check]
 *
 *   --assets  Pack directory, repeatable. Defaults to the `assets` given to the
 *             config plugin in app.json, else `./assets/ss`.
 *   --out     Where to write. Default `./ss-assets.ts`.
 *   --check   Write nothing; exit non-zero if the file is missing or stale.
 *             For CI, and for catching a pack added without a regenerate.
 */

const fs = require('fs')
const path = require('path')

const DEFAULT_ASSETS = ['./assets/ss']
const DEFAULT_OUT = './ss-assets.ts'

function main(argv) {
  const command = argv[0]
  if (command !== 'assets') {
    process.stderr.write(
      `react-native-spritestudio: unknown command '${command ?? ''}'.\n` +
        'Usage: npx react-native-spritestudio assets [--assets <dir>] [--out <file>] [--check]\n'
    )
    return 2
  }

  const options = parseArgs(argv.slice(1))
  const projectRoot = process.cwd()
  const dirs = options.assets.length > 0 ? options.assets : assetsFromAppJson(projectRoot)

  const packs = []
  for (const dir of dirs) {
    const absolute = path.resolve(projectRoot, dir)
    if (!fs.existsSync(absolute)) {
      process.stderr.write(
        `react-native-spritestudio: no directory at '${dir}'.\n` +
          "  If the packs have not been converted yet, run the SDK's ssconverter-cli first.\n"
      )
      return 1
    }
    // The shipped prefix is the directory's own name — the config plugin copies
    // `./assets/ss` in as `ss/`, so `ss/overall/Basic.ssab` is what the runtime
    // is given. Keep the two in step or every generated path is wrong.
    const prefix = path.basename(absolute)
    for (const file of findSsab(absolute)) {
      const relative = toPosix(path.relative(absolute, file))
      packs.push({
        key: relative.replace(/\.ssab$/, ''),
        value: `${prefix}/${relative}`,
      })
    }
  }

  if (packs.length === 0) {
    process.stderr.write(
      `react-native-spritestudio: no .ssab found under ${dirs.join(', ')}.\n` +
        '  A manifest of nothing would type-check and then draw nothing, so this is an error.\n'
    )
    return 1
  }

  packs.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
  const duplicate = packs.find((p, i) => i > 0 && packs[i - 1].key === p.key)
  if (duplicate != null) {
    process.stderr.write(
      `react-native-spritestudio: two packs would both be '${duplicate.key}'.\n` +
        '  Give one of the asset directories a different name.\n'
    )
    return 1
  }

  const out = path.resolve(projectRoot, options.out)
  const contents = render(packs, dirs)

  if (options.check) {
    const existing = fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : null
    if (existing === contents) {
      process.stdout.write(`react-native-spritestudio: ${options.out} is up to date\n`)
      return 0
    }
    const flags = [...options.assets.flatMap((dir) => ['--assets', dir]), '--out', options.out]
    process.stderr.write(
      `react-native-spritestudio: ${options.out} is ${existing == null ? 'missing' : 'stale'}.\n` +
        `  Run: npx react-native-spritestudio assets ${flags.join(' ')}\n`
    )
    return 1
  }

  fs.mkdirSync(path.dirname(out), { recursive: true })
  fs.writeFileSync(out, contents)
  process.stdout.write(
    `react-native-spritestudio: wrote ${options.out} (${packs.length} packs)\n`
  )
  return 0
}

function parseArgs(args) {
  const options = { assets: [], out: DEFAULT_OUT, check: false }
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]
    if (arg === '--check') options.check = true
    else if (arg === '--assets') options.assets.push(args[++i])
    else if (arg === '--out') options.out = args[++i]
    else if (arg.startsWith('--assets=')) options.assets.push(arg.slice(9))
    else if (arg.startsWith('--out=')) options.out = arg.slice(6)
    else throw new Error(`react-native-spritestudio: unknown option '${arg}'`)
  }
  return options
}

/**
 * The `assets` the config plugin was given, read out of app.json.
 *
 * Static JSON only. An `app.config.js` would have to be evaluated, which means
 * running the app's own code to find out where its assets are — `--assets` is
 * the answer there, and the default covers the convention.
 */
function assetsFromAppJson(projectRoot) {
  const file = path.join(projectRoot, 'app.json')
  if (!fs.existsSync(file)) return DEFAULT_ASSETS
  try {
    const config = JSON.parse(fs.readFileSync(file, 'utf8'))
    const plugins = config?.expo?.plugins ?? []
    for (const plugin of plugins) {
      if (!Array.isArray(plugin) || plugin[0] !== 'react-native-spritestudio') continue
      const assets = plugin[1]?.assets
      if (assets == null) break
      return Array.isArray(assets) ? assets : [assets]
    }
  } catch {
    // A malformed app.json is the app's problem, not this tool's — fall through
    // to the convention rather than failing on a file we only wanted a hint from.
  }
  return DEFAULT_ASSETS
}

function findSsab(dir) {
  const found = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) found.push(...findSsab(full))
    else if (entry.isFile() && entry.name.endsWith('.ssab')) found.push(full)
  }
  return found
}

const toPosix = (p) => p.split(path.sep).join('/')

function render(packs, dirs) {
  const rows = packs.map((p) => `  ${JSON.stringify(p.key)}: ${JSON.stringify(p.value)},`)
  return `// Generated by \`npx react-native-spritestudio assets\`. Do not edit.
//
// Scanned: ${dirs.join(', ')}
//
// Each value is an asset path, which is what \`<SpriteStudioView source>\` takes.
// The point of going through this object rather than writing the string is that
// a wrong key is a **type error** — a wrong string is a blank canvas.
export const SsAssets = {
${rows.join('\n')}
} as const

/** Every pack this app ships. */
export type SsAssetKey = keyof typeof SsAssets

/**
 * The asset path for \`key\`.
 *
 * Only worth using over \`SsAssets[key]\` when the key is itself computed and
 * you want the union enforced at the call rather than at the index.
 */
export function ssAsset(key: SsAssetKey): (typeof SsAssets)[SsAssetKey] {
  return SsAssets[key]
}
`
}

try {
  process.exit(main(process.argv.slice(2)))
} catch (error) {
  process.stderr.write(`${String(error && error.message ? error.message : error)}\n`)
  process.exit(1)
}
