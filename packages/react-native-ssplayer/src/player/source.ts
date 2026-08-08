import { Image } from 'react-native'

import { SsRuntimeModule } from '../runtime'
import type { SsResource } from '../specs/SsRuntime.nitro'

/**
 * Anything Layer 3 will load a `.ssab` (or a texture) from.
 *
 * `number` is a `require()`d module — Metro's asset id. It only resolves once
 * `assetExts` includes `ssab`, which the Phase 2 Expo config plugin will do for
 * you and which a bare app has to add to `metro.config.js` itself.
 */
export type SsSource = number | string | { uri: string }

/**
 * The URI behind a source, before any decision about how to open it.
 *
 * This is where the dev/release split actually lives (design doc ch.9 E): the
 * same `require()` resolves to Metro's dev-server **URL** while the packager is
 * running and to a bundled file in a release build.
 */
export function resolveSourceUri(source: SsSource): string {
  if (typeof source === 'number') {
    const resolved = Image.resolveAssetSource(source)
    if (resolved?.uri == null) {
      throw new Error(
        'SsSource: require() did not resolve to an asset. Is `ssab` in the ' +
          "Metro config's resolver.assetExts?"
      )
    }
    return resolved.uri
  }
  return typeof source === 'string' ? source : source.uri
}

/**
 * The filesystem path behind `uri`, or null when it is not a local file.
 *
 * The Brain opens files with `fopen`, which does not speak `file://`.
 */
export function fileSystemPathOf(uri: string): string | null {
  if (uri.startsWith('file://')) return decodeURIComponent(uri.slice(7))
  // An absolute path with no scheme at all — what iOS release builds hand back.
  if (uri.startsWith('/')) return uri
  return null
}

/**
 * Loads a `.ssab` into a Layer 1 resource.
 *
 * Prefers the path route, which keeps the bytes out of the JS heap entirely
 * (design doc ch.5 A) — C++ opens the file. Falls back to fetching the bytes for
 * sources no `fopen` can reach, which in practice means Metro's dev-server URL.
 *
 * The resource is the caller's to `dispose()`.
 *
 * **Known gap:** an Android *release* build resolves bundled assets to a path
 * inside the APK, which is neither `fopen`-able nor `fetch`-able — it needs
 * `AAssetManager`. Android has no drawing path yet either (see the ROADMAP's
 * `SSPLAYER_ENABLE_SKIA_DIRECT` entry), so this is not the binding constraint
 * there yet.
 */
export async function loadResource(source: SsSource): Promise<SsResource> {
  const uri = resolveSourceUri(source)

  const path = fileSystemPathOf(uri)
  if (path != null) return SsRuntimeModule.createResourceFromPath(path)

  const response = await fetch(uri)
  if (!response.ok) {
    throw new Error(`SsSource: ${response.status} fetching '${uri}'`)
  }
  return SsRuntimeModule.createResourceFromBytes(await response.arrayBuffer())
}
