import { Skia, type SkData, type SkImage } from '@shopify/react-native-skia'

import { SsRuntimeModule } from '../runtime'
import type { SsTextureInfo } from '../specs/SsRuntime.nitro'
import { resolveAgainst, schemeOf } from './assets'
import { ssImageCache } from './caches'
import type { SsTextureRegistry } from './SsTextureRegistry'

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
  /**
   * Texture hashes this pass actually put in the registry — not the ones it was
   * asked about, and not the ones a caller had already registered, since those
   * are left alone.
   *
   * For the same reason as `imageKeys`, one level up: an owner replacing what it
   * loaded needs to know which entries were its own.
   */
  registered: number[]
}

/**
 * What an owner that can start a second load before the first is done tells a
 * pass in flight.
 */
export interface SsTextureLoadPass {
  /**
   * Asked after each decode, before the atlas goes in; false ends the pass. An
   * atlas a replaced pass registers is one the live load finds in place and
   * skips — and is then left without when the replaced pass is cleaned up.
   */
  isCurrent(): boolean
  /**
   * Where each hash goes as it is registered rather than at the end, so an owner
   * replacing the load can take back what a pass still in flight has put in.
   * Handed back as the report's `registered`.
   */
  registered: number[]
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
   * `readEmbedded` hands over the encoded bytes of an atlas inside an Embedded
   * pack — `SsInternalPlayer.copyEmbeddedTexture` for textures out of its
   * `getTextures()`. It is asked only for an atlas the image cache does not
   * already hold.
   *
   * `baseUri` is the `.ssab`'s own URI. Omit it to load embedded textures only.
   *
   * A hash already in `registry` is skipped, so several packs sharing one
   * registry (a root and its instance children routinely name the same atlas)
   * decode it once, and a caller-supplied texture wins over the pack's.
   *
   * `pass` is for an owner that can replace a load while this one is still
   * decoding — see `SsTextureLoadPass`.
   */
  static async load(
    registry: SsTextureRegistry,
    textures: SsTextureInfo[],
    readEmbedded: (textureHash: number) => ArrayBuffer,
    baseUri?: string,
    pass?: SsTextureLoadPass
  ): Promise<SsTextureLoadReport> {
    const unresolved: string[] = []
    const imageKeys: string[] = []
    const registered = pass?.registered ?? []

    // Sequential rather than concurrent: the skip-if-registered check is only
    // sound if the calls are ordered, and two cellmaps naming one atlas would
    // otherwise both miss and decode it twice.
    for (const texture of textures) {
      if (registry.has(texture.textureHash)) continue

      // Keyed by where the atlas came from, so two packs naming one sibling
      // image decode it once. An atlas inside an Embedded pack has no URI of its
      // own, so it is keyed by the pack it lives inside plus the hash it is stored
      // under.
      const key =
        texture.embeddedLength > 0 || texture.imagePath.length === 0 || baseUri == null
          ? `${baseUri ?? ''}#${texture.textureHash}`
          : resolveAgainst(baseUri, texture.imagePath)

      let image: SkImage | null = null
      try {
        image = await ssImageCache.acquire(key, async () => {
          const decoded = await this.decode(texture, readEmbedded, baseUri)
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
        // After the await, which is where a newer load can have started. The
        // lease above is still reported, for the owner to give back.
        if (pass != null && !pass.isCurrent()) break
        registered.push(texture.textureHash)
        // Sampling is the registry's (Linear + Clamp unless the caller registers
        // the atlas itself). The SpriteStudio filter and wrap are deliberately
        // not carried — the Porting Guide leaves both to the engine.
        registry.registerByHash(texture.textureHash, image)
        continue
      }
      unresolved.push(
        texture.imagePath.length > 0
          ? texture.imagePath
          : `texture#${texture.textureHash}`
      )
    }

    return { unresolved, imageKeys, registered }
  }

  private static async decode(
    texture: SsTextureInfo,
    readEmbedded: (textureHash: number) => ArrayBuffer,
    baseUri?: string
  ): Promise<SkImage | null> {
    // 1. Embedded bytes win.
    if (texture.embeddedLength > 0) {
      const bytes = readEmbedded(texture.textureHash)
      const image =
        bytes.byteLength > 0
          ? Skia.Image.MakeImageFromEncoded(Skia.Data.fromBytes(new Uint8Array(bytes)))
          : null
      if (image != null) return decodeOffThread(image)
    }

    // 2. Reference: the parent of the `.ssab`, joined with the path inside it.
    if (texture.imagePath.length === 0 || baseUri == null) return null
    try {
      const data = await loadImageData(resolveAgainst(baseUri, texture.imagePath))
      const image = Skia.Image.MakeImageFromEncoded(data)
      return image == null ? null : await decodeOffThread(image)
    } catch {
      return null
    }
  }
}

/**
 * `image`, decoded on a worker. Left encoded, it decodes the first time a
 * canvas draws it — on the UI thread, which a large atlas stalls for tens of
 * milliseconds. A build that cannot decode natively keeps it encoded.
 */
async function decodeOffThread(image: SkImage): Promise<SkImage> {
  try {
    await SsRuntimeModule.decodeImage(image)
  } catch {
    // Drawn as it is, decoding on first use.
  }
  return image
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
