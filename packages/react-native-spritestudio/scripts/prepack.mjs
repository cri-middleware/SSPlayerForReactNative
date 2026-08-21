// Refuses to build a tarball that would not build on the other side.
//
// `npm pack` is the last place any of this is checkable, and every failure it
// guards against is silent: the tarball is produced, published and installed,
// and the symptom arrives in somebody else's Xcode.
//
// Plain Node rather than the `.js` shim over `.sh` + `.ps1` the root toolchain
// scripts use — there is no platform-specific work here, and a lifecycle hook
// has to run wherever `npm publish` is run.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const pkgDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'))

const problems = []
const fail = (what, why) => problems.push(`${what}\n    ${why}`)
const has = (...parts) => existsSync(join(pkgDir, ...parts))

// --- 1. the Brain, which is gitignored and therefore absent by default -------
//
// A clean checkout has no `native/` at all, so this is the failure a release
// from CI hits first: a tarball that installs and then cannot link.
if (!has('native', 'libs')) {
  fail('native/libs is missing', 'run `npm run build-runtime -- build=release` (or download-sdk) before packing')
} else {
  if (!has('native', 'libs', 'ios', 'libssruntime.xcframework')) {
    fail('native/libs/ios has no xcframework', 'the iOS slices are built on macOS only — pack there')
  }
  if (!has('native', 'libs', 'android')) {
    fail('native/libs/android is missing', 'the Android slices did not build')
  }
  if (!has('native', 'include', 'ssruntime.h')) {
    fail('native/include/ssruntime.h is missing', 'cpp/ includes it; without it the consumer cannot compile')
  }
}

// --- 2. a release build ------------------------------------------------------
//
// A debug Brain swamps every other cost and the version cannot tell them apart,
// so `download-sdk` writes the mode down. A local build leaves none.
const modeFile = join(pkgDir, 'native', 'BUILD_MODE')
if (!existsSync(modeFile)) {
  fail('native/BUILD_MODE is missing', 'the Brain in native/ was built locally, or predates this check — install the pinned release with `npm run download-sdk`')
} else {
  const mode = readFileSync(modeFile, 'utf8').trim()
  if (mode !== 'release') {
    fail(`the Brain is a ${mode} build`, 'run `npm run build-runtime -- build=release`; a debug build ships as a slow player with nothing to say why')
  }
}

// --- 3. the licences this package promises to carry --------------------------
//
// THIRD_PARTY_NOTICES.md tells an app developer to ship these three with their
// app. `build-runtime` only warns when the crate notices are absent, so without
// this the promise and the tarball disagree.
for (const f of ['LICENSE.md', 'THIRD-PARTY-LICENSES.ssruntime.md']) {
  if (!has('native', f)) {
    fail(`native/${f} is missing`, 'THIRD_PARTY_NOTICES.md names it as a file to redistribute — run the SDK\'s scripts/generate-licenses.sh')
  }
}

// The third is the FlatBuffers licence, and it is the one that got away: `files`
// listed `third_party/flatbuffers/include` and stopped there, so the headers
// were compiled into the consumer's binary while the Apache-2.0 text they are
// told to redistribute was not in the package they installed. It sits beside
// `include/`, not inside it, which is exactly why the check below is separate
// from the header check.
if (!has('third_party', 'flatbuffers', 'LICENSE')) {
  fail('third_party/flatbuffers/LICENSE is missing', 'Apache-2.0 requires the text to travel with the headers — check `files` still lists it, and that the submodule is initialised')
}

// --- 4. the vendored headers, which are a submodule --------------------------
//
// `third_party/flatbuffers` is empty in a checkout that did not init submodules,
// and `cpp/format/ssab.h` includes it, so the miss lands in the consumer's build.
if (!has('third_party', 'flatbuffers', 'include', 'flatbuffers', 'flatbuffers.h')) {
  fail('third_party/flatbuffers/include is empty', 'run `git submodule update --init` before packing')
}

// --- 5. what `files` actually pulls in ---------------------------------------
//
// `files` takes directories recursively, which is how `"android"` came to carry
// 2.8 GB of `.cxx` build output. Guarded two ways: the entry that did it is
// named, and the total is measured, so the next way in is caught as well.
if (pkg.files?.includes('android')) {
  fail('files lists "android" whole', 'it takes the directory recursively, .cxx build output included — list CMakeLists.txt, build.gradle and src instead')
}

const sizeOf = (p) => {
  let total = 0
  const walk = (entry) => {
    const s = statSync(entry)
    if (s.isDirectory()) for (const child of readdirSync(entry)) walk(join(entry, child))
    else total += s.size
  }
  if (existsSync(p)) walk(p)
  return total
}

let bytes = 0
const missing = []
for (const entry of pkg.files ?? []) {
  // Globs are npm's to expand; only the plain paths are measurable here.
  if (entry.includes('*')) continue
  const p = join(pkgDir, entry)
  // `native/` has its own checks above, which say something more useful than
  // "this path is missing" about a Brain that was never installed.
  if (!existsSync(p)) { if (!entry.startsWith('native/')) missing.push(entry) }
  else bytes += sizeOf(p)
}
const mb = bytes / 1024 / 1024

if (missing.length > 0) {
  fail(`files lists ${missing.length} path(s) that do not exist: ${missing.join(', ')}`,
       'npm ignores them silently, so an entry that was renamed reads as one that works')
}

// The Brain is ~57 MB of it and the sources are under 2 MB, so anything past
// this is something new and unintended rather than growth.
const kCeilingMb = 100
if (mb > kCeilingMb) {
  fail(`the pack would be ${mb.toFixed(0)} MB unpacked`, `over the ${kCeilingMb} MB ceiling — something is pulling in build output`)
}

if (problems.length > 0) {
  console.error(`\nprepack: ${problems.length} problem(s) — not packing\n`)
  for (const p of problems) console.error(`  ✗ ${p}\n`)
  process.exit(1)
}

const brain = readFileSync(join(pkgDir, 'native', 'VERSION'), 'utf8').trim()
console.log(`prepack: ok — ${mb.toFixed(1)} MB unpacked, Brain ${brain} (${readFileSync(modeFile, 'utf8').trim()})`)
