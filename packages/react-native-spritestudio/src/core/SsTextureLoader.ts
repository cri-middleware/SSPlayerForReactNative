import {
  FilterMode,
  Skia,
  TileMode,
  type SkData,
  type SkImage,
} from '@shopify/react-native-skia'

import { SsRuntimeModule } from '../runtime'
import {
  SsTexFilterMode,
  SsTexWrapMode,
  type SsTextureInfo,
} from '../specs/SsRuntime.nitro'
import { resolveAgainst, schemeOf } from './assets'
import { ssImageCache } from './caches'
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
  /**
   * Cache keys this pass took a lease on, for the caller to give back.
   *
   * The loader cannot release them itself: an atlas outlives the call that
   * decoded it, and only whoever owns the registry knows when the last user of
   * it is gone. `SpriteStudioPlayer` holds these and releases them on dispose.
   */
  imageKeys: string[]
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
 * ## Where reference mode reaches
 *
 * Everywhere an `SsSource` can point, because all three kinds keep their
 * directory: the app's asset directory, a real filesystem directory, or a
 * server. The sibling is opened the way the `.ssab` was — `resolveAgainst`
 * hands back a URI of the same kind, and `schemeOf` picks the door.
 *
 * This used not to hold. While the `.ssab` was named with a `require()` there
 * was no directory to resolve against, so a reference pack could only be drawn
 * by supplying its textures by hand. That is what the asset directory replaced.
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
    const imageKeys: string[] = []

    // Sequential rather than concurrent: the skip-if-registered check is only
    // sound if the calls are ordered, and two cellmaps naming one atlas would
    // otherwise both miss and decode it twice.
    for (const texture of textures) {
      if (registry.has(texture.textureHash)) continue

      // Keyed by where the atlas came from, so two packs naming one sibling
      // image decode it once. An embedded atlas has no URI of its own, so it is
      // keyed by the pack it lives inside plus the hash it is stored under.
      const key =
        texture.embedded.byteLength > 0 || texture.imagePath.length === 0 || baseUri == null
          ? `${baseUri ?? ''}#${texture.textureHash}`
          : resolveAgainst(baseUri, texture.imagePath)

      let image: SkImage | null = null
      try {
        image = await ssImageCache.acquire(key, async () => {
          const decoded = await this.decode(texture, baseUri)
          // Thrown rather than returned: a null must not be cached, or the pack
          // whose atlas arrives late is permanently textureless.
          if (decoded == null) throw new Error(`unresolved texture '${key}'`)
          return decoded
        })
      } catch {
        image = null
      }

      if (image != null) {
        imageKeys.push(key)
        registry.registerByHash(texture.textureHash, image, samplingOf(texture))
        continue
      }
      unresolved.push(
        texture.imagePath.length > 0
          ? texture.imagePath
          : `texture#${texture.textureHash}`
      )
    }

    return { unresolved, imageKeys }
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
      const data = await loadImageData(resolveAgainst(baseUri, texture.imagePath))
      return Skia.Image.MakeImageFromEncoded(data)
    } catch {
      return null
    }
  }
}

/**
 * The encoded bytes at `uri`, as Skia data.
 *
 * `Skia.Data.fromURI` covers `file:` and `http:` and knows nothing about either
 * platform's asset storage — iOS keeps assets inside the `.app` and Android
 * inside the APK, where only `AAssetManager` reaches them. So an asset takes
 * the Layer 1 route, which is the same one the `.ssab` itself took.
 */
export async function loadImageData(uri: string): Promise<SkData> {
  if (schemeOf(uri) === 'asset') {
    return Skia.Data.fromBytes(new Uint8Array(SsRuntimeModule.readAsset(uri)))
  }
  return Skia.Data.fromURI(uri)
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
