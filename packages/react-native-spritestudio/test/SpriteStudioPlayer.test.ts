import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SkImage } from 'react-native-skia'

import { ssClearCaches, ssImageCache } from '../src/core/caches'
import { SsOverridePriority } from '../src/core/parts'
import { SsPlaybackDirection, SsPlaybackStyle } from '../src/core/types'
import { onFrameChanged, onFrameShown } from '../src/player/frames'
import { MAX_STEP_MS, SpriteStudioPlayer } from '../src/player/SpriteStudioPlayer'
import type { SsTextureInfo } from '../src/specs/SsRuntime.nitro'
import { pendingFrames, stepFrame } from './support/frameClock'
import { SsInternalPlayer } from './support/fakeInternalPlayer'
import { SsRuntimeModule, definePack, openPack, resetFakeRuntime } from './support/fakeRuntime'
import { loadInstancePacks, loadResource, releaseResource, resetFakeSource } from './support/fakeSource'
import type { SsTextureRegistry as RealTextureRegistry } from '../src/core/SsTextureRegistry'
import { SsTextureRegistry } from './support/fakeTextureRegistry'
import { skiaDecode } from './support/stubs/skia'

// The four doors this layer opens onto the device, all of them fake here. The
// player, its transport, its lease bookkeeping and its event gates are real.
vi.mock('../src/runtime', () => import('./support/fakeRuntime'))
vi.mock('../src/core/SsInternalPlayer', () => import('./support/fakeInternalPlayer'))
vi.mock('../src/core/SsTextureRegistry', () => import('./support/fakeTextureRegistry'))
vi.mock('../src/player/source', () => import('./support/fakeSource'))

const PACK = 'ss/overall/Basic.ssab'

beforeEach(() => {
  resetFakeRuntime()
  resetFakeSource()
  SsInternalPlayer.reset()
  SsTextureRegistry.reset()
  definePack(PACK, { animations: ['Idle', 'Walk'] })
})

afterEach(ssClearCaches)

/** A texture the pack carries inside itself, so nothing has to be fetched. */
function embeddedTexture(name: string, imagePath = ''): SsTextureInfo {
  return {
    textureHash: SsRuntimeModule.hashString(name),
    name,
    imagePath,
    embeddedLength: imagePath === '' ? 3 : 0,
  }
}

async function loaded(
  options?: Parameters<SpriteStudioPlayer['load']>[1]
): Promise<SpriteStudioPlayer> {
  const player = new SpriteStudioPlayer()
  await player.load(PACK, options)
  return player
}

describe('load', () => {
  // "Just play the pack" rather than "render nothing": a resource with no
  // `setup_animation` draws an empty canvas, which is a silent default for
  // `<SpriteStudioView source={…} />` with no `animation` prop.
  it('sets up the pack’s first animation when none is named', async () => {
    const player = await loaded()
    expect(player.currentAnimation).toBe('Idle')
  })

  // `play()` is the host's call, and for the components it is what the `playing`
  // prop maps onto. Folding it in here is what made `setAnimation` start the
  // animation it was only asked to select.
  it('selects and poses without starting playback', async () => {
    const player = await loaded()
    expect(SsInternalPlayer.last().names()).not.toContain('play')
    expect(player.isPlaying).toBe(false)
  })

  // Binding is refused once the child players exist, so the order is Layer 1's
  // requirement and not a preference.
  it('binds the instance packs before the animation is set up', async () => {
    definePack('ss/overall/Child.ssab')
    loadInstancePacks.mockResolvedValueOnce([
      { resource: openPack('ss/overall/Child.ssab'), uri: 'ss/overall/Child.ssab' },
    ])

    await loaded()

    const calls = SsInternalPlayer.last().names()
    expect(calls.indexOf('bindInstancePack')).toBeLessThan(calls.indexOf('setupAnimation'))
  })

  it('carries a root transform set before the load onto the animation', async () => {
    const player = new SpriteStudioPlayer()
    player.setRootTransform({ x: 10, y: 20, scale: 2, flipX: true, flipY: false })

    await player.load(PACK)

    expect(SsInternalPlayer.last().rootTransform).toEqual({
      x: 10,
      y: 20,
      scale: 2,
      flipX: true,
      flipY: false,
    })
  })

  // The lease goes back rather than the resource being disposed: another player
  // may be holding the same pack.
  it('drops a superseded load instead of racing it into place', async () => {
    definePack('ss/overall/Other.ssab', { animations: ['Other'] })
    let settle!: (value: { resource: ReturnType<typeof openPack>; uri: string }) => void
    loadResource.mockImplementationOnce(
      async () => new Promise((resolve) => (settle = resolve))
    )

    const player = new SpriteStudioPlayer()
    const first = player.load(PACK)
    await player.load('ss/overall/Other.ssab')
    settle({ resource: openPack(PACK), uri: PACK })
    await first

    expect(releaseResource).toHaveBeenCalledWith(PACK)
    expect(player.currentAnimation).toBe('Other')
  })

  it('drops a load that lands after dispose', async () => {
    let settle!: (value: { resource: ReturnType<typeof openPack>; uri: string }) => void
    loadResource.mockImplementationOnce(
      async () => new Promise((resolve) => (settle = resolve))
    )

    const player = new SpriteStudioPlayer()
    const pending = player.load(PACK)
    player.dispose()
    settle({ resource: openPack(PACK), uri: PACK })
    await pending

    expect(releaseResource).toHaveBeenCalledWith(PACK)
    expect(player.isLoaded).toBe(false)
  })
})

