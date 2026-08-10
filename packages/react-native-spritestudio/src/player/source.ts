import { fileSystemPathOf, normalizeUri, resolveAgainst, schemeOf } from '../core/assets'
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

/**
 * Loads every pack this one's Instance parts reach into, transitively.
 *
 * A reference is a **sibling name** like everything else a `.ssab` points at, so
 * each one is `resolveAgainst` the pack's own URI plus `.ssab` — the same seam
 * the textures go through, which is why an instance tree works from an asset
 * directory, an unpacked one and a dev server without three code paths.
 *
 * Breadth-first with a `seen` set, because the walk is genuinely transitive: a
 * mounted pack can mount further packs, and two of them can name the same one.
 * SSPlayerForWeb's `PackResolver` does the same, and the dedup is not just an
 * optimisation — one resource per pack is what keeps `liveHandles` honest.
 *
 * A pack that will not load is **warned about and skipped**, not thrown: the
 * parts that wanted it then draw nothing, which is the same fail-safe the C++
 * side applies to a slot it cannot resolve, and it keeps one missing sibling
 * from taking the whole animation down with it.
 *
 * The returned resources are the caller's to dispose.
 */
export async function loadInstancePacks(
  root: SsResource,
  baseUri: string
): Promise<SsResource[]> {
  const queue = [...root.getExternalInstancePackNames()]
  if (queue.length === 0) return []

  const loaded: SsResource[] = []
  const seen = new Set<string>()
  while (queue.length > 0) {
    const name = queue.shift()!
    if (name.length === 0 || seen.has(name)) continue
    seen.add(name)
    try {
      const { resource } = await loadResource(resolveAgainst(baseUri, `${name}.ssab`))
      loaded.push(resource)
      queue.push(...resource.getExternalInstancePackNames())
    } catch (e) {
      console.warn(
        `react-native-spritestudio: instance pack '${name}' referenced by ` +
          `'${baseUri}' could not be loaded — those parts will not draw. ${String(e)}`
      )
    }
  }
  return loaded
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
