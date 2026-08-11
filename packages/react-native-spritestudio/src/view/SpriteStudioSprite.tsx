import { forwardRef, useEffect, useImperativeHandle, type ReactNode } from 'react'

import { resolveRootTransform, type SsAlign } from '../core/fit'
import type { SpriteStudioPlayer } from '../player/SpriteStudioPlayer'
import { useSsScene } from './SpriteStudioScene'
import {
  useSpriteStudioPlayer,
  type SsPlayerProps,
} from './useSpriteStudioPlayer'

export interface SpriteStudioSpriteProps extends SsPlayerProps {
  /**
   * Where the art goes, in **scene pixels from the scene's top-left**.
   *
   * Which point of the art lands there depends on the rest: with a `width` and
   * `height` it is the box those describe, positioned by `align`; without them
   * there is no box to fit, so it is the animation's own origin — wherever the
   * author put it.
   */
  x?: number
  y?: number
  /**
   * The box to fit the art into, in scene pixels. Omit both for no fit at all,
   * which is what `scale` alone wants.
   */
  width?: number
  height?: number
  align?: SsAlign
  flipX?: boolean
  flipY?: boolean
  /** Multiplier on top of the fit's scale, or the whole scale with no fit. */
  scale?: number
  /** Draw order within the scene; ties break on mount order. */
  z?: number
}

export interface SpriteStudioSpriteRef {
  readonly player: SpriteStudioPlayer | null
}

/**
 * One animation inside a `<SpriteStudioScene>` — a position and a draw order,
 * not a view.
 *
 * Renders **nothing of its own**: the scene owns the single canvas everything
 * draws into, and this component's whole job is to hold a player, keep its root
 * transform current and stay enrolled. That is what makes twenty of them cost
 * one canvas and one clock instead of twenty of each.
 *
 * Outside a scene it warns and draws nothing, rather than silently rendering an
 * empty box — the mistake is easy to make and impossible to see otherwise.
 */
export const SpriteStudioSprite = forwardRef<
  SpriteStudioSpriteRef,
  SpriteStudioSpriteProps
>(function SpriteStudioSprite(props, ref) {
  const {
    x = 0,
    y = 0,
    width = 0,
    height = 0,
    align = 'center',
    flipX = false,
    flipY = false,
    scale = 1,
    z = 0,
  } = props
  const fit = props.fit ?? 'contain'

  const scene = useSsScene()
  const { player, measured } = useSpriteStudioPlayer(props)

  useEffect(() => {
    if (scene == null) {
      console.warn(
        'react-native-spritestudio: <SpriteStudioSprite> must be inside a ' +
          '<SpriteStudioScene>. It draws through the scene’s canvas, so ' +
          'outside one there is nothing for it to draw into.'
      )
    }
  }, [scene])

  useImperativeHandle(ref, () => ({ player }), [player])

  // --- enrolment ----------------------------------------------------------
  useEffect(() => {
    if (scene == null || player == null) return
    return scene.join({ player, z })
  }, [scene, player, z])

  // --- placement ----------------------------------------------------------
  //
  // The same solver the view uses, with two substitutions: the box is `width` x
  // `height` rather than the whole canvas, and `offset` carries `x`/`y`, which
  // translates that box's placement into scene coordinates. With no width and
  // height the solver falls through to its unfitted case — origin at (0,0) plus
  // the offset — so `x`/`y` then place the animation's origin directly, which
  // is exactly what "no box to fit" should mean.
  const box = props.frame ?? measured
  useEffect(() => {
    if (player == null) return
    player.setRootTransform(
      resolveRootTransform(box, width, height, {
        fit,
        align,
        offset: { x, y },
        scale,
        flipX,
        flipY,
      })
    )
  }, [player, box, width, height, fit, align, x, y, scale, flipX, flipY])

  return null as ReactNode
})