describe('setAnimation', () => {
  // ForRN #78. `currentAnimation` used to be assigned ahead of the result, so it
  // named an animation the runtime had never set up — and `onAnimationStarted`
  // published that name too.
  it('does not take the name of an animation the runtime refused', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const player = await loaded({ animation: 'Idle' })

    expect(player.setAnimation('Typo')).toBe(false)
    expect(player.currentAnimation).toBe('Idle')
  })

  it('reports the Brain’s own reason for the refusal', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const player = await loaded()
    SsInternalPlayer.last().setupFailure = 'SSAB data is not loaded'

    player.setAnimation('Typo')

    expect(warn.mock.calls[0]?.[0]).toContain('SSAB data is not loaded')
    expect(warn.mock.calls[0]?.[0]).toContain(PACK)
  })

  // The early return compares against what the runtime HAS, and a failed switch
  // leaves that alone — so a state machine asserting a typo every frame would
  // otherwise report it every frame.
  it('reports one wrong name once, and a second one on its own line', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const player = await loaded()

    player.setAnimation('Typo')
    player.setAnimation('Typo')
    expect(warn).toHaveBeenCalledOnce()

    player.setAnimation('Other typo')
    expect(warn).toHaveBeenCalledTimes(2)
  })

  // Safe for a state machine to assert its current clip every frame: the
  // playhead stays, the loop budget is not re-armed, the overrides survive.
  it('does nothing at all when the animation is already set up', async () => {
    const player = await loaded({ animation: 'Idle' })
    const internal = SsInternalPlayer.last()
    internal.calls.length = 0

    expect(player.setAnimation('Idle')).toBe(true)
    expect(internal.calls).toEqual([])
  })

  it('announces a switch, but not a restart of the same animation', async () => {
    const player = await loaded({ animation: 'Idle' })
    const changed = vi.fn()
    const started = vi.fn()
    player.onAnimationChanged = changed
    player.onAnimationStarted = started

    player.setAnimation('Walk')
    player.setAnimation('Walk')

    expect(changed.mock.calls).toEqual([['Walk']])
    // A selection is not a start.
    expect(started).not.toHaveBeenCalled()
  })

  it('remembers a name chosen before there is a resource, and starts on it', async () => {
    const player = new SpriteStudioPlayer()
    expect(player.setAnimation('Walk')).toBe(false)

    await player.load(PACK)

    expect(player.currentAnimation).toBe('Walk')
  })

  // Consumed by that load rather than kept, or it would follow the player onto a
  // second pack and be reported missing there.
  it('does not carry that name onto the next pack', async () => {
    const player = new SpriteStudioPlayer()
    player.setAnimation('Walk')
    await player.load(PACK)

    definePack('ss/overall/Other.ssab', { animations: ['Other'] })
    await player.load('ss/overall/Other.ssab')

    expect(player.currentAnimation).toBe('Other')
  })
})

describe('the transport settings replayed onto each animation', () => {
  // `setup_animation` resets the loop count and `play` arms the counter with
  // whatever is in effect at that moment, so the order is not decorative.
  it('re-arms the loop count before playback heads out', async () => {
    const player = await loaded()
    player.play()

    const calls = SsInternalPlayer.last().names()
    expect(calls.indexOf('setLoopCount')).toBeLessThan(calls.indexOf('play'))
  })

  it('lands values chosen before the load on the animation', async () => {
    const player = new SpriteStudioPlayer()
    player.setSpeedScale(2)
    player.setLoopCount(3)
    player.setPlaybackDirection(SsPlaybackDirection.backward, SsPlaybackStyle.pingPong)

    await player.load(PACK)

    const internal = SsInternalPlayer.last()
    expect(internal.speedScale).toBe(2)
    expect(internal.loopCount).toBe(3)
    expect(internal.playbackDirection).toBe(SsPlaybackDirection.backward)
    expect(internal.playbackStyle).toBe(SsPlaybackStyle.pingPong)
  })

  // A rate the host never chose must not be pushed, or the clip's authored rate
  // becomes an override that follows the player onto clips authored differently.
  it('pushes a frame rate only once the host has chosen one', async () => {
    const player = await loaded()
    expect(SsInternalPlayer.last().names()).not.toContain('setFrameRate')

    player.setFrameRate(60)
    player.setAnimation('Walk')

    expect(SsInternalPlayer.last().argsOf('setFrameRate')).toEqual([[60], [60]])
  })

  // Frame numbers only mean something inside the animation they were measured
  // in, so a section is not carried across a switch — set it after each one.
  it('restricts playback to a section of the current animation', async () => {
    const player = await loaded()

    expect(player.setAnimationSection(10, 20)).toBe(true)

    expect(SsInternalPlayer.last().argsOf('setSection')).toEqual([[10, 20]])
    expect(player.startFrame).toBe(10)
    expect(player.endFrame).toBe(20)
    // Both ends inclusive — feed it to a scrubber.
    expect(player.totalFrames).toBe(11)
  })

  // The Brain refuses an end before the start and keeps the section it had; a
  // state machine repeating the call every frame is one line, a second pair
  // another.
  it('says once per pair that a section ending before it starts did nothing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const player = await loaded()
    player.setAnimationSection(2, 5)

    expect(player.setAnimationSection(20, 10)).toBe(false)
    expect(player.setAnimationSection(20, 10)).toBe(false)
    expect(player.startFrame).toBe(2)
    expect(player.endFrame).toBe(5)
    expect(warn).toHaveBeenCalledOnce()
    const line = String(warn.mock.calls[0]?.[0])
    expect(line).toContain('setAnimationSection(20, 10)')
    expect(line).toContain(PACK)
    expect(line).toContain('Invalid parameter')

    player.setAnimationSection(30, 10)
    expect(warn).toHaveBeenCalledTimes(2)
  })

  describe('by label', () => {
    async function labelled(): Promise<SpriteStudioPlayer> {
      const player = await loaded({ animation: 'Idle' })
      SsInternalPlayer.last().labelTables = {
        Idle: {
          startFrame: 0,
          endFrame: 30,
          labels: [
            { name: 'Start', frame: 10 },
            { name: 'End', frame: 20 },
          ],
        },
        Walk: { startFrame: 0, endFrame: 12, labels: [{ name: '_end', frame: 6 }] },
      }
      return player
    }

    it('sets the section from one label to another of the current animation, offsets added', async () => {
      const player = await labelled()

      expect(player.setAnimationSectionByLabel('Start', 'End', 1, -1)).toBe(true)

      expect(SsInternalPlayer.last().argsOf('setSection')).toEqual([[11, 19]])
      expect(player.startFrame).toBe(11)
      expect(player.endFrame).toBe(19)
    })

    it('reads _start and _end as the animation’s own ends, unless a label has that name', async () => {
      const player = await labelled()

      player.setAnimationSectionByLabel('_start', 'Start')
      player.setAnimation('Walk')
      player.setAnimationSectionByLabel('_start', '_end')

      expect(SsInternalPlayer.last().argsOf('setSection')).toEqual([
        [0, 10],
        [0, 6],
      ])
    })

    it('says once that the animation has no such label, and changes nothing', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const player = await labelled()

      expect(player.setAnimationSectionByLabel('Start', 'hover')).toBe(false)
      expect(player.setAnimationSectionByLabel('Start', 'hover')).toBe(false)

      expect(SsInternalPlayer.last().names()).not.toContain('setSection')
      expect(warn).toHaveBeenCalledOnce()
      const line = String(warn.mock.calls[0]?.[0])
      expect(line).toContain("'hover'")
      expect(line).toContain("'Idle'")
      expect(line).not.toContain("'Start'")

      player.setAnimationSectionByLabel('pressed', 'pressed')
      expect(warn).toHaveBeenCalledTimes(2)
      expect(String(warn.mock.calls[1]?.[0])).not.toContain('or')
    })

    it('says once, with the labels and the frames, that a section ending before it starts did nothing', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const player = await labelled()
      player.setAnimationSection(2, 5)

      expect(player.setAnimationSectionByLabel('End', 'Start')).toBe(false)
      expect(player.setAnimationSectionByLabel('End', 'Start')).toBe(false)

      expect(player.startFrame).toBe(2)
      expect(player.endFrame).toBe(5)
      expect(warn).toHaveBeenCalledOnce()
      const line = String(warn.mock.calls[0]?.[0])
      expect(line).toContain("'End', 'Start'")
      expect(line).toContain('frames 20 to 10')
      expect(line).toContain('Invalid parameter')
    })

    it('is false, and silent, before a load', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const player = new SpriteStudioPlayer()

      expect(player.setAnimationSectionByLabel('Start', 'End')).toBe(false)
      expect(warn).not.toHaveBeenCalled()
    })

    it('reads the label table of the current animation, or of the one named', async () => {
      const player = await labelled()

      expect(player.getLabelTable()).toEqual({
        valid: true,
        startFrame: 0,
        endFrame: 30,
        labels: [
          { name: 'Start', frame: 10 },
          { name: 'End', frame: 20 },
        ],
      })
      expect(player.getLabelTable('Walk')?.endFrame).toBe(12)
      expect(player.getLabelTable('Nope')).toBeNull()
      expect(new SpriteStudioPlayer().getLabelTable()).toBeNull()
    })
  })

  it('replays them again after a switch, because setup drops them', async () => {
    const player = await loaded({ animation: 'Idle' })
    player.setSpeedScale(0.5)
    const internal = SsInternalPlayer.last()
    internal.calls.length = 0

    player.setAnimation('Walk')

    expect(internal.names()).toEqual([
      'setupAnimation',
      'setLoopCount',
      'setSpeedScale',
      'setFrameSkipEnabled',
      'setSubFrameEnabled',
      'setPlaybackDirection',
    ])
  })
})

