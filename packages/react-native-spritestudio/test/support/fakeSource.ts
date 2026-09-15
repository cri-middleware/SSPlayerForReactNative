import { vi } from 'vitest'

import { normalizeUri } from '../../src/core/assets'
import { openPack, type FakeResource } from './fakeRuntime'

/**
 * Stands in for `player/source`, so Layer 3's lease bookkeeping is observable.
 *
 * `sourceUriOf` and `resolveSourceUri` keep their real behaviour — they are
 * pure, and `useSpriteStudioPlayer` keys its load effect on the second one, so
 * a stub that got normalisation wrong would change what is under test. The
 * three that touch the cache are `vi.fn`s: a test that needs a load to hang, or
 * to fail, replaces one with `mockImplementationOnce`.
 */
export type SsSource = string | { uri: string }

export interface LoadedResource {
  resource: FakeResource
  uri: string
}

export function sourceUriOf(source: SsSource): string {
  if (typeof source === 'number') throw new Error('SsSource: a require()d module')
  const uri = typeof source === 'string' ? source : source?.uri
  if (typeof uri !== 'string' || uri.length === 0) {
    throw new Error('SsSource: expected a path or URI string')
  }
  return uri
}

export function resolveSourceUri(source: SsSource): string {
  return normalizeUri(sourceUriOf(source))
}

/** Leases handed out and not given back, oldest first per URI. */
const leases = new Map<string, FakeResource[]>()

export const loadResource = vi.fn(async (source: SsSource): Promise<LoadedResource> => {
  const uri = resolveSourceUri(source)
  const resource = openPack(uri)
  const held = leases.get(uri) ?? []
  held.push(resource)
  leases.set(uri, held)
  return { resource, uri }
})

export const releaseResource = vi.fn((uri: string): void => {
  const held = leases.get(uri)
  const resource = held?.shift()
  resource?.dispose()
  if (held != null && held.length === 0) leases.delete(uri)
})

export const loadInstancePacks = vi.fn(
  async (_root: FakeResource, _baseUri: string): Promise<LoadedResource[]> => []
)

export const preloadResource = vi.fn(async (_source: SsSource): Promise<void> => {})

export const unloadResource = vi.fn((_source: SsSource): void => {})

export function resetFakeSource(): void {
  leases.clear()
  loadResource.mockReset()
  releaseResource.mockReset()
  loadInstancePacks.mockReset()
  preloadResource.mockReset()
  unloadResource.mockReset()
}
