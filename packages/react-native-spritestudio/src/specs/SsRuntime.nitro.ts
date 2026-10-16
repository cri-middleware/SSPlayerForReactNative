import type { CustomType, HybridObject } from 'react-native-nitro-modules'

/**
 * Layer 1 — the JSI seam onto `libssruntime` (the Brain).
 *
 * **Layer 1 owns the drawing**, not just the geometry: one draw call per player
 * per frame, with nothing per-vertex crossing into JS.
 *
 * Lifetime rule: **every ArrayBuffer handed out here is a borrow of native
 * memory that stays valid only until the next `update()`**.
 * Nothing may retain one across frames. `SsContext.generation` is the
 * enforcement handle — read it when you take a buffer, and compare it again
 * before you read through one.
 *
 * Disposal is not declared here: every Nitro `HybridObject` already carries a
 * `dispose()` (nitrogen rejects redeclaring it), and that is the explicit
 * teardown the borrow rule asks for — L3 calls it on unmount rather than waiting for GC.
 * Note that inheriting the method is only half of it: Nitro's
 * `HybridObject::dispose()` is a **no-op unless the C++ class overrides it**, so
 * both implementations here do, and `SsRuntime.liveHandles` is what proves it.
 */

/**
 * An RN Skia `SkCanvas`, unwrapped back to the `SkCanvas*` behind it.
 *
 * RN Skia hands JS a JSI host object wrapping the real canvas. Nitro's
 * `CustomType` is the escape hatch that lets a spec name a type Nitro does not
 * know: the `JSIConverter` in `cpp/SsRNSkiaInterop.hpp` does the unwrapping, so
 * C++ ends up holding the same pointer RN Skia's own draw calls use.
 *
 * This is what makes `drawInto` possible at all — without it there is no way to
 * hand a canvas across the Nitro boundary, and the whole design rests on the
 * canvas reaching C++.
 */
export type SkCanvasHandle = CustomType<
  object,
  'SkCanvasHandle',
  { include: 'SsRNSkiaInterop.hpp' }
>

/** An RN Skia `SkPaint`, unwrapped the same way. */
export type SkPaintHandle = CustomType<
  object,
  'SkPaintHandle',
  { include: 'SsRNSkiaInterop.hpp' }
>

/** An RN Skia `SkImage`, unwrapped the same way. */
export type SkImageHandle = CustomType<
  object,
  'SkImageHandle',
  { include: 'SsRNSkiaInterop.hpp' }
>

/**
 * One entry of the texture table `drawInto` resolves batches against.
 *
 * The table has to be handed over per call rather than registered once, because
 * the `SkPaint` is JS-owned: RN Skia can recycle or mutate it between frames and
 * C++ must never hold one past the call it was passed to.
 *
 * `textureHash` is `cellmap.name_hash`, which is exactly `DrawBatch.texture_hash`
 * — get it from `SsRuntime.hashString`, never by re-implementing FNV-1a.
 */
export interface SsTextureBinding {
  textureHash: number
  /** Carries the atlas image shader, and later the blend/colour state. */
  paint: SkPaintHandle
}

/**
 * One texture a pack needs, read out of its `.ssab`.
 *
 * Sampling does not come along: the `.ssab` carries the SpriteStudio filter and
 * wrap, but both are the engine's to choose (see `SsTextureOptions`).
 */
export interface SsTextureInfo {
  /** Look this up with `DrawBatch.texture_hash` directly. */
  textureHash: number
  /** Cellmap name, or an external texture's file name. */
  name: string
  /** Path to the image **relative to the `.ssab`**, or empty when embedded-only. */
  imagePath: string
  /**
   * Size of the encoded image an embedded pack carries, 0 for a reference one.
   *
   * The bytes themselves come from `SsContext.copyEmbeddedTexture`, asked for
   * only when the atlas is not decoded already: copying every one on every
   * load would pay again for each atlas the image cache holds.
   */
  embeddedLength: number
}

/**
 * A box in **player-local units, Y-down** — the space the root transform works
 * in, and the same one `local_vertices` and the world matrices are expressed in.
 *
 * Y-down because the context is (`HybridSsContext` sets the Brain's coordinate
 * system), which is Skia's own sense: the root transform is then a plain
 * translate-and-scale with no flip hidden in it, and every number that crosses
 * this boundary — box, world matrix, baked vertex — agrees about which way is up.
 */
export interface SsBox {
  /** Left edge. */
  x: number
  /** **Top** edge, +Y being down. */
  y: number
  width: number
  height: number
}

/**
 * One part's placement this frame, in **player-local units, Y-down**.
 *
 * Decomposed rather than handed over as a matrix because the callers are
 * placement code — attaching a React view to a hand, spawning a projectile at a
 * muzzle — and every one of them would otherwise decompose it identically.
 *
 * `determinant` is here because a world matrix **can be a reflection** and the
 * sign is the product of authored negative scale and the player's flip, so the
 * two cancel: reading it off the flip settings gives the wrong answer, and
 * `scaleX`/`scaleY` alone cannot tell a mirror from a rotation.
 */
export interface SsPartTransform {
  /** False when the index is out of range or the frame carries no matrix. */
  valid: boolean
  x: number
  y: number
  /** Radians, taken from the matrix — so a parent's rotation is already in it. */
  rotation: number
  scaleX: number
  scaleY: number
  /** Negative for a reflection. See above. */
  determinant: number
}

/**
 * One authored user-data key the playhead crossed.
 *
 * Four independent payloads, each optional, which is how SpriteStudio authors
 * them — a key can carry an integer *and* a string. The `has*` flags are not
 * decoration: `integer: 0` is a value an author can mean.
 */
