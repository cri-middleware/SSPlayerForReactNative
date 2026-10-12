import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactTestRenderer } from 'react-test-renderer'

import { SpriteStudioScene } from '../src/view/SpriteStudioScene'
import { SpriteStudioSprite } from '../src/view/SpriteStudioSprite'
import { pendingFrames, stepFrame } from './support/frameClock'
import { SpriteStudioPlayer } from './support/fakePlayer'
import { fakePlayerHookState } from './support/fakePlayerHook'
import { act, findHosts, render } from './support/render'
import type { StubPicture } from './support/stubs/skia'

// How a player came to exist is `useSpriteStudioPlayer`'s business and is tested
// there; what a scene does with one is this file's.
vi.mock('../src/player/SpriteStudioPlayer', () => import('./support/fakePlayer'))
vi.mock('../src/view/useSpriteStudioPlayer', () => import('./support/fakePlayerHook'))

const PACK = 'ss/overall/Basic.ssab'

beforeEach(() => {
  SpriteStudioPlayer.reset()
  fakePlayerHookState.measured = null
  fakePlayerHookState.ready = true
})

/** The scene draws nothing until Yoga has measured it. */
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

/** What the last tick recorded, in the order it recorded it. */
function drawn(renderer: ReactTestRenderer): unknown[] {
  const picture = findHosts(renderer, 'Picture')[0]?.props.picture as {
    value: StubPicture
  }
  return picture.value.drawn
}

describe('SpriteStudioScene', () => {
  // The arrangement Layer 3 was built for: N of `<SpriteStudioView>` is N Skia
  // canvases and N frame loops, and a scene is one of each for the lot.
  it('runs one clock for every sprite in it', async () => {
    const { renderer } = await render(
      <SpriteStudioScene>
        <SpriteStudioSprite source={PACK} />
        <SpriteStudioSprite source={PACK} />
      </SpriteStudioScene>
    )
    expect(pendingFrames()).toBe(0)

    await layout(renderer, 300, 200)
    expect(pendingFrames()).toBe(1)

    await act(async () => stepFrame(16))

    expect(SpriteStudioPlayer.created.map((p) => p.argsOf('advance'))).toEqual([
      [[16]],
      [[16]],
    ])
  })

  // Enrolment order rather than JSX order because a sprite can be nested inside
  // any component in between, and React gives no reliable document order.
  it('draws by z, then by enrolment order', async () => {
    const { renderer } = await render(
      <SpriteStudioScene>
        <SpriteStudioSprite source={PACK} z={2} />
        <SpriteStudioSprite source={PACK} z={0} />
        <SpriteStudioSprite source={PACK} z={0} />
      </SpriteStudioScene>
    )
    await layout(renderer, 300, 200)
    await act(async () => stepFrame(16))

    const [high, firstLow, secondLow] = SpriteStudioPlayer.created
    expect(drawn(renderer)).toEqual([firstLow, secondLow, high])
  })

  it('stops the whole scene on paused', async () => {
    const { renderer, update } = await render(
      <SpriteStudioScene>
        <SpriteStudioSprite source={PACK} />
      </SpriteStudioScene>
    )
    await layout(renderer, 300, 200)
    expect(pendingFrames()).toBe(1)

    await update(
      <SpriteStudioScene paused>
        <SpriteStudioSprite source={PACK} />
      </SpriteStudioScene>
    )

    expect(pendingFrames()).toBe(0)
  })

  it('drops a sprite that unmounts', async () => {
    const { renderer, update } = await render(
      <SpriteStudioScene>
        <SpriteStudioSprite key="a" source={PACK} />
        <SpriteStudioSprite key="b" source={PACK} />
      </SpriteStudioScene>
    )
    await layout(renderer, 300, 200)

    await update(
      <SpriteStudioScene>
        <SpriteStudioSprite key="a" source={PACK} />
      </SpriteStudioScene>
    )
    await act(async () => stepFrame(16))

    const [kept] = SpriteStudioPlayer.created
    expect(drawn(renderer)).toEqual([kept])
  })

  // Every sprite stopped and unchanged: the picture the scene has is the one it
  // would record. One that has something new redraws the lot.
  it('records only when a sprite has something new to draw', async () => {
    const { renderer } = await render(
      <SpriteStudioScene>
        <SpriteStudioSprite source={PACK} />
        <SpriteStudioSprite source={PACK} />
      </SpriteStudioScene>
    )
    await layout(renderer, 300, 200)
    await act(async () => stepFrame(16))
    const picture = findHosts(renderer, 'Picture')[0]?.props.picture as { value: unknown }
    const [a, b] = SpriteStudioPlayer.created
    const first = picture.value

    for (const player of SpriteStudioPlayer.created) player.needsDraw = false
    await act(async () => stepFrame(16))
    expect(picture.value).toBe(first)
    // Still advanced: a paused sprite's independent effects keep running.
    expect(a?.argsOf('advance')).toEqual([[16], [16]])

    if (b != null) b.needsDraw = true
    await act(async () => stepFrame(16))
    expect(picture.value).not.toBe(first)
    expect(drawn(renderer)).toEqual([a, b])
  })

  it('records again when a sprite leaves, even with nothing new to draw', async () => {
    const { renderer, update } = await render(
      <SpriteStudioScene>
        <SpriteStudioSprite key="a" source={PACK} />
        <SpriteStudioSprite key="b" source={PACK} />
      </SpriteStudioScene>
    )
    await layout(renderer, 300, 200)
    await act(async () => stepFrame(16))
    for (const player of SpriteStudioPlayer.created) player.needsDraw = false

    await update(
      <SpriteStudioScene>
        <SpriteStudioSprite key="a" source={PACK} />
      </SpriteStudioScene>
    )
    await act(async () => stepFrame(16))

    const [kept] = SpriteStudioPlayer.created
    expect(drawn(renderer)).toEqual([kept])
  })

  // Caps the step so returning from the background does not fast-forward
  // through every frame the scene missed — events on them included.
  it('caps a long tick', async () => {
    const { renderer } = await render(
      <SpriteStudioScene>
        <SpriteStudioSprite source={PACK} />
      </SpriteStudioScene>
    )
    await layout(renderer, 300, 200)

    await act(async () => stepFrame(5000))

    expect(SpriteStudioPlayer.last().argsOf('advance')).toEqual([[1000 / 15]])
  })
})

