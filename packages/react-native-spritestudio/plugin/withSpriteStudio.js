// Expo config plugin: ships SpriteStudio pack *directories* into the app.
//
// Plain CommonJS with no build step, because Expo requires this file directly
// during `prebuild`. `@expo/config-plugins` is not a dependency of the package:
// it comes with `expo`, and an app that is not an Expo app never loads this.
//
// ## Why a plugin at all
//
// A converted pack is a directory — `.ssab` files, the `.ssqb` that sequences
// them, and the textures they name — and every reference inside it is a sibling
// *name*. Metro cannot host that. It ships a dependency graph, so it bundles
// only what a `require()` names and never walks a directory; and on an Android
// release build the packager then flattens and lowercases what it did name into
// `res/`, losing the extension too. So the directory is copied in out-of-band,
// as a native app asset, and `SsAssets` on the C++ side reads it back.
//
// ## What it does
//
//  * **iOS** — a run-script phase rsyncs each directory into the `.app`'s
//    resources, where it stays an ordinary directory of ordinary files.
//  * **Android** — a Gradle `Sync` task stages each directory under
//    `build/generated/spritestudio/assets/<name>` and adds that as an asset
//    source set, so it lands in the APK's `assets/<name>/…`.
//
// Both re-run on every build rather than once at prebuild, so re-converting a
// project and hitting Run picks the new assets up.

const fs = require('fs')
const path = require('path')

const {
  withAppBuildGradle,
  withDangerousMod,
  withGradleProperties,
  withXcodeProject,
} = require('@expo/config-plugins')

/** Where the packs live when the app does not say otherwise. */
const DEFAULT_ASSETS = ['./assets/ss']

const IOS_PHASE_NAME = 'SpriteStudio assets'
const KEY_ARCHITECTURES = 'reactNativeArchitectures'
const GRADLE_FILE = 'spritestudio-assets.gradle'
const GRADLE_APPLY = `apply from: "./${GRADLE_FILE}"`

/**
 * @param {import('@expo/config-types').ExpoConfig} config
 * @param {{ assets?: string | string[] }} [options]
 */
function withSpriteStudio(config, options = {}) {
  const explicit = options.assets != null
  const requested = toArray(options.assets ?? DEFAULT_ASSETS)

  let withPlugin = config
  withPlugin = withXcodeProject(withPlugin, (cfg) => {
    const packs = resolvePacks(cfg.modRequest.projectRoot, requested, explicit)
    applyIos(cfg.modResults, packs)
    return cfg
  })
  withPlugin = withAppBuildGradle(withPlugin, (cfg) => {
    if (cfg.modResults.language !== 'groovy') {
      throw new Error(
        'react-native-spritestudio: app/build.gradle is not Groovy, so the ' +
          'asset sync cannot be applied. Add it by hand — see plugin/withSpriteStudio.js.'
      )
    }
    if (!cfg.modResults.contents.includes(GRADLE_APPLY)) {
      cfg.modResults.contents = `${cfg.modResults.contents.trimEnd()}\n\n${GRADLE_APPLY}\n`
    }
    return cfg
  })
  withPlugin = withDangerousMod(withPlugin, [
    'android',
    (cfg) => {
      const packs = resolvePacks(cfg.modRequest.projectRoot, requested, explicit)
      const target = path.join(cfg.modRequest.platformProjectRoot, 'app', GRADLE_FILE)
      fs.writeFileSync(target, androidGradle(packs))
      return cfg
    },
  ])
  withPlugin = withGradleProperties(withPlugin, (cfg) => {
    narrowArchitectures(cfg.modResults)
    return cfg
  })
  return withPlugin
}

