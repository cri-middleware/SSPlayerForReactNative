import type { SkCanvas } from '@shopify/react-native-skia'

import { SsRuntimeModule } from '../runtime'
import type { SsContext, SsResource } from '../specs/SsRuntime.nitro'
import { SsTextureRegistry } from './SsTextureRegistry'
import {
  SS_ROOT_TRANSFORM_IDENTITY,
  type SsPlaybackDirection,
  type SsPlaybackStyle,
  type SsRootTransform,
} from './types'

/**
 * Layer 2 — the internal player: native-handle lifecycle, the root transform,
 * and one draw call per frame.
 *
 * Phase 0 left this layer thin on purpose. Once the batch walk, the geometry
 * bake and the Skia calls all moved into C++ (`docs/phase0-spike.md`), what is
 * left up here is lifetime and placement, not rendering — `draw()` is a canvas
 * transform and a single `drawInto`, whatever the vertex count.
 *
 * **Imports nothing from `react` or `react-native`**, which is what keeps a
 * headless test, a non-React renderer and the Phase 3 react-native-web route
 * possible. Skia is fair game: it is the drawing backend, not the UI framework.
 *
 * ## Ownership
 *
 * Owns the `SsContext` and disposes it. Does **not** own the `SsResource`: one
 * `.ssab` backs any number of players, and the Brain refcounts it internally.
 * Whoever loaded it disposes it.
 */
export class SsInternalPlayer {
  private context: SsContext | null
  private disposed = false

  readonly textures: SsTextureRegistry
  /**
   * Whether `dispose()` may release the registry. A supplied one is the
   * caller's — it usually outlives this player and is shared with its siblings.
   */
  private readonly ownsTextures: boolean

  /**
   * Where the animation's origin lands and how it is scaled/mirrored. Applied
   * exactly once, in `draw()` — see `SsRootTransform`.
   */
  rootTransform: SsRootTransform = { ...SS_ROOT_TRANSFORM_IDENTITY }

  constructor(resource: SsResource, textures?: SsTextureRegistry) {
    this.context = SsRuntimeModule.createContext(resource)
    this.ownsTextures = textures == null
    this.textures = textures ?? new SsTextureRegistry()
  }

  /** The Layer 1 handle, for callers that need the escape hatch. Null once disposed. */
  get native(): SsContext | null {
    return this.context
  }

  get isDisposed(): boolean {
    return this.disposed
  }

  private require(): SsContext {
    if (this.context == null) {
      throw new Error('SsInternalPlayer: used after dispose()')
    }
    return this.context
  }

  // --- lifecycle ---------------------------------------------------------

  setupAnimation(name: string): boolean {
    return this.require().setupAnimation(name)
  }

  /** Advances the Brain by `dtSeconds` and returns the new frame number. */
  advance(dtSeconds: number): number {
    return this.require().update(dtSeconds)
  }

  /**
   * Draws the current frame.
   *
   * The transform is composed here and nowhere else (design doc ch.3 C). The
   * base Y scale is **negative** because SpriteStudio authors Y-up and Skia's
   * canvas is Y-down; `flipY` toggles that sign rather than adding a second
   * flip, so a flipped player still lands the same way up.
   *
   * Returns the number of vertices drawn — 0 when nothing was drawn, including
   * when no texture is registered yet.
   */
  draw(canvas: SkCanvas): number {
    const context = this.require()
    const bindings = this.textures.bindings()
    if (bindings.length === 0) return 0

    const t = this.rootTransform
    canvas.save()
    try {
      canvas.translate(t.x, t.y)
      canvas.scale(
        t.flipX ? -t.scale : t.scale,
        t.flipY ? t.scale : -t.scale
      )
      return context.drawInto(canvas, bindings)
    } finally {
      // The canvas is the caller's, and RN Skia keeps drawing into it after we
      // return: an unbalanced save() would leak this player's transform onto
      // everything drawn next.
      canvas.restore()
    }
  }

  /**
   * Releases the native context.
   *
   * Explicit rather than left to GC (design doc ch.9 F): every ArrayBuffer L1
   * ever handed out is a borrow of memory this context owns. Idempotent.
   */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    if (this.ownsTextures) this.textures.dispose()
    this.context?.dispose()
    this.context = null
  }

  // --- transport ---------------------------------------------------------
  //
  // Straight through to the Brain, which owns the playback state. Mirroring it
  // here would give two answers to "which frame is this".

  get frameNo(): number {
    return this.context?.frameNo ?? 0
  }
  get partCount(): number {
    return this.context?.partCount ?? 0
  }
  get isPlaying(): boolean {
    return this.context?.isPlaying ?? false
  }
  get isPausing(): boolean {
    return this.context?.isPausing ?? false
  }
  /** A state, not a pulse — take its rising edge for a one-shot completion. */
  get isFinished(): boolean {
    return this.context?.isFinished ?? false
  }
  get isLooped(): boolean {
    return this.context?.isLooped ?? false
  }
  get fps(): number {
    return this.context?.fps ?? 0
  }
  get startFrame(): number {
    return this.context?.startFrame ?? 0
  }
  get endFrame(): number {
    return this.context?.endFrame ?? 0
  }

  play(): void {
    this.require().play()
  }
  playFrom(frameNo: number): void {
    this.require().playFrom(frameNo)
  }
  pause(): void {
    this.require().pause()
  }
  stop(): void {
    this.require().stop()
  }
  seek(frameNo: number): void {
    this.require().setFrameNo(frameNo)
  }
  /** 0 = infinite. */
  setLoop(loops: number): void {
    this.require().setLoop(loops)
  }
  setSpeed(rate: number): void {
    this.require().setSpeed(rate)
  }
  setPlaybackDirection(
    direction: SsPlaybackDirection,
    style: SsPlaybackStyle
  ): void {
    this.require().setPlaybackDirection(direction, style)
  }
  setSkipFrames(skip: boolean): void {
    this.require().setSkipFrames(skip)
  }
  setSection(startFrame: number, endFrame: number): void {
    this.require().setSection(startFrame, endFrame)
  }

  /** Part index for `partName`, or -1. */
  findPartIndex(partName: string): number {
    return this.require().findPartIndex(partName)
  }
}
