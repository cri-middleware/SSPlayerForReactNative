import type { SkCanvas } from '@shopify/react-native-skia'

import { ssImageCache } from '../core/caches'
import type { SsFrameScope } from '../core/fit'
import {
  ssPackColor,
  SsOverridePriority,
  SsPartColorBlend,
  type SsPartOverrides,
} from '../core/parts'
import { SsInternalPlayer } from '../core/SsInternalPlayer'
import {
  SsTextureLoader,
  type SsTextureLoadReport,
} from '../core/SsTextureLoader'
import { SsTextureRegistry } from '../core/SsTextureRegistry'
import {
  SsPlaybackDirection,
  SsPlaybackStyle,
  type SsRootTransform,
} from '../core/types'
import { SsRuntimeModule } from '../runtime'
import type {
  SsBox,
  SsPartTransform,
  SsResource,
  SsUserDataEvent,
} from '../specs/SsRuntime.nitro'
import {
  loadInstancePacks,
  loadResource,
  releaseResource,
  type LoadedResource,
  type SsSource,
} from './source'

/**
 * The transport surface, with no drawing backend in it.
 *
 * Stated as an interface on purpose: Phase 3 serves react-native-web from the
 * existing `@spritestudio/ssplayer-webgl` rather than a port, and only this API
 * and the Layer 4 prop types are shared between the two. Anything Skia-shaped
 * belongs on the class below, not here.
 */
export interface SpriteStudioPlayerApi {
  readonly frameNo: number
  readonly isPlaying: boolean
  readonly isFinished: boolean
  readonly currentAnimation: string | null

  play(): void
  pause(): void
  stop(): void
  setAnimation(name: string): boolean
  /**
   * Every animation in the loaded pack, in the order the `.ssab` lists them.
   *
   * Empty until a load finishes, so a caller building a picker off it should
   * read it from `onLoad` rather than on mount. The names are exactly what
   * `setAnimation` takes — there is no separate id, which is why this is worth
   * exposing rather than making callers hard-code a list that the next
   * conversion can invalidate.
   */
  getAnimationNames(): string[]
  seek(frameNo: number): void
  /** Multiplier on the authored frame rate; negative plays backwards. */
  setSpeed(rate: number): void
  /** 0 = infinite. */
  setLoop(loops: number): void
  /**
   * Advances the clock by `dtMilliseconds`. The default drive — see the class
   * comment. Milliseconds is the Brain's unit and is carried unconverted
   * through every layer, so there is no seam for a 1000x to hide in.
   */
  advance(dtMilliseconds: number): void
}

export interface SpriteStudioPlayerOptions {
  /**
   * Share a registry to share decoded textures across players (a root and its
   * instance children routinely use one cellmap). Otherwise the player makes
   * and owns its own.
   */
  textures?: SsTextureRegistry
}

/** Fired once when the configured loops complete. */
export type SsCompleteCallback = () => void

/**
 * What to measure the content box over, and how far.
 *
 * The cost is a bake per frame walked, so the scope is the caller's call:
 * `animation` walks one, `pack` walks every animation in the file. Measured on
 * a debug-built Brain, `Ringo`'s 24 animations at 120 frames each took 1.3s;
 * `Basic`'s single one took 16ms. Release is far faster and the resource cache
 * makes it once-per-pack, but the ratio between the two scopes is the point.
 */
export interface SsMeasureRequest {
  scope: SsFrameScope
  /**
   * Frames to walk per animation; 0 walks one authored cycle.
   *
   * A cycle is right for a character and wrong for an effect, whose extent keeps
   * growing for as long as it is simulated — `e030`'s box only settles after a
   * couple of hundred frames.
   */
  maxFrames?: number
}

/**
 * The largest step a clock will hand to `advance`, in milliseconds (~15fps).
 *
 * Without it, returning from the background delivers one enormous delta and the
 * animation fast-forwards through every frame it missed — including firing
 * every event on them.
 */
export const MAX_STEP_MS = 1000 / 15

