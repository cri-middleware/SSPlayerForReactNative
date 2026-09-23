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
 * `cellmap.name_hash` → the `SkPaint` its batches draw with.
 *
 * The hash is what `DrawBatch.texture_hash` carries, so this is the whole of
 * texture resolution — mirrors the sibling ports' hash-keyed texture map (Godot
 * `_textures`, Flutter `TextureRegistry`, Unity's material map). Hashes come
 * from the Brain via `SsRuntime.hashString`; **never** re-implement FNV-1a here,
 * because a second implementation that disagrees shows up as a texture that
 * silently never resolves.
 *
 * A paint rather than an image, because a paint is what `drawInto` needs and
 * building one per frame would allocate on the hot path. The blend mode and the
 * colour state ride on that same paint, and the per-batch selection did not have
 * to change shape to carry them.
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
   * The paint a hash carried when a runtime {@link override} first displaced it,
   * so {@link restore} can put back exactly what the pack had loaded. `null`
   * records that the hash carried nothing at that moment — restoring then simply
   * drops the entry rather than resurrecting a paint that never existed.
   */
  private readonly baseUnderOverride = new Map<number, SkPaint | null>()

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

  /**
   * Replaces the paint for `textureHash` with a runtime `image`, remembering the
   * paint it displaced so {@link restore} can bring it back.
   *
   * This is the runtime texture-replacement seam — a costume change or a dynamic
   * expression driven from code rather than the authoring data. It
   * is keyed by the same hash `DrawBatch.texture_hash` carries, so the swap takes
   * effect on the next `drawInto` with nothing else to do.
   *
   * Distinct from {@link registerByHash} only in that it captures the base: a
   * plain re-register (what a loader does) is not an override and leaves nothing
   * to restore to.
   */
  override(
    textureHash: number,
    image: SkImage,
    options?: SsTextureOptions
  ): void {
    // Only the FIRST override captures the base: a second one before a restore
    // is displacing another override, not the pack's own paint, and recording it
    // would make `restore` hand back the intermediate image instead of the
    // original.
    if (!this.baseUnderOverride.has(textureHash)) {
      this.baseUnderOverride.set(textureHash, this.paints.get(textureHash) ?? null)
    }
    this.registerByHash(textureHash, image, options)
  }

  /** Whether `textureHash` currently carries a runtime {@link override}. */
  isOverridden(textureHash: number): boolean {
    return this.baseUnderOverride.has(textureHash)
  }

  /**
   * Undoes an {@link override}, putting back the paint the pack had loaded — or
   * dropping the entry when the override went on before any paint was there.
   * Returns whether an override was actually in effect.
   */
  restore(textureHash: number): boolean {
    if (!this.baseUnderOverride.has(textureHash)) return false
    const base = this.baseUnderOverride.get(textureHash) ?? null
    this.baseUnderOverride.delete(textureHash)
    if (base == null) this.paints.delete(textureHash)
    else this.paints.set(textureHash, base)
    this.cachedBindings = null
    return true
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
    // Drop any override bookkeeping alongside the paint: an entry taken out from
    // under an override has no base left to restore to, and leaving the record
    // behind would make a later `override` of the same hash treat a stale paint
    // as the pack's own.
    this.baseUnderOverride.delete(textureHash)
    if (!this.paints.delete(textureHash)) return false
    this.cachedBindings = null
    return true
  }

  /** Drops every paint. The images stay alive — see the class comment. */
  dispose(): void {
    this.paints.clear()
    this.baseUnderOverride.clear()
    this.cachedBindings = null
  }
}
