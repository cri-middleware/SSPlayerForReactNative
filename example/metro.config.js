const path = require('path')
const { getDefaultConfig } = require('expo/metro-config')

const projectRoot = __dirname
const workspaceRoot = path.resolve(projectRoot, '..')

const config = getDefaultConfig(projectRoot)

// Nothing here teaches Metro about `.ssab`, and that is deliberate. A pack is a
// directory — the `.ssab` names its textures, its Instance parts' external
// packs and its `.ssqb` targets as siblings — and Metro ships a dependency
// graph, not directories. The pack tree goes into the app as a native asset
// directory instead, through this package's Expo config plugin (see app.json),
// and is addressed by path: `source="ss/overall/Basic.ssab"`.

// Monorepo: the example consumes the package from source, so Metro has to watch
// the workspace root and resolve out of both node_modules trees. Hierarchical
// lookup stays on: pnpm keeps each package's dependencies beside it in the store,
// reachable only by walking up from where the package really is.
config.watchFolders = [workspaceRoot]
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
]

module.exports = config
