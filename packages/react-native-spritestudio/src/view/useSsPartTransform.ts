import { useEffect } from 'react'
import { useSharedValue, type SharedValue } from 'react-native-reanimated'

import type { SpriteStudioPlayer } from '../player/SpriteStudioPlayer'

/** A part's placement in **view pixels**, ready for an `Animated.View`. */
export interface SsPartScreenTransform {
  /** False until the part has been located — an unknown name never becomes true. */
  valid: boolean
  x: number
  y: number
  /** Radians, and already negated for Skia's Y-down screen. */
  rotation: number
  scaleX: number
  scaleY: number
}

const ABSENT: SsPartScreenTransform = {
  valid: false,
  x: 0,
  y: 0,
  rotation: 0,
  scaleX: 1,
  scaleY: 1,
}

/**
 * Follows a part with a Reanimated shared value — a health bar over a head, a
 * spark at a muzzle, a React view pinned to a hand.
 *
 * Sampled on the JS thread and published into a shared value, so the *consumer*
 * runs on the UI thread even though the sample does not. That is the honest
 * shape today: the frame loop, the Brain and the whole player are JS-thread, so
 * a hook that claimed to sample in a worklet would be sampling a value the JS
 * thread had already moved on from. Moving the tick itself to the UI thread is
 * a separate piece of work, and when it lands this hook's *consumers* do not
 * change — which is the point of publishing through a shared value now.
 *
 * The reported transform is in **view pixels**, root transform applied, because
 * that is the space an `Animated.View` on top of the canvas lives in.
 */
export function useSsPartTransform(
  player: SpriteStudioPlayer | null,
  partName: string
): SharedValue<SsPartScreenTransform> {
  const value = useSharedValue<SsPartScreenTransform>(ABSENT)

  useEffect(() => {
    if (player == null) {
      value.value = ABSENT
      return
    }

    let raf = 0
    const tick = (): void => {
      raf = requestAnimationFrame(tick)
      const local = player.getPartTransform(partName)
      const root = player.rootTransform
      if (local == null || root == null) {
        // Only write when it changes: a shared value assignment crosses to the
        // UI thread, and an unresolved part would otherwise do that 60 times a
        // second to say the same thing.
        if (value.value.valid) value.value = ABSENT
        return
      }

      // Exactly the mapping `SsInternalPlayer.draw` applies — translate, then
      // scale, both axes unnegated. Kept in step with it by construction rather
      // than by comment: get this wrong and the follower drifts off the part in
      // a way that looks like an animation bug.
      const sx = root.flipX ? -root.scale : root.scale
      const sy = root.flipY ? -root.scale : root.scale
      value.value = {
        valid: true,
        x: root.x + sx * local.x,
        y: root.y + sy * local.y,
        // Taken as it comes: the Brain mirrors the hierarchy itself (it negates
        // `rotation_z` along with `position_y`), so the angle decomposed out of
        // the world matrix already turns the way the screen does. Negating here
        // as well — which is what this did while the flip lived in the root
        // transform — would turn every follower the wrong way.
        rotation: local.rotation,
        scaleX: local.scaleX * Math.abs(sx),
        scaleY: local.scaleY * Math.abs(sy),
      }
    }

    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [player, partName, value])

  return value
}
