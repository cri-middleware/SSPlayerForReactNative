import type { SkCanvas } from '@shopify/react-native-skia'

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
import type { SsResource } from '../specs/SsRuntime.nitro'
import { loadResource, type SsSource } from './source'

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

  private clock: ReturnType<typeof requestAnimationFrame> | null = null

  /** Fires on the rising edge of the Brain's `isFinished`, so once per run. */
  onComplete: SsCompleteCallback | null = null
  /** Fires on any frame the playhead crossed a loop boundary. */
  onLoop: SsCompleteCallback | null = null

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
    options?: { animation?: string; loadTextures?: boolean }
  ): Promise<void> {
    const token = ++this.loadToken
    const { resource, uri } = await loadResource(source)

    if (token !== this.loadToken || this.disposed) {
      // Superseded mid-flight. Nothing else holds this, so release it here
      // rather than leaving the Brain's copy to sit until GC.
      resource.dispose()
      return
    }

    this.releaseNative()
    this.resource = resource
    const internal = new SsInternalPlayer(resource, this.textures)
    if (this.root != null) internal.rootTransform = { ...this.root }
    this.internalPlayer = internal

    // No name given means "just play the pack", not "render nothing". A resource
    // that has had no `setup_animation` has no animation selected at all, so it
    // draws an empty canvas — a silent and thoroughly unhelpful default for
    // `<SpriteStudioView source={…} />` with no `animation` prop. The pack's
    // first is the only defensible choice, and it is what `currentAnimation`
    // will then report, so a caller can still find out what it got.
    const requested = options?.animation ?? internal.getAnimationNames()[0]
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
    if (token !== this.loadToken || this.disposed) return
    this.lastTextureReport = report
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
    this.internalPlayer?.dispose()
    this.internalPlayer = null
    this.resource?.dispose()
    this.resource = null
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
