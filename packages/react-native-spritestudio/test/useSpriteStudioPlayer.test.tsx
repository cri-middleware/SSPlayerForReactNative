import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  useSpriteStudioPlayer,
  type SsPlayerProps,
} from '../src/view/useSpriteStudioPlayer'
import { SpriteStudioPlayer } from './support/fakePlayer'
import { definePack, resetFakeRuntime } from './support/fakeRuntime'
import { act, renderHook } from './support/render'

// Layer 3 is what this layer makes decisions *about*, so it is the fake here.
// `player/source` stays real — the hook keys its load effect on the URI it
// resolves, which is the whole of "an inline `{ uri }` must not reload".
vi.mock('../src/runtime', () => import('./support/fakeRuntime'))
vi.mock('../src/player/SpriteStudioPlayer', () => import('./support/fakePlayer'))

const PACK = 'ss/overall/Basic.ssab'
const OTHER = 'ss/overall/Other.ssab'

beforeEach(() => {
  resetFakeRuntime()
  SpriteStudioPlayer.reset()
  definePack(PACK)
  definePack(OTHER)
})

const mount = (props: SsPlayerProps) => renderHook(useSpriteStudioPlayer, props)

describe('the player’s lifetime', () => {
  // Tearing down on an animation change dropped the cache leases, so the `.ssab`
  // was re-read and its atlases re-decoded for a change `setAnimation` does in
  // one call — every pick from the example's 24-animation dropdown was a reload
  // from the APK.
  it('switches the animation without rebuilding the player', async () => {
    const harness = await mount({ source: PACK, animation: 'Idle' })
    const player = SpriteStudioPlayer.last()

    await harness.rerender({ source: PACK, animation: 'Walk' })

    expect(SpriteStudioPlayer.created).toHaveLength(1)
    expect(player.disposed).toBe(false)
    expect(player.argsOf('setAnimation')).toEqual([['Walk']])
  })

  it('rebuilds it for a different pack, and tears the old one down', async () => {
    const harness = await mount({ source: PACK })
    const first = SpriteStudioPlayer.last()

    await harness.rerender({ source: OTHER })

    expect(SpriteStudioPlayer.created).toHaveLength(2)
    expect(first.disposed).toBe(true)
  })

  // An inline `{ uri }` is a new object every render, so keying on `source`
  // itself would reload the pack on each one. The key is the URI the prop
  // *names* — `sourceUriOf`, not the normalised one — so this is identity only.
  it('does not reload when only the source object’s identity changed', async () => {
    const harness = await mount({ source: PACK })

    await harness.rerender({ source: { uri: PACK } })
    await harness.rerender({ source: { uri: PACK } })

    expect(SpriteStudioPlayer.created).toHaveLength(1)
  })

  it('disposes on unmount', async () => {
    const harness = await mount({ source: PACK })
    const player = SpriteStudioPlayer.last()

    await harness.unmount()

    expect(player.disposed).toBe(true)
  })

  // The switch is refused while the load is in flight, and `loadTick` is what
  // brings the prop back for a second try.
  it('applies an animation that changed mid-load once the load lands', async () => {
    SpriteStudioPlayer.holdLoads = true
    const harness = await mount({ source: PACK, animation: 'Idle' })
    const player = SpriteStudioPlayer.last()

    await harness.rerender({ source: PACK, animation: 'Walk' })
    expect(player.currentAnimation).toBeNull()

    await act(async () => player.finishLoad())

    expect(player.argsOf('setAnimation')).toEqual([['Walk'], ['Walk']])
    expect(player.currentAnimation).toBe('Walk')
  })
})

describe('the playing prop', () => {
  // `load` selects and poses; starting is a separate verb, so this leaves the
  // animation on its first frame without ever having played.
  it('leaves a player mounted with playing={false} on its first frame', async () => {
    await mount({ source: PACK, playing: false })

    expect(SpriteStudioPlayer.last().names()).not.toContain('play')
  })

  it('heads out exactly once on a load that resolved before the commit', async () => {
    await mount({ source: PACK })

    expect(SpriteStudioPlayer.last().argsOf('play')).toHaveLength(1)
  })

  // Four verbs below, one boolean here: mapping the two is the only thing this
  // layer knows a boolean prop exists for.
  it('resumes a held transport and heads out a stopped one', async () => {
    const harness = await mount({ source: PACK, playing: false })
    const player = SpriteStudioPlayer.last()

    // Never played: this is a start.
    await harness.rerender({ source: PACK, playing: true })
    expect(player.names('play', 'resume', 'pause')).toEqual(['play'])

    await harness.rerender({ source: PACK, playing: false })
    expect(player.names('play', 'resume', 'pause')).toEqual(['play', 'pause'])

    // Held, not stopped: this is a resume, and must not rewind.
    await harness.rerender({ source: PACK, playing: true })
    expect(player.names('play', 'resume', 'pause')).toEqual(['play', 'pause', 'resume'])
  })
})

