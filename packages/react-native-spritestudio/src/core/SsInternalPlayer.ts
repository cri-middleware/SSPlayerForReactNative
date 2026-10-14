import type { SkCanvas } from '@shopify/react-native-skia'

import { SsRuntimeModule } from '../runtime'
import type {
  SsAudioEvent,
  SsBox,
  SsContext,
  SsPartTransform,
  SsResource,
  SsSignalEvent,
  SsTextureBinding,
  SsTextureInfo,
  SsUserDataEvent,
} from '../specs/SsRuntime.nitro'
import { SsTextureRegistry } from './SsTextureRegistry'
import {
  SS_ROOT_TRANSFORM_IDENTITY,
  SsPlaybackDirection,
  SsPlaybackStyle,
  type SsRootTransform,
  type SsTrackBlend,
  type SsTrackSync,
} from './types'

/**
 * Layer 2 — the internal player: native-handle lifecycle, the root transform,
 * and one draw call per frame.
 *
 * This layer is thin on purpose. With the batch walk, the geometry bake and the
 * Skia calls all in C++, what is left up here is lifetime and placement, not
 * rendering — `draw()` is a single `drawInto`, whatever the vertex count.
 *
 * **Imports nothing from `react` or `react-native`**, which is what keeps a
 * headless test, a non-React renderer and the react-native-web route
 * possible. Skia is fair game: it is the drawing backend, not the UI framework.
 *
 * ## Ownership
 *
 * Owns the `SsContext` and disposes it. Does **not** own the `SsResource`: one
 * `.ssab` backs any number of players, and the Brain refcounts it internally.
 * Whoever loaded it disposes it.
 *
 * ## Naming
 *
 * **This layer follows the C API, not the Player API conventions.** It takes part
 * *indices* and name *hashes*, and its override methods keep the C API's argument
 * order (`blendOp` before the colour) — so `setSection` and `setPartColor` are
 * the right names here even though `setAnimationSection` and
 * `setPartColorOverride` are the right names one layer up.
 *
 * That list used to be longer. `isLooped` and `fps` were on it, because the C
 * API spelled them that way; it now says `ss_runtime_just_looped` and
 * `ss_runtime_get_frame_rate`, so following the C API and following the
 * vocabulary are the same thing for those two, and this layer says
 * `justLooped` and `frameRate` like everyone else.
 *
 * Layer 3 — `SpriteStudioPlayer` — is where the conventions apply: it takes part
 * names, puts the value before its modifiers, and is what a host should reach for.
 * Coming here means deliberately trading the ergonomics for the raw calls, and
 * the names are the signpost that you have.
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
    const ok = this.require().setupAnimation(name)
    if (ok) this.setUpAnimation = name
    return ok
  }

  /**
   * Why the last call that tracks a reason failed, or `null` when it succeeded.
   *
   * Read it straight after the call that returned false — it describes the LAST
   * failure, not a history. For reporting, not for branching; see the spec.
   */
  get lastErrorMessage(): string | null {
    const message = this.require().lastErrorMessage()
    return message === '' ? null : message
  }

  /**
   * The animation track 0 plays, or null before the first successful
   * `setupAnimation`.
   *
   * Tracked here, at the layer that owns the native context, so that "already
   * set up" cannot be confused with "the name the host most recently asked
   * for". A player is built per load, so this resets with the resource — which
   * is what keeps a second pack that names an animation the same way as the
   * first from being mistaken for one that is already selected.
   *
   * **A `crossfade` or `setTrackAnimation` on track 0 changes it from the
   * call on**, as the Brain changes what track 0 plays from the call on. Left
   * naming the outgoing animation, a `setupAnimation` back to it looked like a
   * re-selection of the one already up, and could never return.
   */
  get currentAnimation(): string | null {
    return this.setUpAnimation
  }

  private setUpAnimation: string | null = null

  /**
   * Advances the Brain by `dtMilliseconds` and returns the new frame number.
   *
   * **Milliseconds all the way down** — the Brain's unit, named in every
   * signature that carries it. Seconds anywhere in this chain would mean a
   * conversion, and a missed conversion is a silent 1000x, not an error.
   */
  advance(dtMilliseconds: number): number {
    const frameNo = this.require().update(dtMilliseconds)
    this.advanced = true
    return frameNo
  }

  /**
   * Whether {@link draw} would draw something other than what it last drew:
   * the frame changed, or the texture table, or the root transform.
   *
   * An `advance` always changes the frame, so it answers true without asking
   * the context. Anything else that changes the frame (a seek, a new
   * animation, an override on a stopped player) is caught by `frameDrawn`.
   */
  get needsDraw(): boolean {
    const context = this.context
    if (context == null) return false
    const bindings = this.textures.bindings()
    if (bindings !== this.drawnBindings) return true
    const t = this.rootTransform
    const d = this.drawnTransform
    if (
      t.x !== d.x ||
      t.y !== d.y ||
      t.scale !== d.scale ||
      t.flipX !== d.flipX ||
      t.flipY !== d.flipY
    ) {
      return true
    }
    // With no textures, `draw` never reaches `drawInto`, so the context's frame
    // is never drawn; and nothing would show anyway.
    if (bindings.length === 0) return false
    return this.advanced || !context.frameDrawn
  }

  private advanced = false
  private drawnBindings: SsTextureBinding[] | null = null
  private drawnTransform: SsRootTransform = { ...SS_ROOT_TRANSFORM_IDENTITY }

  /**
   * Draws the current frame.
   *
   * The transform is composed here and nowhere else. The base Y scale is
   * **positive**: the Brain already runs Y-down (see `HybridSsContext`), so the
   * geometry arrives in Skia's own sense and a negative scale here would flip it
   * back. `flipY` is then a plain mirror, nothing more.
   *
   * Returns the number of vertices drawn — 0 when nothing was drawn, including
   * when no texture is registered yet.
   */
  draw(canvas: SkCanvas): number {
    const context = this.require()
    const bindings = this.textures.bindings()
    const t = this.rootTransform
    const d = this.drawnTransform
    this.advanced = false
    // Only when it changed: the table is an array marshalled across JSI.
    if (bindings !== this.drawnBindings) context.setTextures(bindings)
    this.drawnBindings = bindings
    d.x = t.x
    d.y = t.y
    d.scale = t.scale
    d.flipX = t.flipX
    d.flipY = t.flipY
    if (bindings.length === 0) return 0

    return context.drawInto(
      canvas,
      t.x,
      t.y,
      t.flipX ? -t.scale : t.scale,
      t.flipY ? -t.scale : t.scale
    )
  }

  /**
   * Releases the native context.
   *
   * Explicit rather than left to GC (the lifetime rule in `specs/SsRuntime.nitro.ts`):
   * every ArrayBuffer L1 ever handed out is a borrow of memory this context owns.
   * Idempotent.
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
  /**
   * Whether {@link advance} can change the frame: playing, and not paused
   * unless an effect or instance part keeps its own clock. After track 0 has
   * finished, while another track or a fade still moves — see the spec.
   */
  get advances(): boolean {
    return this.context?.advances ?? false
  }
  /** A state, not a pulse — take its rising edge for a one-shot completion. */
  get isFinished(): boolean {
    return this.context?.isFinished ?? false
  }
  get justLooped(): boolean {
    return this.context?.justLooped ?? false
  }
  /**
   * Which way the playhead is actually travelling — not the configured heading,
   * which is `playbackDirection`. True with no context: forward is the resting
   * state, and the caller that most wants this is an audio gate.
   */
  get isPlayingForward(): boolean {
    return this.context?.isPlayingForward ?? true
  }
  get frameRate(): number {
    return this.context?.frameRate ?? 0
  }
  get startFrame(): number {
    return this.context?.startFrame ?? 0
  }
  get endFrame(): number {
    return this.context?.endFrame ?? 0
  }

  /**
   * Head-out from the section start, or from `startFrame`. **Not a resume** —
   * see `resume()`.
   *
   * One entry point rather than two: the binding's `playFrom` is reached through
   * the argument, which is the shape the conventions give it (`play(startFrame)`).
   */
  play(startFrame?: number): void {
    if (startFrame == null) this.require().play()
    else this.require().playFrom(startFrame)
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
  setLoopCount(loops: number): void {
    this.require().setLoopCount(loops)
  }
  setSpeedScale(rate: number): void {
    this.require().setSpeedScale(rate)
  }
  setPlaybackDirection(
    direction: SsPlaybackDirection,
    style: SsPlaybackStyle
  ): void {
    this.require().setPlaybackDirection(direction, style)
  }
  setFrameSkipEnabled(skip: boolean): void {
    this.require().setSkipFrames(skip)
  }
  setSection(startFrame: number, endFrame: number): void {
    this.require().setSection(startFrame, endFrame)
  }
  setFrameRate(fps: number): void {
    this.require().setFrameRate(fps)
  }
  /**
   * The speed the Brain stored, which is not always the one that was passed:
   * `0` and negatives clamp to a stop, so this reports the stop rather than the
   * request.
   */
  get speedScale(): number {
    return this.context?.speedScale ?? 1
  }

  /** Cycles configured for this run; `-1` is infinite. */
  get loopCount(): number {
    return this.context?.loopCount ?? -1
  }

  /** The configured heading — not `isPlayingForward`, which is the live one. */
  get playbackDirection(): SsPlaybackDirection {
    return (this.context?.playbackDirection ?? SsPlaybackDirection.forward) as SsPlaybackDirection
  }

  /** What the playhead does at the far end of the section. */
  get playbackStyle(): SsPlaybackStyle {
    return (this.context?.playbackStyle ?? SsPlaybackStyle.normal) as SsPlaybackStyle
  }

  /** Whether a long tick may drop frames to stay on the wall clock. */
  get frameSkipEnabled(): boolean {
    return this.context?.skipFrames ?? true
  }

  /** Frames in the range being played, both ends inclusive. */
  get totalFrames(): number {
    const ctx = this.context
    return ctx == null ? 0 : ctx.endFrame - ctx.startFrame + 1
  }

  /** Whether the DISPLAY frame keeps its fraction. See `setSubFrame`. */
  get subFrameEnabled(): boolean {
    return this.context?.subFrame ?? true
  }
  setSubFrameEnabled(enabled: boolean): void {
    this.require().setSubFrame(enabled)
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

  /** The authored canvas of the animation set up, in player-local units — see the spec. */
  canvasBox(): SsBox {
    return this.require().canvasBox()
  }

  /** Every texture this pack needs, read out of the `.ssab` in C++. */
  getTextures(): SsTextureInfo[] {
    return this.require().getTextures()
  }

  /** A copy of embedded texture `textureHash`'s encoded image — see the spec. */
  copyEmbeddedTexture(textureHash: number): ArrayBuffer {
    return this.require().copyEmbeddedTexture(textureHash)
  }

  /** Where part `partIndex` is this frame, in player-local units. */
  getPartTransform(partIndex: number): SsPartTransform {
    return this.require().getPartTransform(partIndex)
  }

  /**
   * Whether part `partIndex` is hidden on the frame being displayed — see the
   * spec.
   *
   * A per-frame read, unlike {@link isPartSkinnedMesh}, so it answers false
   * before the first `advance` (there is no frame yet) as well as once
   * disposed. Same reasoning either way: a query about a player that is not
   * showing anything is not a misuse the way a transport call would be.
   */
  isPartHidden(partIndex: number): boolean {
    return this.context?.isPartHidden(partIndex) ?? false
  }

  /**
   * Whether part `partIndex` is a skinned (bone-bound) mesh — see the spec.
   *
   * A static `.ssab` read, so it answers before the first `advance` and returns
   * false once disposed rather than throwing: a query about a torn-down player
   * is not a misuse the way a transport call would be.
   */
  isPartSkinnedMesh(partIndex: number): boolean {
    return this.context?.isPartSkinnedMesh(partIndex) ?? false
  }

  /** Events the last `advance` crossed — the cheap gate in front of the next one. */
  get passedEventCount(): number {
    return this.context?.passedEventCount ?? 0
  }

  /** The user-data keys the last `advance` crossed. A read, not a drain. */
  getUserDataEvents(): SsUserDataEvent[] {
    return this.require().getUserDataEvents()
  }

  /** The audio keys the last `advance` crossed. A read, not a drain. */
  getAudioEvents(): SsAudioEvent[] {
    return this.require().getAudioEvents()
  }

  /** The signals the last `advance` crossed, inactive ones dropped. */
  getSignalEvents(): SsSignalEvent[] {
    return this.require().getSignalEvents()
  }

  // --- the override layer -------------------------------------------------
  //
  // Straight through. The Brain owns the override state, exactly as it owns the
  // playback state, and mirroring either here would give two answers.

  // Off by default, matching the map layer above and the rest of the family;
  // a keyframed hide never cascades in SpriteStudio, so cascading is the opt-in.
  setPartVisibility(partIndex: number, force: number, cascade = false): boolean {
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

  // --- animation mixing: the track stack -----------------------------------
  //
  // Straight through, with the C API's names and its sentinels: `NaN` for a
  // missing float, `-1` for a missing integer or source handle. Turning those
  // into `null` is Layer 3's, which is also where a refused call is reported.

  /** Tracks that exist, silent ones included. */
  get trackCount(): number {
    return this.context?.trackCount ?? 0
  }
  /** Which animation track 0 plays, as an index into `getAnimationNames()`, or `-1`. */
  get currentAnimationIndex(): number {
    return this.context?.currentAnimationIndex ?? -1
  }

  setTrackAnimation(track: number, name: string): boolean {
    const ok = this.require().setTrackAnimation(track, name)
    if (ok && track === 0) this.setUpAnimation = name
    return ok
  }
  clearTrack(track: number): boolean {
    return this.require().clearTrack(track)
  }
  crossfade(track: number, name: string, durationMs: number): boolean {
    const ok = this.require().crossfade(track, name, durationMs)
    if (ok && track === 0) this.setUpAnimation = name
    return ok
  }
  fadeTrack(track: number, targetAlpha: number, durationMs: number): boolean {
    return this.require().fadeTrack(track, targetAlpha, durationMs)
  }
  getTrackFadeProgress(track: number): number {
    return this.context?.getTrackFadeProgress(track) ?? NaN
  }
  cancelTrackFade(track: number): boolean {
    return this.require().cancelTrackFade(track)
  }
  setTrackAlpha(track: number, alpha: number): boolean {
    return this.require().setTrackAlpha(track, alpha)
  }
  getTrackAlpha(track: number): number {
    return this.context?.getTrackAlpha(track) ?? NaN
  }
  setTrackBlend(track: number, blend: SsTrackBlend): boolean {
    return this.require().setTrackBlend(track, blend)
  }
  getTrackBlend(track: number): number {
    return this.context?.getTrackBlend(track) ?? -1
  }
  setTrackSync(track: number, sync: SsTrackSync): boolean {
    return this.require().setTrackSync(track, sync)
  }
  getTrackSync(track: number): number {
    return this.context?.getTrackSync(track) ?? -1
  }
  setTrackFrame(track: number, frameNo: number): boolean {
    return this.require().setTrackFrame(track, frameNo)
  }
  getTrackFrame(track: number): number {
    return this.context?.getTrackFrame(track) ?? NaN
  }
  setTrackSpeed(track: number, speed: number): boolean {
    return this.require().setTrackSpeed(track, speed)
  }
  getTrackSpeed(track: number): number {
    return this.context?.getTrackSpeed(track) ?? NaN
  }
  setTrackFrameRate(track: number, fps: number): boolean {
    return this.require().setTrackFrameRate(track, fps)
  }
  getTrackFrameRate(track: number): number {
    return this.context?.getTrackFrameRate(track) ?? -1
  }
  setTrackSkipFrames(track: number, skip: boolean): boolean {
    return this.require().setTrackSkipFrames(track, skip)
  }
  getTrackSkipFrames(track: number): boolean {
    return this.context?.getTrackSkipFrames(track) ?? false
  }
  setTrackPlaybackDirection(
    track: number,
    direction: SsPlaybackDirection,
    style: SsPlaybackStyle
  ): boolean {
    return this.require().setTrackPlaybackDirection(track, direction, style)
  }
  getTrackPlaybackDirection(track: number): number {
    return this.context?.getTrackPlaybackDirection(track) ?? -1
  }
  getTrackPlaybackStyle(track: number): number {
    return this.context?.getTrackPlaybackStyle(track) ?? -1
  }
  setTrackLoopCount(track: number, loops: number): boolean {
    return this.require().setTrackLoopCount(track, loops)
  }
  /** `-1` forever, `0` for a track with no animation. */
  getTrackLoopCount(track: number): number {
    return this.context?.getTrackLoopCount(track) ?? 0
  }
  isTrackFinished(track: number): boolean {
    return this.context?.isTrackFinished(track) ?? false
  }
  /** The Brain's pulse, standing until its next update — see Layer 3. */
  trackJustLooped(track: number): boolean {
    return this.context?.trackJustLooped(track) ?? false
  }
  setTrackOutgoingEventThreshold(track: number, threshold: number): boolean {
    return this.require().setTrackOutgoingEventThreshold(track, threshold)
  }
  getTrackOutgoingEventThreshold(track: number): number {
    return this.context?.getTrackOutgoingEventThreshold(track) ?? NaN
  }
  getTrackMainSource(track: number): number {
    return this.context?.getTrackMainSource(track) ?? -1
  }
  addTrackSource(track: number, name: string, weight: number): number {
    return this.require().addTrackSource(track, name, weight)
  }
  setSourceWeight(source: number, weight: number): boolean {
    return this.require().setSourceWeight(source, weight)
  }
  getSourceWeight(source: number): number {
    return this.context?.getSourceWeight(source) ?? NaN
  }
  setSourceFrame(source: number, frameNo: number): boolean {
    return this.require().setSourceFrame(source, frameNo)
  }
  getSourceFrame(source: number): number {
    return this.context?.getSourceFrame(source) ?? NaN
  }
  getSourceAnimationIndex(source: number): number {
    return this.context?.getSourceAnimationIndex(source) ?? -1
  }
  setSourceEventThreshold(source: number, threshold: number): boolean {
    return this.require().setSourceEventThreshold(source, threshold)
  }
  getSourceEventThreshold(source: number): number {
    return this.context?.getSourceEventThreshold(source) ?? NaN
  }

  /**
   * Part names in part-index order, read from the `.ssab` and so available
   * before the first advance.
   *
   * An unnamed part holds its slot as `''`, so the list stays aligned with the
   * `partIndex` every event carries. `length` is the part count — {@link partCount}
   * reads the Brain's matrix count instead, which is zero until the first advance.
   */
  partNames(): string[] {
    return this.context?.partNames() ?? []
  }

  /**
   * Cellmap names in the pack, without the `.ssce` extension — the namespace
   * {@link setPartCell} hashes against.
   */
  cellmapNames(): string[] {
    return this.context?.cellmapNames() ?? []
  }

  /** The cell names inside one cellmap — the other half of what {@link setPartCell} takes. */
  cellNames(cellmapName: string): string[] {
    return this.context?.cellNames(cellmapName) ?? []
  }

  /** Animation names in this pack, for feeding to `setupAnimation`. */
  getAnimationNames(): string[] {
    return this.require().getAnimationNames()
  }
}
