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
 *
 * Position, rotation and scale only — never Skew: a part's Skew is a
 * non-inheriting local-vertex deform that stays out of the world matrix, so a
 * follower is not sheared even when it rides a sheared part (or one under a
 * sheared parent), matching SpriteStudio.
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
    // One-shot, and only in dev: the check reads the `.ssab` across JSI, so it
    // runs on the first frame the part resolves and never again — not per frame
    // on the loop this hook already documents as the costly one.
    let checked = false
    // A stopped player's part does not move, and writing the same pose again
    // would still have the UI thread re-run every style built on it.
    let published: SsPartScreenTransform = ABSENT
    const tick = (): void => {
      raf = requestAnimationFrame(tick)
      const local = player.getPartTransform(partName)
      const root = player.rootTransform
      if (local == null || root == null) {
        // Only write when it changes: a shared value assignment crosses to the
        // UI thread, and an unresolved part would otherwise do that 60 times a
        // second to say the same thing.
        if (published.valid) {
          published = ABSENT
          value.value = ABSENT
        }
        return
      }

      // The part has resolved (it has a matrix), so this is the frame to say —
      // once — that following it will not do what it looks like. A skinned mesh
      // is drawn from its bones while *this* transform stays at the part's setup
      // node, near the character root; the follower would sit there, not on the
      // art. Non-blocking: the value below is still published, exactly as the
      // sibling Players report the transform and only *mark* the target rather
      // than refusing it. Point a null / bone part at the art and follow that.
      if (__DEV__ && !checked) {
        checked = true
        if (player.isPartSkinnedMesh(partName)) {
          console.warn(
            `react-native-spritestudio: '${partName}' is a skinned (bone-bound) ` +
              `mesh part, so useSsPartTransform follows its node transform — which ` +
              `sits near the character root, not on the deformed art. The follower ` +
              `will not track the visible part. Add a NULL / bone part at that spot ` +
              `in SpriteStudio and follow that instead.`
          )
        }
      }

      // Exactly the mapping `SsInternalPlayer.draw` applies — translate, then
      // scale, both axes unnegated. Kept in step with it by construction rather
      // than by comment: get this wrong and the follower drifts off the part in
      // a way that looks like an animation bug.
      const sx = root.flipX ? -root.scale : root.scale
      const sy = root.flipY ? -root.scale : root.scale
      const x = root.x + sx * local.x
      const y = root.y + sy * local.y
      // Taken as it comes: the Brain mirrors the hierarchy itself (it negates
      // `rotation_z` along with `position_y`), so the angle decomposed out of
      // the world matrix already turns the way the screen does. Negating here
      // as well — which is what this did while the flip lived in the root
      // transform — would turn every follower the wrong way.
      const rotation = local.rotation
      const scaleX = local.scaleX * Math.abs(sx)
      const scaleY = local.scaleY * Math.abs(sy)
      if (
        published.valid &&
        published.x === x &&
        published.y === y &&
        published.rotation === rotation &&
        published.scaleX === scaleX &&
        published.scaleY === scaleY
      ) {
        return
      }
      published = { valid: true, x, y, rotation, scaleX, scaleY }
      value.value = published
    }

    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [player, partName, value])

  return value
}