describe('advance', () => {
  // `isFinished` is a state the Brain latches until the next play/setup, so
  // polling it would fire the event on every frame after the end.
  it('fires finished on the rising edge, once per run', async () => {
    const player = await loaded({ animation: 'Walk' })
    const finished = vi.fn()
    player.onAnimationFinished = finished
    const internal = SsInternalPlayer.last()
    player.play()

    player.advance(16)
    expect(finished).not.toHaveBeenCalled()

    internal.isFinished = true
    player.advance(16)
    player.advance(16)
    // How the Brain leaves a run that finished.
    internal.isPlaying = false
    player.advance(16)

    expect(finished.mock.calls).toEqual([['Walk']])
  })

  it('fires looped on every tick that crossed a boundary', async () => {
    const player = await loaded({ animation: 'Walk' })
    const looped = vi.fn()
    player.onAnimationLooped = looped
    player.play()
    SsInternalPlayer.last().justLooped = true

    player.advance(16)
    player.advance(16)

    expect(looped.mock.calls).toEqual([['Walk'], ['Walk']])
  })

  it('does not ask whether it looped when nothing is listening', async () => {
    const player = await loaded()
    player.play()
    const read = vi.fn(() => true)
    Object.defineProperty(SsInternalPlayer.last(), 'justLooped', { get: read })

    player.advance(16)

    expect(read).not.toHaveBeenCalled()
  })

  // Both gates are on the hot path: without them this is a vector allocation and
  // a Nitro array marshal per player per frame, almost always to report nothing.
  it('does not read the event lists when nothing is listening', async () => {
    const player = await loaded()
    SsInternalPlayer.last().passedEventCount = 3

    player.advance(16)

    expect(SsInternalPlayer.last().names()).not.toContain('getUserDataEvents')
  })

  it('does not read them on a frame the Brain says carried no event', async () => {
    const player = await loaded()
    player.onUserData = vi.fn()
    SsInternalPlayer.last().passedEventCount = 0

    player.advance(16)

    expect(SsInternalPlayer.last().names()).not.toContain('getUserDataEvents')
  })

  it('reads only the kinds that have a handler', async () => {
    const player = await loaded()
    player.onAudio = vi.fn()
    player.play()
    SsInternalPlayer.last().passedEventCount = 1

    player.advance(16)

    const calls = SsInternalPlayer.last().names()
    expect(calls).toContain('getAudioEvents')
    expect(calls).not.toContain('getUserDataEvents')
    expect(calls).not.toContain('getSignalEvents')
  })

  it('is a no-op once the player is disposed', async () => {
    const player = await loaded()
    const internal = SsInternalPlayer.last()
    player.dispose()
    internal.calls.length = 0

    player.advance(16)

    expect(internal.names()).not.toContain('advance')
  })

  // As in SSPlayerForWeb: a stopped player builds no frame, steps no effect
  // and fires nothing, so a view of one costs next to nothing.
  it('holds a stopped player where it is, and advances a paused one', async () => {
    const player = await loaded()
    const internal = SsInternalPlayer.last()
    const advances = (): number => internal.names('advance').length

    player.advance(16)
    expect(advances()).toBe(0)

    player.play()
    player.advance(16)
    expect(advances()).toBe(1)

    // A paused player's independent effects and sub-animations keep running.
    player.pause()
    player.advance(16)
    expect(advances()).toBe(2)

    player.stop()
    player.advance(16)
    expect(advances()).toBe(2)
  })

  // A pause moves only the parts that keep their own clock, and only effect
  // and instance parts can — so `playing={false}` on a pack with neither holds
  // like a stop.
  it('holds a paused player that has no effect or instance part', async () => {
    const player = await loaded()
    const internal = SsInternalPlayer.last()
    internal.hasOwnClocks = false
    player.play()
    player.pause()

    player.advance(16)

    expect(internal.names()).not.toContain('advance')
  })
})

