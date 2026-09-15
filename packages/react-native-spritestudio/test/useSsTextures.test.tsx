import { beforeEach, describe, expect, it, vi } from 'vitest'

import { SS_DEFAULT_CELLMAP, useSsTextures, type SsTextureSources } from '../src/view/useSsTextures'
import { definePack, resetFakeRuntime } from './support/fakeRuntime'
import { renderHook } from './support/render'
import { skiaDecode } from './support/stubs/skia'
import { Image } from './support/stubs/react-native'

// `loadImageData` takes the Layer 1 route for an asset, which is the one thing
// here that reaches the Brain.
vi.mock('../src/runtime', () => import('./support/fakeRuntime'))

beforeEach(resetFakeRuntime)

const decode = (sources: SsTextureSources | null | undefined) =>
  renderHook(
    (props: { sources: SsTextureSources | null | undefined }) =>
      useSsTextures(props.sources),
    { sources }
  )

describe('useSsTextures', () => {
  // The shorthand for a pack with one cellmap, whose name only the `.ssab`
  // carries — `drawInto` matches a single-entry table unconditionally.
  it('puts a bare source under the default cellmap', async () => {
    const harness = await decode('ss/overall/atlas.png')

    expect(Object.keys(harness.result.current ?? {})).toEqual([SS_DEFAULT_CELLMAP])
  })

  it('keys a map by cellmap name', async () => {
    const harness = await decode({ body: 'ss/body.png', face: 'ss/face.png' })

    expect(Object.keys(harness.result.current ?? {}).sort()).toEqual(['body', 'face'])
  })

  // The two forms are otherwise indistinguishable; a pack whose single cellmap
  // is actually named `uri` is the one case this gets wrong.
  it('reads a lone { uri } as a bare source, not a one-cellmap map', async () => {
    const harness = await decode({ uri: 'ss/atlas.png' })

    expect(Object.keys(harness.result.current ?? {})).toEqual([SS_DEFAULT_CELLMAP])
  })

  // `require()` is allowed here and nowhere else: a replacement texture is a
  // single standalone image with no siblings to resolve.
  it('resolves a require()d image through the bundler', async () => {
    const resolve = vi.spyOn(Image, 'resolveAssetSource')

    await decode(7)

    expect(resolve).toHaveBeenCalledWith(7)
  })

  it('is null until every texture has decoded', async () => {
    const harness = await decode(null)

    expect(harness.result.current).toBeNull()
  })

  // Returning a half-decoded map would flash a frame with a missing atlas.
  it('reports a decode it could not make, and stays null', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(skiaDecode, 'image').mockReturnValue(null)

    const harness = await decode('ss/atlas.png')

    expect(harness.result.current).toBeNull()
    expect(error.mock.calls[0]?.[0]).toMatch(/texture load failed/)
  })

  // Keyed on the resolved URIs, because an inline object literal's identity
  // changes every render.
  it('does not decode again for an equal map written inline', async () => {
    definePack('ss/atlas.png')
    const decodeSpy = vi.spyOn(skiaDecode, 'image')
    const harness = await decode({ body: 'ss/atlas.png' })
    const calls = decodeSpy.mock.calls.length

    await harness.rerender({ sources: { body: 'ss/atlas.png' } })

    expect(decodeSpy.mock.calls).toHaveLength(calls)
  })
})