/**
 * Layer 3 — the user-facing player: transport, clock and events.
 *
 * **Externally clocked by default.** `advance(dt)` is the drive, called by
 * `<SpriteStudioView>` from its frame loop, so the whole tree ticks off one
 * clock instead of N. `startClock()` exists for headless use, where there is no
 * view to do it.
 *
 * Everything below `advance`/`draw` is Layer 2's; everything above is React's.
 * This layer holds the resource, applies transport settings that were set
 * before a load finished, and turns the Brain's `isFinished` *state* into a
 * one-shot event.
 */
export class SpriteStudioPlayer implements SpriteStudioPlayerApi {
  private internalPlayer: SsInternalPlayer | null = null
  private resource: SsResource | null = null
  /**
   * The packs this animation's Instance parts mount, owned here because they
   * were loaded here. Disposed with the player, after the context that mounted
   * them — the Brain refcounts a resource, but the order still states the
   * dependency.
   */
  private instancePacks: LoadedResource[] = []
  /** The URI `resource` was leased under, for giving the lease back. */
  private resourceUri: string | null = null
  private disposed = false

  /**
   * Bumped by every `load()`. An in-flight load whose token no longer matches
   * has been superseded (or the player disposed) and must drop what it built
   * instead of installing it.
   */
  private loadToken = 0

  private animation: string | null = null
  private wasFinished = false

  /** Pending transport settings, replayed onto each newly loaded animation. */
  private readonly settings = {
    speed: 1,
    loops: 0,
    playing: true,
    direction: SsPlaybackDirection.forward as SsPlaybackDirection,
    style: SsPlaybackStyle.normal as SsPlaybackStyle,
  }

  private root: SsRootTransform | null = null

  /** What `load()` was asked to measure, kept so a later `setAnimation` can redo it. */
  /**
   * The last override map, replayed onto each newly loaded animation for the
   * same reason the transport settings are: `setupAnimation` is a fresh start,
   * and a prop that survives a source change should survive it here too.
   */
  private pendingOverrides: SsPartOverrides | null = null
  /** Parts the last map touched, so dropping one from it can revert just that one. */
  private readonly overriddenParts = new Set<string>()

  private measureRequest: SsMeasureRequest | null = null
  private contentBoxValue: SsBox | null = null

  private clock: ReturnType<typeof requestAnimationFrame> | null = null

  /** Fires on the rising edge of the Brain's `isFinished`, so once per run. */
  onComplete: SsCompleteCallback | null = null
  /** Fires on any frame the playhead crossed a loop boundary. */
  onLoop: SsCompleteCallback | null = null
  /**
   * Fires once per user-data key the playhead crossed, in `advance`.
   *
   * Only read from Layer 1 when something is listening — the Brain rebuilds its
   * list every collection, so a tick nobody watched costs nothing.
   */
  onUserData: ((event: SsUserDataEvent) => void) | null = null

  private readonly listeners = new Set<() => void>()

  readonly textures: SsTextureRegistry
  /** A supplied registry is the caller's to release; one we made is ours. */
  private readonly ownsTextures: boolean

  constructor(options?: SpriteStudioPlayerOptions) {
    this.ownsTextures = options?.textures == null
    this.textures = options?.textures ?? new SsTextureRegistry()
  }

  // --- loading -----------------------------------------------------------