describe('needsDraw', () => {
  it('asks for the first draw, and for one after every load', async () => {
    const player = await loaded()
    SsInternalPlayer.last().needsDraw = false
    expect(player.needsDraw).toBe(true)

    player.draw({} as never)
    expect(player.needsDraw).toBe(false)

    await player.load(PACK)
    SsInternalPlayer.last().needsDraw = false
    expect(player.needsDraw).toBe(true)
  })

  it('follows Layer 2 once a frame is drawn', async () => {
    const player = await loaded()
    player.draw({} as never)
    const internal = SsInternalPlayer.last()

    internal.needsDraw = false
    expect(player.needsDraw).toBe(false)
    internal.needsDraw = true
    expect(player.needsDraw).toBe(true)
  })

  // Released: the view has to draw once more, to put down the empty frame.
  it('asks for a draw once the player is released', async () => {
    const player = await loaded()
    player.draw({} as never)
    player.dispose()

    expect(player.needsDraw).toBe(true)
    player.draw({} as never)
    expect(player.needsDraw).toBe(false)
  })
})

describe('advances', () => {
  it('follows Layer 2, and is false before a load and after dispose', async () => {
    const player = new SpriteStudioPlayer()
    expect(player.advances).toBe(false)

    await player.load(PACK)
    expect(player.advances).toBe(false)
    player.play()
    expect(player.advances).toBe(true)

    player.dispose()
    expect(player.advances).toBe(false)
  })
})

describe('frame changes', () => {
  async function watched(): Promise<{ player: SpriteStudioPlayer; changes: () => number }> {
    const player = await loaded()
    SsInternalPlayer.last().parts = ['hat']
    let count = 0
    onFrameChanged(player, () => count++)
    return { player, changes: () => count }
  }

  it('are announced for the transport and for a seek', async () => {
    const { player, changes } = await watched()

    player.play()
    player.pause()
    player.resume()
    player.seek(3)
    player.stop()

    expect(changes()).toBe(5)
  })

  it('are announced for the calls that change the frame without a notification', async () => {
    const { player, changes } = await watched()

    player.setPartOverrides({ hat: { hide: true } })
    player.setSubFrameEnabled(false)
    player.setRootTransform({ x: 1, y: 2, scale: 3, flipX: false, flipY: false })
    player.setTrackAlpha(0, 0.5)

    expect(changes()).toBe(4)
  })

  it('are not announced for a track command that did nothing', async () => {
    const { player, changes } = await watched()
    vi.spyOn(SsInternalPlayer.last(), 'setTrackAlpha').mockReturnValue(false)
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    player.setTrackAlpha(1, 0.5)

    expect(changes()).toBe(0)
  })
})

describe('part overrides', () => {
  async function withParts(): Promise<SpriteStudioPlayer> {
    const player = await loaded()
    SsInternalPlayer.last().parts = ['hat', 'body']
    return player
  }

  // Declarative rather than incremental: a part that has dropped out of the map
  // goes back to the animation.
  it('reverts a part dropped from the map, and leaves the rest alone', async () => {
    const player = await withParts()
    player.setPartOverrides({ hat: { hide: true }, body: { hide: true } })
    const internal = SsInternalPlayer.last()
    internal.calls.length = 0

    player.setPartOverrides({ hat: { hide: true } })

    // Only the part that left the map is reverted; the one still in it is set.
    expect(internal.argsOf('clearPartVisibility')).toEqual([[1]])
    expect(internal.argsOf('setPartVisibility')).toEqual([[0, 1, false]])
  })

  // The Brain rejects the force-show the C ABI reserves, so `false` reverts, as
  // in every sibling Player.
  it('reverts on hide: false rather than force-showing', async () => {
    const player = await withParts()
    player.setPartOverrides({ hat: { hide: true } })
    const internal = SsInternalPlayer.last()
    internal.calls.length = 0

    player.setPartOverrides({ hat: { hide: false } })

    expect(internal.argsOf('clearPartVisibility')).toEqual([[0]])
    expect(internal.names()).not.toContain('setPartVisibility')
  })

  it('hashes a cell override through the Brain, at the family default priority', async () => {
    const player = await withParts()

    player.setPartOverrides({ hat: { cell: { cellmap: 'common', cell: 'face' } } })

    expect(SsInternalPlayer.last().argsOf('setPartCell')).toEqual([
      [
        0,
        SsRuntimeModule.hashString('common'),
        SsRuntimeModule.hashString('face'),
        SsOverridePriority.holdUntilNextAnimation,
      ],
    ])
  })

  it('warns about a part the animation does not have, and skips it', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const player = await withParts()

    player.setPartOverrides({ ghost: { hide: true } })

    expect(warn.mock.calls[0]?.[0]).toMatch(/no part called 'ghost'/)
    expect(SsInternalPlayer.last().names()).not.toContain('setPartVisibility')
  })

  // `setupAnimation` resets the override layer along with everything else, so a
  // prop that survives a source change has to survive a switch too.
  it('replays the map after a switch', async () => {
    const player = await withParts()
    player.setPartOverrides({ hat: { hide: true } })
    const internal = SsInternalPlayer.last()
    internal.calls.length = 0

    player.setAnimation('Walk')

    expect(internal.argsOf('setPartVisibility')).toEqual([[0, 1, false]])
  })
})

