import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ssClearCaches, ssResourceCache } from '../src/core/caches'
import {
  loadInstancePacks,
  loadResource,
  preloadResource,
  releaseResource,
  resolveSourceUri,
  sourceUriOf,
  unloadResource,
  type SsSource,
} from '../src/player/source'
import { SsRuntimeModule, definePack, live, resetFakeRuntime } from './support/fakeRuntime'

// The only thing standing between this file and a device: `runtime.ts` builds a
// Nitro hybrid object at module scope, so importing `source.ts` is importing it.
vi.mock('../src/runtime', () => import('./support/fakeRuntime'))

beforeEach(resetFakeRuntime)
// `ssResourceCache` is a module singleton, so a leaked lease would follow the
// next test into a cache hit it did not ask for.
afterEach(ssClearCaches)

/** Answers a remote load with its own URL, which is what the fake Brain reads back. */
function serveRemote(status = 200): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => ({
      ok: status >= 200 && status < 300,
      status,
      arrayBuffer: async () => new TextEncoder().encode(url).buffer,
    }))
  )
}

describe('sourceUriOf', () => {
  // The check exists for JS callers: TypeScript rejects a module id, and the
  // failure it would otherwise cause is a part that silently is not there.
  it('rejects a require()d module rather than taking its id as a path', () => {
    expect(() => sourceUriOf(7 as unknown as SsSource)).toThrow(
      /require\(\)d module cannot be a SpriteStudio source/
    )
  })

  it('rejects an empty or absent URI', () => {
    expect(() => sourceUriOf('')).toThrow(/expected a path or URI string/)
    expect(() => sourceUriOf({} as SsSource)).toThrow(/expected a path or URI string/)
  })

  it('unwraps both spellings to the same URI', () => {
    expect(sourceUriOf('ss/a.ssab')).toBe('ss/a.ssab')
    expect(sourceUriOf({ uri: 'ss/a.ssab' })).toBe('ss/a.ssab')
  })
})

describe('resolveSourceUri', () => {
  // What makes `'ss/a.ssab'` and `{ uri: 'ss/./a.ssab' }` one cache entry rather
  // than two parses of one pack.
  it('collapses the path so the two spellings share a cache key', () => {
    expect(resolveSourceUri('ss/overall/../b.ssab')).toBe('ss/b.ssab')
    expect(resolveSourceUri({ uri: 'ss/./b.ssab' })).toBe('ss/b.ssab')
  })
})

describe('loadResource — which door a source opens', () => {
  it('takes a bare path to the asset directory', async () => {
    definePack('ss/overall/Basic.ssab')
    const open = vi.spyOn(SsRuntimeModule, 'createResourceFromAsset')

    const { uri } = await loadResource('ss/overall/Basic.ssab')

    expect(open).toHaveBeenCalledWith('ss/overall/Basic.ssab')
    expect(uri).toBe('ss/overall/Basic.ssab')
  })

  it('takes a rooted path and a file:// URL to the filesystem, percent-decoded', async () => {
    definePack('/tmp/packs/Basic.ssab')
    definePack('/tmp/with space/Basic.ssab')
    const open = vi.spyOn(SsRuntimeModule, 'createResourceFromPath')

    await loadResource('/tmp/packs/Basic.ssab')
    await loadResource('file:///tmp/with%20space/Basic.ssab')

    expect(open.mock.calls.map(([path]) => path)).toEqual([
      '/tmp/packs/Basic.ssab',
      '/tmp/with space/Basic.ssab',
    ])
  })

  it('fetches a remote pack and hands the bytes over', async () => {
    serveRemote()
    definePack('https://cdn.example/Basic.ssab')
    const open = vi.spyOn(SsRuntimeModule, 'createResourceFromBytes')

    const { uri } = await loadResource('https://cdn.example/Basic.ssab')

    expect(uri).toBe('https://cdn.example/Basic.ssab')
    expect(open).toHaveBeenCalledOnce()
  })

  it('reports the status when a remote pack is not there', async () => {
    serveRemote(404)
    await expect(loadResource('https://cdn.example/Missing.ssab')).rejects.toThrow(
      /404 fetching 'https:\/\/cdn.example\/Missing.ssab'/
    )
  })
})

