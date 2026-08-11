import type { SkImage } from '@shopify/react-native-skia'

import type { SsResource } from '../specs/SsRuntime.nitro'
import { SsRefCache } from './SsRefCache'

/**
 * Loaded `.ssab` resources, keyed by resolved URI.
 *
 * The expensive halves are reading the bytes and having the Brain parse them,
 * and both are per-pack rather than per-player — so twenty sprites of one
 * character cost one of each. Keyed on the **resolved** URI so `'ss/a.ssab'`
 * and `{ uri: 'ss/a.ssab' }` are the same entry.
 *
 * Disposed on the last release, which is what keeps `SsRuntime.liveHandles`
 * exact — see `SsRefCache`.
 */
export const ssResourceCache = new SsRefCache<SsResource>({
  destroy: (resource) => resource.dispose(),
})

/**
 * Decoded atlases, keyed by resolved image URI.
 *
 * Not disposed on eviction, and deliberately so: `SsTextureRegistry` already
 * states that it does not own the `SkImage`s handed to it, because one can be
 * inside a recorded-but-not-yet-rasterised `SkPicture` when its last registry
 * goes. Dropping the reference and leaving it to the collector is the existing
 * contract; this cache only stops the *decode* happening twice.
 */
export const ssImageCache = new SsRefCache<SkImage>()

/**
 * Empties both caches.
 *
 * The leak check calls this before it measures: a cache holding a pack is
 * indistinguishable from a leaked handle when the measurement is a count of
 * live ones.
 */
export function ssClearCaches(): void {
  ssResourceCache.clear()
  ssImageCache.clear()
}
