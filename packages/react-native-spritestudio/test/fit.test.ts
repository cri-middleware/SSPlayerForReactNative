import { describe, expect, it } from 'vitest'

import { resolveRootTransform, type SsAlign, type SsPlacement } from '../src/core/fit'
import type { SsBox } from '../src/specs/SsRuntime.nitro'
import type { SsRootTransform } from '../src/core/types'

/** A 100x100 box at the origin, in player-local units (Y down). */
const BOX: SsBox = { x: 0, y: 0, width: 100, height: 100 }
/** Same size, but offset — so a fit that ignores `box.x/y` is visible. */
const OFFSET_BOX: SsBox = { x: -40, y: 10, width: 100, height: 100 }

/**
 * Where the box lands on screen under `t`.
 *
 * The draw maps `p -> origin + s * p`, so this is what the transform is *for*;
 * asserting on it rather than on the raw `x`/`y` is what makes a flip case
 * readable — under a mirror the origin moves to the other end of the extent
 * while the extent itself is the answer that has to hold.
 */
function extent(t: SsRootTransform, box: SsBox) {
  const sx = t.flipX ? -t.scale : t.scale
  const sy = t.flipY ? -t.scale : t.scale
  const xs = [t.x + sx * box.x, t.x + sx * (box.x + box.width)]
  const ys = [t.y + sy * box.y, t.y + sy * (box.y + box.height)]
  return {
    left: Math.min(...xs),
    right: Math.max(...xs),
    top: Math.min(...ys),
    bottom: Math.max(...ys),
  }
}

const place = (box: SsBox | null | undefined, w: number, h: number, p: SsPlacement = {}) =>
  resolveRootTransform(box, w, h, p)

describe('resolveRootTransform — the fit', () => {
  it('contains by the tighter axis', () => {
    // 200x100 view, 100x100 box: min(2, 1).
    expect(place(BOX, 200, 100).scale).toBe(1)
  })

  it('covers by the looser axis', () => {
    expect(place(BOX, 200, 100, { fit: 'cover' }).scale).toBe(2)
  })

  it('defaults to contain', () => {
    expect(place(BOX, 200, 100).scale).toBe(place(BOX, 200, 100, { fit: 'contain' }).scale)
  })

  it('fills the view on the tight axis when contained', () => {
    const t = place(BOX, 200, 100)
    const e = extent(t, BOX)
    expect(e.top).toBeCloseTo(0)
    expect(e.bottom).toBeCloseTo(100)
  })

  it('multiplies the caller’s scale on top of the fit’s, not instead of it', () => {
    expect(place(BOX, 200, 100, { scale: 3 }).scale).toBe(3)
    expect(place(BOX, 200, 100, { fit: 'cover', scale: 3 }).scale).toBe(6)
  })

  it('measures from the box’s own origin, not from zero', () => {
    // Same size as BOX but sitting elsewhere: the scale is unchanged and the
    // placement still centres the box rather than the origin.
    expect(place(OFFSET_BOX, 200, 100).scale).toBe(place(BOX, 200, 100).scale)
    const e = extent(place(OFFSET_BOX, 200, 100), OFFSET_BOX)
    expect((e.left + e.right) / 2).toBeCloseTo(100)
    expect((e.top + e.bottom) / 2).toBeCloseTo(50)
  })
})

describe('resolveRootTransform — no fit to do', () => {
  const preFit = { x: 100, y: 50, scale: 1, flipX: false, flipY: false }

  it('fit: none is scale 1 at the view’s centre', () => {
    expect(place(BOX, 200, 100, { fit: 'none' })).toEqual(preFit)
  })

  it('keeps the caller’s scale under fit: none', () => {
    expect(place(BOX, 200, 100, { fit: 'none', scale: 2 })).toEqual({
      ...preFit,
      scale: 2,
    })
  })

  // A zero-sized or absent box means "nothing measured" — the pre-fit
  // behaviour rather than a division by zero.
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['zero width', { x: 0, y: 0, width: 0, height: 100 }],
    ['zero height', { x: 0, y: 0, width: 100, height: 0 }],
  ] as const)('falls back to the pre-fit placement for a %s box', (_label, box) => {
    const t = place(box, 200, 100)
    expect(t).toEqual(preFit)
    expect(Number.isFinite(t.scale)).toBe(true)
  })

  it.each([
    ['zero width', 0, 100],
    ['zero height', 200, 0],
  ])('falls back for a %s view', (_label, w, h) => {
    const t = place(BOX, w, h)
    expect(t).toEqual({ x: w / 2, y: h / 2, scale: 1, flipX: false, flipY: false })
  })
})

