import { Asset } from 'expo-asset'

/**
 * Turns a `require()`d asset into a filesystem path Layer 1 can open.
 *
 * This is the ch.9 E problem in miniature: `require('./x.ssab')` resolves to a
 * Metro dev-server **URL** in development and to a bundled path in release, and
 * L1 only accepts a real path. `expo-asset` normalises both — `downloadAsync()`
 * caches the dev URL to disk and is a no-op in release — so this is the shape
 * the eventual L3 asset resolution should take.
 */
export async function resolveAssetPath(moduleRef: number): Promise<string> {
  const asset = Asset.fromModule(moduleRef)
  await asset.downloadAsync()

  const uri = asset.localUri ?? asset.uri
  if (!uri) {
    throw new Error('resolveAssetPath: asset has neither localUri nor uri')
  }
  // The Brain opens the file with fopen(), which does not speak file:// URLs.
  return uri.startsWith('file://') ? decodeURIComponent(uri.slice(7)) : uri
}
