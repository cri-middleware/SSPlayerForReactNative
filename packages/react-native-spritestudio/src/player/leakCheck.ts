import { ssClearCaches } from '../core/caches'
import { SsRuntimeModule } from '../runtime'
import type { SsLiveHandles } from '../specs/SsRuntime.nitro'
import { SpriteStudioPlayer } from './SpriteStudioPlayer'
import type { SsSource } from './source'

/**
 * How many native handles are alive right now.
 *
 * Copied out of the Nitro struct rather than returned as-is, so a caller can
 * hold it as a baseline across the cycles it is about to run — the point of the
 * value is comparing two readings, and one that aliased native state would
 * compare equal to itself forever.
 */
export function ssLiveHandles(): SsLiveHandles {
  const { resources, contexts } = SsRuntimeModule.liveHandles
  return { resources, contexts }
}

export interface SsLeakCheckResult {
  cycles: number
  before: SsLiveHandles
  after: SsLiveHandles
  /** True if either count grew — see `ssCheckForLeaks` for why growth is exact. */
  leaked: boolean
  /** Registry entries one player held after its first load of `source`. */
  texturesAfterFirstLoad: number
  /** And after loading it `cycles` times over, which should be the same number. */
  texturesAfterReloads: number
  /** True if the registry grew across the reloads — see the reload pass below. */
  registryLeaked: boolean
}

/**
 * Loads and disposes `source` `cycles` times and reports whether the native
 * handle counts came back to where they started.
 *
 * This is the "no leaked native handles" criterion, made runnable.
 * It drives the same L3 path `<SpriteStudioView>` drives on mount and unmount —
 * `load()` then `dispose()` — so what it proves is the real teardown, not a
 * synthetic one.
 *
 * **The comparison is exact, and that is only true because `dispose()` releases
 * eagerly.** Both Hybrid Objects override Nitro's `dispose()` (which is a no-op
 * unless a class does), so the Brain handles are given back inside the call
 * rather than whenever the collector next runs. A count that has not come back
 * down by the time this returns is therefore a leak and not a pending GC —
 * before that override existed, this check could not have told the two apart.
 *
 * Growth rather than inequality, because an app is free to be doing other things
 * on other players while this runs; a count that *fell* is someone else's
 * teardown landing mid-check, which is not a failure.
 *
 * ## The caches have to be drained first
 *
 * `ssResourceCache` keeps a pack alive for as long as something holds a lease,
 * and `preload` holds one nothing balances. Both are correct and both are
 * indistinguishable from a leak when the measurement is a count of live
 * handles: the baseline would be taken before the first cycle warmed the cache
 * and the reading after it would be one resource higher, every time, on a
 * player that leaks nothing. So the caches are emptied **before the baseline**
 * and again at the end, which also leaves the app where it found it.
 */
export async function ssCheckForLeaks(
  source: SsSource,
  options?: { cycles?: number; animation?: string }
): Promise<SsLeakCheckResult> {
  const cycles = options?.cycles ?? 8
  ssClearCaches()
  const before = ssLiveHandles()

  for (let i = 0; i < cycles; i += 1) {
    const player = new SpriteStudioPlayer()
    try {
      await player.load(source, { animation: options?.animation })
    } finally {
      // In a `finally` so a pack that fails to load still tears down whatever it
      // got as far as building. A load that throws half-way is exactly the case
      // where a leak would otherwise go unnoticed.
      player.dispose()
    }
  }

  // The other way a reload leaks, and the one `liveHandles` cannot see: **one**
  // player loaded over and over. `load()` documents that it replaces what was
  // there, and the texture registry is where that used to stop being true — the
  // paints from every previous pack stayed, so the table handed to `drawInto`
  // grew by one binding per load and a cellmap name shared by two packs kept
  // drawing with the older one's atlas.
  //
  // The same source each time, so the count is its own expectation: whatever the
  // first load registered is what the eighth should have too.
  const reloader = new SpriteStudioPlayer()
  let texturesAfterFirstLoad = 0
  let texturesAfterReloads = 0
  try {
    for (let i = 0; i < cycles; i += 1) {
      await reloader.load(source, { animation: options?.animation })
      if (i === 0) texturesAfterFirstLoad = reloader.textures.size
    }
    texturesAfterReloads = reloader.textures.size
  } finally {
    reloader.dispose()
  }

  // The last cycle's dispose gave its leases back, so nothing should be held —
  // but a `preload` from elsewhere in the app would be, and it would read as a
  // leak. Cleared again rather than trusted.
  ssClearCaches()
  const after = ssLiveHandles()
  return {
    cycles,
    before,
    after,
    leaked:
      after.resources > before.resources || after.contexts > before.contexts,
    texturesAfterFirstLoad,
    texturesAfterReloads,
    registryLeaked: texturesAfterReloads > texturesAfterFirstLoad,
  }
}