describe('resolveRootTransform — align', () => {
  // 200x100 view, 100x100 box contained at scale 1: 100px of slack on X, none
  // on Y, so the horizontal half of every align is what moves.
  const cases: Array<[SsAlign, number, number]> = [
    ['center', 50, 150],
    ['left', 0, 100],
    ['right', 100, 200],
    ['top-left', 0, 100],
    ['bottom-left', 0, 100],
    ['top-right', 100, 200],
    ['bottom-right', 100, 200],
    ['top', 50, 150],
    ['bottom', 50, 150],
  ]

  it.each(cases)('%s puts the box at [%d, %d] horizontally', (align, left, right) => {
    const e = extent(place(BOX, 200, 100, { align }), BOX)
    expect(e.left).toBeCloseTo(left)
    expect(e.right).toBeCloseTo(right)
  })

  it('aligns the vertical half in screen terms — top is the top of the view', () => {
    // 100x200 view, so the slack is on Y this time; a square view would leave
    // none and every vertical align would coincide.
    const top = extent(place(BOX, 100, 200, { align: 'top' }), BOX)
    const bottom = extent(place(BOX, 100, 200, { align: 'bottom' }), BOX)
    expect(top.top).toBeCloseTo(0)
    expect(bottom.bottom).toBeCloseTo(200)
    expect(top.top).toBeLessThan(bottom.top)
  })

  it('aligns a box that does not start at the origin by its edges', () => {
    const e = extent(place(OFFSET_BOX, 200, 100, { align: 'left' }), OFFSET_BOX)
    expect(e.left).toBeCloseTo(0)
  })
})

describe('resolveRootTransform — flip', () => {
  it('reports the flags through', () => {
    const t = place(BOX, 200, 100, { flipX: true, flipY: true })
    expect(t.flipX).toBe(true)
    expect(t.flipY).toBe(true)
    expect(t.scale).toBeGreaterThan(0)
  })

  // The documented reason `center` is the safe default: the anchor follows the
  // sign, so the box lands in the same place mirrored.
  it('leaves a centred box where it was', () => {
    const plain = extent(place(OFFSET_BOX, 200, 100), OFFSET_BOX)
    const mirrored = extent(
      place(OFFSET_BOX, 200, 100, { flipX: true, flipY: true }),
      OFFSET_BOX
    )
    expect(mirrored.left).toBeCloseTo(plain.left)
    expect(mirrored.right).toBeCloseTo(plain.right)
    expect(mirrored.top).toBeCloseTo(plain.top)
    expect(mirrored.bottom).toBeCloseTo(plain.bottom)
  })

  // The edge cases are where the sign matters: a mirror swaps which end of the
  // box is the low one, and `left` still has to mean the left of the view.
  it('keeps an edge-aligned box against that edge', () => {
    expect(extent(place(OFFSET_BOX, 200, 100, { align: 'left', flipX: true }), OFFSET_BOX).left)
      .toBeCloseTo(0)
    expect(extent(place(OFFSET_BOX, 200, 100, { align: 'right', flipX: true }), OFFSET_BOX).right)
      .toBeCloseTo(200)
    // 100x200 for the vertical pair, so there is slack for the align to spend.
    expect(extent(place(OFFSET_BOX, 100, 200, { align: 'top', flipY: true }), OFFSET_BOX).top)
      .toBeCloseTo(0)
    expect(extent(place(OFFSET_BOX, 100, 200, { align: 'bottom', flipY: true }), OFFSET_BOX).bottom)
      .toBeCloseTo(200)
  })
})

describe('resolveRootTransform — offset', () => {
  it('is applied after the fit, in pixels', () => {
    const plain = place(BOX, 200, 100, { align: 'left' })
    const moved = place(BOX, 200, 100, { align: 'left', offset: { x: 7, y: -3 } })
    expect(moved.x - plain.x).toBeCloseTo(7)
    expect(moved.y - plain.y).toBeCloseTo(-3)
    expect(moved.scale).toBe(plain.scale)
  })

  it('is not scaled by the fit', () => {
    const a = place(BOX, 200, 100, { offset: { x: 10, y: 10 } })
    const b = place(BOX, 400, 200, { offset: { x: 10, y: 10 } })
    expect(a.x - place(BOX, 200, 100).x).toBeCloseTo(10)
    expect(b.x - place(BOX, 400, 200).x).toBeCloseTo(10)
  })

  it('still applies when there was no fit to do', () => {
    expect(place(null, 200, 100, { offset: { x: 5, y: 5 } })).toEqual({
      x: 105,
      y: 55,
      scale: 1,
      flipX: false,
      flipY: false,
    })
  })
})
