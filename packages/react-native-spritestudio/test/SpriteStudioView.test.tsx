import { createElement, createRef } from 'react'
import type { ReactTestRenderer } from 'react-test-renderer'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  SpriteStudioView,
  type SpriteStudioViewRef,
} from '../src/view/SpriteStudioView'
import { pendingFrames, stepFrame } from './support/frameClock'
import { SpriteStudioPlayer } from './support/fakePlayer'
import { fakePlayerHookState } from './support/fakePlayerHook'
import { act, findHosts, render } from './support/render'

vi.mock('../src/player/SpriteStudioPlayer', () => import('./support/fakePlayer'))
vi.mock('../src/view/useSpriteStudioPlayer', () => import('./support/fakePlayerHook'))

const PACK = 'ss/overall/Basic.ssab'
const PLACEHOLDER = createElement('Placeholder')

beforeEach(() => {
  SpriteStudioPlayer.reset()
  fakePlayerHookState.measured = null
  fakePlayerHookState.canvas = null
  fakePlayerHookState.ready = true
})

async function layout(
  renderer: ReactTestRenderer,
  width: number,
  height: number
): Promise<void> {
  const view = findHosts(renderer, 'View')[0]
  await act(async () => {
    ;(view?.props as { onLayout(event: unknown): void }).onLayout({
      nativeEvent: { layout: { width, height } },
    })
  })
}

describe('the frame loop', () => {
  // Not gated on textures: until something is registered `draw()` draws nothing,
  // which is the same empty frame waiting would have produced — and this way the
  // clock is already running when they land.
  it('waits for a measured width, then advances and records each tick', async () => {
    const { renderer } = await render(<SpriteStudioView source={PACK} />)
    expect(pendingFrames()).toBe(0)

    await layout(renderer, 300, 200)
    await act(async () => stepFrame(16))

    const player = SpriteStudioPlayer.last()
    expect(player.argsOf('advance')).toEqual([[16]])
    expect(player.names('advance', 'draw')).toEqual(['advance', 'draw'])
  })

  it('caps a long tick so a backgrounded app does not fast-forward', async () => {
    const { renderer } = await render(<SpriteStudioView source={PACK} />)
    await layout(renderer, 300, 200)

    await act(async () => stepFrame(5000))

    expect(SpriteStudioPlayer.last().argsOf('advance')).toEqual([[1000 / 15]])
  })

  // A throwing tick would otherwise throw once per frame, forever.
  it('stops the loop and reports the first error it hits', async () => {
    vi.spyOn(SpriteStudioPlayer.prototype, 'draw').mockImplementation(() => {
      throw new Error('boom')
    })
    const onError = vi.fn()
    const { renderer } = await render(
      <SpriteStudioView source={PACK} onError={onError} />
    )
    await layout(renderer, 300, 200)

    await act(async () => stepFrame(16))

    expect(onError).toHaveBeenCalledOnce()
    expect(pendingFrames()).toBe(0)
  })

  it('cancels the loop on unmount', async () => {
    const { renderer, unmount } = await render(<SpriteStudioView source={PACK} />)
    await layout(renderer, 300, 200)
    expect(pendingFrames()).toBe(1)

    await unmount()

    expect(pendingFrames()).toBe(0)
  })
})

describe('placement', () => {
  it('fits the measured box to the view’s own box', async () => {
    fakePlayerHookState.measured = { x: 0, y: 0, width: 50, height: 50 }

    const { renderer } = await render(<SpriteStudioView source={PACK} />)
    await layout(renderer, 300, 200)

    // contain takes the tighter axis (200/50), and centre puts what is left over
    // on both sides of x.
    expect(SpriteStudioPlayer.last().argsOf('setRootTransform').at(-1)).toEqual([
      { x: 50, y: 0, scale: 4, flipX: false, flipY: false },
    ])
  })

  // With nothing supplied and nothing measured, the box is the authored canvas.
  it('fits the authored canvas when nothing was measured', async () => {
    fakePlayerHookState.canvas = { x: 0, y: 0, width: 50, height: 50 }

    const { renderer } = await render(<SpriteStudioView source={PACK} />)
    await layout(renderer, 300, 200)

    expect(SpriteStudioPlayer.last().argsOf('setRootTransform').at(-1)).toEqual([
      { x: 50, y: 0, scale: 4, flipX: false, flipY: false },
    ])
  })

  // A measured box, when one was asked for, wins over the canvas.
  it('prefers the measured box to the canvas', async () => {
    fakePlayerHookState.canvas = { x: 0, y: 0, width: 100, height: 100 }
    fakePlayerHookState.measured = { x: 0, y: 0, width: 50, height: 50 }

    const { renderer } = await render(<SpriteStudioView source={PACK} />)
    await layout(renderer, 300, 200)

    expect(SpriteStudioPlayer.last().argsOf('setRootTransform').at(-1)).toEqual([
      { x: 50, y: 0, scale: 4, flipX: false, flipY: false },
    ])
  })

  // Under `fit="none"` the offset is measured from the view's centre, which is
  // what it always meant.
  it('leaves the art unscaled under fit="none", offset from the centre', async () => {
    fakePlayerHookState.measured = { x: 0, y: 0, width: 50, height: 50 }

    const { renderer } = await render(
      <SpriteStudioView source={PACK} fit="none" offset={{ x: 10, y: -10 }} />
    )
    await layout(renderer, 300, 200)

    expect(SpriteStudioPlayer.last().argsOf('setRootTransform').at(-1)).toEqual([
      { x: 160, y: 90, scale: 1, flipX: false, flipY: false },
    ])
  })
})

describe('the placeholder', () => {
  // Until the textures land `drawInto` skips every batch, so the honest
  // alternative is a blank rectangle that looks exactly like a broken pack.
  it('covers the canvas until the first frame is drawable', async () => {
    fakePlayerHookState.ready = false
    const { renderer, update } = await render(
      <SpriteStudioView source={PACK} placeholder={PLACEHOLDER} />
    )
    expect(findHosts(renderer, 'Placeholder')).toHaveLength(1)

    fakePlayerHookState.ready = true
    await update(<SpriteStudioView source={PACK} placeholder={PLACEHOLDER} />)

    expect(findHosts(renderer, 'Placeholder')).toHaveLength(0)
  })

  it('is nothing at all when none was given', async () => {
    fakePlayerHookState.ready = false
    const { renderer } = await render(<SpriteStudioView source={PACK} />)

    expect(findHosts(renderer, 'View')).toHaveLength(1)
  })
})

describe('the ref', () => {
  // For everything the props do not cover.
  it('hands out the Layer 3 player', async () => {
    const ref = createRef<SpriteStudioViewRef>()

    await render(<SpriteStudioView ref={ref} source={PACK} />)

    expect(ref.current?.player).toBe(SpriteStudioPlayer.last())
  })
})
