import { useEffect, useState } from 'react'
import { Image } from 'react-native'
import { Skia, type SkImage } from '@shopify/react-native-skia'

import { normalizeUri } from '../core/assets'
import { loadImageData } from '../core/SsTextureLoader'

/**
 * One texture to put in front of the pack's own.
 *
 * `require()` is allowed here and nowhere else. A pack cannot be named with one
 * — it is a directory, and Metro does not ship directories (see `SsSource`) —
 * but a *replacement* texture is a single standalone image with no siblings to
 * resolve, which is exactly what Metro is good at.
 */
export type SsTextureSource = number | string | { uri: string }

/**
 * Textures to use instead of the ones a pack names, keyed by cellmap name.
 *
 * A bare source is the shorthand for a pack with one cellmap, which is the
 * common case and the one where the caller would otherwise have to know a name
 * only the `.ssab` carries. The player resolves it to that cellmap once the pack
 * has loaded, so the name is genuinely not needed there.
 */
export type SsTextureSources = SsTextureSource | Record<string, SsTextureSource>

/** The key a bare source decodes under, for the player to resolve to the pack's one cellmap. */
export const SS_DEFAULT_CELLMAP = ''

/**
 * Decodes override textures into `SkImage`s.
 *
 * Its own hook rather than a loop over RN Skia's `useImage`, which cannot be
 * called once per entry of a map whose size changes between renders — and which
 * would not reach the app's asset directory either.
 *
 * Returns null until every texture has decoded, so a caller can hold off
 * drawing rather than flash a frame with a missing atlas.
 */
export function useSsTextures(
  sources: SsTextureSources | null | undefined
): Record<string, SkImage> | null {
  const [images, setImages] = useState<Record<string, SkImage> | null>(null)

  // The identity of an inline object literal changes every render, so key the
  // effect on the resolved URIs instead — that is what actually decides whether
  // a reload is needed.
  const key = sources == null ? '' : JSON.stringify(entriesOf(sources))

  useEffect(() => {
    if (sources == null) {
      setImages(null)
      return
    }
    let cancelled = false
    ;(async () => {
      const entries = entriesOf(sources)
      const decoded: Record<string, SkImage> = {}
      for (const [name, uri] of entries) {
        const image = Skia.Image.MakeImageFromEncoded(await loadImageData(uri))
        if (image == null) {
          throw new Error(`useSsTextures: could not decode '${uri}'`)
        }
        decoded[name] = image
      }
      if (!cancelled) setImages(decoded)
    })().catch((error: unknown) => {
      if (!cancelled) {
        console.error('[ssplayer] texture load failed', error)
        setImages(null)
      }
    })
    return () => {
      cancelled = true
    }
    // `sources` is deliberately absent: `key` is its stable projection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return images
}

/**
 * `[cellmapName, uri]` pairs, in a stable order so `key` is stable.
 *
 * `{ uri }` is read as a bare source rather than a one-cellmap map only when it
 * is the sole key — the two forms are otherwise indistinguishable, and a pack
 * whose single cellmap is actually named `uri` is the one case this gets wrong.
 */
function entriesOf(sources: SsTextureSources): Array<[string, string]> {
  if (typeof sources === 'number' || typeof sources === 'string') {
    return [[SS_DEFAULT_CELLMAP, uriOf(sources)]]
  }
  const keys = Object.keys(sources)
  if (keys.length === 1 && keys[0] === 'uri' && typeof sources.uri === 'string') {
    return [[SS_DEFAULT_CELLMAP, uriOf(sources as { uri: string })]]
  }
  const map = sources as Record<string, SsTextureSource>
  return keys.sort().map((name) => [name, uriOf(map[name]!)])
}

/**
 * A single image source as a URI.
 *
 * The `require()` branch resolves to Metro's dev-server URL while the packager
 * is running and to a bundled asset in a release build. That difference is
 * survivable here precisely because nothing is resolved *relative* to it.
 */
function uriOf(source: SsTextureSource): string {
  if (typeof source === 'number') {
    const resolved = Image.resolveAssetSource(source)
    if (resolved?.uri == null) {
      throw new Error('useSsTextures: require() did not resolve to an asset')
    }
    return resolved.uri
  }
  return normalizeUri(typeof source === 'string' ? source : source.uri)
}
