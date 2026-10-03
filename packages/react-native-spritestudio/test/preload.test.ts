import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ssClearCaches, ssImageCache } from '../src/core/caches'
import { ssPreload, ssPreloadedSources, ssUnload } from '../src/player/preload'
import type { SsTextureInfo } from '../src/specs/SsRuntime.nitro'
import { SsInternalPlayer } from './support/fakeInternalPlayer'
import { SsRuntimeModule, definePack, resetFakeRuntime } from './support/fakeRuntime'
import { loadResource, preloadResource, resetFakeSource, unloadResource } from './support/fakeSource'
import { SsTextureRegistry } from './support/fakeTextureRegistry'

vi.mock('../src/runtime', () => import('./support/fakeRuntime'))
vi.mock('../src/core/SsInternalPlayer', () => import('./support/fakeInternalPlayer'))
vi.mock('../src/core/SsTextureRegistry', () => import('./support/fakeTextureRegistry'))
vi.mock('../src/player/source', () => import('./support/fakeSource'))

const PACK = 'ss/overall/Basic.ssab'

/** One atlas carried inside the pack, so warming it needs no fetch. */
const embedded = (name: string): SsTextureInfo => ({
  textureHash: SsRuntimeModule.hashString(name),
  name,
  imagePath: '',
  wrapMode: 0,
  embedded: new Uint8Array([1, 2, 3]).buffer as ArrayBuffer,
})

beforeEach(() => {
  resetFakeRuntime()
  resetFakeSource()
  SsInternalPlayer.reset()
  SsTextureRegistry.reset()
  definePack(PACK, { animations: ['Idle'], textures: [embedded('common')] })
})

// `preloaded` is a module singleton, so an unbalanced preload would follow the
// next test in as a cache hit it never asked for.
afterEach(() => {
  for (const uri of ssPreloadedSources()) ssUnload(uri)
  ssClearCaches()
})

describe('ssPreload', () => {
  // The texture list is read out of the `.ssab` by a context, which is a player,
  // so warming the atlases means loading one and throwing it away.
  it('keeps the atlases the throwaway player decoded', async () => {
    await ssPreload(PACK)

    expect(ssImageCache.size).toBe(1)
    expect(ssPreloadedSources()).toEqual([PACK])
  })

  it('does the work once however many times it is asked', async () => {
    await ssPreload(PACK)
    await ssPreload({ uri: PACK })

    expect(loadResource).toHaveBeenCalledOnce()
  })

  // Claimed before the first await, so two screens preloading one pack at once
  // do not both run the throwaway player.
  it('runs one throwaway player for two callers at once', async () => {
    await Promise.all([ssPreload(PACK), ssPreload(PACK)])

    expect(loadResource).toHaveBeenCalledOnce()
  })

  it('rolls the claim back when the pack will not load, and rethrows', async () => {
    preloadResource.mockRejectedValueOnce(new Error('no such pack'))

    await expect(ssPreload(PACK)).rejects.toThrow('no such pack')

    expect(ssPreloadedSources()).toEqual([])
    expect(unloadResource).toHaveBeenCalledWith(PACK)
  })

  it('can be retried after that failure', async () => {
    preloadResource.mockRejectedValueOnce(new Error('offline'))
    await expect(ssPreload(PACK)).rejects.toThrow()

    await ssPreload(PACK)

    expect(ssPreloadedSources()).toEqual([PACK])
  })
})

describe('ssUnload', () => {
  it('gives back exactly what the preload retained', async () => {
    await ssPreload(PACK)

    ssUnload(PACK)

    expect(ssImageCache.size).toBe(0)
    expect(ssPreloadedSources()).toEqual([])
    expect(unloadResource).toHaveBeenCalledWith(PACK)
  })

  // Two packs naming one sibling image lease one atlas entry, and each retains it.
  it('leaves an atlas another preloaded pack shares', async () => {
    const OTHER = 'ss/overall/Other.ssab'
    const sibling: SsTextureInfo = { ...embedded('common'), imagePath: 'common.png', embedded: new ArrayBuffer(0) }
    definePack(PACK, { animations: ['Idle'], textures: [sibling] })
    definePack(OTHER, { animations: ['Idle'], textures: [sibling] })
    await ssPreload(PACK)
    await ssPreload(OTHER)
    expect(ssImageCache.size).toBe(1)

    ssUnload(PACK)
    expect(ssImageCache.size).toBe(1)

    ssUnload(OTHER)
    expect(ssImageCache.size).toBe(0)
  })

  it('is a no-op for a source nothing preloaded', () => {
    ssUnload('ss/never.ssab')
    expect(unloadResource).not.toHaveBeenCalled()
  })
})
