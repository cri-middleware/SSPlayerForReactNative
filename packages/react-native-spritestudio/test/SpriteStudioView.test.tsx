import { createElement, createRef } from 'react'
import type { ReactTestRenderer } from 'react-test-renderer'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  SpriteStudioView,
  useSsViewPlayer,
  type SpriteStudioViewRef,
} from '../src/view/SpriteStudioView'
import { SpriteStudioPartAnchor } from '../src/view/SpriteStudioPartAnchor'
import { frameChanged } from '../src/player/frames'
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

  // A stopped player with nothing new to draw would record the same picture
  // again, and have the UI thread redraw it.
  it('keeps its picture while the player has nothing new to draw', async () => {
    const { renderer } = await render(<SpriteStudioView source={PACK} />)
    await layout(renderer, 300, 200)
    await act(async () => stepFrame(16))
    const player = SpriteStudioPlayer.last()
    const picture = findHosts(renderer, 'Picture')[0]?.props.picture as { value: unknown }
    const first = picture.value

    player.needsDraw = false
    await act(async () => stepFrame(16))
    expect(picture.value).toBe(first)
    expect(player.names('advance', 'draw')).toEqual(['advance', 'draw', 'advance'])

    player.needsDraw = true
    await act(async () => stepFrame(16))
    expect(picture.value).not.toBe(first)
  })

  it('books no next tick while the player does not advance', async () => {
    const { renderer } = await render(<SpriteStudioView source={PACK} />)
    const player = SpriteStudioPlayer.last()
    player.advances = false
    await layout(renderer, 300, 200)

    await act(async () => stepFrame(16))

    expect(player.names('advance', 'draw')).toEqual(['advance', 'draw'])
    expect(pendingFrames()).toBe(0)
  })

  it('draws one frame for a change while the player does not advance', async () => {
    const { renderer } = await render(<SpriteStudioView source={PACK} />)
    const player = SpriteStudioPlayer.last()
    player.advances = false
    await layout(renderer, 300, 200)
    await act(async () => stepFrame(16))

    frameChanged(player)
    frameChanged(player)
    expect(pendingFrames()).toBe(1)
    await act(async () => stepFrame(16))

    expect(player.names('advance', 'draw')).toEqual(['advance', 'draw', 'advance', 'draw'])
    expect(pendingFrames()).toBe(0)
  })

  it('runs again from the change that sets the player advancing', async () => {
    const { renderer } = await render(<SpriteStudioView source={PACK} />)
    const player = SpriteStudioPlayer.last()
    player.advances = false
    await layout(renderer, 300, 200)
    await act(async () => stepFrame(16))
    await act(async () => stepFrame(1000))

    player.advances = true
    player.notify()
    await act(async () => stepFrame(16))
    await act(async () => stepFrame(16))

    expect(player.argsOf('advance')).toEqual([[16], [16], [16]])
    expect(pendingFrames()).toBe(1)
  })

  it('stops listening for changes on unmount', async () => {
    const { renderer, unmount } = await render(<SpriteStudioView source={PACK} />)
    const player = SpriteStudioPlayer.last()
    player.advances = false
    await layout(renderer, 300, 200)
    await act(async () => stepFrame(16))

    await unmount()
    frameChanged(player)

    expect(pendingFrames()).toBe(0)
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

    frameChanged(SpriteStudioPlayer.last())
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

describe('an error nobody handles', () => {
  // A blank rectangle with nothing in the log reads as a renderer fault.
  it('goes to console.error rather than nowhere', async () => {
    vi.spyOn(SpriteStudioPlayer.prototype, 'draw').mockImplementation(() => {
      throw new Error('boom')
    })
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { renderer } = await render(<SpriteStudioView source={PACK} />)
    await layout(renderer, 300, 200)

    await act(async () => stepFrame(16))

    expect(error).toHaveBeenCalledOnce()
    expect(String(error.mock.calls[0]?.[0])).toContain('frame loop stopped')
  })
})

describe('a view’s own props', () => {
  it('reach the view, and the player’s props do not', async () => {
    const onLayout = vi.fn()
    const { renderer } = await render(
      <SpriteStudioView
        source={PACK}
        animation="Walk"
        testID="hero"
        accessibilityLabel="Ringo waving"
        pointerEvents="none"
        onLayout={onLayout}
      />
    )
    const props = findHosts(renderer, 'View')[0]?.props ?? {}

    expect(props).toMatchObject({
      testID: 'hero',
      accessibilityLabel: 'Ringo waving',
      pointerEvents: 'none',
    })
    expect(props).not.toHaveProperty('source')
    expect(props).not.toHaveProperty('animation')

    await layout(renderer, 300, 200)
    expect(onLayout).toHaveBeenCalledOnce()
    expect(pendingFrames()).toBe(1)
  })
})

/** The style the outer `<View>` was rendered with, flattened. */
function outerStyle(renderer: ReactTestRenderer): Record<string, unknown> {
  const style = findHosts(renderer, 'View')[0]?.props.style as unknown[]
  return Object.assign({}, ...style.filter((entry) => entry != null))
}

describe('the view’s own size', () => {
  const CANVAS = { x: -400, y: -600, width: 800, height: 600 }

  // `<Image>`'s rule for a bundled image. Without it a view with no style lays
  // out 0 high in a column and draws nothing.
  it('is the canvas when the style sizes neither axis', async () => {
    fakePlayerHookState.canvas = CANVAS
    const { renderer } = await render(<SpriteStudioView source={PACK} />)

    expect(outerStyle(renderer)).toEqual({ width: 800, height: 600 })
  })

  it('keeps the canvas’s aspect ratio when the style sizes one axis', async () => {
    fakePlayerHookState.canvas = CANVAS
    const { renderer } = await render(<SpriteStudioView source={PACK} style={{ width: 200 }} />)

    expect(outerStyle(renderer)).toEqual({ width: 200, aspectRatio: 800 / 600 })
  })

  it('leaves a flexed view alone', async () => {
    fakePlayerHookState.canvas = CANVAS
    const { renderer } = await render(<SpriteStudioView source={PACK} style={{ flex: 1 }} />)

    expect(outerStyle(renderer)).toEqual({ flex: 1 })
  })

  it('does not run the frame loop for a view laid out with no height', async () => {
    const { renderer } = await render(<SpriteStudioView source={PACK} />)
    await layout(renderer, 300, 0)

    expect(pendingFrames()).toBe(0)
  })
})

describe('children', () => {
  function Probe(): null {
    probed.push(useSsViewPlayer())
    return null
  }
  const probed: unknown[] = []
  beforeEach(() => {
    probed.length = 0
  })

  it('are laid over the view once it is drawable, and reach its player', async () => {
    fakePlayerHookState.ready = false
    const { renderer, update } = await render(
      <SpriteStudioView source={PACK}>
        <Probe />
      </SpriteStudioView>
    )
    expect(probed).toEqual([])

    fakePlayerHookState.ready = true
    await update(
      <SpriteStudioView source={PACK}>
        <Probe />
      </SpriteStudioView>
    )

    expect(probed.at(-1)).toBe(SpriteStudioPlayer.last())
    expect(findHosts(renderer, 'View')[1]?.props).toMatchObject({ pointerEvents: 'box-none' })
  })

  it('give an anchor the view’s player when it names none', async () => {
    await render(
      <SpriteStudioView source={PACK}>
        <SpriteStudioPartAnchor partName="hand" />
      </SpriteStudioView>
    )
    await act(async () => stepFrame(16))

    expect(SpriteStudioPlayer.last().argsOf('getPartTransform')).toContainEqual(['hand'])
  })

  it('warn about an anchor with no player to follow', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await render(<SpriteStudioPartAnchor partName="hand" />)

    expect(warn).toHaveBeenCalledOnce()
  })
})