describe('the content box', () => {
  // A fit would divide by it, so nothing measured is null rather than a zero box.
  it('stays null when nothing drew', async () => {
    definePack(PACK, {
      animations: ['Idle', 'Walk'],
      contentBox: { x: 0, y: 0, width: 0, height: 0 },
    })

    const player = await loaded({ measure: { scope: 'animation' } })

    expect(player.contentBox).toBeNull()
  })

  // Each measurement is a bake of every frame it walks, and the switch that
  // follows the load's own measurement is to the animation just measured.
  it('measures an animation-scoped box once on a load', async () => {
    await loaded({ animation: 'Idle', measure: { scope: 'animation' } })

    expect(SsInternalPlayer.last().argsOf('measureContentBox')).toEqual([[['Idle'], 0]])
  })

  it('drops the last pack’s box on a load that measures nothing', async () => {
    const player = await loaded({ measure: { scope: 'pack' } })
    expect(player.contentBox).not.toBeNull()

    await player.load(PACK)

    expect(player.contentBox).toBeNull()
  })

  it('re-measures an animation-scoped box on a switch', async () => {
    const player = await loaded({ animation: 'Idle', measure: { scope: 'animation' } })
    const internal = SsInternalPlayer.last()
    internal.calls.length = 0

    player.setAnimation('Walk')

    expect(internal.argsOf('measureContentBox')).toEqual([[['Walk'], 0]])
  })

  // The union over the whole file does not change — which is the point of asking
  // for it.
  it('leaves a pack-scoped box alone on a switch', async () => {
    const player = await loaded({ animation: 'Idle', measure: { scope: 'pack' } })
    const internal = SsInternalPlayer.last()
    internal.calls.length = 0

    player.setAnimation('Walk')

    expect(internal.names()).not.toContain('measureContentBox')
  })
})

describe('before a load', () => {
  // Layer 4 builds a player and renders against it a commit before the load
  // lands, so every reader has to answer rather than throw.
  it('answers every reader with a default', () => {
    const player = new SpriteStudioPlayer()

    expect(player.isLoaded).toBe(false)
    expect(player.currentAnimation).toBeNull()
    expect(player.frameNo).toBe(0)
    expect(player.isPlaying).toBe(false)
    expect(player.isPausing).toBe(false)
    expect(player.isPlayingForward).toBe(true)
    expect(player.partCount).toBe(0)
    expect(player.totalFrames).toBe(0)
    expect(player.contentBox).toBeNull()
    expect(player.getAnimationNames()).toEqual([])
    expect(player.partNames()).toEqual([])
    expect(player.cellmapNames()).toEqual([])
    expect(player.cellNames('common')).toEqual([])
    expect(player.findPartIndex('hat')).toBe(-1)
    expect(player.isPartHidden('hat')).toBe(false)
    expect(player.isPartSkinnedMesh('hat')).toBe(false)
  })

  it('takes every transport verb and does nothing with it', () => {
    const player = new SpriteStudioPlayer()

    expect(() => {
      player.play()
      player.pause()
      player.resume()
      player.stop()
      player.seek(4)
      player.advance(16)
      player.setAnimationSection(0, 10)
    }).not.toThrow()
  })
})

describe('the part read-outs', () => {
  // What turns the `partIndex` on an event back into something a human reads,
  // and what fills a part picker.
  it('report the animation’s parts and cells', async () => {
    const player = await loaded()
    const internal = SsInternalPlayer.last()
    internal.parts = ['root', 'hat']
    internal.cellmaps = { common: ['face', 'body'] }
    internal.hiddenParts.add(1)
    internal.skinnedParts.add(0)

    expect(player.partNames()).toEqual(['root', 'hat'])
    expect(player.partCount).toBe(2)
    expect(player.cellmapNames()).toEqual(['common'])
    expect(player.cellNames('common')).toEqual(['face', 'body'])
    expect(player.findPartIndex('hat')).toBe(1)
    expect(player.isPartHidden('hat')).toBe(true)
    // Drawn from its bones, so a follower on it would sit near the root.
    expect(player.isPartSkinnedMesh('root')).toBe(true)
  })
})

describe('getPartTransform', () => {
  it('is null for a name the animation does not have', async () => {
    const player = await loaded()
    expect(player.getPartTransform('ghost')).toBeNull()
  })

  // A part with no matrix — before the first `advance`, or one the bake skipped.
  it('is null for a part the frame has no matrix for', async () => {
    const player = await loaded()
    SsInternalPlayer.last().parts = ['hat']
    expect(player.getPartTransform('hat')).toBeNull()
  })

  // A follower reads its part by name every frame; resolving the name is a
  // string across JSI and a scan of the part names.
  it('resolves a part name once per animation', async () => {
    const player = await loaded()
    const internal = SsInternalPlayer.last()
    internal.parts = ['hat']
    const resolves = (): number => internal.names('findPartIndex').length

    player.getPartTransform('hat')
    player.getPartTransform('hat')
    player.isPartHidden('hat')
    expect(resolves()).toBe(1)

    player.setAnimation('Walk')
    player.getPartTransform('hat')
    expect(resolves()).toBe(2)
  })
})

describe('dispose', () => {
  it('gives back the pack, the mounted packs and the atlas leases', async () => {
    definePack('ss/overall/Child.ssab')
    definePack(PACK, {
      animations: ['Idle'],
      textures: [embeddedTexture('common')],
    })
    loadInstancePacks.mockResolvedValueOnce([
      { resource: openPack('ss/overall/Child.ssab'), uri: 'ss/overall/Child.ssab' },
    ])
    const player = await loaded()
    expect(ssImageCache.size).toBe(1)

    player.dispose()

    expect(releaseResource.mock.calls.map(([uri]) => uri)).toEqual([
      PACK,
      'ss/overall/Child.ssab',
    ])
    expect(ssImageCache.size).toBe(0)
  })

  // Left encoded, an atlas decodes the first time a canvas draws it, on the UI
  // thread. Every atlas a load registers has been through the worker first.
  it('decodes each atlas off the UI thread before registering it', async () => {
    definePack(PACK, { animations: ['Idle'], textures: [embeddedTexture('common')] })
    const player = await loaded()
    const registry = player.textures as unknown as SsTextureRegistry
    const bound = registry.bound(SsRuntimeModule.hashString('common'))

    expect(bound).toBeDefined()
    expect(SsRuntimeModule.decoded).toEqual([bound])
  })

  // `texture_hash` is the hash of a *cellmap name*, so a second pack naming a
  // cellmap the same thing kept drawing with the first pack's atlas.
  it('takes its own registry entries back out', async () => {
    definePack(PACK, { animations: ['Idle'], textures: [embeddedTexture('common')] })
    const player = await loaded()
    const registry = player.textures as unknown as SsTextureRegistry

    expect(registry.size).toBe(1)
    player.dispose()

    expect(registry.size).toBe(0)
    expect(registry.disposed).toBe(true)
  })

  // A shared registry may be feeding other players, whose entries are not this
  // player's to drop.
  it('leaves a registry it was handed alone', async () => {
    definePack(PACK, { animations: ['Idle'], textures: [embeddedTexture('common')] })
    const shared = new SsTextureRegistry()
    const player = new SpriteStudioPlayer({
      textures: shared as unknown as RealTextureRegistry,
    })
    await player.load(PACK)

    player.dispose()

    expect(shared.disposed).toBe(false)
    expect(shared.size).toBe(1)
  })

  it('is idempotent', async () => {
    const player = await loaded()
    player.dispose()
    player.dispose()
    expect(releaseResource).toHaveBeenCalledOnce()
  })
})

