import type { CustomType, HybridObject } from 'react-native-nitro-modules'

/**
 * Layer 1 — the JSI seam onto `libssruntime` (the Brain).
 *
 * Phase 0 measured where this boundary belongs rather than assuming it, and the
 * answer moved it down: **Layer 1 owns the drawing**, not just the geometry.
 * The two splits it was measured against — the Brain's SoA buffers lent to JS
 * for a bake in Hermes, and vertices baked in C++ but handed up for
 * `Skia.MakeVertices` — are gone along with the harness that ran them. Both are
 * capped by `MakeVertices` unmarshalling JSI host objects one vertex at a time,
 * so they stayed within 3% of each other at every load and neither came close
 * to `drawInto` (`docs/phase0-spike.md`). What is left is the shipping shape:
 * one draw call per player per frame.
 *
 * Lifetime rule: **every ArrayBuffer handed out here is a borrow of native
 * memory that stays valid only until the next `update()`** (design doc ch.9 F).
 * Nothing may retain one across frames. `SsContext.generation` is the
 * enforcement handle — read it when you take a buffer, and compare it again
 * before you read through one.
 *
 * Disposal is not declared here: every Nitro `HybridObject` already carries a
 * `dispose()` (nitrogen rejects redeclaring it), and that is the explicit
 * teardown ch.9 F asks for — L3 calls it on unmount rather than waiting for GC.
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

/** `cellmap.wrap_mode` wire values. */
export const SsTexWrapMode = { clamp: 0, repeat: 1, mirror: 2 } as const

/** `cellmap.filter_mode` wire values. */
export const SsTexFilterMode = { nearest: 0, linear: 1 } as const

/**
 * One texture a pack needs, read out of its `.ssab`.
 *
 * Sampling comes along because it is a cellmap property: left to the paint's
 * default, `drawVertices` samples nearest-neighbour and every scaled or rotated
 * sprite comes out jaggy.
 */
export interface SsTextureInfo {
  /** Look this up with `DrawBatch.texture_hash` directly. */
  textureHash: number
  /** Cellmap name, or an external texture's file name. */
  name: string
  /** Path to the image **relative to the `.ssab`**, or empty when embedded-only. */
  imagePath: string
  /** `SsTexWrapMode`. */
  wrapMode: number
  /** `SsTexFilterMode`. */
  filterMode: number
  /**
   * Encoded image bytes for an embedded pack, empty for a reference one.
   *
   * A **borrow** of the Brain's copy — decode it during the call that received
   * it and do not retain it. Note that an embedded atlas stays resident for the
   * resource's whole life even after decoding: it sits inside the same
   * contiguous FlatBuffer the Brain holds, so it cannot be freed on its own.
   */
  embedded: ArrayBuffer
}

/**
 * How many native handles are alive right now — the leak check, made observable.
 *
 * Phase 1's exit criteria ask for "no leaked native handles", which was an
 * assertion with nothing behind it until this existed: a handle that outlives
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
   * Advances by `dtMilliseconds` and returns the new frame number. Invalidates
   * every previously issued buffer.
   *
   * **Milliseconds**, which is what `ss_runtime_update` takes
   * (`30_core/20_playback_control.md` §"update"), and the unit every layer above
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
  readonly isLooped: boolean
  /** Authored frame rate of the current animation. */
  readonly fps: number
  readonly startFrame: number
  readonly endFrame: number
  /** Configured loop count; 0 means infinite. */
  readonly loops: number
  readonly remainLoops: number
  /** `SsPlaybackDirection` wire value. */
  readonly playbackDirection: number
  /** `SsPlaybackStyle` wire value. */
  readonly playbackStyle: number
  readonly skipFrames: boolean

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
   * Pauses, and does nothing if already paused.
   *
   * The C-API's `ss_runtime_pause` is a **toggle**
   * (`is_pausing = !is_pausing`), which makes a second call a resume. That is
   * the wrong shape for a declarative `playing` prop, so this side guards on
   * `isPausing` and splits the toggle into `pause()` / `resume()`.
   */
  pause(): void
  /** Resumes a paused animation, and does nothing if not paused. */
  resume(): void
  /**
   * Halts the transport **where it stands** — it does not rewind, and it does
   * not raise `isFinished`. `play()` is what returns to the start.
   */
  stop(): void
  /** Seeks without changing play/pause state. Moves the playhead. */
  setFrameNo(frameNo: number): void
  /** 0 = infinite. */
  setLoop(loops: number): void
  /** Multiplier on the authored frame rate; negative plays backwards. */
  setSpeed(rate: number): void
  setPlaybackDirection(direction: number, style: number): void
  /**
   * Whether a long `update()` may skip intermediate frames. False makes every
   * frame — and so every event on it — observed, at the cost of catching up.
   */
  setSkipFrames(skip: boolean): void
  /** Restricts playback to `[startFrame, endFrame]`. Moves the playhead. */
  setSection(startFrame: number, endFrame: number): void

  /** Part index for `partName`, or -1. Stable for the loaded pack. */
  findPartIndex(partName: string): number

  // --- `.ssab` metadata ---------------------------------------------------
  //
  // The Brain returns none of the metadata rendering needs — cellmap names,
  // texture paths, animation names — and tells Players to read it out of the
  // ssab themselves (`20_design/20_architecture.md`). That reading happens in
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
   * stop drawing (`30_core/10_initialization.md` §3).
   *
   * **Includes every bound instance pack's textures**, deduplicated by hash, so
   * one table covers the whole player tree — which is what `drawInto` needs,
   * since a child draws through the root's table. Call it *after*
   * `setupAnimation`: the children do not exist until then, and their textures
   * come with them.
   */
  getTextures(): SsTextureInfo[]

  /** Animation names in this pack, for feeding back to `setupAnimation`. */
  getAnimationNames(): string[]

  /**
   * Bake **and draw** the current frame, entirely in C++.
   *
   * Nothing per-vertex crosses into JS — no `SkPoint` host objects to allocate
   * and no `MakeVertices` array to unmarshal, which the Phase 0 numbers
   * (`docs/phase0-spike.md`) identify as the actual cost. JS is left with one
   * call per player per frame.
   *
   * `textures` resolves each batch's `texture_hash` to the paint it draws with,
   * so a pack with several cellmaps still costs one call and — unlike drawing
   * per texture — keeps the batches in the order the Brain emitted them, which
   * is the whole of the depth sorting. A batch whose hash is absent is skipped
   * rather than drawn with the wrong atlas; a single-entry table is matched
   * unconditionally, so a one-cellmap pack does not need the hash to be right.
   *
   * The canvas and every paint come straight from RN Skia; the caller keeps
   * owning them and this only borrows them for the duration of the call.
   * Returns the number of vertices drawn.
   */
  drawInto(canvas: SkCanvasHandle, textures: SsTextureBinding[]): number
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
   * The `.ssab` never enters the JS heap (design doc ch.5 A). `path` must
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
}
