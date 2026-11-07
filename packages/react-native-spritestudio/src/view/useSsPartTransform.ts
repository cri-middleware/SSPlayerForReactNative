import { useEffect, useRef } from 'react'
import { useSharedValue, type SharedValue } from 'react-native-reanimated'

import { onFrameShown } from '../player/frames'
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
 * Sampled on the JS thread, once per frame the player shows (`player/frames`),
 * and published into a shared value, so the *consumer* runs on the UI thread
 * even though the sample does not. A player that stands still shows no new
 * frame, and is not read. The frame loop, the Brain and the whole player are
 * JS-thread, so a hook that claimed to sample in a worklet would be sampling a
 * value the JS thread had already moved on from.
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

  // A scene redraws every member when one of them moves, so a still part is
  // read again, and writing the same pose would still have the UI thread re-run
  // every style built on it. Outlives the effect: what is on the shared value
  // does not change when the player or the part does.
  const published = useRef<SsPartScreenTransform>(ABSENT)

  useEffect(() => {
    if (player == null) {
      published.current = ABSENT
      value.value = ABSENT
      return
    }

    // One-shot, and only in dev: the check reads the `.ssab` across JSI, so it
    // runs on the first frame the part resolves and never again.
    let checked = false
    const sample = (): void => {
      const local = player.getPartTransform(partName)
      const root = player.rootTransform
      if (local == null || root == null) {
        // Only write when it changes: a shared value assignment crosses to the
        // UI thread, and an unresolved part would otherwise do that on every
        // frame to say the same thing.
        if (published.current.valid) {
          published.current = ABSENT
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
      // The draw mirrors the art with the root's signed scale, so the angle the
      // screen shows is -r under one flip and r + pi under both. The scale is
      // reported as a size and stays positive, so a follower is never turned
      // over; reading the flip into the angle as pi - r would do exactly that.
      const mirrored = sx < 0 !== sy < 0
      const rotation = mirrored
        ? -local.rotation
        : sx < 0
          ? local.rotation + Math.PI
          : local.rotation
      const scaleX = local.scaleX * Math.abs(sx)
      const scaleY = local.scaleY * Math.abs(sy)
      const last = published.current
      if (
        last.valid &&
        last.x === x &&
        last.y === y &&
        last.rotation === rotation &&
        last.scaleX === scaleX &&
        last.scaleY === scaleY
      ) {
        return
      }
      published.current = { valid: true, x, y, rotation, scaleX, scaleY }
      value.value = published.current
    }

    // The frame already shown: a follower mounted on a still player would
    // otherwise wait for one that never comes.
    sample()
    return onFrameShown(player, sample)
  }, [player, partName, value])

  return value
}
