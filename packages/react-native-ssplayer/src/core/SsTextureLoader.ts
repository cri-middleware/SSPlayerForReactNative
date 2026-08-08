import {
  FilterMode,
  Skia,
  TileMode,
  type SkImage,
} from '@shopify/react-native-skia'

import {
  SsTexFilterMode,
  SsTexWrapMode,
  type SsTextureInfo,
} from '../specs/SsRuntime.nitro'
import type { SsTextureOptions, SsTextureRegistry } from './SsTextureRegistry'

/**
 * What a texture-load pass could not resolve. Empty on full success.
 *
 * A missing texture is silent at draw time — `drawInto` skips a batch it has no
 * paint for — so this is the only thing standing between a mis-shipped atlas and
 * a part that just quietly is not there.
 */
export interface SsTextureLoadReport {
  /** `image_path` (or a `texture#<hash>` placeholder) per unresolved texture. */
  unresolved: string[]
}

/**
 * Loads a pack's textures into an `SsTextureRegistry`, the way the sibling
 * Players do (`SSPlayerForFlutter`'s `texture_loader.dart` is the same routine).
 *
 * The `.ssab` itself is read in C++ — this layer is handed `SsTextureInfo[]`,
 * never a buffer to parse. Two supply modes, routed per texture with embedded
 * winning:
 *
 *  * **embedded** — bytes came along inside the `.ssab`.
 *  * **reference** — the texture names a sibling file, resolved against the
 *    `.ssab`'s own location: the parent of `baseUri`, joined with `imagePath`.
 *
 * Everything is registered under `SsTextureInfo.textureHash`, which
 * `DrawBatch.texture_hash` can be looked up with directly.
 *
 * ## Where reference mode reaches, on React Native
 *
 * The sibling Players can always find a sibling because Flutter and Godot ship
 * asset *directories*. Metro ships a dependency *graph*: it bundles only what a
 * `require()` names, and never walks a directory. So:
 *
 *  * **Metro dev server** — works. It serves the project tree by path, whether
 *    or not anything required the file.
 *  * **A real filesystem directory** — works. Runtime downloads, `Documents/`,
 *    or assets copied into the app bundle out-of-band (what the planned Expo
 *    config plugin is for).
 *  * **A `require()`d asset in a release build** — cannot work. The sibling
 *    image is not in the bundle at all. Register those textures yourself before
 *    loading; already-registered hashes are left alone.
 */
export class SsTextureLoader {
  /**
   * Decodes and registers every texture in `textures`.
   *
   * `baseUri` is the `.ssab`'s own URI. Omit it to load embedded textures only.
   *
   * A hash already in `registry` is skipped, so several packs sharing one
   * registry (a root and its instance children routinely name the same atlas)
   * decode it once, and a caller-supplied texture wins over the pack's.
   */
  static async load(
    registry: SsTextureRegistry,
    textures: SsTextureInfo[],
    baseUri?: string
  ): Promise<SsTextureLoadReport> {
    const unresolved: string[] = []

    // Sequential rather than concurrent: the skip-if-registered check is only
    // sound if the calls are ordered, and two cellmaps naming one atlas would
    // otherwise both miss and decode it twice.
    for (const texture of textures) {
      if (registry.has(texture.textureHash)) continue

      const image = await this.decode(texture, baseUri)
      if (image != null) {
        registry.registerByHash(texture.textureHash, image, samplingOf(texture))
        continue
      }
      unresolved.push(
        texture.imagePath.length > 0
          ? texture.imagePath
          : `texture#${texture.textureHash}`
      )
    }

    return { unresolved }
  }

  private static async decode(
    texture: SsTextureInfo,
    baseUri?: string
  ): Promise<SkImage | null> {
    // 1. Embedded bytes win.
    if (texture.embedded.byteLength > 0) {
      const image = Skia.Image.MakeImageFromEncoded(
        Skia.Data.fromBytes(new Uint8Array(texture.embedded))
      )
      if (image != null) return image
    }

    // 2. Reference: the parent of the `.ssab`, joined with the path inside it.
    if (texture.imagePath.length === 0 || baseUri == null) return null
    try {
      const data = await Skia.Data.fromURI(resolveAgainst(baseUri, texture.imagePath))
      return Skia.Image.MakeImageFromEncoded(data)
    } catch {
      return null
    }
  }
}

function samplingOf(texture: SsTextureInfo): SsTextureOptions {
  const tile =
    texture.wrapMode === SsTexWrapMode.repeat
      ? TileMode.Repeat
      : texture.wrapMode === SsTexWrapMode.mirror
        ? TileMode.Mirror
        : TileMode.Clamp
  return {
    filter:
      texture.filterMode === SsTexFilterMode.nearest
        ? FilterMode.Nearest
        : FilterMode.Linear,
    tileX: tile,
    tileY: tile,
  }
}

/**
 * Joins the parent of `baseUri` with `path`.
 *
 * Deliberately string surgery rather than `new URL`: `baseUri` is a URL for a
 * dev-server source and a bare filesystem path for a bundled or downloaded one,
 * and the join is the same operation either way. A `?query` on the base (Metro
 * puts one there) belongs to the `.ssab`, not to its directory, so it goes.
 */
export function resolveAgainst(baseUri: string, path: string): string {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(path) || path.startsWith('/')) return path
  const withoutQuery = baseUri.replace(/[?#].*$/, '')
  const slash = withoutQuery.lastIndexOf('/')
  const parent = slash < 0 ? '' : withoutQuery.slice(0, slash)
  const relative = path.startsWith('./') ? path.slice(2) : path
  return parent === '' ? relative : `${parent}/${relative}`
}