describe('an Embedded pack’s atlases', () => {
  // The bytes cross JSI as a copy, which a second player of the pack has no use
  // for while the first one's decode is in the cache.
  it('are copied only when the cache does not hold the decode', async () => {
    definePack(PACK, { animations: ['Idle'], textures: [embeddedTexture('common')] })
    await loaded()
    await loaded()

    expect(SsInternalPlayer.created.map((p) => p.argsOf('copyEmbeddedTexture'))).toEqual([
      [[SsRuntimeModule.hashString('common')]],
      [],
    ])
  })
})

describe('a load that replaces one still decoding', () => {
  // Both loads name the same atlases, so the live one skips whatever the
  // replaced pass has already registered. Losing one of those is silent: the
  // report says nothing is missing.
  it('keeps every atlas the live load needs, and the leases balance', async () => {
    const body = embeddedTexture('body')
    const face = embeddedTexture('face')
    definePack(PACK, { animations: ['Idle'], textures: [body, face] })
    const decode = SsRuntimeModule.decodeImage
    let finishFace: (() => void) | null = null
    vi.spyOn(SsRuntimeModule, 'decodeImage')
      .mockImplementationOnce(decode)
      .mockImplementationOnce(async (image) => {
        await new Promise<void>((resolve) => (finishFace = resolve))
        return decode(image)
      })

    const player = new SpriteStudioPlayer()
    const first = player.load(PACK)
    await vi.waitFor(() => expect(finishFace).not.toBeNull())
    const second = player.load(PACK)
    await vi.waitFor(() => expect(SsInternalPlayer.created).toHaveLength(2))
    finishFace!()
    await first
    await second

    const registry = player.textures as unknown as SsTextureRegistry
    expect(registry.has(body.textureHash)).toBe(true)
    expect(registry.has(face.textureHash)).toBe(true)
    expect([...(player.lastTextureReport?.registered ?? [])].sort()).toEqual(
      [body.textureHash, face.textureHash].sort()
    )
    expect(ssImageCache.size).toBe(2)

    player.dispose()
    expect(ssImageCache.size).toBe(0)
  })
})

describe('the texture report', () => {
  // A missing texture is otherwise silent: `drawInto` skips a batch it has no
  // paint for, so the symptom is a part that is simply not there.
  it('warns in dev about what the pack could not resolve', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(skiaDecode, 'image').mockReturnValue(null)
    definePack(PACK, {
      animations: ['Idle'],
      textures: [embeddedTexture('common', 'atlas.png')],
    })

    const player = await loaded()

    expect(warn.mock.calls[0]?.[0]).toMatch(/Missing: atlas.png/)
    expect(player.lastTextureReport?.unresolved).toEqual(['atlas.png'])
  })

  it('says nothing when everything resolved', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    definePack(PACK, { animations: ['Idle'], textures: [embeddedTexture('common')] })

    const player = await loaded()

    expect(warn).not.toHaveBeenCalled()
    expect(player.lastTextureReport?.unresolved).toEqual([])
  })
})

describe('runtime texture replacement', () => {
  /** A stand-in for a decoded atlas — the registry only ever holds the reference. */
  const fakeImage = (tag: string): SkImage => ({ tag }) as unknown as SkImage

  /** The fake registry's entry for a texture name, or undefined. */
  function boundImage(player: SpriteStudioPlayer, name: string): unknown {
    const registry = player.textures as unknown as SsTextureRegistry
    return registry.bound(SsRuntimeModule.hashString(name))
  }

  it('binds a replacement over the pack atlas', async () => {
    definePack(PACK, { animations: ['Idle'], textures: [embeddedTexture('common')] })
    const player = await loaded()
    const face = fakeImage('face')

    expect(player.setCellmapTexture('common', face)).toBe(true)

    expect(player.getCellmapTexture('common')).toBe(face)
    expect(boundImage(player, 'common')).toBe(face)
    const registry = player.textures as unknown as SsTextureRegistry
    expect(registry.isOverridden(SsRuntimeModule.hashString('common'))).toBe(true)
  })

  it('restores the pack atlas when handed null', async () => {
    definePack(PACK, { animations: ['Idle'], textures: [embeddedTexture('common')] })
    const player = await loaded()
    const original = boundImage(player, 'common')
    player.setCellmapTexture('common', fakeImage('face'))

    expect(player.setCellmapTexture('common', null)).toBe(true)

    expect(player.getCellmapTexture('common')).toBeNull()
    // Back to exactly what the loader had put in, not merely cleared.
    expect(boundImage(player, 'common')).toBe(original)
    const registry = player.textures as unknown as SsTextureRegistry
    expect(registry.isOverridden(SsRuntimeModule.hashString('common'))).toBe(false)
  })

  it('rejects a name the loaded pack has no texture for', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    definePack(PACK, { animations: ['Idle'], textures: [embeddedTexture('common')] })
    const player = await loaded()

    expect(player.setCellmapTexture('missing', fakeImage('x'))).toBe(false)

    expect(player.getCellmapTexture('missing')).toBeNull()
    expect(warn.mock.calls[0]?.[0]).toMatch(/no replaceable texture called 'missing'/)
  })

  it('lists cellmaps and external textures as replaceable', async () => {
    definePack(PACK, {
      animations: ['Idle'],
      // A cellmap and the file name a TextureChange points at — different hash
      // spaces, both legitimately replaceable.
      textures: [embeddedTexture('common'), embeddedTexture('common.png')],
    })
    const player = await loaded()

    expect(player.getReplaceableTextureNames()).toEqual(['common', 'common.png'])
    // An external-texture file name is a valid target too.
    expect(player.setCellmapTexture('common.png', fakeImage('costume'))).toBe(true)
    expect(player.getCellmapTexture('common.png')).toBeTruthy()
  })

  it('re-keys an override onto the pack after a source change', async () => {
    const OTHER = 'ss/overall/Other.ssab'
    definePack(PACK, { animations: ['Idle'], textures: [embeddedTexture('common')] })
    definePack(OTHER, { animations: ['Idle'], textures: [embeddedTexture('common')] })
    const player = await loaded()
    const face = fakeImage('face')
    player.setCellmapTexture('common', face)

    await player.load(OTHER)

    // The override followed onto the new pack's own `common`, replayed by name.
    expect(player.getCellmapTexture('common')).toBe(face)
    expect(boundImage(player, 'common')).toBe(face)
  })

  it('applies an override set before the pack has loaded', async () => {
    definePack(PACK, { animations: ['Idle'], textures: [embeddedTexture('common')] })
    const player = new SpriteStudioPlayer()
    const face = fakeImage('face')

    // No resource yet: recorded, and made to win over the pack atlas the load
    // is about to register.
    player.setCellmapTexture('common', face)
    await player.load(PACK)

    expect(player.getCellmapTexture('common')).toBe(face)
    expect(boundImage(player, 'common')).toBe(face)
    player.dispose()
  })

  it('takes its overrides off a shared registry on dispose', async () => {
    definePack(PACK, { animations: ['Idle'], textures: [embeddedTexture('common')] })
    const shared = new SsTextureRegistry()
    const player = new SpriteStudioPlayer({
      textures: shared as unknown as RealTextureRegistry,
    })
    await player.load(PACK)
    const original = shared.bound(SsRuntimeModule.hashString('common'))
    player.setCellmapTexture('common', fakeImage('face'))

    player.dispose()

    // The shared registry survives, its `common` is back to the pack atlas, and
    // the override is gone — a sibling sharing it must not inherit this swap.
    expect(shared.disposed).toBe(false)
    expect(shared.isOverridden(SsRuntimeModule.hashString('common'))).toBe(false)
    expect(shared.bound(SsRuntimeModule.hashString('common'))).toBe(original)
  })
})

