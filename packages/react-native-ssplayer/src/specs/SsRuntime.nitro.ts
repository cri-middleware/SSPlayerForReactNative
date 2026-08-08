import type { CustomType, HybridObject } from 'react-native-nitro-modules'

/**
 * Layer 1 — the JSI seam onto `libssruntime` (the Brain).
 *
 * PHASE 0 SPIKE SURFACE. This is deliberately not the shipping API: it exposes
 * the *same* frame in two competing representations so the two candidate
 * L1/L2 boundaries can be measured against each other on device (design doc
 * ch.8 Phase 0 / ch.9 A). Once the measurement picks a winner, the loser's
 * entry point goes away and this file becomes the real spec.
 *
 * Lifetime rule that survives into the real spec: **every ArrayBuffer handed
 * out here is a borrow of native memory that stays valid only until the next
 * `update()`** (design doc ch.9 F). Nothing may retain one across frames. The
 * `generation` counter is the enforcement handle — see `SsFramePlan`.
 *
 * Disposal is not declared here: every Nitro `HybridObject` already carries a
 * `dispose()` (nitrogen rejects redeclaring it), and that is the explicit
 * teardown ch.9 F asks for — L3 calls it on unmount rather than waiting for GC.
 */

/**
 * The per-frame drawing plan, walked out of the FrameData FlatBuffer natively.
 *
 * This walk is native in BOTH variants on purpose, so it is not what the spike
 * measures. That is not a thumb on the scale: `30_core/30_render_loop.md` §2
 * already rules out per-element FlatBuffers accessors on high-level hosts
 * (measured at ~26x on Unity/C#), so "JS parses the FlatBuffer" was never a
 * candidate design.
 */
export interface SsFramePlan {
  /**
   * Bumped by every `update()`. Read it when you take a buffer and compare it
   * before you use one: a mismatch means the memory behind your ArrayBuffer has
   * already been recycled by the Brain.
   */
  generation: number
  /** Part indices in draw order, `Uint16Array`. */
  drawOrder: ArrayBuffer
  /** `SsBatchDesc[]` — see `cpp/SsBatchDesc.hpp` for the layout. `Int32Array`-readable. */
  batches: ArrayBuffer
  batchCount: number
  /** Per-part alpha for the current frame, `Float32Array`, indexed by part index. */
  partAlpha: ArrayBuffer
}

/**
 * Variant (a) — the Flutter-shaped split: the Brain's SoA buffers are lent to
 * JS untouched and **L2 (JS/Hermes) does the per-vertex bake**.
 *
 * Every buffer is a borrow; see the lifetime rule above.
 */
export interface SsSoAFrame {
  generation: number
  /** 16 floats per part, column-major 4x4. `Float32Array`. */
  worldMatrices: ArrayBuffer
  /** 10 floats per part: `lt, rt, lb, rb, center` as (x, y). `Float32Array`. */
  localVertices: ArrayBuffer
  /**
   * 10 floats per part, same corner order as `localVertices`.
   * **Texture pixel coordinates, not normalized** (SSPlayerForFlutter AGENTS.md
   * "Traps"). Divide by the cellmap texture size at bake time.
   */
  localUvs: ArrayBuffer
  /** 6 floats per part: `pivot_x, pivot_y, size_w, size_h, rect_left, rect_top`. `Float32Array`. */
  cellMeta: ArrayBuffer
}

/**
 * Variant (b) — **L1 (C++) does the per-vertex bake** and hands JS finished
 * vertex arrays, leaving JS only the batch walk and the draw calls.
 *
 * Split rather than interleaved because that is the shape RN Skia's
 * `Skia.MakeVertices(mode, positions, texs, colors, indices)` consumes.
 */
export interface SsBakedFrame {
  generation: number
  /** 2 floats per vertex, world space. `Float32Array`. */
  positions: ArrayBuffer
  /**
   * 2 floats per vertex, in **texture pixel space** — deliberately not
   * normalized. Skia's image shader samples in pixels, so these go to
   * `MakeVertices` untouched and the atlas size never has to reach this layer.
   */
  texCoords: ArrayBuffer
  /** `Uint16Array`, triangle list, indices are **batch-relative**. */
  indices: ArrayBuffer
  /** `SsBatchDesc[]`, with the vertex/index ranges filled in. */
  batches: ArrayBuffer
  vertexCount: number
  indexCount: number
  batchCount: number
}

/**
 * An RN Skia `SkCanvas`, unwrapped back to the `SkCanvas*` behind it.
 *
 * RN Skia hands JS a JSI host object wrapping the real canvas. Nitro's
 * `CustomType` is the escape hatch that lets a spec name a type Nitro does not
 * know: the `JSIConverter` in `cpp/SsSkiaBridge.hpp` does the unwrapping, so
 * C++ ends up holding the same pointer RN Skia's own draw calls use.
 *
 * This is what makes variant (c) possible at all — without it there is no way
 * to hand a canvas across the Nitro boundary.
 */
export type SkCanvasHandle = CustomType<
  object,
  'SkCanvasHandle',
  { include: 'SsSkiaBridge.hpp' }
>

/** An RN Skia `SkPaint`, unwrapped the same way. */
export type SkPaintHandle = CustomType<
  object,
  'SkPaintHandle',
  { include: 'SsSkiaBridge.hpp' }
>

/** A loaded `.ssab`. Shareable across contexts; the Brain refcounts it internally. */
export interface SsResource
  extends HybridObject<{ ios: 'c++'; android: 'c++' }> {
  readonly byteLength: number
}

/** One playing animation. */
export interface SsContext
  extends HybridObject<{ ios: 'c++'; android: 'c++' }> {
  readonly partCount: number
  readonly generation: number
  readonly frameNo: number

  setupAnimation(name: string): boolean
  /** Advances by `dtSeconds` and returns the new frame number. Invalidates every previously issued buffer. */
  update(dtSeconds: number): number

  getPlan(): SsFramePlan
  /** Variant (a). */
  getSoA(): SsSoAFrame
  /** Variant (b). */
  bake(): SsBakedFrame

  /**
   * Variant (c): bake **and draw**, entirely in C++.
   *
   * Nothing per-vertex crosses into JS — no `SkPoint` host objects to allocate
   * and no `MakeVertices` array to unmarshal, which the Phase 0 numbers
   * (`docs/phase0-spike.md`) identify as the actual cost. JS is left with one
   * call per player per frame.
   *
   * `canvas` and `paint` come straight from RN Skia; the caller keeps owning
   * them, and this only borrows them for the duration of the call. Returns the
   * number of vertices drawn, so the bench can report the same figure the other
   * two variants do.
   */
  drawInto(canvas: SkCanvasHandle, paint: SkPaintHandle): number
}

/** The module root. One instance per app. */
export interface SsRuntime
  extends HybridObject<{ ios: 'c++'; android: 'c++' }> {
  /** SDK version the linked `libssruntime` reports. */
  readonly version: string

  /**
   * Reads the file natively and hands the bytes straight to the Brain.
   *
   * The `.ssab` never enters the JS heap (design doc ch.5 A). `path` must
   * already be resolved to a filesystem path — turning Metro's dev-server URL
   * into one is L3's job (design doc ch.9 E).
   */
  createResourceFromPath(path: string): SsResource
  createContext(resource: SsResource): SsContext
}