/**
 * Drops from `reactNativeArchitectures` any ABI the installed Brain has no
 * `libssruntime.a` for.
 *
 * Expo's Android template ships `armeabi-v7a,arm64-v8a,x86,x86_64`, and the SDK
 * builds three of those — **32-bit `x86` is not one**, deliberately: it is an
 * emulator-only ABI with no meaningful device share, and `x86_64` already covers
 * the emulator. Left alone, Gradle configures a CMake variant for it and the
 * build dies at `configureCMakeDebug[x86]` naming a path that was never going to
 * exist. Editing `android/gradle.properties` by hand does not stick — `prebuild`
 * rewrites it from the template, which is measurable in about a minute — so the
 * narrowing has to happen here, where it survives.
 *
 * Read off `native/libs/android/` rather than hardcoded, so a Brain built with a
 * different set (a local `build-runtime` slice, or a future x86) is respected
 * instead of overruled. When that directory is absent the property is left
 * exactly as it is: nothing can be built yet either way, and the CMake check
 * says so with the install command, which is the more useful failure.
 *
 * Only ever removes. An app that asked for fewer keeps its own list, since this
 * is an intersection.
 *
 * @param {{ type: string, key?: string, value?: string }[]} properties
 */
function narrowArchitectures(properties) {
  const available = availableAbis()
  if (available == null) return

  const entry = properties.find((p) => p.type === 'property' && p.key === KEY_ARCHITECTURES)
  if (entry == null || !entry.value) return

  const asked = entry.value.split(',').map((abi) => abi.trim()).filter(Boolean)
  const kept = asked.filter((abi) => available.includes(abi))
  const dropped = asked.filter((abi) => !available.includes(abi))
  if (dropped.length === 0) return
  if (kept.length === 0) {
    // Every ABI the app wants is missing. Narrowing to nothing would produce an
    // APK with no native code at all, which fails at run time instead of build
    // time; leave it and let the CMake check name the missing library.
    console.warn(
      `react-native-spritestudio: none of ${asked.join(', ')} has a libssruntime.a ` +
        `(${available.join(', ')} are installed) — leaving reactNativeArchitectures alone.`
    )
    return
  }

  entry.value = kept.join(',')
  console.log(
    `react-native-spritestudio: dropped ${dropped.join(', ')} from ` +
      `reactNativeArchitectures — the SDK ships no libssruntime.a for ` +
      `${dropped.length === 1 ? 'it' : 'them'}.`
  )
}

/** The ABIs `native/libs/android/` holds, or null when it is not installed. */
function availableAbis() {
  const dir = path.join(__dirname, '..', 'native', 'libs', 'android')
  if (!fs.existsSync(dir)) return null
  const abis = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(dir, e.name, 'libssruntime.a')))
    .map((e) => e.name)
  return abis.length > 0 ? abis : null
}

/**
 * The pack directories to ship, as `{ from, name }`.
 *
 * `from` stays relative to the project root: it ends up inside a build script
 * that is checked in, and an absolute path there would only work on the machine
 * that ran `prebuild`.
 *
 * A directory the app explicitly listed and does not have is an error. The
 * default one is only a convention, so a missing one is a warning and the app
 * builds without it.
 */
function resolvePacks(projectRoot, requested, explicit) {
  const packs = []
  const seen = new Map()

  for (const entry of requested) {
    const relative = normalizeSlashes(path.relative(projectRoot, path.resolve(projectRoot, entry)))
    const name = path.basename(relative)

    if (!fs.existsSync(path.resolve(projectRoot, relative))) {
      const message = `react-native-spritestudio: no directory at '${entry}'`
      if (explicit) throw new Error(message)
      console.warn(`${message} — skipping (set \`assets\` in the plugin options)`)
      continue
    }
    if (seen.has(name)) {
      throw new Error(
        `react-native-spritestudio: '${entry}' and '${seen.get(name)}' would both ` +
          `ship as '${name}'. Give one of them a different directory name.`
      )
    }
    seen.set(name, entry)
    packs.push({ from: relative, name })
  }
  return packs
}

// --- iOS ---------------------------------------------------------------------

/**
 * Replaces the run-script phase, rather than adding one.
 *
 * `expo prebuild` without `--clean` reuses the existing project, so an
 * add-if-absent check on the name is what keeps a rerun from stacking up copies
 * of the same phase.
 *
 * The script reads from outside the Xcode project directory, so an app that
 * turns `ENABLE_USER_SCRIPT_SANDBOXING` on has to grant it — Expo's template
 * leaves it off.
 */