describe('the frames a player shows', () => {
  // What a part follower reads on: a frame is new when it is drawn.
  it('run after each draw, and not on an advance alone', async () => {
    const player = await loaded()
    let frames = 0
    const unsubscribe = onFrameShown(player, () => {
      frames += 1
    })

    player.advance(16)
    expect(frames).toBe(0)
    player.draw({} as never)
    expect(frames).toBe(1)

    unsubscribe()
    player.draw({} as never)
    expect(frames).toBe(1)
  })

  // Released, the view draws once more to put down the empty frame — and a
  // follower has to hear that its part is gone.
  it('run after the draw that follows a release', async () => {
    const player = await loaded()
    let frames = 0
    onFrameShown(player, () => {
      frames += 1
    })
    player.dispose()

    player.draw({} as never)

    expect(frames).toBe(1)
  })

  // Nothing draws a player on its own clock, so the step is the frame.
  it('run after each step of the fallback clock', async () => {
    const player = await loaded()
    let frames = 0
    onFrameShown(player, () => {
      frames += 1
    })
    player.startClock()

    stepFrame(16)
    stepFrame(16)

    expect(frames).toBe(2)
    player.stopClock()
  })
})

describe('the fallback clock', () => {
  // Only for a player with no view attached — `<SpriteStudioView>` clocks its own.
  it('advances off requestAnimationFrame, capped so a backgrounded app does not fast-forward', async () => {
    const player = await loaded()
    player.play()
    player.startClock()

    stepFrame(16)
    stepFrame(5000)

    expect(SsInternalPlayer.last().argsOf('advance')).toEqual([[16], [MAX_STEP_MS]])
  })

  it('stops, and stops with the player', async () => {
    const player = await loaded()
    player.startClock()
    stepFrame(16)
    expect(pendingFrames()).toBe(1)

    player.stopClock()
    expect(pendingFrames()).toBe(0)

    player.startClock()
    stepFrame(16)
    player.dispose()
    expect(pendingFrames()).toBe(0)
  })
})

describe('animation mixing: switching track 0', () => {
  // The Brain hands track 0 over when the crossfade begins, so the player has
  // to as well — left on the outgoing name, everything keyed on it lied.
  it('names the incoming animation from the crossfade call on', async () => {
    const player = await loaded({ animation: 'Idle' })
    const changed = vi.fn()
    const started = vi.fn()
    player.onAnimationChanged = changed
    player.onAnimationStarted = started

    expect(player.crossfade(0, 'Walk', 300)).toBe(true)

    expect(player.currentAnimation).toBe('Walk')
    expect(changed.mock.calls).toEqual([['Walk']])
    // A switch that keeps playing is not a `play()`.
    expect(started).not.toHaveBeenCalled()
  })

  // ForGodot's A-2, where this started: `setAnimation` compared against the
  // outgoing name, took the call for a re-selection and did nothing.
  it('can go back to the animation a crossfade left', async () => {
    const player = await loaded({ animation: 'Idle' })
    player.crossfade(0, 'Walk', 300)
    const internal = SsInternalPlayer.last()
    internal.calls.length = 0

    expect(player.setAnimation('Idle')).toBe(true)

    expect(internal.names()).toContain('setupAnimation')
    expect(player.currentAnimation).toBe('Idle')
  })

  // "Walk is already chosen" — the fade runs on.
  it('leaves a fade alone when its incoming animation is selected again', async () => {
    const player = await loaded({ animation: 'Idle' })
    player.crossfade(0, 'Walk', 300)
    const internal = SsInternalPlayer.last()
    internal.calls.length = 0

    expect(player.setAnimation('Walk')).toBe(true)
    expect(internal.calls).toEqual([])
  })

  it('switches on a track-0 setTrackAnimation too, but not on another track', async () => {
    const player = await loaded({ animation: 'Idle' })

    player.setTrackAnimation(1, 'Walk')
    expect(player.currentAnimation).toBe('Idle')

    player.setTrackAnimation(0, 'Walk')
    expect(player.currentAnimation).toBe('Walk')
  })

  // The Brain lays every animation looping forever; the host's count is the
  // player's to put back, after each switch of track 0.
  it('puts the loop count back on the incoming animation', async () => {
    const player = await loaded({ animation: 'Idle' })
    player.setLoopCount(2)
    const internal = SsInternalPlayer.last()
    internal.calls.length = 0

    player.crossfade(0, 'Walk', 300)
    player.setTrackAnimation(0, 'Idle')
    player.setTrackAnimation(1, 'Walk')

    expect(internal.argsOf('setLoopCount')).toEqual([[2], [2]])
  })

  it('reports the incoming animation finishing after the outgoing one had', async () => {
    const player = await loaded({ animation: 'Idle' })
    const finished = vi.fn()
    player.onAnimationFinished = finished
    const internal = SsInternalPlayer.last()
    player.play()
    internal.isFinished = true
    player.advance(16)

    player.crossfade(0, 'Walk', 300)
    internal.isFinished = false
    player.advance(16)
    internal.isFinished = true
    player.advance(16)

    expect(finished.mock.calls).toEqual([['Idle'], ['Walk']])
  })

  // No fade on a refusal, and nothing renamed.
  it('keeps the name when the crossfade is refused', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const player = await loaded({ animation: 'Idle' })

    expect(player.crossfade(0, 'Typo', 300)).toBe(false)
    expect(player.currentAnimation).toBe('Idle')
  })
})

