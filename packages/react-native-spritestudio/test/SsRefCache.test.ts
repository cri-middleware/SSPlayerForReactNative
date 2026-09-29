import { describe, expect, it, vi } from 'vitest'

import { SsRefCache } from '../src/core/SsRefCache'

/** A build whose settling this test controls, so the in-flight window is reachable. */
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const cacheOf = () => {
  const destroy = vi.fn<(value: string) => void>()
  return { cache: new SsRefCache<string>({ destroy }), destroy }
}

describe('SsRefCache — one build per key', () => {
  it('builds once and hands the same value to every lease', async () => {
    const { cache } = cacheOf()
    const create = vi.fn(async () => 'pack')

    const [a, b] = await Promise.all([
      cache.acquire('a.ssab', create),
      cache.acquire('a.ssab', create),
    ])

    expect(create).toHaveBeenCalledTimes(1)
    expect(a).toBe('pack')
    expect(b).toBe('pack')
    expect(cache.size).toBe(1)
  })

  // The refcount is incremented synchronously, before any await, so two mounts
  // racing on one pack share a single build rather than each starting their own.
  it('shares a build that is still in flight', async () => {
    const { cache } = cacheOf()
    const d = deferred<string>()
    const create = vi.fn(() => d.promise)

    const first = cache.acquire('a.ssab', create)
    const second = cache.acquire('a.ssab', create)
    expect(create).toHaveBeenCalledTimes(1)

    d.resolve('pack')
    expect(await first).toBe('pack')
    expect(await second).toBe('pack')
  })

  it('keys entries separately', async () => {
    const { cache } = cacheOf()
    await cache.acquire('a.ssab', async () => 'a')
    await cache.acquire('b.ssab', async () => 'b')
    expect(cache.size).toBe(2)
  })
})

describe('SsRefCache — release is eager', () => {
  // An LRU would hold packs past their last user and read as a leak, so an
  // entry is destroyed the moment its last lease goes.
  it('destroys on the last release, not before', async () => {
    const { cache, destroy } = cacheOf()
    await cache.acquire('a.ssab', async () => 'pack')
    await cache.acquire('a.ssab', async () => 'pack')

    cache.release('a.ssab')
    expect(destroy).not.toHaveBeenCalled()
    expect(cache.size).toBe(1)

    cache.release('a.ssab')
    expect(destroy).toHaveBeenCalledExactlyOnceWith('pack')
    expect(cache.size).toBe(0)
  })

  it('rebuilds after the entry died', async () => {
    const { cache } = cacheOf()
    const create = vi.fn(async () => 'pack')
    await cache.acquire('a.ssab', create)
    cache.release('a.ssab')
    await cache.acquire('a.ssab', create)
    expect(create).toHaveBeenCalledTimes(2)
  })

  it('ignores a release for a key it does not hold', () => {
    const { cache, destroy } = cacheOf()
    expect(() => cache.release('nothing.ssab')).not.toThrow()
    expect(destroy).not.toHaveBeenCalled()
  })

  // The window the class calls out: the release arrived while the build was
  // still in flight, leaving the refcount at zero with nothing to destroy yet.
  it('settles a release that landed while the build was in flight', async () => {
    const { cache, destroy } = cacheOf()
    const d = deferred<string>()

    const pending = cache.acquire('a.ssab', () => d.promise)
    cache.release('a.ssab')
    expect(destroy).not.toHaveBeenCalled()

    d.resolve('pack')
    await expect(pending).resolves.toBe('pack')
    expect(destroy).toHaveBeenCalledExactlyOnceWith('pack')
    expect(cache.size).toBe(0)
  })
})