  /**
   * Loads a `.ssab` and, optionally, sets up an animation in it.
   *
   * Replaces whatever was loaded before. Safe to call again while a previous
   * load is still in flight: the older one is discarded rather than racing the
   * newer one into place.
   */
  async load(
    source: SsSource,
    options?: {
      animation?: string
      loadTextures?: boolean
      /**
       * Measure the content box while loading, for `fit` to place against.
       *
       * Off by default because it costs a bake of every frame it walks, and a
       * caller who supplies a `frame` — or wants the old scale-1 placement —
       * should not pay for it. See `SsMeasureRequest`.
       */
      measure?: SsMeasureRequest
    }
  ): Promise<void> {
    const token = ++this.loadToken
    const { resource, uri } = await loadResource(source)

    if (token !== this.loadToken || this.disposed) {
      // Superseded mid-flight. The lease goes back rather than the resource
      // being disposed: another player may be holding the same pack, and the
      // cache disposes it only when the last lease goes.
      releaseResource(uri)
      return
    }

    // The packs this one's Instance parts mount, transitively. Loaded before the
    // context exists because binding has to happen before `setupAnimation`, and
    // it is a second await, so the supersede check has to run again after it.
    const packs = await loadInstancePacks(resource, uri)
    if (token !== this.loadToken || this.disposed) {
      for (const pack of packs) releaseResource(pack.uri)
      releaseResource(uri)
      return
    }

    this.releaseNative()
    this.resource = resource
    this.resourceUri = uri
    this.instancePacks = packs
    const internal = new SsInternalPlayer(resource, this.textures)
    // Before `setAnimation` below, which is what spawns the child players — a
    // pack bound after that has nothing left to reach.
    for (const pack of packs) internal.bindInstancePack(pack.resource)
    if (this.root != null) internal.rootTransform = { ...this.root }
    this.internalPlayer = internal

    // No name given means "just play the pack", not "render nothing". A resource
    // that has had no `setup_animation` has no animation selected at all, so it
    // draws an empty canvas — a silent and thoroughly unhelpful default for
    // `<SpriteStudioView source={…} />` with no `animation` prop. The pack's
    // first is the only defensible choice, and it is what `currentAnimation`
    // will then report, so a caller can still find out what it got.
    const requested = options?.animation ?? internal.getAnimationNames()[0]

    // Before `setAnimation`, which is the ordering Layer 1 requires: measuring
    // walks each animation's frames and leaves the last one set up, so it has to
    // happen while there is still a `setupAnimation` to come. Storing the
    // request as well as the result is what lets an *animation*-scoped box be
    // re-measured when the animation changes.
    this.measureRequest = options?.measure ?? null
    if (this.measureRequest != null && requested != null) {
      this.remeasure(requested)
    }

    if (requested != null) this.setAnimation(requested)
    else this.applySettings()

    this.notify()

    if (options?.loadTextures === false) return

    // The pack names its own textures, so load them rather than making the
    // caller do it: `image_path` is relative to the `.ssab`, and `uri` is where
    // the `.ssab` came from. Anything already registered is left alone, so a
    // caller-supplied texture wins.
    //
    // After `notify()` on purpose — the animation is usable the moment the
    // context exists, and holding the load open for a texture fetch would delay
    // the first frame for no reason. It simply draws nothing until they arrive.
    const report = await SsTextureLoader.load(
      this.textures,
      internal.getTextures(),
      uri
    )
    if (token !== this.loadToken || this.disposed) {
      // The leases this pass took belong to a load that is no longer wanted.
      for (const key of report.imageKeys) ssImageCache.release(key)
      return
    }
    this.lastTextureReport = report
    this.imageKeys = report.imageKeys

    // A missing texture is otherwise **silent**: `drawInto` skips a batch it has
    // no paint for, so the symptom is a part that is simply not there, and a
    // pack that resolved none of its textures draws nothing at all. Both read as
    // "the renderer broke" rather than "the atlas is not next to the .ssab".
    // Dev only — a release build should not pay for the string work, and an app
    // that wants this in production has `lastTextureReport`.
    if (__DEV__ && report.unresolved.length > 0) {
      console.warn(
        `react-native-spritestudio: '${uri}' resolved ` +
          `${report.imageKeys.length}/${report.imageKeys.length + report.unresolved.length}` +
          ` textures. Missing: ${report.unresolved.join(', ')}. Those parts will not draw.`
      )
    }
    this.notify()
  }

  /**
   * What the last load could not resolve, or null before the first one.
   *
   * Worth surfacing because a missing texture is silent: `drawInto` skips a
   * batch it has no paint for, so the symptom is a part that is simply not
   * there rather than an error.
   */
  get lastTextureReport(): SsTextureLoadReport | null {
    return this.textureReport
  }
  private set lastTextureReport(value: SsTextureLoadReport | null) {
    this.textureReport = value
  }
  private textureReport: SsTextureLoadReport | null = null
  /** Atlas cache leases taken by the last load, given back on teardown. */
  private imageKeys: string[] = []