export interface SsUserDataEvent {
  partIndex: number
  /** The authored part name, so a caller need not keep an index table. */
  partName: string
  /** The frame the key sits on, not the frame it was noticed on. */
  frameNo: number
  /**
   * The source that fired it — the handle `getTrackMainSource` and
   * `addTrackSource` give out. With no animation mixing this is always track
   * 0's main source; it tells two blended animations' keys apart once a second
   * source fires too. `frameNo` is a frame of **that** source's animation.
   */
  source: number

  hasInteger: boolean
  integer: number
  hasPoint: boolean
  pointX: number
  pointY: number
  hasRect: boolean
  rect: SsBox
  hasText: boolean
  text: string
}

/**
 * One authored audio key the playhead crossed.
 *
 * **This package never produces sound.** It says what to play, how many times,
 * and where the file is; feeding an audio stack is the app's job, the same
 * division the sibling Players draw (`ssplayer-wgpu`'s `AudioEvent` says so in
 * as many words). There is no audio dependency here to make that decision for
 * you, and an authored key is not a command — a caller that ignores these
 * simply has a silent animation.
 *
 * `soundListNameHash` / `soundNameHash` address the pack's `SoundList` and the
 * `SoundFile` within it. They are carried as well as the resolved fields
 * because they are what a host keys its *own* audio by when it does not want
 * the pack's file at all.
 */
export interface SsAudioEvent {
  partIndex: number
  /** The authored part name, so a caller need not keep an index table. */
  partName: string
  /** The frame the key sits on, not the frame it was noticed on. */
  frameNo: number
  /** The source that fired it — see `SsUserDataEvent.source`. */
  source: number

  /** The alias as authored — a name inside the sound list, not a file name. */
  soundName: string
  soundListNameHash: number
  soundNameHash: number
  /**
   * How many times to play it. SpriteStudio has no infinite audio loop, so this
   * is a count and not a flag; `1` is the ordinary authored value.
   */
  loopNum: number

  /**
   * Path to the sound file **relative to the `.ssab`**, exactly like a
   * cellmap's `image_path` — so `resolveAgainst(baseUri, filePath)` opens it,
   * the same seam textures go through. Empty when the pack has no `SoundList`
   * entry for `soundNameHash`, which is authored garbage rather than a state to
   * handle.
   */
  filePath: string
  /** The authored duration in **milliseconds**, or 0 when unresolved. */
  totalMs: number
  /**
   * Whether the pack carries this file's bytes in `embedded_assets` — i.e. it
   * was converted with `--embedded`, and `filePath` names a sibling that **is
   * not on disk**. Reading those bytes out is not wired yet, so an embedded
   * pack's audio is currently reportable but not playable; the flag is what
   * keeps that legible instead of presenting as a missing file.
   */
  embedded: boolean
}

/** `SignalCommandParam.type` wire values. */
export const SsSignalParamType = {
  bool: 0,
  /** A choice from an authored list, carried as its index. */
  index: 1,
  integer: 2,
  floating: 3,
  text: 4,
  /** The parameter exists and was left unset. */
  none: 5,
} as const

/**
 * One `id` → value pair on a signal.
 *
 * Flat rather than a union, because a Nitro struct has no union to be. Unlike
 * `SsUserDataEvent`, though, this needs no `has*` flags: a parameter carries
 * exactly one value and `type` says which field holds it, so the others are
 * simply unread rather than ambiguous. `index` and `integer` share `intValue`
 * for the same reason — they are one wire type (`IntValueEntry`) authored two
 * ways, and `type` is what tells them apart.
 */
export interface SsSignalParam {
  /** The authored parameter name. */
  id: string
  /** `SsSignalParamType`. */
  type: number
  boolValue: boolean
  /** Holds both `index` and `integer`. */
  intValue: number
  floatValue: number
  textValue: string
}

/**
 * One authored signal the playhead crossed: **a named command and its
 * parameters**, for the app to dispatch however it likes.
 *
 * Where user data is a bag of values and audio names a file, a signal is the
 * one that means *do something* — SpriteStudio's way of letting an animator
 * call into the game. Nothing here interprets `commandId`; that is the whole
 * point of it.
 *
 * **Signals switched off are not reported.** `PartAttributeSignal.active` is
 * authoring state — a command left in the timeline but disabled — not something
 * that happened, and every sibling Player drops them for the same reason.
 */
export interface SsSignalEvent {
  partIndex: number
  /** The authored part name, so a caller need not keep an index table. */
  partName: string
  /** The frame the key sits on, not the frame it was noticed on. */
  frameNo: number
  /** The source that fired it — see `SsUserDataEvent.source`. */
  source: number

  /** The authored command name. Uninterpreted. */
  commandId: string
  params: SsSignalParam[]
}

/**
 * How many native handles are alive right now — the leak check, made observable.
 *
 * "No leaked native handles" was an assertion with nothing behind it until this
 * existed: a handle that outlives
 * its player has no symptom on the JS side at all. It shows up as memory the
 * Brain never gives back, which on a simulator is invisible and on a device is
 * a crash several minutes later.
 *
 * A count, not a byte total, because that is what can be checked exactly: run a
 * load/dispose cycle N times and both numbers must come back to where they
 * started. Anything else is a leak, and *which* number stayed high says where —
 * a stuck `contexts` is a player that was not disposed, a stuck `resources` with
 * `contexts` back at baseline is a `.ssab` released out of order.
 *
 * Counted on the C++ side rather than in TypeScript on purpose: the whole
 * question is whether the native object went away, and only the native
 * destructor knows that.
 */
