import { afterEach, describe, expect, it, vi } from 'vitest'

import { ssClearCaches, ssImageCache, ssResourceCache } from '../src/core/caches'
import type { SsResource } from '../src/specs/SsRuntime.nitro'

// Module singletons, so every test starts from empty and leaves them empty.
afterEach(() => ssClearCaches())

/** Only `dispose` is reached from here; the rest of `SsResource` is Nitro's. */
const fakeResource = () =>
  ({ dispose: vi.fn() }) as unknown as SsResource & { dispose: ReturnType<typeof vi.fn> }

describe('ssResourceCache', () => {
  // What keeps `SsRuntime.liveHandles` exact: the pack is handed back to the
  // Brain on the last release rather than held for a later hit.
  it('disposes the resource when the last lease goes', async () => {
    const resource = fakeResource()
    await ssResourceCache.acquire('a.ssab', async () => resource)

    ssResourceCache.release('a.ssab')
    expect(resource.dispose).toHaveBeenCalledTimes(1)
    expect(ssResourceCache.size).toBe(0)
  })

  it('parses one pack once for many players', async () => {
    const create = vi.fn(async () => fakeResource())
    await Promise.all([
      ssResourceCache.acquire('a.ssab', create),
      ssResourceCache.acquire('a.ssab', create),
      ssResourceCache.acquire('a.ssab', create),
    ])
    expect(create).toHaveBeenCalledTimes(1)
  })
})

describe('ssImageCache', () => {
  // Deliberately no destroy hook: `SsTextureRegistry` does not own the SkImages
  // handed to it — one can be inside a recorded-but-not-rasterised SkPicture
  // when its last registry goes. This cache only stops the decode happening
  // twice.
  it('evicts without disposing the atlas', async () => {
    const image = { dispose: vi.fn() }
    await ssImageCache.acquire('a.png', async () => image as never)

    ssImageCache.release('a.png')
    expect(image.dispose).not.toHaveBeenCalled()
    expect(ssImageCache.size).toBe(0)
  })
})

describe('ssClearCaches', () => {
  // The leak check calls this before it measures: a cache holding a pack is
  // indistinguishable from a leaked handle when the measurement is a count of
  // live ones.
  it('empties both, retained entries included', async () => {
    const resource = fakeResource()
    await ssResourceCache.acquire('a.ssab', async () => resource)
    await ssImageCache.acquire('a.png', async () => ({}) as never)
    ssResourceCache.retain('a.ssab')
    ssImageCache.retain('a.png')

    ssClearCaches()

    expect(ssResourceCache.size).toBe(0)
    expect(ssImageCache.size).toBe(0)
    expect(resource.dispose).toHaveBeenCalledTimes(1)
  })
})