  /**
   * Atlas cache keys the last load leased — what `ssPreload` retains so its
   * throwaway player's `dispose` does not evict the very entries it warmed.
   */
  get textureCacheKeys(): string[] {
    return [...this.imageKeys]
  }

  /** The Layer 2 player, or null before the first successful load. */
  get internal(): SsInternalPlayer | null {
    return this.internalPlayer
  }

  get isLoaded(): boolean {
    return this.internalPlayer != null
  }

  // --- transport ---------------------------------------------------------

  get currentAnimation(): string | null {
    return this.animation
  }
  get frameNo(): number {
    return this.internalPlayer?.frameNo ?? 0
  }
  get isPlaying(): boolean {
    return this.internalPlayer?.isPlaying ?? false
  }
  get isFinished(): boolean {
    return this.internalPlayer?.isFinished ?? false
  }
  get fps(): number {
    return this.internalPlayer?.fps ?? 0
  }
  get partCount(): number {
    return this.internalPlayer?.partCount ?? 0
  }

  /** See `SpriteStudioPlayerApi`. Empty before a load completes. */
  getAnimationNames(): string[] {
    return this.internalPlayer?.getAnimationNames() ?? []
  }

  setAnimation(name: string): boolean {
    this.animation = name
    const internal = this.internalPlayer
    if (internal == null) return false

    // An animation-scoped box describes *this* animation, so switching makes it
    // stale. A pack-scoped one is the union over the whole file and does not
    // change — which is the point of asking for it.
    if (this.measureRequest?.scope === 'animation' && this.contentBoxValue != null) {
      this.remeasure(name)
    }

    if (!internal.setupAnimation(name)) return false
    // setup resets playback, so the settings have to be replayed onto it — the
    // same reason they are replayed after a load.
    this.wasFinished = false
    this.applySettings()
    this.notify()
    return true
  }

  /**
   * Plays: resumes if paused, otherwise starts from the beginning.
   *
   * Layer 1 keeps the two apart because the Brain does — `ss_runtime_play`
   * rewinds. Up here they are one verb, so `playing={false}` → `playing={true}`
   * carries on rather than restarting, and `stop()` then `play()` restarts.
   */
  play(): void {
    this.settings.playing = true
    this.wasFinished = false
    const internal = this.internalPlayer
    if (internal != null) {
      // Resume only a *running* transport that happens to be paused. Pausing
      // one that never started leaves `isPausing` true with `isPlaying` false,
      // and resuming that would clear the pause flag without starting anything.
      if (internal.isPausing && internal.isPlaying) internal.resume()
      else internal.play()
    }
    this.notify()
  }

  pause(): void {
    this.settings.playing = false
    this.internalPlayer?.pause()
    this.notify()
  }

  /** Halts where it stands. The next `play()` starts from the beginning. */
  stop(): void {
    this.settings.playing = false
    this.wasFinished = false
    this.internalPlayer?.stop()
    this.notify()
  }

  seek(frameNo: number): void {
    this.internalPlayer?.seek(frameNo)
    this.notify()
  }

  setSpeed(rate: number): void {
    this.settings.speed = rate
    this.internalPlayer?.setSpeed(rate)
  }

  setLoop(loops: number): void {
    this.settings.loops = loops
    this.internalPlayer?.setLoop(loops)
  }

  setPlaybackDirection(
    direction: SsPlaybackDirection,
    style: SsPlaybackStyle = SsPlaybackStyle.normal
  ): void {
    this.settings.direction = direction
    this.settings.style = style
    this.internalPlayer?.setPlaybackDirection(direction, style)
  }

  /**
   * Replays the transport settings onto a freshly set-up animation.
   *
   * The order matters and is not decorative: `setup_animation` resets the loop
   * count to its default, and `play` arms the counter with whatever is in effect
   * at that moment (`30_core/20_playback_control.md`). So `setLoop` has to come
   * before `play`, not after.
   */
  private applySettings(): void {
    const internal = this.internalPlayer
    if (internal == null) return
    internal.setLoop(this.settings.loops)
    internal.setSpeed(this.settings.speed)
    internal.setPlaybackDirection(this.settings.direction, this.settings.style)
    if (this.settings.playing) internal.play()
    else internal.pause()
    // After `setup_animation`, which resets the override layer along with
    // everything else — and after the part indices are therefore valid again,
    // since they are resolved against the animation that is now set up.
    if (this.pendingOverrides != null) {
      this.overriddenParts.clear()
      this.setPartOverrides(this.pendingOverrides)
    }
  }