describe('SsRefCache — a failed build is not cached', () => {
  it('rethrows and forgets the entry', async () => {
    const { cache } = cacheOf()
    const boom = new Error('unreadable .ssab')

    await expect(cache.acquire('a.ssab', async () => { throw boom })).rejects.toThrow(boom)
    expect(cache.size).toBe(0)
  })

  it('gives the next caller a fresh attempt rather than the same rejection', async () => {
    const { cache } = cacheOf()
    const create = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValueOnce('pack')

    await expect(cache.acquire('a.ssab', create)).rejects.toThrow('transient')
    await expect(cache.acquire('a.ssab', create)).resolves.toBe('pack')
    expect(create).toHaveBeenCalledTimes(2)
  })

  it('never destroys a value it never built', async () => {
    const { cache, destroy } = cacheOf()
    await expect(
      cache.acquire('a.ssab', async () => { throw new Error('nope') })
    ).rejects.toThrow()
    expect(destroy).not.toHaveBeenCalled()
  })
})

describe('SsRefCache — retain', () => {
  it('outlives the last ordinary release', async () => {
    const { cache, destroy } = cacheOf()
    await cache.acquire('a.ssab', async () => 'pack')
    cache.retain('a.ssab')

    cache.release('a.ssab')
    expect(destroy).not.toHaveBeenCalled()
    expect(cache.size).toBe(1)

    cache.releaseRetained('a.ssab')
    expect(destroy).toHaveBeenCalledExactlyOnceWith('pack')
    expect(cache.size).toBe(0)
  })

  // Two packs sharing an atlas each retain it: unloading one must leave it for
  // the other.
  it('counts, one releaseRetained each', async () => {
    const { cache, destroy } = cacheOf()
    await cache.acquire('atlas.png', async () => 'atlas')
    cache.retain('atlas.png')
    cache.retain('atlas.png')
    cache.release('atlas.png')

    cache.releaseRetained('atlas.png')
    expect(destroy).not.toHaveBeenCalled()
    expect(cache.size).toBe(1)

    cache.releaseRetained('atlas.png')
    expect(destroy).toHaveBeenCalledExactlyOnceWith('atlas')
    expect(cache.size).toBe(0)
  })

  it('ignores releaseRetained when nothing is retained', async () => {
    const { cache, destroy } = cacheOf()
    await cache.acquire('a.ssab', async () => 'pack')
    cache.releaseRetained('a.ssab')
    expect(destroy).not.toHaveBeenCalled()
    expect(cache.size).toBe(1)
  })

  it('ignores retain for a key it does not hold', () => {
    const { cache } = cacheOf()
    expect(() => cache.retain('nothing.ssab')).not.toThrow()
    expect(cache.size).toBe(0)
  })
})

describe('SsRefCache — clear', () => {
  // The leak check runs this first: a cache holding packs is indistinguishable
  // from a leak when the measurement is a count of live handles.
  it('drops everything, retained entries included', async () => {
    const { cache, destroy } = cacheOf()
    await cache.acquire('a.ssab', async () => 'a')
    await cache.acquire('b.ssab', async () => 'b')
    cache.retain('b.ssab')

    cache.clear()
    expect(cache.size).toBe(0)
    expect(destroy).toHaveBeenCalledTimes(2)
    expect(destroy.mock.calls.flat().sort()).toEqual(['a', 'b'])
  })

  it('leaves the cache usable', async () => {
    const { cache } = cacheOf()
    await cache.acquire('a.ssab', async () => 'a')
    cache.clear()
    await expect(cache.acquire('a.ssab', async () => 'again')).resolves.toBe('again')
    expect(cache.size).toBe(1)
  })

  it('does not double-destroy what it already cleared', async () => {
    const { cache, destroy } = cacheOf()
    await cache.acquire('a.ssab', async () => 'a')
    cache.clear()
    cache.release('a.ssab')
    expect(destroy).toHaveBeenCalledTimes(1)
  })
})

describe('SsRefCache — without a destroy hook', () => {
  // ssImageCache is built this way on purpose: it stops the decode happening
  // twice and does not own the SkImage it hands out.
  it('evicts without touching the value', async () => {
    const cache = new SsRefCache<string>()
    await cache.acquire('a.png', async () => 'atlas')
    expect(() => cache.release('a.png')).not.toThrow()
    expect(cache.size).toBe(0)
  })
})
