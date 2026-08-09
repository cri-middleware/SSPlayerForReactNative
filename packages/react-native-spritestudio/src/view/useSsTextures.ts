import { useEffect, useState } from 'react'
import { Skia, type SkImage } from '@shopify/react-native-skia'

import { resolveSourceUri, type SsSource } from '../player/source'

/**
 * A pack's textures, keyed by cellmap name.
 *
 * A bare source is the shorthand for a pack with one cellmap, which is the
 * common case and the one where the caller would otherwise have to know a name
 * only the `.ssab` carries — `drawInto` matches a single-entry texture table
 * unconditionally, so the name is genuinely not needed there.
 */
export type SsTextureSources = SsSource | Record<string, SsSource>

/** The default key a bare source is registered under. */
export const SS_DEFAULT_CELLMAP = ''

/**
 * Decodes cellmap textures into `SkImage`s.
 *
 * Its own hook rather than a loop over RN Skia's `useImage`, which cannot be
 * called once per entry of a map whose size changes between renders.
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
        const data = await Skia.Data.fromURI(uri)
        const image = Skia.Image.MakeImageFromEncoded(data)
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
    return [[SS_DEFAULT_CELLMAP, resolveSourceUri(sources)]]
  }
  const keys = Object.keys(sources)
  if (keys.length === 1 && keys[0] === 'uri' && typeof sources.uri === 'string') {
    return [[SS_DEFAULT_CELLMAP, sources.uri]]
  }
  const map = sources as Record<string, SsSource>
  return keys.sort().map((name) => [name, resolveSourceUri(map[name]!)])
}
