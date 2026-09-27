#!/usr/bin/env node
//
// Guards the web stub barrel — `src/index.web.ts`, the entry point that lets an
// app shipping web as well as native build its web bundle. Nothing on it draws;
// what it has to survive is *import*.
//
// Three ways it breaks, none of which `pnpm run typecheck` can see, and all of
// which surface in somebody else's web build rather than here:
//
//   1. A module the barrel re-exports gains a runtime import that reaches Skia,
//      react-native or Nitro. RN Skia's web entry is `JsiSkApi(global.CanvasKit)`
//      and Nitro's web shim throws on any property access — both at module
//      scope, so the web bundle dies on import.
//   2. An export is added to `index.ts` and not to `index.web.ts`. A web
//      consumer then reads `undefined`, with no error to go on.
//   3. A stub stops throwing (an arrow function instead of a `function`, say,
//      which turns `new SsTextureRegistry()` into "is not a constructor").
//
// Plain Node rather than the `.sh` + `.ps1` pair the other checks use: there is
// nothing platform-specific here — no flatc, no cargo, no Skia — so a shim pair
// would only shut Windows contributors out of the one check they could run.
//
// Usage: node tools/check-web-barrel.mjs

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PKG = join(ROOT, 'packages', 'react-native-spritestudio')
const BUILD = join(ROOT, 'tools', '.build', 'web-barrel')

const problems = []
const fail = (what, why) => problems.push(`${what}\n    ${why}`)
const ok = (line) => console.log(`  ok   ${line}`)

const report = () => {
  if (problems.length === 0) return
  console.error(`\ncheck-web-barrel: ${problems.length} problem(s)\n`)
  for (const problem of problems) console.error(`  ${problem}\n`)
  process.exit(1)
}

// --- 1. emit -----------------------------------------------------------------
//
// The package's own settings (esnext / bundler), so what is inspected is what
// Metro would resolve rather than a second compilation with its own rules.
console.log('==> transpiling src/')
rmSync(BUILD, { recursive: true, force: true })
mkdirSync(BUILD, { recursive: true })
execFileSync(
  'npx',
  ['tsc', '--noEmit', 'false', '--declaration', 'false',
   '--rootDir', 'src', '--outDir', BUILD],
  { cwd: PKG, stdio: 'inherit' }
)

const emitted = []
const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) walk(full)
    else if (entry.name.endsWith('.js')) emitted.push(full)
  }
}
walk(BUILD)

// Node needs the extension that a bundler infers, and `import()` below is what
// makes "the stubs throw" a fact rather than a reading of the source.
const SPECIFIER = /(\bfrom\s*|\bimport\s*\(\s*)'(\.[^']*)'/g
for (const file of emitted) {
  const src = readFileSync(file, 'utf8')
  writeFileSync(file, src.replace(SPECIFIER, (m, head, spec) =>
    spec.endsWith('.js') ? m : `${head}'${spec}.js'`))
}
writeFileSync(join(BUILD, 'package.json'), '{"type":"module"}\n')

// --- 2. the import closure is free of backends -------------------------------
//
// Walked rather than required, so the result does not depend on whether a
// `react-native` happens to sit in a node_modules above the build directory.
console.log('==> import closure of index.web.js')
const closure = new Set()
const bare = []
const collect = (file) => {
  if (closure.has(file)) return
  closure.add(file)
  const src = readFileSync(file, 'utf8')
  for (const [, , spec] of src.matchAll(SPECIFIER)) {
    const target = resolve(dirname(file), spec)
    if (existsSync(target)) collect(target)
    else fail(`${relative(BUILD, file)} imports ${spec}`, 'it resolves to nothing in the emitted tree')
  }
  for (const [, spec] of src.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*)'([^.'][^']*)'/g)) {
    bare.push(`${relative(BUILD, file)} → ${spec}`)
  }
}
collect(join(BUILD, 'index.web.js'))

if (bare.length > 0) {
  fail(
    'the web barrel reaches a package, not just its own files:\n      ' + bare.join('\n      '),
    'every module it re-exports must be import-clean — move the offending export behind a stub, ' +
      'or split the runtime import out the way core/packColor.ts is split from core/parts.ts'
  )
} else {
  ok(`${closure.size} modules, no package imports`)
}

// Stop here rather than reporting through a stack trace: a closure that reaches
// a package is a closure Node cannot import, so step 4 below would die on the
// offending module instead of on the finding that already names it.
report()

// --- 3. the two barrels export the same names --------------------------------
console.log('==> export parity')
const exportsOf = (file) => {
  const src = readFileSync(file, 'utf8')
  const names = new Set()
  for (const [, group] of src.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const part of group.split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop()?.trim()
      if (name) names.add(name)
    }
  }
  for (const [, name] of src.matchAll(
    /export\s+(?:declare\s+)?(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/g
  )) {
    names.add(name)
  }
  return names
}
const nativeNames = exportsOf(join(BUILD, 'index.js'))
const webNames = exportsOf(join(BUILD, 'index.web.js'))
const missing = [...nativeNames].filter((n) => !webNames.has(n))
const extra = [...webNames].filter((n) => !nativeNames.has(n))

if (missing.length > 0) {
  fail(`index.web.ts is missing: ${missing.join(', ')}`,
    'a web consumer reads undefined for these — re-export them if portable, stub them if not')
}
if (extra.length > 0) {
  fail(`index.web.ts exports what index.ts does not: ${extra.join(', ')}`,
    'the two barrels are one API; add it to index.ts or drop it')
}
if (missing.length === 0 && extra.length === 0) ok(`${nativeNames.size} names, both barrels`)

// --- 4. the stubs throw, and the portable half does not ----------------------
console.log('==> behaviour')
const web = await import(pathToFileURL(join(BUILD, 'index.web.js')).href)

// One of each shape, because they fail differently: a component is called, a
// class is constructed, and the Layer 1 escape hatch is a property read.
const throws = (label, fn) => {
  try {
    fn()
    fail(`${label} did not throw`, 'it must, and the message must name this package')
  } catch (error) {
    const message = String(error?.message ?? '')
    if (!message.startsWith('react-native-spritestudio:')) {
      fail(`${label} threw the wrong error`, message.slice(0, 120))
    } else ok(`${label} throws`)
  }
}
throws('SpriteStudioView()', () => web.SpriteStudioView({}))
throws('new SsTextureRegistry()', () => new web.SsTextureRegistry())
throws('SsRuntimeModule.hashString', () => web.SsRuntimeModule.hashString)

// The portable half is the reason this barrel is worth more than a hard error:
// placement, path resolution and the vocabulary are real on both platforms.
const placed = web.resolveRootTransform(
  { x: 0, y: 0, width: 100, height: 100 }, 200, 200, { fit: 'contain', align: 'center' }
)
if (placed.scale !== 2) {
  fail('resolveRootTransform is not the real implementation', `scale came out ${placed.scale}, expected 2`)
} else if (web.SsPlaybackDirection.forward !== 0 || web.schemeOf('http://a/b.ssab') !== 'remote') {
  fail('a portable export is not the real implementation', 'the enums or the path helpers were stubbed')
} else {
  ok('placement, enums and path helpers compute')
}

// --- report ------------------------------------------------------------------
report()
console.log('\ncheck-web-barrel: ok')