describe('animation mixing: track 0 settings under their track names', () => {
  // The track forms are the same settings, so the player's own record has to
  // move with them — it is what a reload replays.
  it('keeps what the track-0 forms set, for the next load to replay', async () => {
    const player = await loaded()
    player.setTrackSpeed(0, 2)
    player.setTrackLoopCount(0, 3)
    player.setTrackFrameSkipEnabled(0, false)
    player.setTrackFrameRate(0, 24)
    player.setTrackPlaybackDirection(0, SsPlaybackDirection.backward, SsPlaybackStyle.pingPong)

    await player.load(PACK)

    const internal = SsInternalPlayer.last()
    expect(internal.speedScale).toBe(2)
    expect(internal.loopCount).toBe(3)
    expect(internal.frameSkipEnabled).toBe(false)
    expect(internal.frameRate).toBe(24)
    expect(internal.playbackDirection).toBe(SsPlaybackDirection.backward)
    expect(internal.playbackStyle).toBe(SsPlaybackStyle.pingPong)
  })

  it('puts a loop count set through the track form back after a crossfade', async () => {
    const player = await loaded({ animation: 'Idle' })
    player.setTrackLoopCount(0, 1)
    const internal = SsInternalPlayer.last()
    internal.calls.length = 0

    player.crossfade(0, 'Walk', 300)

    expect(internal.argsOf('setLoopCount')).toEqual([[1]])
  })

  // Accepted before a load, the same as `setSpeedScale`: it is a setting the
  // player keeps, not a command against a track that does not exist yet.
  it('accepts the track-0 forms before a load', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const player = new SpriteStudioPlayer()

    expect(player.setTrackSpeed(0, 2)).toBe(true)
    expect(player.trackSpeed(0)).toBe(2)
    expect(warn).not.toHaveBeenCalled()
  })
})

describe('animation mixing: reporting', () => {
  // A command that did nothing shows up as an animation that "will not blend";
  // the bool alone is one nobody has to read.
  it('says why a track command did nothing, naming the call and the pack', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const player = await loaded()

    expect(player.setTrackAnimation(1, 'Typo')).toBe(false)

    const line = String(warn.mock.calls[0]?.[0])
    expect(line).toContain("setTrackAnimation(1, 'Typo')")
    expect(line).toContain(PACK)
    expect(line).toContain('Animation not found')
  })

  // A state machine repeats its commands every frame.
  it('says it once per call and target, and a second target on its own line', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const player = await loaded()

    player.crossfade(1, 'Typo', 300)
    player.crossfade(1, 'Typo', 300)
    expect(warn).toHaveBeenCalledOnce()

    player.crossfade(1, 'Other typo', 300)
    expect(warn).toHaveBeenCalledTimes(2)
  })

  // Keyed on the target, not the value: a slider dragging a refused alpha.
  it('does not say it again for each new value', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const player = await loaded()

    player.setTrackAlpha(5, 0.1)
    player.setTrackAlpha(5, 0.2)

    expect(warn).toHaveBeenCalledOnce()
  })

  it('refuses a track no index can be', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const player = await loaded()

    expect(player.setTrackAlpha(-1, 0.5)).toBe(false)
    expect(SsInternalPlayer.last().names()).not.toContain('setTrackAlpha')
    expect(warn).toHaveBeenCalledOnce()
  })

  it('refuses a track command before a load, and says so', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const player = new SpriteStudioPlayer()

    expect(player.setTrackAnimation(1, 'Walk')).toBe(false)
    expect(String(warn.mock.calls[0]?.[0])).toContain('no pack is loaded')
  })

  // A lookup may fail quietly.
  it('reads nothing there as null, without a word', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const player = await loaded()

    expect(player.trackAlpha(3)).toBeNull()
    expect(player.trackBlend(3)).toBeNull()
    expect(player.trackFadeProgress(0)).toBeNull()
    expect(player.trackLoopCount(3)).toBeNull()
    expect(player.trackMainSource(3)).toBeNull()
    expect(player.trackFrameSkipEnabled(3)).toBeNull()
    expect(player.sourceWeight(7)).toBeNull()
    expect(warn).not.toHaveBeenCalled()
  })

  it('hands back the handle of an added source, or null', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const player = await loaded()

    expect(player.addTrackSource(1, 'Walk', 0.5)).toBe(101)
    expect(player.addTrackSource(1, 'Typo')).toBeNull()
  })
})

describe('animation mixing: the loop pulses', () => {
  // The Brain's pulses stand until its next update, so a tick that did not
  // reach it would report the previous tick's loop again.
  it('reports no loop for a tick that did not run', async () => {
    const player = await loaded({ animation: 'Walk' })
    const internal = SsInternalPlayer.last()
    player.play()
    internal.justLooped = true
    internal.loopedTracks.add(1)

    player.advance(16)
    expect(player.justLooped).toBe(true)
    expect(player.trackJustLooped(1)).toBe(true)

    // Nothing moves — Layer 1's `advances` said so — and no update ran.
    internal.isPlaying = false
    player.advance(16)
    expect(player.justLooped).toBe(false)
    expect(player.trackJustLooped(1)).toBe(false)
  })
})
