import { useEffect, useMemo } from 'react'

import type { SsBox } from '../../src/specs/SsRuntime.nitro'
import { SpriteStudioPlayer } from './fakePlayer'

/**
 * Stands in for `view/useSpriteStudioPlayer` while the two components that use
 * it are under test.
 *
 * What a component does with a player — enrol it in a scene, place it, clock it
 * — is separable from how the player came to exist, and mounting the real hook
 * here would drag a load and its promise timing into a test about draw order.
 */
export const fakePlayerHookState = {
  measured: null as SsBox | null,
  ready: true,
}

export function useSpriteStudioPlayer(_props: unknown): {
  player: SpriteStudioPlayer
  measured: SsBox | null
  ready: boolean
} {
  const player = useMemo(() => new SpriteStudioPlayer(), [])
  useEffect(() => () => player.dispose(), [player])
  return {
    player,
    measured: fakePlayerHookState.measured,
    ready: fakePlayerHookState.ready,
  }
}