export interface SsLiveHandles {
  /** Live `SsResource`s — one per loaded `.ssab` that has not been released. */
  resources: number
  /** Live `SsContext`s — one per player that has not been released. */
  contexts: number
}

/** A loaded `.ssab`. Shareable across contexts; the Brain refcounts it internally. */
export interface SsResource
  extends HybridObject<{ ios: 'c++'; android: 'c++' }> {
  readonly byteLength: number

  /**
   * The packs this one's Instance parts reach into, as bare names.
   *
   * From the `.ssab`'s own `external_instances` manifest, so a same-file
   * sub-animation is correctly absent and the caller only fetches what is
   * genuinely elsewhere. Read once when the resource is created, because the
   * Brain offers no way to get a `.ssab` back out of a resource and creating a
   * throwaway context to ask would be the alternative.
   *
   * **Resolution is transitive and that walk is the caller's**: an external
   * pack can reach further still, so a loader has to ask each pack it loads.
   * `Ringo_tyu` → `Ringo` is one level; nothing stops there being more.
   */
  getExternalInstancePackNames(): string[]
}

/** One playing animation. */
export interface SsContext
  extends HybridObject<{ ios: 'c++'; android: 'c++' }> {
  readonly partCount: number
  readonly generation: number
  readonly frameNo: number

  /**
   * Whether the last `drawInto` drew the frame as it stands.
   *
   * False after anything that changes what would be drawn: an `update()` that
   * moves the pose, a call that moves the playhead, a new animation, a
   * sub-frame switch, an override, or a track call. An `update()` that lands on
   * the pose already drawn leaves it true — a frame that lasts several ticks,
   * or a pause, unless an effect or instance part moves on its own clock. A
   * view that finds it true, with the same texture table and transform as last
   * time, can keep the picture it has.
   */
  readonly frameDrawn: boolean

  /**
   * Whether `update()` can change the frame. False for a stopped player, and
   * for a paused one with no effect or instance part: a pause moves only the
   * parts that keep their own clock, and only those two kinds can. Layer 3
   * sends a player that does not advance no `update()`.
   *
   * **Not** `isPlaying`, which goes false when track 0 finishes: the Brain's
   * clock runs on from `play()` until `stop()` or a setup, and the rest of the
   * stack still moves on it — a fade in flight, or a source other than track
   * 0's main one, track 0's own included, still playing where it is heard. So
   * a finished track 0 advances while the Brain says one of those does, and
   * only then. A pause holds them as it holds track 0.
   */
  readonly advances: boolean

  /**
   * Makes `pack` available to this player's Instance parts.
   *
   * **Must be called before `setupAnimation`**, which is when the child players
   * are spawned; a pack bound after that is ignored, and the parts that wanted
   * it stay silently undrawn. The pack identifies itself — its `name_hash` is
   * read out of the `.ssab` — so the caller does not have to say which of the
   * names from `getExternalInstancePackNames` this one satisfies.
   *
   * Returns false when the pack is already released or the children have been
   * built. Binding the same pack twice is not an error; a pack referenced from
   * several places is loaded once and mounted many times.
   */
  bindInstancePack(pack: SsResource): boolean

  setupAnimation(name: string): boolean

  /**
   * Why the last call that tracks a reason failed, or `''` when it succeeded.
   *
   * The Brain's own wording, not a code. It is for **reporting**, not for
   * branching: branching would mean hard-coding the integers from
   * `SSRuntimeError::as_code`, which the C ABI publishes as a compatibility
   * surface but exports no constants for (unlike `SS_RUNTIME_TRACK_BLEND_*`).
   *
   * It describes the LAST failure, so read it straight after the call that
   * returned false rather than treating it as a log.
   */
  lastErrorMessage(): string
  /**
   * Advances by `dtMilliseconds` and returns the new frame number. Invalidates
   * every previously issued buffer.
   *
   * **Milliseconds**, which is what `ss_runtime_update` takes,
   * and the unit every layer above
   * uses too — a seconds-shaped API here would put a `* 1000` at the seam and a
   * silent 1000x slowdown one forgotten conversion away. It is the same unit as
   * `ss_runtime_crossfade`'s duration.
   */
  update(dtMilliseconds: number): number

  // --- transport ---------------------------------------------------------
  //
  // Thin passthroughs onto the Brain's playback state, which is where it
  // already lives: mirroring it in TypeScript would give two answers to
  // "which frame is this", and `is_finished` in particular is a *state* the
  // Brain owns (see below). L3 is transport + clock + events on top of these,
  // not a second state machine.
  //
  // Every call marked "moves the playhead" bumps `generation` and refreshes the
  // frame, so it invalidates outstanding buffers exactly the way `update()`
  // does.

  /**
   * Whether the transport is running. **Stays true while paused** — pausing sets
   * a separate flag. "Actually advancing" is `isPlaying && !isPausing`.
   */
  readonly isPlaying: boolean
  readonly isPausing: boolean
  /**
   * True once the configured loops have completed, and it **stays** true until
   * the next `play()` / `setupAnimation()`. A state, not a pulse — take its
   * rising edge to fire a one-shot completion event. Always false on an
   * infinite loop count, and `stop()` never raises it.
   */
  readonly isFinished: boolean
  /** True on the frame a loop boundary was crossed. */
  readonly justLooped: boolean
  /** Authored frame rate of the current animation. */
  readonly frameRate: number
  readonly startFrame: number
  readonly endFrame: number
  /**
   * The speed the Brain **stored**, which is not always the one that was passed:
   * `0` and negatives clamp to a stop, so a host that dragged a slider negative
   * can see the stop it actually got rather than assuming it got reverse.
   */
  readonly speedScale: number

  /**
   * Configured loop count. `-1` is infinite, and it is what you read back for
   * one: `setLoopCount` normalizes everything at or below zero to `-1`, so passing
   * `0` asks for infinite but never comes back as `0`.
   */
  readonly loopCount: number
  readonly remainingLoops: number
  /** `SsPlaybackDirection` wire value. */
  readonly playbackDirection: number
  /** `SsPlaybackStyle` wire value. */
  readonly playbackStyle: number
  /**
   * Which way the playhead is actually travelling this frame — **not** the same
   * as `playbackDirection`, which is only the heading that was configured. Under
   * ping-pong the return leg runs backward while `playbackDirection` still reads
   * forward, and a negative speed does not flip it (a negative speed is a stop).
   *
   * This is the gate the sibling players put in front of audio: SpriteStudio has
   * no reverse audio, so a key crossed on a backward leg must not be played. A
   * host wiring `onAudio` into its own audio stack wants the same test.
   */
  readonly isPlayingForward: boolean
  readonly skipFrames: boolean
  /**
   * Whether the frame handed to the Brain **for display** keeps its fraction.
   *
   * The playhead is a float either way — `frameNo` reports it unrounded, and the
   * instance / effect slots are always stepped from the unrounded value, since
   * truncating there freezes a child on any tick worth less than a frame.
   */
  readonly subFrame: boolean

  /**
   * **Starts from the beginning** — not a resume. `ss_runtime_play` rewinds to
   * the start frame (the end frame when playing backwards), re-arms the loop
   * counter and clears the pause and terminal flags. To carry on from where a
   * pause left off, use `resume()`. Moves the playhead.
   */
  play(): void
  /** As `play()`, but starting at `frameNo`. Moves the playhead. */
  playFrom(frameNo: number): void
  /**
   * Holds playback on the current frame, and does nothing if already held or
   * if nothing is playing.
   *
   * Maps onto `ss_runtime_pause`, which is one-way and idempotent. It used to
   * be a **toggle** (`is_pausing = !is_pausing`) — the wrong shape for a
   * declarative `playing` prop, since a second call resumed — and the runtime
   * split it into `pause` / `resume`.
   */
  pause(): void
  /**
   * Lifts a `pause()`, carrying on from the same frame. Does nothing if not
   * held. Not the same as `play()`, which heads out and rewinds.
   */
  resume(): void
  /**
   * Halts the transport **where it stands** — it does not rewind, and it does
   * not raise `isFinished`. `play()` is what returns to the start.
   */
  stop(): void
  /** Seeks without changing play/pause state. Moves the playhead. */
  setFrameNo(frameNo: number): void
  /**
   * How many times to play: `n` cycles then stop, `-1` forever, and `0` asks
   * for the same as `-1` rather than "no cycles".
   *
   * The one transport setting that is per-transition: `setupAnimation` resets
   * it, so a host that wants a count to hold has to set it again after each
   * switch.
   */
  setLoopCount(loops: number): void
  /**
   * Multiplier on the authored frame rate.
   *
   * `0` **stops the playhead** where it stands rather than meaning "no
   * setting", and a negative rate is clamped to the same stop — reversing is
   * `setPlaybackDirection`'s job, not the speed's. Survives `setupAnimation`.
   */
  setSpeedScale(rate: number): void
  /**
   * Which way the playhead walks, and what it does at the far end.
   *
   * Survives `setupAnimation` — "play this backwards" describes the playback,
   * not the clip that happens to be loaded. The heading inside a ping-pong
   * cycle does not: a new animation always starts on the outward leg.
   */
  setPlaybackDirection(direction: number, style: number): void
  /**
   * Whether a long `update()` may skip intermediate frames. False makes every
   * frame — and so every event on it — observed, at the cost of catching up.
   */
  setSkipFrames(skip: boolean): void
  /** Restricts playback to `[startFrame, endFrame]`. Moves the playhead. */
  setSection(startFrame: number, endFrame: number): void
  /**
   * Overrides the advance rate, in absolute frames per second.
   *
   * The host's rather than the clip's, so it survives `setupAnimation` — pass
   * `0` (or a negative) to clear it and go back to whatever each animation was
   * authored at. `setSpeedScale` is the multiplier; this replaces the rate.
   */
  setFrameRate(fps: number): void
  /**
   * See `subFrame`. Off floors the **display** frame only, pinning playback to
   * whole authored frames; the playhead and the slot stepping are untouched.
   *
   * Propagates to the instance children, which are drawn at their own playhead
   * and have to be floored on the same terms.
   */
  setSubFrame(enabled: boolean): void

  /** Part index for `partName`, or -1. Stable for the loaded pack. */
  findPartIndex(partName: string): number

  /**
   * The box `animations` actually draw into, measured by baking each of them
   * and unioning every vertex — the subtrees Instance parts mount included.
   *
   * This is the box a caller asks for when the authored canvas (`canvasBox`)
   * is not the one it wants: the canvas is where the artist composed, and art
   * can overflow it. Measured on this repo's own packs, `Basic` (480 wide)
   * draws into `x[-250.5, 232.0]` and `Shape` (320 wide) into
   * `x[-248.0, 131.9]`.
   *
   * **Moves the playhead and leaves the last of `animations` set up**, so it
   * runs *before* `setupAnimation` — the same ordering rule `bindInstancePack`
   * has, and for a related reason: it is load-time setup, not a query. Layer 3
   * already calls `setAnimation` after a load, which restores the intended one.
   *
   * `maxFrames` caps the walk per animation; 0 means one authored cycle. An
   * effect's extent grows for as long as it is simulated, so a pack of those
   * wants a real cap rather than a cycle.
   *
   * Returns a zero-sized box when nothing drew — a caller should fall back to
   * placing at scale 1 rather than dividing by it.
   */
  measureContentBox(animations: string[], maxFrames: number): SsBox

  /**
   * The authored canvas of the animation set up — its size, placed against the
   * origin by its pivot — in player-local units. What `fit` places against when
   * the caller supplies no `frame` and asks for no measurement.
   *
   * Read from the `.ssab`, no bake, so it costs nothing and does not move with
   * the playhead. Zero-sized before an animation is set up.
   */
  canvasBox(): SsBox

  /**
   * Where part `partIndex` is this frame — see `SsPartTransform`.
   *
   * Player-local, so the root transform still has to be applied to reach the
   * screen. That is deliberate: the root transform is Layer 2's and is applied
   * exactly once, and folding it in here would give two places that know it.
   */
  getPartTransform(partIndex: number): SsPartTransform

  /**
   * Whether part `partIndex` is hidden on the frame being displayed.
   *
   * The companion to `getPartTransform`, which reports where a part *would* be
   * whether or not it is drawn. A host driving its own view from a part needs
   * both: the pose to place it, and this to decide whether to show it — the
   * `onHide` option the sibling Players offer on their built-in attachments.
   *
   * Read from the **display** frame's `FrameData` — floored when sub-frame is
   * off, the same frame the renderer bakes — so it cannot disagree with what is
   * on screen. It is that frame's `hide`, which the Brain also sets for a
   * `setPartVisibility` force-hide and, with `cascade`, for every descendant it
   * reaches, from the next `update()` or call that moves the playhead (at once
   * on a player that does not advance — see the override layer below). False
   * for an out-of-range index and before the first `update()`, when there is
   * no frame to read.
   */
  isPartHidden(partIndex: number): boolean

  /**
   * Whether part `partIndex` is a **skinned** mesh — a mesh part bound to bones.
   *
   * The one thing a follower of `getPartTransform` has to know. A skinned mesh's
   * vertices are drawn from its bound bones' matrices, while the part's own node
   * transform — what this returns a placement for — stays at its setup position,
   * usually near the character root. So a view pinned to such a part snaps near
   * the root rather than onto the deformed art. A rigid (deform-only) mesh and
   * every non-mesh part place their art at their own node, so those are false
   * and follow correctly.
   *
   * A static `.ssab` read, keyed off the same field every sibling Player uses so
   * the answers agree (`mesh_binding` present with a non-empty `influence_bone`
   * list). False for an out-of-range
   * index. Available before the first `update()`, like `partNames`.
   */
  isPartSkinnedMesh(partIndex: number): boolean

  /**
   * How many events the last `update()` crossed — user data, signals and all.
   *
   * A **cheap gate** in front of `getUserDataEvents` / `getAudioEvents`, each of
   * which is otherwise one vector allocation and one Nitro array marshal per
   * player per frame to say "none", on a path that runs 60 times a second for
   * every player on screen. Almost every frame answers 0.
   *
   * It counts *frames* crossed that carry any event at all, so it gates both
   * calls and over-reports each: a frame with a user-data key and no audio still
   * makes this non-zero. That is the right direction to be wrong in — the cost
   * of an extra empty read is one marshal, and the cost of a missed one is a
   * dropped event.
   */
  readonly passedEventCount: number

  /**
   * The user-data keys the last `update()` crossed.
   *
   * A **read, not a drain**: the Brain's `collect_events` clears its list at the
   * top of each collection, so calling this twice in a tick returns the same
   * events and never calling it loses nothing. That is why it is safe to gate
   * on `passedEventCount` and on whether anyone is listening.
   *
   * A long `update()` can cross several frames at once and reports all of
   * them, unless `setSkipFrames(true)` let it skip — which is exactly the
   * trade-off that setting exists to make.
   */
  getUserDataEvents(): SsUserDataEvent[]

  /**
   * The audio keys the last `update()` crossed.
   *
   * Same contract as `getUserDataEvents` in every respect — a read rather than a
   * drain, gated on `passedEventCount`, and reporting every frame a long
   * `update()` crossed unless `setSkipFrames(true)` let it skip. It is a
   * separate call rather than a `kind` field on one list because the two
   * payloads have nothing in common, and a union would make every consumer
   * narrow before it could read anything.
   *
   * Each event is resolved against the pack's `SoundList` here, in C++, because
   * that table lives in the `.ssab` and the `.ssab` deliberately never enters
   * the JS heap.
   */
  getAudioEvents(): SsAudioEvent[]

  /**
   * The signals the last `update()` crossed, inactive ones dropped.
   *
   * Same contract as the two above, and the third and last table
   * `EventsPerFrame` carries that is a *key* rather than a slot — `instances`
   * and `effects` are read by their own slot machinery, not here.
   */
  getSignalEvents(): SsSignalEvent[]

  // --- the override layer -------------------------------------------------
  //
  // Per-part overrides that sit *on top of* the animation, from the Brain's own
  // override layer rather than anything reimplemented here. Every one takes a
  // part index from `findPartIndex`, and every one returns false rather than
  // throwing when the part cannot take that kind of override — a Shape has no
  // cell, so `setPartCell` on one is a no-op and says so.
  //
  // The Brain applies an override when it builds a frame. A player that
  // `advances` shows it from the next `update()`. One that does not has no
  // `update()` coming, so its frame is rebuilt at the next read or draw.

  /**
   * `force`: 0 reverts to the animation, 1 force-hides. 2 (force-show) is
   * reserved: the runtime rejects it and returns false.
   * `cascade` propagates a force-hide to descendants, which is what "hide this
   * limb" almost always means.
   */
  setPartVisibility(partIndex: number, force: number, cascade: boolean): boolean
  clearPartVisibility(partIndex: number): boolean

  /**
   * `rgba` is `0xRRGGBBAA` and fills all four corners. `blendOp` is the
   * **PartColor** blend — `0=Mix 1=Mul 2=Add 3=Sub`, and only those four —
   * *not* `DrawBatch.blend_type`'s twelve. Conflating the two is a mistake.
   *
   * `priority`: `0` until the next keyframe, `1` until the next animation,
   * `2` permanent.
   */
  setPartColor(
    partIndex: number,
    blendOp: number,
    rgba: number,
    priority: number
  ): boolean
  clearPartColor(partIndex: number): boolean

  /**
   * Swaps which cell a part samples — a costume change, or a mouth shape.
   *
   * Both hashes come from `hashString`, of the cellmap name (no `.ssce`) and
   * the cell name. Normal and Mask parts only; fails if the cell cannot be
   * resolved, which is what makes a typo visible rather than silent.
   */
  setPartCell(
    partIndex: number,
    cellmapNameHash: number,
    cellNameHash: number,
    priority: number
  ): boolean
  clearPartCell(partIndex: number): boolean

  /** Drops every per-part override on this player at once. */
  clearPartOverrides(): boolean

  // --- animation mixing: the track stack ------------------------------------
  //
  // Straight through to the Brain's track calls (`ss_runtime_set_track_*`,
  // `ss_runtime_crossfade`, `ss_runtime_*_source_*`), with their names and their
  // argument order. A **track** layers onto the pose the tracks below it made; a
  // **source** is one animation blended within a track. Track 0 is the one
  // `setupAnimation` lays, and `setupAnimation` collapses the stack back to it.
  //
  // The track-0 forms of the playback settings are the transport calls above:
  // `setSpeedScale` is track 0's `setTrackSpeed`, and the Brain stores one value
  // for both. A `crossfade` or `setTrackAnimation` on track 0 changes what track
  // 0 plays **from the call on** — `frameNo`, `isPlaying` / `isFinished` /
  // `justLooped`, `canvasBox` and `currentAnimationIndex` all answer for the
  // incoming animation at once — and lays it looping forever, as a setup does.
  //
  // Every setter returns false when the Brain refused it, with the reason in
  // `lastErrorMessage`. A read with nothing to report returns the C ABI's
  // sentinel, translated only where the C one cannot cross as a number: `NaN`
  // for a missing float, `-1` for a missing integer or source handle.
  //
  // A call that changes the pose marks the frame stale, so a player that does
  // not advance still shows it, the same way an override does.

  /** How many tracks exist, silent ones included. At least 1 once set up. */
  readonly trackCount: number
  /**
   * Which animation track 0 plays, as an index into `getAnimationNames()`, or
   * `-1` before anything is set up. Follows a track-0 `crossfade` from the call.
   */
  readonly currentAnimationIndex: number

  /**
   * Lays `name` on `track`, replacing what it played. Tracks grow on demand;
   * track 0 must have been set up first. Cancels a fade in flight on the track.
   */
  setTrackAnimation(track: number, name: string): boolean
  /** Silences `track` and cancels its fade. Track 0 cannot be cleared. */
  clearTrack(track: number): boolean
  /**
   * Fades `track` over to `name` in `durationMs` — the same unit as `update`.
   * Everything the track carried fades out together; a fade in flight is folded
   * into the outgoing side where it stands.
   */
  crossfade(track: number, name: string, durationMs: number): boolean
  /** Drives `track`'s alpha to `targetAlpha` over `durationMs`. */
  fadeTrack(track: number, targetAlpha: number, durationMs: number): boolean
  /** How far the fade in flight on `track` has got, `[0, 1]`; `NaN` when none. */
  getTrackFadeProgress(track: number): number
  /** Stops the fade on `track` where it stands. */
  cancelTrackFade(track: number): boolean

  /** How strongly `track` layers onto the pose below. Not clamped. */
  setTrackAlpha(track: number, alpha: number): boolean
  /** `NaN` for a track that does not exist. */
  getTrackAlpha(track: number): number
  /** `SsTrackBlend` wire value: 0 Mix, 1 Additive. */
  setTrackBlend(track: number, blend: number): boolean
  /** `SsTrackBlend` wire value, or `-1` for a track that does not exist. */
  getTrackBlend(track: number): number
  /**
   * `SsTrackSync` wire value: 0 Free, 1 Start. Set it before laying an
   * animation; a track with nothing on it is created for it.
   */
  setTrackSync(track: number, sync: number): boolean
  /** `SsTrackSync` wire value, or `-1` for a track that does not exist. */
  getTrackSync(track: number): number

  /** Seeks the track's main animation. */
  setTrackFrame(track: number, frameNo: number): boolean
  /** `NaN` when the track has no animation. */
  getTrackFrame(track: number): number
  /**
   * The track's speed — a track setting, so it holds for every animation laid
   * on the track, a crossfade's both sides included. Track 0's is `speedScale`.
   */
  setTrackSpeed(track: number, speed: number): boolean
  /** What was stored (a negative speed reads back as 0); `NaN` for no track. */
  getTrackSpeed(track: number): number
  /** Absolute fps override; `0` or less clears it. A track setting. */
  setTrackFrameRate(track: number, fps: number): boolean
  /**
   * The rate the track's animation plays at: `0` with no animation and no
   * override, `-1` for a track that does not exist.
   */
  getTrackFrameRate(track: number): number
  /** A track setting. */
  setTrackSkipFrames(track: number, skip: boolean): boolean
  /** False for a track that does not exist. */
  getTrackSkipFrames(track: number): boolean
  /** Wire values as `setPlaybackDirection`. A track setting. */
  setTrackPlaybackDirection(track: number, direction: number, style: number): boolean
  /** `-1` for a track that does not exist. */
  getTrackPlaybackDirection(track: number): number
  /** `-1` for a track that does not exist. */
  getTrackPlaybackStyle(track: number): number
  /**
   * How many times the track's animation plays before it holds its last frame;
   * `0` or less loops forever. **The animation's**, not the track's: laying
   * another one on the track starts it looping forever again.
   */
  setTrackLoopCount(track: number, loops: number): boolean
  /** `-1` forever, `0` for a track with no animation. */
  getTrackLoopCount(track: number): number
  /** True once the track's animation has played its loops out. A state. */
  isTrackFinished(track: number): boolean
  /**
   * True for the update in which the track's animation wrapped. A pulse, and
   * the Brain's own: it stands until the next `update`, however long that is.
   */
  trackJustLooped(track: number): boolean
  /**
   * How far into a crossfade on `track` its outgoing side keeps firing events:
   * while its share, `1 - t`, is at least `threshold`. Default `+∞`, silent from
   * the moment the fade begins.
   */
  setTrackOutgoingEventThreshold(track: number, threshold: number): boolean
  /** `NaN` for a track that does not exist. */
  getTrackOutgoingEventThreshold(track: number): number

  /**
   * The handle of the source carrying the track's animation, or `-1` when it
   * has none. Released handles are reused, so do not hold one across a fade.
   */
  getTrackMainSource(track: number): number
  /** Adds another weighted source to `track`. The new handle, or `-1`. */
  addTrackSource(track: number, name: string, weight: number): number
  setSourceWeight(source: number, weight: number): boolean
  /** `NaN` for a handle that names no source. */
  getSourceWeight(source: number): number
  setSourceFrame(source: number, frameNo: number): boolean
  /** `NaN` for a handle that names no source. */
  getSourceFrame(source: number): number
  /**
   * Which animation `source` plays, as an index into `getAnimationNames()`, or
   * `-1` for a handle that names no source.
   */
  getSourceAnimationIndex(source: number): number
  /** The weight at or above which `source` fires events. Default `+∞`. */
  setSourceEventThreshold(source: number, threshold: number): boolean
  /** `NaN` for a handle that names no source. */
  getSourceEventThreshold(source: number): number

  // --- `.ssab` metadata ---------------------------------------------------
  //
  // The Brain returns none of the metadata rendering needs — cellmap names,
  // texture paths, animation names — and tells Players to read it out of the
  // ssab themselves. That reading happens in
  // C++ (`cpp/SsAnimeBinary.hpp`), against the Brain's own copy of the bytes,
  // and the layers above ask **typed questions** rather than being handed a
  // buffer to parse. No FlatBuffer ever crosses into JS.

  /**
   * Every texture this pack needs, cellmaps first and then external textures.
   *
   * One list because to a caller it is one question. `DrawBatch.texture_hash`
   * is the cellmap name's hash normally, but a part under an authored texture
   * change (`TCHG`) carries the hash of a texture *file* name out of
   * `external_textures` instead; miss those and exactly those parts silently
   * stop drawing.
   *
   * **Includes every bound instance pack's textures**, deduplicated by hash, so
   * one table covers the whole player tree — which is what `drawInto` needs,
   * since a child draws through the root's table. Call it *after*
   * `setupAnimation`: the children do not exist until then, and their textures
   * come with them.
   */
  getTextures(): SsTextureInfo[]

  /**
   * A copy of the encoded image an embedded texture carries, by
   * `SsTextureInfo.textureHash`, out of the same tree `getTextures` lists.
   * Empty when that texture is not embedded, or once the context is released.
   *
   * A copy because the decode runs across an `await`, which the resource may
   * not outlive. The Brain's own copy stays resident for the resource's whole
   * life either way: it sits inside the same contiguous FlatBuffer as the rest
   * of the pack, so it cannot be freed on its own.
   */
  copyEmbeddedTexture(textureHash: number): ArrayBuffer

  /** Animation names in this pack, for feeding back to `setupAnimation`. */
  getAnimationNames(): string[]

  /**
   * Part names in part-index order, read from the `.ssab` and so available
   * before the first `update()`.
   *
   * A part authored without a name holds its slot as `''` rather than being
   * skipped, so the list stays aligned with the `partIndex` every event carries
   * — turning one back into something a human reads is the point. `length` is
   * the part count, which `partCount` reports only once a frame has run.
   */
  partNames(): string[]

  /**
   * Cellmap names in this pack, without the `.ssce` extension — the namespace
   * `setPartCell` hashes against.
   *
   * Read from the `.ssab` rather than the texture table, because a cellmap
   * inside an Embedded pack still has a name.
   */
  cellmapNames(): string[]

  /**
   * The cell names inside one cellmap — the other half of what `setPartCell`
   * takes. Empty when the cellmap is not in this pack.
   */
  cellNames(cellmapName: string): string[]

  /**
   * The texture table `drawInto` resolves batches against, kept until the next
   * call. Set it when the table changes, not every frame: it is an array
   * marshalled across JSI.
   *
   * It resolves each batch's `texture_hash` to the paint it draws with, so a
   * pack with several cellmaps still costs one `drawInto` and — unlike drawing
   * per texture — keeps the batches in the order the Brain emitted them, which
   * is the whole of the depth sorting. A batch whose hash is absent is skipped
   * rather than drawn with the wrong atlas; a single-entry table is matched
   * unconditionally, so a one-cellmap pack does not need the hash to be right.
   *
   * The context holds a reference to every paint until the table is replaced
   * or the context disposed, so a registry that drops a paint meanwhile leaves
   * nothing dangling.
   */
  setTextures(textures: SsTextureBinding[]): void

  /**
   * Bake **and draw** the current frame, entirely in C++.
   *
   * Nothing per-vertex crosses into JS — no `SkPoint` host objects to allocate
   * and no `MakeVertices` array to unmarshal. JS is left with one draw call
   * per player per frame.
   *
   * The root placement is applied here, around the draw: translate by
   * `(x, y)`, then scale by `(scaleX, scaleY)`, a negative scale mirroring that
   * axis. The canvas comes from RN Skia and is borrowed for the call. Draws
   * nothing until `setTextures` has given it a table. Returns the number of
   * vertices drawn.
   */
  drawInto(
    canvas: SkCanvasHandle,
    x: number,
    y: number,
    scaleX: number,
    scaleY: number
  ): number
}

