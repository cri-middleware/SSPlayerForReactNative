import type { SkCanvas, SkImage } from '@shopify/react-native-skia'

import { ssImageCache } from '../core/caches'
import type { SsFrameScope } from '../core/fit'
import { ssPackColor } from '../core/packColor'
import {
  SsOverridePriority,
  SsBlendOp,
  type SsPartOverrides,
} from '../core/parts'
import { SsInternalPlayer } from '../core/SsInternalPlayer'
import {
  SsTextureLoader,
  type SsTextureLoadReport,
} from '../core/SsTextureLoader'
import {
  SsTextureRegistry,
  type SsTextureOptions,
} from '../core/SsTextureRegistry'
import {
  SsPlaybackDirection,
  SsPlaybackStyle,
  type SsRootTransform,
} from '../core/types'
import { SsRuntimeModule } from '../runtime'
import type {
  SsAudioEvent,
  SsBox,
  SsPartTransform,
  SsResource,
  SsSignalEvent,
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
 * Stated as an interface on purpose: react-native-web is to be served from the
 * existing `@spritestudio/ssplayer-webgl` rather than by a port, and only this API
 * and the Layer 4 prop types are shared between the two. Anything Skia-shaped
 * belongs on the class below, not here.
 */
export interface SpriteStudioPlayerApi {
  readonly frameNo: number
  readonly isPlaying: boolean
  readonly isFinished: boolean
  /** Whether the playhead is travelling forward this frame. Gate audio on it. */
  readonly isPlayingForward: boolean
  readonly currentAnimation: string | null

  /**
   * **Head-out.** Rewinds to the start of the section and re-arms the loop
   * count — it is not a resume, and using it to lift a `pause()` sends the
   * playhead back to the start. That is the Brain's contract, and these four
   * verbs are kept distinct here.
   */
  play(startFrame?: number): void
  /** Holds playback where it stands. Idempotent, ignored while nothing plays. */
  pause(): void
  /**
   * Lifts a {@link pause}, carrying on from the same frame. Idempotent, and a
   * no-op on a stopped animation — starting one is {@link play}'s job.
   */
  resume(): void
  /** Ends playback. Nothing rewinds; the frame it stopped on stays on screen. */
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
  /**
   * Multiplier on the authored frame rate. `0` and negatives **stop** the
   * playhead where it stands rather than turning it around — reversing is
   * `setPlaybackDirection`'s job, not the speed's, and the Brain clamps both to
   * the same stop.
   */
  setSpeedScale(rate: number): void
  /** 0 = infinite. */
  setLoopCount(loops: number): void
  /** Restricts playback to `[startFrame, endFrame]` of the current animation. */
  setAnimationSection(startFrame: number, endFrame: number): void
  /**
   * Whether a long tick may skip frames to stay on the wall clock (the default)
   * or advance exactly one frame, stretching playback instead.
   */
  setFrameSkipEnabled(enabled: boolean): void
  /**
   * Overrides the advance rate, in absolute frames per second. `0` clears the
   * override and hands playback back to whatever each animation was authored at.
   */
  setFrameRate(fps: number): void
  /**
   * Sub-frame interpolation, on by default: whether what is drawn may sit
   * between two authored frames.
   */
  setSubFrameEnabled(enabled: boolean): void
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

/**
 * A lifecycle notification, carrying **which animation** it is about.
 *
 * The name is not decoration: one player outlives the animations mounted on it,
 * so a handler that fires after a `setAnimation` cannot otherwise tell what
 * finished — and a scene of sprites shares one handler across many. The sibling
 * Players pass it for the same reason (`SpriteStudioPlayer2D` emits every one of
 * its four animation signals with `anim_name`).
 */
export type SsAnimationCallback = (animation: string) => void

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

  /**
   * Pending transport settings, replayed onto each newly set-up animation.
   *
   * The loop count has to be here: the Brain resets it on every transition,
   * because a transition is what states a count. The rest is here so a value
   * chosen *before* a resource exists still lands — the Brain keeps the speed
   * and the direction across a setup on its own.
   *
   * Whether it is **playing** is deliberately absent. Starting playback is
   * `play()`'s job and nothing else's; folding it into a load or a switch is
   * what made `setAnimation` start the animation it was only asked to select.
   */
  private readonly settings = {
    speed: 1,
    loops: 0,
    skipFrames: true,
    // `null` rather than a number: a rate the host never chose must not be
    // pushed, or the clip's authored rate becomes an override that then follows
    // the player onto clips authored at a different one.
    frameRate: null as number | null,
    subFrame: true,
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
  onAnimationFinished: SsAnimationCallback | null = null
  /** Fires on any frame the playhead crossed a loop boundary. */
  onAnimationLooped: SsAnimationCallback | null = null
  /**
   * Fires when playback **starts from the beginning** — not on resume.
   *
   * Layer 3 folds start and resume into one `play()` verb because that is what a
   * `playing` prop means, but they are different events: one rewinds and re-arms
   * the loop counter, the other carries on. This is the first of the two, which
   * is the one worth reacting to.
   */
  onAnimationStarted: SsAnimationCallback | null = null
  /**
   * Fires when a **different** animation is mounted, with the new name.
   *
   * Not on a re-`setAnimation` to the same name, which is a restart and reports
   * itself through `onAnimationStarted`.
   *
   * The conventions do not require this event, on the grounds that a host that
   * called `setAnimation` already knows.
   * Here it earns its place: `animation` is a **prop**, so a re-render can
   * mount a different clip without anything in the host calling `setAnimation`
   * at all — the switch happens in `applySettings`, below Layer 4. Without this
   * there is no way to observe it.
   */
  onAnimationChanged: SsAnimationCallback | null = null
  /**
   * Fires once per user-data key the playhead crossed, in `advance`.
   *
   * Only read from Layer 1 when something is listening — the Brain rebuilds its
   * list every collection, so a tick nobody watched costs nothing.
   */
  onUserData: ((event: SsUserDataEvent) => void) | null = null
  /**
   * Fires once per audio key the playhead crossed, in `advance`.
   *
   * Gated exactly like `onUserData`, and for the same reason. **Nothing plays
   * it**: the event says what to play and where the file is, and an app that
   * leaves this null gets a silent animation rather than an error.
   */
  onAudio: ((event: SsAudioEvent) => void) | null = null
  /**
   * Fires once per active signal the playhead crossed, in `advance`.
   *
   * Gated like the other two. Nothing here interprets `commandId` — dispatching
   * it is the whole point, and is the app's.
   */
  onSignal: ((event: SsSignalEvent) => void) | null = null

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
    //
    // A name `setAnimation` was given before there was a resource comes first,
    // though — that call had nothing to select against and said so by returning
    // false, and this is where it lands.
    const requested =
      options?.animation ?? this.pendingAnimation ?? internal.getAnimationNames()[0]
    this.pendingAnimation = null

    // Before `setAnimation`, which is the ordering Layer 1 requires: measuring
    // walks each animation's frames and leaves the last one set up, so it has to
    // happen while there is still a `setupAnimation` to come. Storing the
    // request as well as the result is what lets an *animation*-scoped box be
    // re-measured when the animation changes.
    this.measureRequest = options?.measure ?? null
    if (this.measureRequest != null && requested != null) {
      this.remeasure(requested)
    }

    // Selects and poses, without starting: `play()` is the host's call, and for
    // the components that is what the `playing` prop maps onto.
    if (requested != null) this.setAnimation(requested)
    else this.applySettings()

    // The textures this pack (and its instance children) needs, read once here
    // rather than again per query. After `setAnimation` because the children —
    // and so their textures — do not exist until then, and before the
    // `loadTextures` early-out because a runtime override does not depend on the
    // pack's own atlases being loaded. The names are copied strings, so retaining
    // them past the borrowed `SsTextureInfo[]` is safe.
    const textureInfos = internal.getTextures()
    this.replaceableTextureNames = textureInfos.map((info) => info.name)

    this.notify()

    if (options?.loadTextures === false) {
      // Still replay any runtime replacements the caller set: they are keyed by
      // name and do not need the pack's own textures loaded first.
      this.applyCellmapTextureOverrides()
      return
    }

    // The pack names its own textures, so load them rather than making the
    // caller do it: `image_path` is relative to the `.ssab`, and `uri` is where
    // the `.ssab` came from. Anything already registered is left alone, so a
    // caller-supplied texture wins.
    //
    // After `notify()` on purpose — the animation is usable the moment the
    // context exists, and holding the load open for a texture fetch would delay
    // the first frame for no reason. It simply draws nothing until they arrive.
    const report = await SsTextureLoader.load(this.textures, textureInfos, uri)
    if (token !== this.loadToken || this.disposed) {
      // The leases this pass took belong to a load that is no longer wanted.
      for (const key of report.imageKeys) ssImageCache.release(key)
      // So do its registry entries: the loader registers as it decodes, which is
      // before this check, so a superseded pass has already put its paints in.
      // `releaseNative` cannot take them back — it ran before this pass recorded
      // anything — so they would otherwise stay for the life of the player.
      //
      // Skipping what the *current* load registered matters when the two packs
      // share a cellmap name: the hash is the same, and dropping it would take
      // the live pack's atlas with it.
      if (this.ownsTextures) {
        const live = new Set(this.registeredTextures)
        for (const hash of report.registered) {
          if (!live.has(hash)) this.textures.unregister(hash)
        }
      }
      return
    }
    this.lastTextureReport = report
    this.imageKeys = report.imageKeys
    this.registeredTextures = report.registered

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

    // After the loader, so a replacement wins over the pack atlas the loader just
    // put in, and after the supersede check, so a discarded load does not paint
    // into the live registry. This is what carries a runtime override across a
    // `source` change onto the new pack, the way `applySettings` carries the
    // part overrides.
    this.applyCellmapTextureOverrides()

    this.notify()
  }

  /**
   * Replays the recorded runtime texture replacements onto the current registry,
   * re-keying each by name against the pack that is now loaded.
   *
   * A name the new pack has no texture for is left recorded but unapplied — it
   * may match again after a later `source` change, exactly as ForGodot keeps its
   * `_cellmap_overrides` by name and simply skips a name the current resource
   * does not resolve.
   */
  private applyCellmapTextureOverrides(): void {
    if (this.cellmapTextureOverrides.size === 0) return
    for (const [name, override] of this.cellmapTextureOverrides) {
      if (!this.replaceableTextureNames.includes(name)) continue
      this.textures.override(
        SsRuntimeModule.hashString(name),
        override.image,
        override.options
      )
    }
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
  /** Registry entries the last load added, taken back out on teardown. */
  private registeredTextures: number[] = []

  /**
   * Runtime texture replacements in effect, keyed by the cellmap (or external
   * texture) **name** — the name-side record ForGodot keeps too, so
   * {@link getCellmapTexture} can answer and a source change can re-key onto the
   * new pack. The registry holds the hash-side effect; this is what survives the
   * registry being rebuilt under a new pack, and {@link applyCellmapTextureOverrides}
   * replays it after each load — the same pattern {@link pendingOverrides} follows.
   */
  private readonly cellmapTextureOverrides = new Map<
    string,
    { image: SkImage; options?: SsTextureOptions }
  >()
  /**
   * Every texture a replacement can target in the loaded pack — cellmap names
   * and external-texture file names — captured from the last load so
   * {@link getReplaceableTextureNames} need not re-marshal the texture table and
   * {@link setCellmapTexture} can reject a name the pack has no such texture for.
   */
  private replaceableTextureNames: string[] = []

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

  /** Whether playback is held by {@link pause}. Stays false before the first {@link play}. */
  get isPausing(): boolean {
    return this.internalPlayer?.isPausing ?? false
  }

  /**
   * Whether the last {@link advance} crossed a loop boundary. A **pulse**, true
   * only inside the tick that crossed — take {@link onAnimationLooped} instead if you would
   * rather have it delivered than polled.
   */
  get justLooped(): boolean {
    return this.internalPlayer?.justLooped ?? false
  }
  /**
   * Which way the playhead is actually travelling this frame.
   *
   * Not `playbackDirection`, which is only the heading that was configured:
   * under ping-pong the return leg runs backward while the configured heading
   * still reads forward. Gate audio on this — SpriteStudio has no reverse audio,
   * so a key crossed on a backward leg is not meant to sound, and it is the test
   * the players that do play audio themselves apply.
   *
   * ```ts
   * player.onAudio = (e) => {
   *   if (player.isPlayingForward) mySoundBank.play(e.soundName, e.loopNum)
   * }
   * ```
   */
  get isPlayingForward(): boolean {
    return this.internalPlayer?.isPlayingForward ?? true
  }
  get frameRate(): number {
    return this.internalPlayer?.frameRate ?? 0
  }
  get partCount(): number {
    return this.internalPlayer?.partCount ?? 0
  }

  /** See `SpriteStudioPlayerApi`. Empty before a load completes. */
  /** Resolve a part name to its index, or `-1` when the name is not in the animation. */
  findPartIndex(partName: string): number {
    return this.internalPlayer?.findPartIndex(partName) ?? -1
  }

  /**
   * Cellmap names in the pack, without the `.ssce` extension — the namespace a
   * cell override takes. Empty before a load completes.
   */
  /**
   * Part names in part-index order, empty before a load finishes.
   *
   * This is what turns the `partIndex` on an event back into something a human
   * reads, and what fills a part picker. An unnamed part holds its slot as `''`
   * so the list stays index-aligned; `length` is the part count.
   */
  partNames(): string[] {
    return this.internalPlayer?.partNames() ?? []
  }

  cellmapNames(): string[] {
    return this.internalPlayer?.cellmapNames() ?? []
  }

  /** The cell names inside one cellmap — the other half a cell override takes. */
  cellNames(cellmapName: string): string[] {
    return this.internalPlayer?.cellNames(cellmapName) ?? []
  }

  getAnimationNames(): string[] {
    return this.internalPlayer?.getAnimationNames() ?? []
  }

  /**
   * Select an animation, and pose it on its first frame. **Does not start
   * playback** — that is {@link play}'s job, and keeping the two apart is what
   * lets a caller swap the animation on a paused player, or show an idle pose.
   *
   * **Selecting the animation already set up does nothing at all.** It is a
   * switch, so with nothing to switch to it costs nothing and disturbs nothing:
   * the playhead stays, the loop budget is not re-armed, and the overrides
   * survive. That makes it safe for a state machine to assert its current clip
   * every frame. To restart, call {@link play}.
   */
  setAnimation(name: string): boolean {
    const internal = this.internalPlayer
    if (internal == null) {
      // No resource yet: remember what was asked for, so a caller can set the
      // animation before the load lands. `load` starts on this value.
      this.animation = name
      this.pendingAnimation = name
      return false
    }
    // Against what the runtime HAS, which `load` resets by building a new
    // internal player — so a second pack naming an animation the same way as the
    // first still gets set up.
    if (internal.currentAnimation === name) return true

    const previous = this.animation

    // An animation-scoped box describes *this* animation, so switching makes it
    // stale. A pack-scoped one is the union over the whole file and does not
    // change — which is the point of asking for it.
    if (this.measureRequest?.scope === 'animation' && this.contentBoxValue != null) {
      this.remeasure(name)
    }

    if (!internal.setupAnimation(name)) {
      this.reportMissingAnimation(name)
      return false
    }
    // Assigned from the result, not ahead of it. `currentAnimation` reads this
    // field, so assigning first left it naming an animation the runtime had
    // never set up — and `onAnimationStarted` then published that name too.
    this.animation = name
    this.reportedMissingAnimation = null
    if (previous !== name) this.onAnimationChanged?.(name)
    // setup drops the loop count and the override layer, so both go back on.
    this.wasFinished = false
    this.applySettings()
    this.notify()
    return true
  }

  /**
   * A name chosen before there was a resource, for the next {@link load} to
   * start on. **Consumed there**, so it cannot follow the player onto a second
   * pack that has no animation by that name — which is why this is not simply
   * `animation`, whose value survives a load.
   */
  private pendingAnimation: string | null = null

  /** The name already reported missing — see {@link reportMissingAnimation}. */
  private reportedMissingAnimation: string | null = null

  /**
   * Say which pack was asked for what.
   *
   * Once per wrong name, because {@link setAnimation}'s early return cannot
   * absorb the repeat: it compares against what the runtime HAS, and a failed
   * switch leaves that alone, so a state machine asserting a typo every frame
   * would report it every frame. Keyed on the name, so a second wrong one still
   * gets its own line.
   *
   * The names that *would* have worked are not printed. {@link getAnimationNames}
   * is public, so a caller who wants the list can print it, and requiring one
   * would mean deciding here how to truncate a pack with two hundred animations.
   */
  private reportMissingAnimation(name: string): void {
    if (this.reportedMissingAnimation === name) return
    this.reportedMissingAnimation = name
    // The Brain's own reason, verbatim. This used to say "has no animation",
    // which is the common case and not the only one: the same call fails with
    // "SSAB data is not loaded" on a player whose pack never bound, and telling
    // that reader the name is missing sends them to the wrong place.
    const reason = this.internalPlayer?.lastErrorMessage
    console.warn(
      `react-native-spritestudio: '${this.resourceUri ?? 'the loaded pack'}' ` +
        `could not select animation '${name}'${reason == null ? '' : ` — ${reason}`}. ` +
        `Check getAnimationNames() for what it does have.`
    )
  }

  /**
   * **Head-out**: rewinds to the start of the section and re-arms the loop
   * count.
   *
   * Not a resume — {@link resume} is. The two used to be one verb here, on the
   * grounds that a `playing` prop means one thing; but a Player publishing three
   * verbs where the contract asks for four leaves a host no way to lift a pause
   * without losing the playhead. Mapping a boolean prop onto the four is Layer
   * 4's job, and it is the only layer that knows the prop exists.
   */
  play(startFrame?: number): void {
    this.wasFinished = false
    const internal = this.internalPlayer
    if (internal != null) this.startPlayback(internal, startFrame)
    this.notify()
  }

  /**
   * Lifts a {@link pause}, carrying on from the same frame.
   *
   * Idempotent, and a no-op on a stopped animation: starting one is
   * {@link play}'s job, and `play` rewinds. No `onAnimationStarted` — a resume is
   * not a start, and firing it here would make the two indistinguishable.
   */
  resume(): void {
    this.internalPlayer?.resume()
    this.notify()
  }

  /**
   * `internal.play()` and the notification that goes with it, in one place.
   *
   * `startFrame` is forwarded when a caller asked to head out from a frame; the
   * replay after a setup passes nothing, since it means "start this clip".
   *
   * Two call sites reach it — an explicit `play()` and `applySettings` after a
   * setup — and both are starts. Resume deliberately does not come through
   * here: it is the other half of the verb, and firing "started" for it would
   * make the two indistinguishable to a listener.
   */
  private startPlayback(internal: SsInternalPlayer, startFrame?: number): void {
    internal.play(startFrame)
    this.onAnimationStarted?.(this.animation ?? '')
  }

  /** Holds playback where it stands. Idempotent, and ignored while nothing plays. */
  pause(): void {
    this.internalPlayer?.pause()
    this.notify()
  }

  /** Halts where it stands — nothing rewinds. The next `play()` heads out. */
  stop(): void {
    this.wasFinished = false
    this.internalPlayer?.stop()
    this.notify()
  }

  seek(frameNo: number): void {
    this.internalPlayer?.seek(frameNo)
    this.notify()
  }

  setSpeedScale(rate: number): void {
    this.settings.speed = rate
    this.internalPlayer?.setSpeedScale(rate)
  }

  setLoopCount(loops: number): void {
    this.settings.loops = loops
    this.internalPlayer?.setLoopCount(loops)
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
   * Restricts playback to `[startFrame, endFrame]` of the **current** animation,
   * so `play`, looping and ping-pong all work within that range.
   *
   * Not carried across a {@link setAnimation}: frame numbers only mean something
   * inside the animation they were measured in. Set it after each switch.
   */
  setAnimationSection(startFrame: number, endFrame: number): void {
    this.internalPlayer?.setSection(startFrame, endFrame)
    this.notify()
  }

  /**
   * How a long tick is spent. On (the default) advances by the elapsed time and
   * drops the frames in between, keeping playback on the wall clock; off
   * advances exactly one frame per tick, so nothing is skipped but a stalled app
   * plays in slow motion.
   *
   * Turn it off when every frame matters — an animation whose events must all
   * fire, or a deterministic capture.
   */
  setFrameSkipEnabled(enabled: boolean): void {
    this.settings.skipFrames = enabled
    this.internalPlayer?.setFrameSkipEnabled(enabled)
  }

  /**
   * Overrides the advance rate, in **absolute** frames per second — the host's
   * choice rather than the clip's, so it survives a {@link setAnimation}. Pass
   * `0` (or a negative) to clear it and go back to whatever each animation was
   * authored at.
   *
   * {@link setSpeedScale} is the other rate control and they compose, but they say
   * different things: speed is a *multiple* of whatever the clip was authored
   * at, so it means the same against every clip; this *replaces* the rate, so
   * 60 against a 30fps clip is double speed and against a 60fps clip is none.
   */
  setFrameRate(fps: number): void {
    this.settings.frameRate = fps
    this.internalPlayer?.setFrameRate(fps)
  }

  /**
   * Sub-frame interpolation — whether the frame handed to the Brain **for
   * display** keeps its fraction. On by default, which is what makes playback
   * smooth on a display refreshing faster than the animation was authored at.
   *
   * The playhead is a float either way ({@link frameNo} reports it unrounded),
   * and the instance / effect children are always stepped from the unrounded
   * value. Turning this off only floors what is drawn, pinning playback to whole
   * authored frames — and it reaches the instance children too, which are drawn
   * at their own playhead and have to be floored on the same terms.
   */
  setSubFrameEnabled(enabled: boolean): void {
    this.settings.subFrame = enabled
    this.internalPlayer?.setSubFrameEnabled(enabled)
  }

  /** See {@link setSubFrame}. */
  get subFrameEnabled(): boolean {
    return this.internalPlayer?.subFrameEnabled ?? this.settings.subFrame
  }

  /**
   * Multiplier in effect, read back from the Brain rather than from what was
   * asked for. `0` and negatives clamp to a **stop** there, so setting `-2` and
   * reading this back gives `0` — the stop it actually became, not the reverse
   * playback the request looks like. Falls back to the pending setting before a
   * resource exists.
   */
  get speedScale(): number {
    return this.internalPlayer?.speedScale ?? this.settings.speed
  }

  /** Cycles configured for this run; `0` and `-1` are both infinite. */
  get loopCount(): number {
    return this.internalPlayer?.loopCount ?? this.settings.loops
  }

  /** See {@link setFrameSkipEnabled}. */
  get frameSkipEnabled(): boolean {
    return this.internalPlayer?.frameSkipEnabled ?? this.settings.skipFrames
  }

  /**
   * The heading that was **configured** — not {@link isPlayingForward}, which is
   * where the playhead is actually going this frame.
   */
  get playbackDirection(): SsPlaybackDirection {
    return this.internalPlayer?.playbackDirection ?? this.settings.direction
  }

  /** What the playhead does at the far end of the section. */
  get playbackStyle(): SsPlaybackStyle {
    return this.internalPlayer?.playbackStyle ?? this.settings.style
  }

  /** First and last frame of the range being played — the section once one is set. */
  get startFrame(): number {
    return this.internalPlayer?.startFrame ?? 0
  }
  get endFrame(): number {
    return this.internalPlayer?.endFrame ?? 0
  }

  /** Frames in that range, both ends inclusive. Feed it to a scrubber. */
  get totalFrames(): number {
    return this.internalPlayer?.totalFrames ?? 0
  }

  /**
   * Replays the transport settings onto a freshly set-up animation.
   *
   * The order matters and is not decorative: `setup_animation` resets the loop
   * count to its default, and `play` arms the counter with whatever is in effect
   * at that moment. So `setLoopCount` has to come
   * before `play`, not after.
   */
  private applySettings(): void {
    const internal = this.internalPlayer
    if (internal == null) return
    // The loop count is the one the Brain drops on every setup, deliberately.
    // The rest it keeps on its own; they are pushed anyway because this is also
    // the path a value chosen before the load takes to reach a fresh animation.
    internal.setLoopCount(this.settings.loops)
    internal.setSpeedScale(this.settings.speed)
    internal.setFrameSkipEnabled(this.settings.skipFrames)
    internal.setSubFrameEnabled(this.settings.subFrame)
    if (this.settings.frameRate != null) internal.setFrameRate(this.settings.frameRate)
    internal.setPlaybackDirection(this.settings.direction, this.settings.style)
    // Playback is deliberately NOT started here: `setAnimation` selects, `play`
    // starts, and this runs inside the former.
    //
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
   * and `useSsPartTransform` is what does that.
   *
   * Position, rotation and scale only. A part's Skew is a non-inheriting
   * local-vertex deform, so it never enters the world matrix this decomposes:
   * a followed part — or one under a sheared parent — is reported unsheared,
   * matching SpriteStudio, where Skew does not inherit to children.
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
   * Whether `part` is hidden on the frame being displayed.
   *
   * The companion to {@link getPartTransform}, which reports where a part
   * *would* be whether or not it is drawn. A view driven from a part needs
   * both: the transform to place it, and this to decide whether to show it —
   * the `onHide` option the sibling Players offer on their built-in
   * attachments. `useSsPartTransform` reports the pose only, so this is the
   * call a host makes alongside it.
   *
   * Read from the **display** frame — floored when sub-frame is off, the same
   * frame that was drawn — so it cannot disagree with what is on screen. It
   * reflects the animation's own hide, not a {@link setPartOverrides}
   * `hide: true`. False for an unknown name, an out-of-range index and
   * before the first `advance`; {@link findPartIndex} is the existence test.
   */
  isPartHidden(part: string | number): boolean {
    const internal = this.internalPlayer
    if (internal == null) return false
    const index =
      typeof part === 'number' ? part : internal.findPartIndex(part)
    if (index < 0) return false
    return internal.isPartHidden(index)
  }

  /**
   * Whether `part` is a **skinned** mesh — a mesh part bound to bones, and so
   * the one kind of part a follower cannot sit on.
   *
   * A skinned mesh draws its vertices from its bound bones, while the part's own
   * transform — what {@link getPartTransform} and `useSsPartTransform` report —
   * stays at its setup node position, usually near the character root. So a view
   * following such a part lands near the root rather than on the deformed art.
   * To follow the art, add a NULL / bone part at that spot in SpriteStudio and
   * follow *that* — a null, joint, armature or bone-point part places its own
   * node where the art is. See [Following a part](/usage/parts#following-a-part).
   *
   * False for a rigid (deform-only) mesh and every non-mesh part — those follow
   * correctly — and false for an unknown name or before a load. The judgement is
   * the cross-player one (ForWeb and ForWgpu carry the same query): a
   * `mesh_binding` present with at least one influence bone.
   */
  isPartSkinnedMesh(part: string | number): boolean {
    const internal = this.internalPlayer
    if (internal == null) return false
    const index =
      typeof part === 'number' ? part : internal.findPartIndex(part)
    if (index < 0) return false
    return internal.isPartSkinnedMesh(index)
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
      // The family's default. `permanent` used to be it, which made an override
      // outlive the animation switch that should have dropped it for anyone
      // reaching past this map into Layer 2. The declarative behaviour is
      // unchanged either way: `applySettings` replays the map after every setup.
      const priority = override.priority ?? SsOverridePriority.holdUntilNextAnimation

      if (override.hide == null) internal.clearPartVisibility(index)
      else {
        internal.setPartVisibility(
          index,
          // Layer 2 keeps the C ABI's tri-state force flag: 1 force-hides,
          // 2 force-shows. An absent key is the third answer and took the
          // branch above, so `hide: false` still means force-show rather than
          // revert — the same three ways round the sibling Players offer as
          // `setPartVisibilityOverride(part, false)` next to `clear…`.
          override.hide ? 1 : 2,
          // Off by default, as everywhere else: a keyframed hide never cascades
          // in SpriteStudio, so cascading is the opt-in.
          override.cascade ?? false
        )
      }

      if (override.color == null) internal.clearPartColor(index)
      else {
        internal.setPartColor(
          index,
          override.blendOp ?? SsBlendOp.mix,
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

  // --- runtime textures --------------------------------------------------

  /**
   * Replaces the texture bound for a cellmap at runtime, or restores the pack's
   * own when `image` is `null`. A costume change or a dynamic expression, driven
   * from code rather than the authoring data.
   *
   * `name` is a cellmap name — with no `.ssce` — or an external texture's file
   * name, whichever {@link getReplaceableTextureNames} lists. The swap is keyed
   * by the same hash `DrawBatch.texture_hash` carries, so it takes effect on the
   * next drawn frame with nothing else to do. Returns false, with a dev warning,
   * for a name the loaded pack has no such texture for; a name set before the
   * first load is accepted and applied once the pack lands.
   *
   * **Unlike ForGodot, the replacement reaches instance children.** The whole
   * player tree draws through one texture table here, so a child that samples the
   * same cellmap picks up the swap too — there is no per-child map to set
   * separately. It also **survives a `source` change**: the override is re-keyed
   * onto the new pack by name, and drops back out only when you clear it or
   * dispose the player.
   *
   * The `image` stays the caller's to keep alive — the registry references it and
   * never disposes it, the same rule the `textures` prop follows. Two caveats:
   * a part under an authored texture change (`TCHG`)
   * binds through a *different* hash on the frames it applies to, so replace the
   * texture file name it points at (also in {@link getReplaceableTextureNames})
   * rather than the cellmap name to affect those; and a replacement is assumed to
   * share the original's **size and layout**, since the UVs stay in the original
   * atlas's pixel space.
   */
  setCellmapTexture(
    name: string,
    image: SkImage | null,
    options?: SsTextureOptions
  ): boolean {
    const hash = SsRuntimeModule.hashString(name)

    if (image == null) {
      this.cellmapTextureOverrides.delete(name)
      this.textures.restore(hash)
      this.notify()
      return true
    }

    // Reject a name the loaded pack cannot bind, so a typo is a warning rather
    // than a paint nothing ever draws with. Only once a pack is loaded: before
    // that there is nothing to check against, and the load's replay validates it.
    if (
      this.internalPlayer != null &&
      !this.replaceableTextureNames.includes(name)
    ) {
      if (__DEV__) {
        console.warn(
          `react-native-spritestudio: '${this.resourceUri ?? 'the loaded pack'}' ` +
            `has no replaceable texture called '${name}'. ` +
            `Check getReplaceableTextureNames() for what it has.`
        )
      }
      return false
    }

    this.cellmapTextureOverrides.set(name, { image, options })
    this.textures.override(hash, image, options)
    this.notify()
    return true
  }

  /**
   * The runtime replacement in effect for `name`, or `null` when none is — the
   * **override value only**, never the pack's own texture (the same contract as
   * ForGodot's `get_cellmap_texture`). Use it to read back what
   * {@link setCellmapTexture} set.
   */
  getCellmapTexture(name: string): SkImage | null {
    return this.cellmapTextureOverrides.get(name)?.image ?? null
  }

  /**
   * Every texture a {@link setCellmapTexture} can target — cellmap names, without
   * `.ssce`, followed by the external-texture file names a `TCHG` points at,
   * deduplicated. Empty before a load completes.
   *
   * The external names are here because a `TCHG` binds through them, so they are
   * legitimately replaceable too — the list a UI would offer as "textures you can
   * swap". It is a snapshot of the loaded pack, cached from the last load rather
   * than re-read per call.
   */
  getReplaceableTextureNames(): string[] {
    return [...this.replaceableTextureNames]
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
   * `onAnimationFinished` is fired off its rising edge — polling the state itself would
   * fire it on every frame after the end.
   */
  advance(dtMilliseconds: number): void {
    const internal = this.internalPlayer
    if (internal == null || internal.isDisposed) return

    internal.advance(dtMilliseconds)

    // Read once and shared by both notifications below: `currentAnimation` is
    // what each is about, and re-reading it would say the same thing twice.
    const animation = this.animation ?? ''

    if (internal.justLooped) this.onAnimationLooped?.(animation)

    // Two gates, both on the hot path. Nothing is lost by skipping: the Brain
    // rebuilds this list on every collection, so an unread tick's events are
    // simply overwritten rather than queued. Without the gates this would be a
    // vector allocation and a Nitro array marshal per player per frame, sixty
    // times a second, almost always to report nothing.
    //
    // `passedEventCount` counts frames carrying *any* event, so it is read once
    // and shared: it cannot tell the two kinds apart, and asking it twice would
    // cross JSI twice to get the same number.
    if (
      (this.onUserData != null || this.onAudio != null || this.onSignal != null) &&
      internal.passedEventCount > 0
    ) {
      if (this.onUserData != null) {
        for (const event of internal.getUserDataEvents()) this.onUserData(event)
      }
      if (this.onAudio != null) {
        for (const event of internal.getAudioEvents()) this.onAudio(event)
      }
      if (this.onSignal != null) {
        for (const event of internal.getSignalEvents()) this.onSignal(event)
      }
    }

    const finished = internal.isFinished
    if (finished && !this.wasFinished) this.onAnimationFinished?.(animation)
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
    // The paints the last load put in the registry, taken back out with it.
    //
    // `load()` documents that it replaces what was loaded before, and leaving
    // these behind made that untrue in a way that draws: `texture_hash` is the
    // FNV-1a of a *cellmap name*, so a second pack naming a cellmap the same
    // thing as the first — `common`, on this repo's own example packs — kept
    // drawing with the first pack's atlas. Silently, and only for the cellmaps
    // whose names happened to collide. Without a collision it merely grew, one
    // binding per load, all of them handed to `drawInto` every frame.
    //
    // Only the ones this load registered: a caller-supplied texture is left
    // alone on the way in (`SsTextureLoader`), so it must be left alone on the
    // way out. And only when the registry is ours — a shared one may be feeding
    // other players, whose entries are not this player's to drop.
    if (this.ownsTextures) {
      for (const hash of this.registeredTextures) this.textures.unregister(hash)
    }
    this.registeredTextures = []
  }

  /**
   * Releases every native handle. Explicit, never left to GC — the lifetime
   * rule in `specs/SsRuntime.nitro.ts`. Idempotent.
   */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    // Invalidates any load still in flight, so it releases what it built
    // instead of installing it into a disposed player.
    this.loadToken++
    this.stopClock()
    this.releaseNative()
    // The runtime overrides go with the player, not the pack: `releaseNative`
    // keeps them so they can re-key onto a new `source`, but a disposed player
    // has no next load to replay them onto. A shared registry that outlives it
    // gets each override taken back off first, since those entries are not the
    // survivors' to inherit.
    if (!this.ownsTextures) {
      for (const name of this.cellmapTextureOverrides.keys()) {
        this.textures.restore(SsRuntimeModule.hashString(name))
      }
    }
    this.cellmapTextureOverrides.clear()
    if (this.ownsTextures) this.textures.dispose()
    this.listeners.clear()
  }
}