function applyIos(project, packs) {
  removeShellScriptPhase(project, IOS_PHASE_NAME)
  if (packs.length === 0) return

  const lines = [
    'set -e',
    '',
    '# Generated by react-native-spritestudio. Keeps the app bundle in step with',
    '# the converted pack directories on every build, so re-running',
    '# ssconverter-cli does not need a prebuild.',
    'ss_sync() {',
    '  src="$PROJECT_DIR/../$1"',
    '  dest="$TARGET_BUILD_DIR/$UNLOCALIZED_RESOURCES_FOLDER_PATH/$2"',
    '  if [ ! -d "$src" ]; then',
    '    echo "error: SpriteStudio assets missing at $src"',
    '    exit 1',
    '  fi',
    '  mkdir -p "$dest"',
    '  rsync -a --delete "$src/" "$dest/"',
    '}',
    '',
    ...packs.map((pack) => `ss_sync ${shellQuote(pack.from)} ${shellQuote(pack.name)}`),
  ]

  const target = project.getFirstTarget()
  const phase = project.addBuildPhase(
    [],
    'PBXShellScriptBuildPhase',
    IOS_PHASE_NAME,
    target ? target.uuid : undefined,
    {
      shellPath: '/bin/sh',
      shellScript: lines.join('\n'),
    }
  )
  // Says out loud what is already true — the phase declares no outputs, so it
  // runs every build. Without this Xcode emits a warning about exactly that.
  if (phase && phase.buildPhase) phase.buildPhase.alwaysOutOfDate = 1
}

function removeShellScriptPhase(project, name) {
  const objects = project.hash.project.objects
  const phases = objects.PBXShellScriptBuildPhase || {}

  for (const uuid of Object.keys(phases)) {
    if (uuid.endsWith('_comment')) continue
    const phase = phases[uuid]
    if (!phase || typeof phase !== 'object') continue
    if (unquote(phase.name) !== name) continue

    delete phases[uuid]
    delete phases[`${uuid}_comment`]

    const targets = objects.PBXNativeTarget || {}
    for (const targetUuid of Object.keys(targets)) {
      const target = targets[targetUuid]
      if (!target || !Array.isArray(target.buildPhases)) continue
      target.buildPhases = target.buildPhases.filter((entry) => entry.value !== uuid)
    }
  }
}

// --- Android -----------------------------------------------------------------

function androidGradle(packs) {
  const froms = packs
    .map(
      (pack) =>
        `  from(ssplayerSource(${groovyQuote(pack.from)})) { into ${groovyQuote(pack.name)} }`
    )
    .join('\n')

  return `// Generated by react-native-spritestudio's Expo config plugin.
// Regenerated by \`expo prebuild\` — edits are lost.
//
// Stages the converted pack directories and adds them as an asset source set,
// so each lands in the APK as assets/<name>/... with its layout intact. That
// layout is the point: a pack names its textures, its Instance parts' external
// .ssab files and its .ssqb targets as siblings, so C++ (SsAssets) reads them
// back through AAssetManager relative to the same root.

def ssplayerStaging = new File(project.layout.buildDirectory.get().asFile,
                               "generated/spritestudio/assets")

def ssplayerSource = { String relative ->
  // Relative to the app project root's parent — the directory holding app.json.
  def dir = file("\${rootDir}/../\${relative}")
  if (!dir.isDirectory()) {
    throw new GradleException(
      "react-native-spritestudio: no SpriteStudio assets at \${dir}. " +
      "Convert them (ssconverter-cli) or fix the plugin's \`assets\` option.")
  }
  return dir
}

def ssplayerSyncAssets = tasks.register("spritestudioSyncAssets", Sync) {
  into ssplayerStaging
${froms}
}

android.sourceSets.main.assets.srcDirs += ssplayerStaging

// Every build, not just prebuild: re-converting a project and hitting Run has
// to pick the new assets up.
tasks.named("preBuild").configure { dependsOn(ssplayerSyncAssets) }
`
}

// --- helpers -----------------------------------------------------------------

function toArray(value) {
  return Array.isArray(value) ? value : [value]
}

function normalizeSlashes(value) {
  return value.split(path.sep).join('/')
}

function unquote(value) {
  return typeof value === 'string' ? value.replace(/^"|"$/g, '') : value
}

function shellQuote(value) {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

function groovyQuote(value) {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\$/g, '\\$')}"`
}

module.exports = withSpriteStudio
module.exports.default = withSpriteStudio
