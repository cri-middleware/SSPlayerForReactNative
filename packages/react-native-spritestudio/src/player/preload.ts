import { ssImageCache } from '../core/caches'
import { SpriteStudioPlayer } from './SpriteStudioPlayer'
import {
  preloadResource,
  resolveSourceUri,
  unloadResource,
  type SsSource,
} from './source'

/**
 * Which atlas keys each preloaded pack is holding, so `ssUnload` can give back
 * exactly those and not another pack's.
 */
const preloaded = new Map<string, string[]>()

/**
 * Loads a pack and its atlases ahead of the mount that needs them.
 *
 * Both halves matter and the second is the slower one: parsing the `.ssab`
 * happens in C++ against bytes that never enter the JS heap, while every
 * texture is a PNG decode. A `<SpriteStudioView>` that mounts against a warm
 * cache draws on its first frame instead of showing `placeholder` while the
 * atlas arrives.
 *
 * The way the textures get warmed is by loading a whole player and throwing it
 * away — there is no shorter route, because the texture list is read out of the
 * `.ssab` by a **context**, which is a player. What survives the throwaway is
 * exactly the cache entries, retained so its `dispose` does not evict them.
 *
 * Balanced by `ssUnload`, or by `ssClearCaches` for the lot. Calling it twice
 * for one source is safe and does the work once.
 */
export async function ssPreload(
  source: SsSource,
  options?: { animation?: string }
): Promise<void> {
  const uri = resolveSourceUri(source)
  if (preloaded.has(uri)) return
  // Claimed before the first await, so two screens preloading the same pack at
  // once do not both run the throwaway player.
  preloaded.set(uri, [])

  try {
    await preloadResource(source)
    const player = new SpriteStudioPlayer()
    try {
      await player.load(source, { animation: options?.animation })
      const keys = player.textureCacheKeys
      for (const key of keys) ssImageCache.retain(key)
      preloaded.set(uri, keys)
    } finally {
      // The player has done its job. Its leases go back; the retained ones stay.
      player.dispose()
    }
  } catch (error) {
    preloaded.delete(uri)
    unloadResource(source)
    throw error
  }
}

/**
 * Gives back what `ssPreload` retained.
 *
 * A pack still mounted somewhere stays loaded — this drops the preload's own
 * lease, not everybody's.
 */
export function ssUnload(source: SsSource): void {
  const uri = resolveSourceUri(source)
  const keys = preloaded.get(uri)
  if (keys == null) return
  preloaded.delete(uri)
  for (const key of keys) ssImageCache.releaseRetained(key)
  unloadResource(source)
}

/** Sources currently held by `ssPreload`. */
export function ssPreloadedSources(): string[] {
  return [...preloaded.keys()]
}