  // --- parts -------------------------------------------------------------

  /**
   * Where a part is this frame, in player-local units, or null if it has no
   * matrix — an unknown name, or a frame before the first `advance`.
   *
   * Player-local: `rootTransform` still has to be applied to reach the screen,
   * and `ssProjectPart` is what does that.
   */
  getPartTransform(part: string | number): SsPartTransform | null {
    const internal = this.internalPlayer
    if (internal == null) return null
    const index =
      typeof part === 'number' ? part : internal.findPartIndex(part)
    if (index < 0) return null
    const transform = internal.getPartTransform(index)
    return transform.valid ? transform : null
  }

  /**
   * Applies a whole override map, and **clears what a previous one set**.
   *
   * Declarative rather than incremental: a part that has dropped out of the map
   * goes back to the animation, which is what makes the map describe the state
   * rather than a history of calls. That is also why `clearPartOverrides` is not
   * enough on its own — it would clear overrides another caller set through the
   * escape hatch, so only the parts this method last touched are reverted.
   */
  setPartOverrides(overrides: SsPartOverrides): void {
    const internal = this.internalPlayer
    if (internal == null) {
      this.pendingOverrides = overrides
      return
    }
    this.pendingOverrides = overrides

    for (const name of this.overriddenParts) {
      if (name in overrides) continue
      const index = internal.findPartIndex(name)
      if (index < 0) continue
      internal.clearPartVisibility(index)
      internal.clearPartColor(index)
      internal.clearPartCell(index)
    }
    this.overriddenParts.clear()

    for (const [name, override] of Object.entries(overrides)) {
      const index = internal.findPartIndex(name)
      if (index < 0) {
        console.warn(
          `react-native-spritestudio: no part called '${name}' in ` +
            `'${this.animation ?? '(no animation)'}' — its override is ignored.`
        )
        continue
      }
      this.overriddenParts.add(name)
      const priority = override.priority ?? SsOverridePriority.permanent

      if (override.visible == null) internal.clearPartVisibility(index)
      else {
        internal.setPartVisibility(
          index,
          override.visible ? 2 : 1,
          override.cascade ?? true
        )
      }

      if (override.color == null) internal.clearPartColor(index)
      else {
        internal.setPartColor(
          index,
          override.colorBlend ?? SsPartColorBlend.mix,
          ssPackColor(override.color),
          priority
        )
      }

      if (override.cell == null) internal.clearPartCell(index)
      else {
        internal.setPartCell(
          index,
          SsRuntimeModule.hashString(override.cell.cellmap),
          SsRuntimeModule.hashString(override.cell.cell),
          priority
        )
      }
    }
  }

  // --- content box -------------------------------------------------------

  /**
   * The box the art occupies, in player-local units, or null when nothing has
   * been measured. What `fit` places against.
   *
   * Null is not a failure — it is what a player loaded without a `measure`
   * request reports, and Layer 4 falls back to the unfitted placement.
   */
  get contentBox(): SsBox | null {
    return this.contentBoxValue
  }

  /**
   * Re-measures for `animation` under the standing request.
   *
   * Leaves the context set up on whichever animation was measured last, which is
   * why every caller here follows it with `setupAnimation`.
   */
  private remeasure(animation: string): void {
    const internal = this.internalPlayer
    const request = this.measureRequest
    if (internal == null || request == null) return
    const names =
      request.scope === 'pack' ? internal.getAnimationNames() : [animation]
    if (names.length === 0) return
    const box = internal.measureContentBox(names, request.maxFrames ?? 0)
    // A zero-sized box means nothing drew — keep null rather than publishing a
    // box that a fit would divide by.
    this.contentBoxValue = box.width > 0 && box.height > 0 ? box : null
    this.notify()
  }

  // --- root transform ----------------------------------------------------

