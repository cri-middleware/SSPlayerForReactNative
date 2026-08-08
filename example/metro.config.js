const path = require('path')
const { getDefaultConfig } = require('expo/metro-config')

const projectRoot = __dirname
const workspaceRoot = path.resolve(projectRoot, '..')

const config = getDefaultConfig(projectRoot)

// `.ssab` is not one of Metro's known asset extensions, so without this a
// `require('./x.ssab')` resolves to nothing and the file never reaches the
// bundle. Design doc ch.5 A / ch.9 E flag this as the thing consumers trip over
// first; the Expo config plugin will inject it for them in Phase 2.
config.resolver.assetExts.push('ssab', 'ssqb')

// Monorepo: the example consumes the package from source, so Metro has to watch
// the workspace root and resolve out of both node_modules trees.
config.watchFolders = [workspaceRoot]
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
]
config.resolver.disableHierarchicalLookup = true

module.exports = config
