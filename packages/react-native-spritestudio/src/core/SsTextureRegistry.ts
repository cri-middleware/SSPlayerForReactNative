import {
  FilterMode,
  MipmapMode,
  Skia,
  TileMode,
  type SkImage,
  type SkPaint,
} from '@shopify/react-native-skia'

import { SsRuntimeModule } from '../runtime'
import type { SsTextureBinding } from '../specs/SsRuntime.nitro'

/**
 * How a cellmap's texture is sampled. Defaults match SpriteStudio's own.
 *
 * Sampling is a cellmap property, so `SsTextureLoader` reads it off the `.ssab`
 * and passes it here. Left to the paint's default, `drawVertices` samples
 * nearest-neighbour and every scaled or rotated sprite comes out jaggy.
 */
export interface SsTextureOptions {
  filter?: FilterMode
  tileX?: TileMode
  tileY?: TileMode
}

/**
 * `cellmap.name_hash` → the `SkPaint` its batches draw with (design doc ch.7).
 *
 * The hash is what `DrawBatch.texture_hash` carries, so this is the whole of
 * texture resolution — mirrors the sibling ports' hash-keyed texture map (Godot
 * `_textures`, Flutter `TextureRegistry`, Unity's material map). Hashes come
 * from the Brain via `SsRuntime.hashString`; **never** re-implement FNV-1a here,
 * because a second implementation that disagrees shows up as a texture that
 * silently never resolves.
 *
 * A paint rather than an image, because a paint is what `drawInto` needs and
 * building one per frame would allocate on the hot path. In Phase 2 the paint
 * grows a blend mode and colour state and the per-batch selection stays the
 * same shape.
 *
 * ## Ownership
 *
 * The registry owns the paints and shaders it builds, not the `SkImage`s handed
 * to it: those usually come from a React hook that manages their lifetime, and
 * disposing one out from under a picture that has been recorded but not yet
 * rasterised would draw from freed memory. `dispose()` therefore drops the
 * paints and leaves the images alone.
 */
export class SsTextureRegistry {
  private readonly paints = new Map<number, SkPaint>()
  /** Rebuilt lazily so the per-frame `bindings()` allocates nothing. */
  private cachedBindings: SsTextureBinding[] | null = null

  /**
   * Registers `image` under the cellmap called `cellmapName` — the name as the
   * `.ssab` carries it, with no `.ssce` extension.
   */
  register(
    cellmapName: string,
    image: SkImage,
    options?: SsTextureOptions
  ): void {
    this.registerByHash(SsRuntimeModule.hashString(cellmapName), image, options)
  }

  /** As `register`, for a hash already obtained from the Brain. */
  registerByHash(
    textureHash: number,
    image: SkImage,
    options?: SsTextureOptions
  ): void {
    const shader = image.makeShaderOptions(
      options?.tileX ?? TileMode.Clamp,
      options?.tileY ?? TileMode.Clamp,
      options?.filter ?? FilterMode.Linear,
      // No mipmaps: the atlas is sampled in texture-pixel space with UVs the
      // Brain hands over unnormalised, and a mip chain would blur a sprite that
      // is only ever drawn near 1:1.
      MipmapMode.None
    )
    const paint = Skia.Paint()
    paint.setShader(shader)

    this.paints.set(textureHash, paint)
    this.cachedBindings = null
  }

  /** Whether something is already registered — lets a loader skip a re-decode. */
  has(textureHash: number): boolean {
    return this.paints.has(textureHash)
  }

  get size(): number {
    return this.paints.size
  }

  /**
   * The texture table for `SsContext.drawInto`, cached until the registry
   * changes.
   *
   * Order does not matter: `drawInto` resolves each batch against this by hash,
   * so the Brain's batch order — which is the whole of the depth sorting —
   * survives regardless.
   */
  bindings(): SsTextureBinding[] {
    if (this.cachedBindings == null) {
      this.cachedBindings = Array.from(this.paints, ([textureHash, paint]) => ({
        textureHash,
        paint,
      }))
    }
    return this.cachedBindings
  }

  /**
   * Drops one paint, if it is registered. Returns whether it was.
   *
   * For an owner replacing what it put in rather than emptying the registry: a
   * player reloading a different pack has to take its own entries out, and a
   * registry it shares with the caller may hold entries that are not its to
   * drop.
   */
  unregister(textureHash: number): boolean {
    if (!this.paints.delete(textureHash)) return false
    this.cachedBindings = null
    return true
  }

  /** Drops every paint. The images stay alive — see the class comment. */
  dispose(): void {
    this.paints.clear()
    this.cachedBindings = null
  }
}
