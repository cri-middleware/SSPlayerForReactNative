import type { SkCanvas } from '@shopify/react-native-skia'

import { SsRuntimeModule } from '../runtime'
import type {
  SsBox,
  SsContext,
  SsPartTransform,
  SsResource,
  SsTextureInfo,
  SsUserDataEvent,
} from '../specs/SsRuntime.nitro'
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

  /**
   * Makes `pack` available to this player's Instance parts.
   *
   * **Before `setupAnimation`**, which is when the child players are spawned —
   * Layer 1 refuses a late binding rather than accepting one that can no longer
   * reach anything.
   */
  bindInstancePack(pack: SsResource): boolean {
    return this.require().bindInstancePack(pack)
  }

  setupAnimation(name: string): boolean {
    return this.require().setupAnimation(name)
  }

  /**
   * Advances the Brain by `dtMilliseconds` and returns the new frame number.
   *
   * **Milliseconds all the way down** — the Brain's unit, named in every
   * signature that carries it. Seconds anywhere in this chain would mean a
   * conversion, and a missed conversion is a silent 1000x, not an error.
   */
  advance(dtMilliseconds: number): number {
    return this.require().update(dtMilliseconds)
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
  /** Transport running. **Stays true while paused** — see `isPausing`. */
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

  /** Starts from the beginning — not a resume. See `resume()`. */
  play(): void {
    this.require().play()
  }
  playFrom(frameNo: number): void {
    this.require().playFrom(frameNo)
  }
  /** Idempotent, unlike the C-API's toggle. */
  pause(): void {
    this.require().pause()
  }
  /** Idempotent. Carries on from where `pause()` left off. */
  resume(): void {
    this.require().resume()
  }
  /** Halts where it stands; does not rewind. */
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

  /**
   * The box `animations` draw into, in player-local units — see the spec.
   *
   * **Moves the playhead and leaves the last name set up**, so it belongs
   * between `bindInstancePack` and `setupAnimation` rather than anywhere a
   * query could go.
   */
  measureContentBox(animations: string[], maxFrames = 0): SsBox {
    return this.require().measureContentBox(animations, maxFrames)
  }

  /**
   * Every texture this pack needs, read out of the `.ssab` in C++.
   *
   * The `embedded` buffers are borrows of the Brain's copy — decode them during
   * the call that asked for them and do not retain them.
   */
  getTextures(): SsTextureInfo[] {
    return this.require().getTextures()
  }

  /** Where part `partIndex` is this frame, in player-local units. */
  getPartTransform(partIndex: number): SsPartTransform {
    return this.require().getPartTransform(partIndex)
  }

  /** Events the last `advance` crossed — the cheap gate in front of the next one. */
  get passedEventCount(): number {
    return this.context?.passedEventCount ?? 0
  }

  /** The user-data keys the last `advance` crossed. A read, not a drain. */
  getUserDataEvents(): SsUserDataEvent[] {
    return this.require().getUserDataEvents()
  }

  // --- the override layer -------------------------------------------------
  //
  // Straight through. The Brain owns the override state, exactly as it owns the
  // playback state, and mirroring either here would give two answers.

  setPartVisibility(partIndex: number, force: number, cascade = true): boolean {
    return this.require().setPartVisibility(partIndex, force, cascade)
  }
  clearPartVisibility(partIndex: number): boolean {
    return this.require().clearPartVisibility(partIndex)
  }
  setPartColor(
    partIndex: number,
    blendOp: number,
    rgba: number,
    priority = 2
  ): boolean {
    return this.require().setPartColor(partIndex, blendOp, rgba, priority)
  }
  clearPartColor(partIndex: number): boolean {
    return this.require().clearPartColor(partIndex)
  }
  setPartCell(
    partIndex: number,
    cellmapNameHash: number,
    cellNameHash: number,
    priority = 2
  ): boolean {
    return this.require().setPartCell(partIndex, cellmapNameHash, cellNameHash, priority)
  }
  clearPartCell(partIndex: number): boolean {
    return this.require().clearPartCell(partIndex)
  }
  clearPartOverrides(): boolean {
    return this.require().clearPartOverrides()
  }

  /** Animation names in this pack, for feeding to `setupAnimation`. */
  getAnimationNames(): string[] {
    return this.require().getAnimationNames()
  }
}