/** The module root. One instance per app. */
export interface SsRuntime
  extends HybridObject<{ ios: 'c++'; android: 'c++' }> {
  /** SDK version the linked `libssruntime` reports. */
  readonly version: string

  /**
   * Whether this build can read the app's asset directory at all.
   *
   * Always true on iOS. On Android it stays false until the bootstrap provider
   * has handed over the `AssetManager`, which turns "the library is not wired
   * up" into a different message from "that pack is not in the app".
   */
  readonly hasAssetDirectory: boolean

  /**
   * Live native handles right now — see `SsLiveHandles`.
   *
   * Cheap enough to poll: two relaxed atomic loads, no lock and no walk. It is
   * a diagnostic rather than something an app should branch on, but it is on the
   * shipping surface deliberately — a leak check that only exists in a debug
   * build cannot be run on the device where leaks actually matter.
   */
  readonly liveHandles: SsLiveHandles

  /**
   * Reads the file natively and hands the bytes straight to the Brain.
   *
   * The `.ssab` never enters the JS heap. `path` must
   * already be a filesystem path — resolving one is L3's job.
   */
  createResourceFromPath(path: string): SsResource

  /**
   * The fallback for sources `fopen` cannot reach, which after the asset-path
   * work means one thing: an `http(s)` URL, so a Metro dev server or a CDN. The
   * bytes pass through the JS heap, which is exactly what the two calls either
   * side of this one exist to avoid.
   */
  createResourceFromBytes(bytes: ArrayBuffer): SsResource

  /**
   * Loads a `.ssab` out of the app's **asset directory** — the pack tree the
   * build copied in, addressed as `ss/overall/Basic.ssab`.
   *
   * This is the route that makes sibling references work. Everything a pack
   * points at — a cellmap's `image_path`, an `external_textures` entry, an
   * Instance part's external `.ssab`, a `.ssqb`'s `ref_anime_pack` — is a name
   * relative to the `.ssab`, so it can only be resolved where the whole
   * directory survives into the app. Metro does not preserve one (it bundles
   * what a `require()` names, and Android's packager then flattens it into
   * `res/`), so the directory is copied in out-of-band by the config plugin.
   *
   * Still no JS heap: iOS opens the file inside the `.app`, Android reads the
   * APK entry through `AAssetManager`, and either way the bytes go straight to
   * the Brain.
   */
  createResourceFromAsset(path: string): SsResource

  createContext(resource: SsResource): SsContext

  /**
   * An asset's bytes, for the things JS itself has to decode — a texture, on
   * its way to `Skia.Data.fromBytes`.
   *
   * `Skia.Data.fromURI` covers `file:` and `http:` but knows nothing about
   * either platform's asset storage, so this is the seam that keeps "where the
   * app keeps its assets" a question only C++ has to answer. Throws, naming the
   * path, rather than returning empty.
   */
  readAsset(path: string): ArrayBuffer

  /**
   * The Brain's own FNV-1a (`ss_runtime_hash_string`), the hash `cellmap.name`
   * and `DrawBatch.texture_hash` are both keyed on.
   *
   * Exposed rather than reimplemented in TypeScript on purpose: two
   * implementations of a hash is one more than can be kept in agreement, and a
   * silent disagreement shows up as a texture that simply never resolves.
   */
  hashString(value: string): number

  /**
   * Decodes `image` on a worker thread if it is still encoded, and swaps the
   * decoded pixels into it.
   *
   * `Skia.Image.MakeImageFromEncoded` returns an image that decodes the first
   * time it is drawn, and a canvas draws on the UI thread, which a large atlas
   * stalls for tens of milliseconds. Decoded here, the image keeps its pixels
   * (width × height × 4 bytes) for as long as it lives. Leave the image alone
   * until the promise settles.
   */
  decodeImage(image: SkImageHandle): Promise<void>
}