describe('SpriteStudioSprite', () => {
  // Easy to make, and impossible to see otherwise: it renders nothing of its
  // own, so outside a scene it is a component that silently does nothing.
  it('says so when it is not in a scene', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await render(<SpriteStudioSprite source={PACK} />)

    expect(warn.mock.calls[0]?.[0]).toMatch(/must be inside a <SpriteStudioScene>/)
  })

  // With no width and height there is no box to fit, so `x`/`y` place the
  // animation's own origin — wherever the author put it.
  it('places the origin at x/y when there is no box to fit', async () => {
    const { renderer } = await render(
      <SpriteStudioScene>
        <SpriteStudioSprite source={PACK} x={40} y={25} />
      </SpriteStudioScene>
    )
    await layout(renderer, 300, 200)

    expect(SpriteStudioPlayer.last().argsOf('setRootTransform').at(-1)).toEqual([
      { x: 40, y: 25, scale: 1, flipX: false, flipY: false },
    ])
  })

  // The same solver the view uses, with the sprite's own box and `x`/`y` carried
  // in as the offset — which is what puts the fitted box into scene coordinates.
  it('fits the measured box into its own width and height, then offsets', async () => {
    fakePlayerHookState.measured = { x: 0, y: 0, width: 50, height: 50 }

    const { renderer } = await render(
      <SpriteStudioScene>
        <SpriteStudioSprite source={PACK} x={10} y={20} width={100} height={100} />
      </SpriteStudioScene>
    )
    await layout(renderer, 300, 200)

    expect(SpriteStudioPlayer.last().argsOf('setRootTransform').at(-1)).toEqual([
      { x: 10, y: 20, scale: 2, flipX: false, flipY: false },
    ])
  })
})
