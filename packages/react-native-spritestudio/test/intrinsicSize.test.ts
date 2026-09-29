import { describe, expect, it } from 'vitest'

import { StyleSheet } from 'react-native'
import { intrinsicSize } from '../src/view/intrinsicSize'

const RINGO = { x: -400, y: -600, width: 800, height: 600 }

describe('intrinsicSize', () => {
  it('is the box, one unit to a point, when the style sizes neither axis', () => {
    expect(intrinsicSize(undefined, RINGO)).toEqual({ width: 800, height: 600 })
    expect(intrinsicSize({ margin: 8 }, RINGO)).toEqual({ width: 800, height: 600 })
  })

  it('fills in the open axis from the aspect ratio', () => {
    expect(intrinsicSize({ width: 200 }, RINGO)).toEqual({ aspectRatio: 800 / 600 })
    expect(intrinsicSize({ height: '50%' }, RINGO)).toEqual({ aspectRatio: 800 / 600 })
    expect(intrinsicSize([{ width: 200 }, null], RINGO)).toEqual({ aspectRatio: 800 / 600 })
  })

  it('leaves a style that sizes both axes alone', () => {
    expect(intrinsicSize({ width: 200, height: 100 }, RINGO)).toBeNull()
    expect(intrinsicSize(StyleSheet.absoluteFill, RINGO)).toBeNull()
    expect(intrinsicSize({ position: 'absolute', inset: 0 }, RINGO)).toBeNull()
  })

  // An aspect ratio under `flex: 1` wins over the stretch: Yoga lays a 390x800
  // column's child out 1067 wide.
  it('leaves a flexed or stretched style alone', () => {
    expect(intrinsicSize({ flex: 1 }, RINGO)).toBeNull()
    expect(intrinsicSize({ flexGrow: 1 }, RINGO)).toBeNull()
    expect(intrinsicSize({ flexBasis: 0 }, RINGO)).toBeNull()
    expect(intrinsicSize({ alignSelf: 'stretch' }, RINGO)).toBeNull()
  })

  it('counts two opposite insets as a size only when absolute', () => {
    expect(intrinsicSize({ position: 'absolute', left: 0, right: 0 }, RINGO)).toEqual({
      aspectRatio: 800 / 600,
    })
    expect(intrinsicSize({ position: 'absolute', top: 10, left: 10 }, RINGO)).toEqual({
      width: 800,
      height: 600,
    })
    expect(intrinsicSize({ left: 0, right: 0 }, RINGO)).toEqual({ width: 800, height: 600 })
  })

  it('keeps the caller’s aspect ratio', () => {
    expect(intrinsicSize({ aspectRatio: 1 }, RINGO)).toEqual({ width: 800 })
    expect(intrinsicSize({ width: 100, aspectRatio: 1 }, RINGO)).toBeNull()
  })

  it('says nothing before there is a box', () => {
    expect(intrinsicSize(undefined, null)).toBeNull()
    expect(intrinsicSize(undefined, { x: 0, y: 0, width: 0, height: 0 })).toBeNull()
  })
})
