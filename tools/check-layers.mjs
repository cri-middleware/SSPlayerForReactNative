#!/usr/bin/env node
//
// Guards Layer 2's one rule: `src/core` imports nothing from `react` or
// `react-native`, so headless use and react-native-web stay possible. A
// violation type-checks, passes every unit test (vitest aliases `react-native`
// to a stub) and builds, so nothing else would notice.
//
// Read from the source, type-only imports included, and followed through every
// relative import, so a Layer 2 module that reaches `react` through a file in
// another layer fails too. What a *package* imports in turn is outside this
// graph: RN Skia's own entry reaches `react-native` on native, and that is the
// coupling Layer 2 accepts by drawing through Skia.
//
// Plain Node, like check-web-barrel.mjs, and for the same reason: nothing here
// is platform-specific, and it needs no install at all.
//
// Usage: node tools/check-layers.mjs

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(ROOT, 'packages', 'react-native-spritestudio', 'src')
const LAYER2 = join(SRC, 'core')

const FORBIDDEN = /^(react|react-native)(\/|$)/

// Comments go first, strings stay: a JSDoc that says "`require()` is allowed
// here" is prose, and `'file://'` is not the start of a comment.
const stripComments = (text) => {
  let out = ''
  let quote = null
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quote != null) {
      out += c
      if (c === '\\') out += text[++i] ?? ''
      else if (c === quote) quote = null
    } else if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++
      out += '\n'
    } else if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2)
      const skipped = text.slice(i, end < 0 ? text.length : end + 2)
      out += skipped.replace(/[^\n]/g, '')
      i = end < 0 ? text.length : end + 1
    } else {
      if (c === "'" || c === '"' || c === '`') quote = c
      out += c
    }
  }
  return out
}

// `import … from`, `export … from`, `import 'x'`, `import('x')` and `require('x')`
// — the last guarded against `this.require()`, a method Layer 2 does have.
const SPECIFIERS = [
  /\bfrom\s*(['"])([^'"]+)\1/g,
  /\bimport\s*(['"])([^'"]+)\1/g,
  /\bimport\s*\(\s*(['"])([^'"]+)\1/g,
  /(?<![.\w$])require\s*\(\s*(['"])([^'"]+)\1/g,
]
const specifiersOf = (file) => {
  const code = stripComments(readFileSync(file, 'utf8'))
  const found = new Set()
  for (const pattern of SPECIFIERS) {
    for (const [, , spec] of code.matchAll(pattern)) found.add(spec)
  }
  return [...found]
}

// What the bundler would pick for an extensionless specifier.
const resolveRelative = (from, spec) => {
  const base = resolve(dirname(from), spec)
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate
  }
  return null
}

const sources = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) return sources(full)
    return /\.tsx?$/.test(entry.name) ? [full] : []
  })

const show = (file) => relative(SRC, file)
const problems = []

console.log('==> import graph of src/core')
// Breadth-first from every Layer 2 file, remembering how each file was reached,
// so a violation two layers away is reported with the path that leads to it.
const reachedFrom = new Map(sources(LAYER2).map((file) => [file, null]))
const queue = [...reachedFrom.keys()]
while (queue.length > 0) {
  const file = queue.shift()
  for (const spec of specifiersOf(file)) {
    if (spec.startsWith('.')) {
      const target = resolveRelative(file, spec)
      if (target == null) {
        problems.push(`${show(file)} imports '${spec}', which resolves to nothing`)
      } else if (!reachedFrom.has(target)) {
        reachedFrom.set(target, file)
        queue.push(target)
      }
    } else if (FORBIDDEN.test(spec)) {
      const chain = [file]
      for (let at = reachedFrom.get(file); at != null; at = reachedFrom.get(at)) chain.unshift(at)
      problems.push(`${chain.map(show).join(' → ')} imports '${spec}'`)
    }
  }
}

if (problems.length > 0) {
  console.error(`\ncheck-layers: ${problems.length} problem(s)\n`)
  for (const problem of problems) console.error(`  ${problem}`)
  console.error(
    '\n  Layer 2 is free of react and react-native, so headless use and react-native-web stay\n' +
      '  possible. Move what needs them up into player/ or view/.'
  )
  process.exit(1)
}
console.log(`  ok   ${reachedFrom.size} modules, none imports react or react-native`)
console.log('\ncheck-layers: ok')
