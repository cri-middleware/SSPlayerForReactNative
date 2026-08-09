import { fileSystemPathOf, normalizeUri, schemeOf } from '../core/assets'
import { SsRuntimeModule } from '../runtime'
import type { SsResource } from '../specs/SsRuntime.nitro'

/**
 * Where a `.ssab` comes from.
 *
 * Always a **location**, never a bundler handle, and that is the whole point.
 * A pack is a directory: the `.ssab` names its textures, the external `.ssab`s
 * its Instance parts reach and — through a `.ssqb` — the packs it sequences,
 * all by paths relative to itself. So a source has to be something whose
 * *directory* still exists on the device.
 *
 * Three spellings, matching `SsUriScheme`:
 *
 * | | |
 * |---|---|
 * | `'ss/overall/Basic.ssab'` | inside the app's asset directory — what you ship |
 * | `'file:///…'`, `'/…'` | a real directory: a download, `Documents/`, anything unpacked |
 * | `'http://…'` | a dev server or a CDN |
 *
 * `{ uri }` is accepted for all three, for symmetry with React Native's own
 * source props.
 *
 * ## Why not `require()`
 *
 * It cannot carry a directory. Metro ships a dependency *graph* — it bundles
 * only what a `require()` names and never walks a directory — and on an Android
 * release build the packager then flattens and lowercases what it did name into
 * `res/`, so `dirname()` of a bundled asset points at nothing. A `require()`
 * source works in development and then silently loses every sibling reference
 * when shipped, which is the failure this API is shaped to avoid. The pack
 * directories are copied in out-of-band instead — see `plugin/`.
 */
export type SsSource = string | { uri: string }

/**
 * The URI a source names, unwrapped but not yet normalised.
 *
 * Also where a `require()` is caught. TypeScript rejects one, but a JS caller
 * gets a module id — an opaque number — and the failure it would otherwise
 * cause is a part that silently is not there.
 *
 * Separate from `resolveSourceUri` so `<SpriteStudioView>` can key its load
 * effect on the URI (an inline `{ uri }` is a new object every render) without
 * a second copy of this check.
 */
export function sourceUriOf(source: SsSource): string {
  if (typeof source === 'number') {
    throw new Error(
      'SsSource: a require()d module cannot be a SpriteStudio source. A pack is ' +
        'a directory and Metro does not ship one — pass a path into the app ' +
        "asset directory instead, e.g. 'ss/overall/Basic.ssab'."
    )
  }
  const uri = typeof source === 'string' ? source : source?.uri
  if (typeof uri !== 'string' || uri.length === 0) {
    throw new Error('SsSource: expected a path or URI string')
  }
  return uri
}

/** The URI behind a source, before any decision about how to open it. */
export function resolveSourceUri(source: SsSource): string {
  return normalizeUri(sourceUriOf(source))
}

/**
 * Loads a `.ssab` into a Layer 1 resource.
 *
 * Two of the three routes keep the bytes out of the JS heap entirely (design
 * doc ch.5 A) — C++ opens the file or the APK entry. Only a remote URL has to
 * be fetched, and only a dev server or a CDN is one.
 *
 * The resource is the caller's to `dispose()`.
 */
export async function loadResource(source: SsSource): Promise<LoadedResource> {
  const uri = resolveSourceUri(source)

  switch (schemeOf(uri)) {
    case 'asset':
      return { resource: SsRuntimeModule.createResourceFromAsset(uri), uri }
    case 'file': {
      const path = fileSystemPathOf(uri)!
      return { resource: SsRuntimeModule.createResourceFromPath(path), uri }
    }
    case 'remote': {
      const response = await fetch(uri)
      if (!response.ok) {
        throw new Error(`SsSource: ${response.status} fetching '${uri}'`)
      }
      return {
        resource: SsRuntimeModule.createResourceFromBytes(await response.arrayBuffer()),
        uri,
      }
    }
  }
}

/** A loaded `.ssab` and where it came from. */
export interface LoadedResource {
  resource: SsResource
  /**
   * The URI the source resolved to, normalised.
   *
   * Carried out of the load because everything the pack references is named
   * *relative to it* — `resolveAgainst(uri, ref)` is how a texture, and later an
   * Instance part's external pack, becomes something openable.
   */
  uri: string
}