describe('loadResource — the lease', () => {
  it('parses one pack once however many players ask for it', async () => {
    definePack('ss/Basic.ssab')
    const open = vi.spyOn(SsRuntimeModule, 'createResourceFromAsset')

    const first = await loadResource('ss/Basic.ssab')
    const second = await loadResource({ uri: 'ss/Basic.ssab' })

    expect(open).toHaveBeenCalledOnce()
    expect(second.resource).toBe(first.resource)
  })

  // The lease replaced a `dispose()` for exactly this reason: a second player of
  // the same pack is still drawing from it.
  it('hands the pack back to the Brain only when the last lease goes', async () => {
    definePack('ss/Basic.ssab')
    await loadResource('ss/Basic.ssab')
    await loadResource('ss/Basic.ssab')

    releaseResource('ss/Basic.ssab')
    expect(live.resources.size).toBe(1)

    releaseResource('ss/Basic.ssab')
    expect(live.resources.size).toBe(0)
  })
})

describe('preloadResource', () => {
  it('keeps the pack loaded with a lease nothing balances', async () => {
    definePack('ss/Basic.ssab')

    await preloadResource('ss/Basic.ssab')

    // One retain, and the acquire's own lease given straight back — leaving both
    // would need two releases to free one pack.
    expect(ssResourceCache.size).toBe(1)
    expect(live.resources.size).toBe(1)
  })

  it('gives that lease back on unload, and only that one', async () => {
    definePack('ss/Basic.ssab')
    await preloadResource('ss/Basic.ssab')
    await loadResource('ss/Basic.ssab')

    unloadResource('ss/Basic.ssab')
    // A pack still mounted somewhere stays loaded.
    expect(live.resources.size).toBe(1)

    releaseResource('ss/Basic.ssab')
    expect(live.resources.size).toBe(0)
  })
})

describe('loadInstancePacks', () => {
  it('walks the references transitively, resolved as siblings of the pack', async () => {
    definePack('ss/overall/Root.ssab', { instancePacks: ['Child'] })
    definePack('ss/overall/Child.ssab', { instancePacks: ['GrandChild'] })
    definePack('ss/overall/GrandChild.ssab')
    const { resource } = await loadResource('ss/overall/Root.ssab')

    const loaded = await loadInstancePacks(resource, 'ss/overall/Root.ssab')

    expect(loaded.map((entry) => entry.uri)).toEqual([
      'ss/overall/Child.ssab',
      'ss/overall/GrandChild.ssab',
    ])
  })

  // One resource per pack is what keeps `liveHandles` honest — the dedup is not
  // only an optimisation.
  it('loads a pack two parents both name exactly once', async () => {
    definePack('ss/Root.ssab', { instancePacks: ['A', 'B'] })
    definePack('ss/A.ssab', { instancePacks: ['Shared'] })
    definePack('ss/B.ssab', { instancePacks: ['Shared'] })
    definePack('ss/Shared.ssab')
    const { resource } = await loadResource('ss/Root.ssab')

    const loaded = await loadInstancePacks(resource, 'ss/Root.ssab')

    expect(loaded.map((entry) => entry.uri)).toEqual([
      'ss/A.ssab',
      'ss/B.ssab',
      'ss/Shared.ssab',
    ])
  })

  it('terminates on a cycle', async () => {
    definePack('ss/Root.ssab', { instancePacks: ['A'] })
    definePack('ss/A.ssab', { instancePacks: ['B'] })
    definePack('ss/B.ssab', { instancePacks: ['A'] })
    const { resource } = await loadResource('ss/Root.ssab')

    const loaded = await loadInstancePacks(resource, 'ss/Root.ssab')

    expect(loaded.map((entry) => entry.uri)).toEqual(['ss/A.ssab', 'ss/B.ssab'])
  })

  // Fail-safe, matching what the C++ side does with a slot it cannot resolve:
  // one missing sibling must not take the whole animation down.
  it('warns about a pack it cannot load and carries on', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    definePack('ss/Root.ssab', { instancePacks: ['Missing', 'Present'] })
    definePack('ss/Present.ssab')
    const { resource } = await loadResource('ss/Root.ssab')

    const loaded = await loadInstancePacks(resource, 'ss/Root.ssab')

    expect(loaded.map((entry) => entry.uri)).toEqual(['ss/Present.ssab'])
    expect(warn).toHaveBeenCalledOnce()
    expect(warn.mock.calls[0]?.[0]).toMatch(
      /instance pack 'Missing' referenced by 'ss\/Root.ssab'/
    )
  })

  it('asks for nothing when the pack references nothing', async () => {
    definePack('ss/Root.ssab')
    const { resource } = await loadResource('ss/Root.ssab')

    expect(await loadInstancePacks(resource, 'ss/Root.ssab')).toEqual([])
  })
})
