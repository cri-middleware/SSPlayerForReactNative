import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SkImage } from '@shopify/react-native-skia'

import { ssClearCaches, ssImageCache } from '../src/core/caches'
import { SsOverridePriority } from '../src/core/parts'
import { SsPlaybackDirection, SsPlaybackStyle } from '../src/core/types'
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
    wrapMode: 0,
    embedded: new Uint8Array(imagePath === '' ? [1, 2, 3] : []).buffer as ArrayBuffer,
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

    player.setAnimationSection(10, 20)

    expect(SsInternalPlayer.last().argsOf('setSection')).toEqual([[10, 20]])
    expect(player.startFrame).toBe(10)
    expect(player.endFrame).toBe(20)
    // Both ends inclusive — feed it to a scrubber.
    expect(player.totalFrames).toBe(11)
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

    player.advance(16)
    expect(finished).not.toHaveBeenCalled()

    internal.isFinished = true
    player.advance(16)
    player.advance(16)

    expect(finished.mock.calls).toEqual([['Walk']])
  })

  it('fires looped on every tick that crossed a boundary', async () => {
    const player = await loaded({ animation: 'Walk' })
    const looped = vi.fn()
    player.onAnimationLooped = looped
    SsInternalPlayer.last().justLooped = true

    player.advance(16)
    player.advance(16)

    expect(looped.mock.calls).toEqual([['Walk'], ['Walk']])
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

  // The tri-state the C ABI keeps: 1 force-hides, 2 force-shows, absent reverts.
  it('force-shows on hide: false rather than reverting', async () => {
    const player = await withParts()

    player.setPartOverrides({ hat: { hide: false } })

    expect(SsInternalPlayer.last().argsOf('setPartVisibility')).toEqual([[0, 2, false]])
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

describe('the fallback clock', () => {
  // Only for a player with no view attached — `<SpriteStudioView>` clocks its own.
  it('advances off requestAnimationFrame, capped so a backgrounded app does not fast-forward', async () => {
    const player = await loaded()
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
