import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ssClearCaches } from '../src/core/caches'
import { ssCheckForLeaks, ssLiveHandles } from '../src/player/leakCheck'
import { preloadResource } from '../src/player/source'
import type { SsTextureInfo } from '../src/specs/SsRuntime.nitro'
import { SsInternalPlayer } from './support/fakeInternalPlayer'
import { SsRuntimeModule, definePack, live, openPack, resetFakeRuntime } from './support/fakeRuntime'
import { SsTextureRegistry } from './support/fakeTextureRegistry'

// `player/source` is deliberately **not** mocked here: the leases and the cache
// are what this check is about, so a fake of them would leave it measuring
// itself. Only the three modules that reach the device are stubbed.
vi.mock('../src/runtime', () => import('./support/fakeRuntime'))
vi.mock('../src/core/SsInternalPlayer', () => import('./support/fakeInternalPlayer'))
vi.mock('../src/core/SsTextureRegistry', () => import('./support/fakeTextureRegistry'))

const PACK = 'ss/overall/Basic.ssab'

const embedded = (name: string): SsTextureInfo => ({
  textureHash: SsRuntimeModule.hashString(name),
  name,
  imagePath: '',
  embeddedLength: 3,
})

beforeEach(() => {
  resetFakeRuntime()
  SsInternalPlayer.reset()
  SsTextureRegistry.reset()
  definePack(PACK, { animations: ['Idle'], textures: [embedded('common')] })
})

afterEach(ssClearCaches)

describe('ssLiveHandles', () => {
  // The point of the value is comparing two readings, so one that aliased native
  // state would compare equal to itself forever.
  it('is a copy, not a window onto the Brain', () => {
    const before = ssLiveHandles()
    openPack(PACK)

    expect(before.resources).toBe(0)
    expect(ssLiveHandles().resources).toBe(1)
  })
})

describe('ssCheckForLeaks', () => {
  it('comes back level on a player that gives everything back', async () => {
    const result = await ssCheckForLeaks(PACK, { cycles: 3 })

    expect(result.leaked).toBe(false)
    expect(result.after).toEqual({ resources: 0, contexts: 0 })
    expect(result.cycles).toBe(3)
  })

  // A cache holding a pack is indistinguishable from a leaked handle when the
  // measurement is a count of live ones — so the baseline is taken after a drain.
  it('drains the caches first, so a warm pack is not read as a leak', async () => {
    await preloadResource(PACK)
    expect(ssLiveHandles().resources).toBe(1)

    const result = await ssCheckForLeaks(PACK, { cycles: 2 })

    expect(result.before.resources).toBe(0)
    expect(result.leaked).toBe(false)
  })

  it('reports a context that never came back', async () => {
    vi.spyOn(SsInternalPlayer.prototype, 'dispose').mockImplementation(() => {})

    const result = await ssCheckForLeaks(PACK, { cycles: 2 })

    expect(result.leaked).toBe(true)
    expect(result.after.contexts).toBeGreaterThan(result.before.contexts)
  })

  // Growth rather than inequality: an app is free to be tearing something else
  // down while this runs, and a count that *fell* is not this player's failure.
  it('does not call a count that fell a leak', async () => {
    const stray = openPack(PACK)
    vi.spyOn(SsRuntimeModule, 'createResourceFromAsset').mockImplementationOnce((path) => {
      stray.dispose()
      return openPack(path)
    })

    const result = await ssCheckForLeaks(PACK, { cycles: 1 })

    expect(result.before.resources).toBe(1)
    expect(result.after.resources).toBe(0)
    expect(result.leaked).toBe(false)
  })

  // The `finally` is the whole point: a load that throws half-way is exactly the
  // case where a leak would otherwise go unnoticed.
  it('tears down a player whose load threw half-way', async () => {
    vi.spyOn(SsInternalPlayer.prototype, 'setupAnimation').mockImplementation(() => {
      throw new Error('bang')
    })

    await expect(ssCheckForLeaks(PACK, { cycles: 1 })).rejects.toThrow('bang')

    expect(live.contexts.size).toBe(0)
    expect(live.resources.size).toBe(0)
  })

  // The other way a reload leaks, and the one `liveHandles` cannot see: one
  // player loaded over and over, its registry growing by a binding per load.
  it('watches one player’s registry across repeated loads', async () => {
    const result = await ssCheckForLeaks(PACK, { cycles: 4 })

    expect(result.texturesAfterFirstLoad).toBe(1)
    expect(result.texturesAfterReloads).toBe(1)
    expect(result.registryLeaked).toBe(false)
  })

  it('reports a registry that grew', async () => {
    vi.spyOn(SsTextureRegistry.prototype, 'unregister').mockReturnValue(false)
    // A different cellmap name per load, so the entries stack rather than
    // overwriting one another.
    let load = 0
    vi.spyOn(SsInternalPlayer.prototype, 'getTextures').mockImplementation(() => [
      embedded(`common${load++}`),
    ])

    const result = await ssCheckForLeaks(PACK, { cycles: 3 })

    expect(result.registryLeaked).toBe(true)
  })
})
