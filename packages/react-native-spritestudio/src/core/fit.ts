import type { SsBox } from '../specs/SsRuntime.nitro'
import type { SsRootTransform } from './types'

/**
 * How the content box is scaled to the view — `<Image resizeMode>`'s vocabulary,
 * because it is the one an RN caller already has.
 *
 * `none` places no fit: scale 1, origin at the view's centre, and the caller
 * supplies `offset`/`scale` themselves.
 */
export type SsFit = 'contain' | 'cover' | 'none'

/** Which point of the content box lands on the matching point of the view. */
export type SsAlign =
  | 'center'
  | 'top'
  | 'bottom'
  | 'left'
  | 'right'
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right'

/**
 * Which animations the content box is measured over, for a caller that asks
 * for a measured box instead of the authored canvas.
 *
 * `animation` is the box of the one animation playing. `pack` unions every
 * animation in the file, which costs a walk per animation and draws smaller:
 * one wide-travelling animation scales down all the others.
 */
export type SsFrameScope = 'animation' | 'pack'

/** Everything `<SpriteStudioView>` and `<SpriteStudioSprite>` share about placement. */
export interface SsPlacement {
  fit?: SsFit
  align?: SsAlign
  /**
   * The box to fit, in player-local units. Omitted, the animation's authored
   * canvas, or the measured box when `frameScope` asks for one.
   */
  frame?: SsBox
  /** Measure the box instead of using the authored canvas. Omitted, nothing is measured. */
  frameScope?: SsFrameScope
  /** Pixels from the aligned position. Applied *after* the fit. */
  offset?: { x: number; y: number }
  /** Multiplier **on top of** the fit's scale, not a replacement for it. */
  scale?: number
  flipX?: boolean
  flipY?: boolean
}

/** The horizontal half of an `SsAlign`. */
function alignX(align: SsAlign): -1 | 0 | 1 {
  if (align === 'left' || align === 'top-left' || align === 'bottom-left') return -1
  if (align === 'right' || align === 'top-right' || align === 'bottom-right') return 1
  return 0
}

/** The vertical half, in **screen** terms: -1 is the top of the view. */
function alignY(align: SsAlign): -1 | 0 | 1 {
  if (align === 'top' || align === 'top-left' || align === 'top-right') return -1
  if (align === 'bottom' || align === 'bottom-left' || align === 'bottom-right') return 1
  return 0
}

/**
 * Solves one axis: where the origin must sit for the box's mapped extent to land
 * against `side` of a `viewSize`-long view.
 *
 * `s` is the *signed* scale for the axis, which is what makes this work under a
 * flip: the draw maps `p -> origin + s * p`, so a negative `s` swaps which end
 * of the box is the low one and the anchor has to follow. `center` comes out
 * sign-independent, which is why it is the safe default.
 */
function solveAxis(
  viewSize: number,
  s: number,
  boxLo: number,
  boxSize: number,
  side: -1 | 0 | 1
): number {
  if (side === 0) return viewSize / 2 - s * (boxLo + boxSize / 2)
  // The player-local edge that maps to the low screen edge.
  const lowEdge = s > 0 ? boxLo : boxLo + boxSize
  const highEdge = s > 0 ? boxLo + boxSize : boxLo
  return side < 0 ? -s * lowEdge : viewSize - s * highEdge
}

/**
 * The root transform that puts `box` into a `width` x `height` view.
 *
 * React-free and Skia-free so both Layer 4 components share exactly one copy of
 * this arithmetic, and so it can be checked without a renderer.
 *
 * A zero-sized or absent box means "nothing to fit": the fit is skipped and
 * the result is the pre-fit behaviour — scale 1, origin at the view's centre —
 * rather than a division by zero.
 */
export function resolveRootTransform(
  box: SsBox | null | undefined,
  width: number,
  height: number,
  placement: SsPlacement
): SsRootTransform {
  const {
    fit = 'contain',
    align = 'center',
    offset,
    scale = 1,
    flipX = false,
    flipY = false,
  } = placement

  const fits =
    fit !== 'none' &&
    box != null &&
    box.width > 0 &&
    box.height > 0 &&
    width > 0 &&
    height > 0

  let s = scale
  if (fits) {
    const sx = width / box.width
    const sy = height / box.height
    s *= fit === 'cover' ? Math.max(sx, sy) : Math.min(sx, sy)
  }

  // The signs the draw applies: both axes are plain mirrors, because the
  // Brain already hands us Y-down geometry (see `HybridSsContext`) and `box`
  // was measured in that same space. Kept identical to `SsInternalPlayer.draw`,
  // which is the only place it is actually applied.
  const signedX = flipX ? -s : s
  const signedY = flipY ? -s : s

  let x = width / 2
  let y = height / 2
  if (fits) {
    x = solveAxis(width, signedX, box.x, box.width, alignX(align))
    y = solveAxis(height, signedY, box.y, box.height, alignY(align))
  }

  return {
    x: x + (offset?.x ?? 0),
    y: y + (offset?.y ?? 0),
    scale: s,
    flipX,
    flipY,
  }
}
