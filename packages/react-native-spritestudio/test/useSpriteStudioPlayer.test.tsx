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

describe('the transitionMs prop', () => {
  // Track 0 switches through the one prop either way, so the prop can always
  // return to where it was: ForWgpu's Bevy A-2, where a crossfade sent by
  // command left the value on the old name and writing it back did nothing.
  it('crossfades a change of animation instead of setting it up', async () => {
    const harness = await mount({ source: PACK, animation: 'Idle', transitionMs: 250 })
    const player = SpriteStudioPlayer.last()

    await harness.rerender({ source: PACK, animation: 'Walk', transitionMs: 250 })
    await harness.rerender({ source: PACK, animation: 'Idle', transitionMs: 250 })

    expect(player.argsOf('crossfade')).toEqual([
      [0, 'Walk', 250],
      [0, 'Idle', 250],
    ])
    expect(player.names()).not.toContain('setAnimation')
  })

  // A crossfade is a switch, not a start: no rewind of the clip it brings in.
  it('does not head out after a crossfade', async () => {
    const harness = await mount({ source: PACK, animation: 'Idle', transitionMs: 250 })
    const player = SpriteStudioPlayer.last()
    const plays = player.argsOf('play').length

    await harness.rerender({ source: PACK, animation: 'Walk', transitionMs: 250 })

    expect(player.argsOf('play')).toHaveLength(plays)
  })

  // There is nothing to fade from before the first clip is up.
  it('sets the first animation of a load up outright', async () => {
    SpriteStudioPlayer.holdLoads = true
    const harness = await mount({ source: PACK, animation: 'Idle', transitionMs: 250 })
    const player = SpriteStudioPlayer.last()

    await harness.rerender({ source: PACK, animation: 'Walk', transitionMs: 250 })
    await act(async () => player.finishLoad())

    expect(player.names()).not.toContain('crossfade')
    expect(player.currentAnimation).toBe('Walk')
  })

  it('switches outright at 0, as without the prop', async () => {
    const harness = await mount({ source: PACK, animation: 'Idle' })
    const player = SpriteStudioPlayer.last()

    await harness.rerender({ source: PACK, animation: 'Walk', transitionMs: 0 })

    expect(player.argsOf('setAnimation')).toEqual([['Walk']])
    expect(player.names()).not.toContain('crossfade')
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

describe('the textures prop', () => {
  /** What the hook last asked of each cellmap: an image, or null for the pack's own. */
  const lastReplacement = (player: SpriteStudioPlayer): Map<string, unknown> =>
    new Map(player.argsOf('setCellmapTexture').map(([name, image]) => [name as string, image]))

  // The pack loads its own atlas into the same registry, so a bare source
  // registered under the default key met a table of two and matched no batch.
  it('replaces the pack’s one cellmap with a bare source', async () => {
    const harness = await mount({ source: PACK, textures: 'ss/winter.png' })
    await harness.flush()
    const player = SpriteStudioPlayer.last()

    expect([...lastReplacement(player).keys()]).toEqual(['common'])
    expect(lastReplacement(player).get('common')).not.toBeNull()
  })

  it('leaves a bare source unapplied on a pack with several cellmaps, and says why', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    SpriteStudioPlayer.holdLoads = true
    const harness = await mount({ source: PACK, textures: 'ss/winter.png' })
    const player = SpriteStudioPlayer.last()
    player.cellmaps = ['body', 'face']

    await act(async () => player.finishLoad())
    await harness.flush()

    expect(player.argsOf('setCellmapTexture')).toEqual([])
    expect(String(warn.mock.calls[0]?.[0])).toMatch(/Key the textures by cellmap name/)
  })

  // Declarative, like `parts`: the prop describes the atlases in effect.
  it('puts the pack’s own atlas back when the prop goes away', async () => {
    const harness = await mount({ source: PACK, textures: { common: 'ss/winter.png' } })
    await harness.flush()
    const player = SpriteStudioPlayer.last()

    await harness.rerender({ source: PACK })

    expect(lastReplacement(player).get('common')).toBeNull()
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
  // The authored canvas is the default box, so measuring — a bake of every
  // frame — happens only when `frameScope` asks for it, and never when there is
  // nothing to fit or a `frame` already answers.
  it('measures only when asked, and never with nothing to measure for', async () => {
    await mount({ source: PACK })
    expect(SpriteStudioPlayer.last().argsOf('load')[0]?.[1]).toMatchObject({
      measure: undefined,
    })

    SpriteStudioPlayer.reset()
    await mount({ source: PACK, frameScope: 'animation' })
    expect(SpriteStudioPlayer.last().argsOf('load')[0]?.[1]).toMatchObject({
      measure: { scope: 'animation', maxFrames: 0 },
    })

    SpriteStudioPlayer.reset()
    await mount({ source: PACK, frameScope: 'pack', fit: 'none' })
    expect(SpriteStudioPlayer.last().argsOf('load')[0]?.[1]).toMatchObject({
      measure: undefined,
    })

    SpriteStudioPlayer.reset()
    await mount({ source: PACK, frameScope: 'pack', frame: { x: 0, y: 0, width: 4, height: 4 } })
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

  it('publishes the authored canvas off the same subscription', async () => {
    const harness = await mount({ source: PACK })
    const player = SpriteStudioPlayer.last()
    expect(harness.result.current.canvas).toBeNull()

    await act(async () => {
      player.canvasBox = { x: -400, y: -600, width: 800, height: 600 }
      player.notify()
    })

    expect(harness.result.current.canvas).toEqual({ x: -400, y: -600, width: 800, height: 600 })
  })

  // Canvases differ within a pack — Ringo's `dead` is 1300 wide against 800 —
  // and a box that followed them would shrink the character as it dies.
  it('keeps the canvas the load started on across a switch, and takes it again on a load', async () => {
    const harness = await mount({ source: PACK, animation: 'Idle' })
    const player = SpriteStudioPlayer.last()
    const idle = { x: -400, y: -600, width: 800, height: 600 }
    const dead = { x: -650, y: -600, width: 1300, height: 600 }

    await act(async () => {
      player.canvasBox = idle
      player.notify()
    })
    await harness.rerender({ source: PACK, animation: 'Walk' })
    await act(async () => {
      player.canvasBox = dead
      player.notify()
    })
    expect(harness.result.current.canvas).toEqual(idle)

    await act(async () => player.load(PACK, { animation: 'Walk' }))
    expect(harness.result.current.canvas).toEqual(dead)
  })
})

describe('the load’s outcome', () => {
  // The player was only reachable through the ref, which a cached load can
  // outrun: `onLoad` fired before React committed the render that set it.
  it('hands the player to onLoad', async () => {
    const onLoad = vi.fn()
    await mount({ source: PACK, onLoad })

    expect(onLoad).toHaveBeenCalledWith(SpriteStudioPlayer.last())
  })

  it('goes to onError when there is one', async () => {
    vi.spyOn(SpriteStudioPlayer.prototype, 'load').mockRejectedValue(new Error('404'))
    const onError = vi.fn()
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})

    const harness = await mount({ source: PACK, onError })
    await harness.flush()

    expect(onError).toHaveBeenCalledWith(new Error('404'))
    expect(error).not.toHaveBeenCalled()
  })

  // A wrong path is otherwise a blank rectangle with nothing in the log.
  it('says which pack did not load when there is no onError', async () => {
    vi.spyOn(SpriteStudioPlayer.prototype, 'load').mockRejectedValue(new Error('404'))
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})

    const harness = await mount({ source: PACK })
    await harness.flush()

    expect(error).toHaveBeenCalledOnce()
    expect(String(error.mock.calls[0]?.[0])).toContain(`'${PACK}' did not load`)
  })
})