  /**
   * Where the origin lands and how it is scaled/mirrored. Held here as well as
   * on Layer 2 so it can be set before a load and survive one.
   */
  get rootTransform(): SsRootTransform | null {
    return this.internalPlayer?.rootTransform ?? this.root
  }

  setRootTransform(value: SsRootTransform): void {
    this.root = { ...value }
    const internal = this.internalPlayer
    if (internal != null) internal.rootTransform = { ...value }
  }

  // --- frame -------------------------------------------------------------

  /**
   * Advances the animation and dispatches the frame's events.
   *
   * `isFinished` is a *state* the Brain latches until the next play/setup, so
   * `onComplete` is fired off its rising edge — polling the state itself would
   * fire it on every frame after the end.
   */
  advance(dtMilliseconds: number): void {
    const internal = this.internalPlayer
    if (internal == null || internal.isDisposed) return

    internal.advance(dtMilliseconds)

    if (internal.isLooped) this.onLoop?.()

    // Two gates, both on the hot path. Nothing is lost by skipping: the Brain
    // rebuilds this list on every collection, so an unread tick's events are
    // simply overwritten rather than queued. Without the gates this would be a
    // vector allocation and a Nitro array marshal per player per frame, sixty
    // times a second, almost always to report nothing.
    if (this.onUserData != null && internal.passedEventCount > 0) {
      for (const event of internal.getUserDataEvents()) this.onUserData(event)
    }

    const finished = internal.isFinished
    if (finished && !this.wasFinished) this.onComplete?.()
    this.wasFinished = finished
  }

  /** Draws the current frame. Returns the number of vertices drawn. */
  draw(canvas: SkCanvas): number {
    const internal = this.internalPlayer
    if (internal == null || internal.isDisposed) return 0
    return internal.draw(canvas)
  }

  // --- fallback clock ----------------------------------------------------

  /**
   * Self-drives the animation off `requestAnimationFrame`.
   *
   * Only for a player with no view attached — `<SpriteStudioView>` clocks its
   * player itself, and running both would advance every frame twice.
   */
  startClock(): void {
    if (this.clock != null || this.disposed) return
    let last = performance.now()
    const tick = (): void => {
      const now = performance.now()
      // `performance.now()` is already milliseconds, which is the unit
      // `advance` wants — no conversion in either direction. Capped so a
      // backgrounded app does not resume by fast-forwarding through every frame
      // it missed.
      this.advance(Math.min(now - last, MAX_STEP_MS))
      last = now
      this.clock = requestAnimationFrame(tick)
    }
    this.clock = requestAnimationFrame(tick)
  }

  stopClock(): void {
    if (this.clock == null) return
    cancelAnimationFrame(this.clock)
    this.clock = null
  }

  // --- change notification ----------------------------------------------

  /** Subscribes to load/transport changes. Returns the unsubscribe. */
  addListener(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private notify(): void {
    for (const listener of this.listeners) listener()
  }

  // --- teardown ----------------------------------------------------------

  private releaseNative(): void {
    // Order matters: the context borrows from the resource, so it goes first.
    // That covers the child players too — they are inside the context and go
    // down with it, which is why the mounted packs can only be released after.
    this.internalPlayer?.dispose()
    this.internalPlayer = null
    // Leases, not handles: the cache disposes the resource when the last player
    // holding it lets go. Order still matters for the same reason it did — the
    // context borrows from the resource, so it goes first.
    this.resource = null
    if (this.resourceUri != null) releaseResource(this.resourceUri)
    this.resourceUri = null
    for (const pack of this.instancePacks) releaseResource(pack.uri)
    this.instancePacks = []
    for (const key of this.imageKeys) ssImageCache.release(key)
    this.imageKeys = []
  }

  /**
   * Releases every native handle. Explicit, never left to GC (design doc
   * ch.9 F). Idempotent.
   */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    // Invalidates any load still in flight, so it releases what it built
    // instead of installing it into a disposed player.
    this.loadToken++
    this.stopClock()
    this.releaseNative()
    if (this.ownsTextures) this.textures.dispose()
    this.listeners.clear()
  }
}