describe('the transport props', () => {
  // Primed at construction, which is what lets them reach an animation that does
  // not exist yet.
  it('primes speed and loop on the player it builds', async () => {
    await mount({ source: PACK, speed: 2, loop: 3 })

    const player = SpriteStudioPlayer.last()
    expect(player.argsOf('setSpeedScale')).toEqual([[2]])
    expect(player.argsOf('setLoopCount')).toEqual([[3]])
  })

  it('pushes a later change, and only the one that changed', async () => {
    const harness = await mount({ source: PACK, speed: 2, loop: 3 })
    const player = SpriteStudioPlayer.last()

    await harness.rerender({ source: PACK, speed: 0.5, loop: 3 })

    expect(player.argsOf('setSpeedScale')).toEqual([[2], [0.5]])
    expect(player.argsOf('setLoopCount')).toEqual([[3]])
  })
})

describe('the parts prop', () => {
  // Keyed on the map's contents, not its identity: a declarative prop is always
  // going to be written inline.
  it('does not re-apply a map whose contents did not change', async () => {
    const harness = await mount({ source: PACK, parts: { hat: { hide: true } } })
    const player = SpriteStudioPlayer.last()

    await harness.rerender({ source: PACK, parts: { hat: { hide: true } } })

    expect(player.argsOf('setPartOverrides')).toEqual([[{ hat: { hide: true } }]])
  })

  // An absent map is `{}` rather than skipped, so removing the prop reverts what
  // it had set — the same rule as removing one part from it.
  it('reverts when the prop goes away', async () => {
    const harness = await mount({ source: PACK, parts: { hat: { hide: true } } })
    const player = SpriteStudioPlayer.last()

    await harness.rerender({ source: PACK })

    expect(player.argsOf('setPartOverrides')).toEqual([[{ hat: { hide: true } }], [{}]])
  })
})

describe('the event forwarders', () => {
  // Layer 3 gates its per-frame reads on whether a handler is set, so a
  // permanently-installed forwarder would defeat the gate to reach a `?.`.
  it('installs one only while its prop is supplied', async () => {
    const harness = await mount({ source: PACK })
    const player = SpriteStudioPlayer.last()
    expect(player.onUserData).toBeNull()
    expect(player.onAudio).toBeNull()

    await harness.rerender({ source: PACK, onUserData: () => {} })
    expect(player.onUserData).not.toBeNull()
    expect(player.onAudio).toBeNull()

    await harness.rerender({ source: PACK })
    expect(player.onUserData).toBeNull()
  })

  // Installed before `load()`, which reaches the end of its own promise chain
  // synchronously — an effect-installed forwarder would arrive after the events
  // it wanted.
  it('has the lifecycle pair on before the load can fire them', async () => {
    await mount({ source: PACK })
    const player = SpriteStudioPlayer.last()

    expect(player.calls[0]?.name).toBe('constructor')
    expect(player.onAnimationStarted).not.toBeNull()
    expect(player.onAnimationChanged).not.toBeNull()
  })

  it('forwards through the latest prop, so an inline arrow does not restart the load', async () => {
    const first = vi.fn()
    const second = vi.fn()
    const harness = await mount({ source: PACK, onAnimationFinished: first })
    await harness.rerender({ source: PACK, onAnimationFinished: second })

    const player = SpriteStudioPlayer.last()
    player.onAnimationFinished?.('Walk')

    expect(SpriteStudioPlayer.created).toHaveLength(1)
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledWith('Walk')
  })
})

describe('what the caller renders against', () => {
  it('measures by default, and not once there is nothing to measure for', async () => {
    await mount({ source: PACK })
    expect(SpriteStudioPlayer.last().argsOf('load')[0]?.[1]).toMatchObject({
      measure: { scope: 'animation', maxFrames: 0 },
    })

    SpriteStudioPlayer.reset()
    await mount({ source: PACK, fit: 'none' })
    expect(SpriteStudioPlayer.last().argsOf('load')[0]?.[1]).toMatchObject({
      measure: undefined,
    })

    SpriteStudioPlayer.reset()
    await mount({ source: PACK, frame: { x: 0, y: 0, width: 4, height: 4 } })
    expect(SpriteStudioPlayer.last().argsOf('load')[0]?.[1]).toMatchObject({
      measure: undefined,
    })
  })

  // Loaded is not drawable: until a texture is registered `drawInto` skips every
  // batch, which is a blank rectangle that looks exactly like a broken pack.
  it('is ready only once the pack is loaded and carrying a texture', async () => {
    const harness = await mount({ source: PACK })
    const player = SpriteStudioPlayer.last()
    expect(harness.result.current.ready).toBe(false)

    await act(async () => {
      player.textures.register('common', {})
      player.notify()
    })

    expect(harness.result.current.ready).toBe(true)
  })

  it('publishes the measured box off the same subscription', async () => {
    const harness = await mount({ source: PACK })
    const player = SpriteStudioPlayer.last()
    expect(harness.result.current.measured).toBeNull()

    await act(async () => {
      player.contentBox = { x: 0, y: 0, width: 32, height: 48 }
      player.notify()
    })

    expect(harness.result.current.measured).toEqual({ x: 0, y: 0, width: 32, height: 48 })
  })
})
