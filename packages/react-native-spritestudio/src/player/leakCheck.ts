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
}

/**
 * Loads and disposes `source` `cycles` times and reports whether the native
 * handle counts came back to where they started.
 *
 * This is Phase 1's "no leaked native handles" exit criterion, made runnable.
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
 */
export async function ssCheckForLeaks(
  source: SsSource,
  options?: { cycles?: number; animation?: string }
): Promise<SsLeakCheckResult> {
  const cycles = options?.cycles ?? 8
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

  const after = ssLiveHandles()
  return {
    cycles,
    before,
    after,
    leaked:
      after.resources > before.resources || after.contexts > before.contexts,
  }
}
