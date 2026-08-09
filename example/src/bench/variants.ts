import {
  Skia,
  VertexMode,
  type SkCanvas,
  type SkPaint,
  type SkPoint,
  type SkVertices,
} from '@shopify/react-native-skia'
import {
  SS_BATCH_STRIDE,
  SS_MATRIX_STRIDE,
  SS_VERTEX_STRIDE,
  SsBatchField,
  SsBatchKind,
  type SsContext,
  type SsTextureBinding,
} from 'react-native-spritestudio'

/**
 * The two candidate L1/L2 boundaries, plus the one the spike added after
 * reading RN Skia's JSI layer.
 *
 * - `js-bake`   — variant (a): the Brain's SoA is lent to JS and Hermes does the
 *                 per-vertex maths. The Flutter-shaped split.
 * - `native-bake` — variant (b): C++ hands JS finished vertex arrays; JS only
 *                 walks batches and calls `MakeVertices`.
 * - `native-draw` — variant (c): C++ builds `SkVertices` and draws into the
 *                 `SkCanvas` itself. Nothing per-vertex crosses into JS.
 *
 * (c) exists because `Skia.MakeVertices` takes `SkPoint[]` and `SkColor[]` —
 * arrays of *host objects*. Its JSI constructor calls `getValueAtIndex` +
 * `asObject` + `fromValue` once per vertex per array, so both (a) and (b) pay
 * ~2N JSI round-trips per frame no matter where the bake happens. If that cost
 * dominates, (b) cannot beat (a) by much and the real answer is (c).
 */
export type Variant = 'js-bake' | 'native-bake' | 'native-draw'

/** Corner float offsets within a part's 10-float `lt, rt, lb, rb, center` slice. */
const CORNER = [0, 2, 4, 6] as const
/** Two triangles over `lt, rt, lb, rb`. Skia does not cull, so winding is free. */
const QUAD_INDICES = [0, 1, 2, 1, 3, 2] as const

/** One batch's geometry, ready for `canvas.drawVertices`. */
export interface BatchGeometry {
  vertices: SkVertices
  vertexCount: number
  textureHash: number
  blendType: number
}

/**
 * Variant (a): read the SoA, do the maths in JS.
 *
 * The `SkPoint[]`/`indices` arrays are rebuilt every frame on purpose — that is
 * what `MakeVertices` consumes, so pooling them would measure a design nobody
 * can actually ship.
 */
export function bakeInJs(ctx: SsContext): BatchGeometry[] {
  const plan = ctx.getPlan()
  const soa = ctx.getSoA()

  const batches = new Int32Array(plan.batches)
  const drawOrder = new Uint16Array(plan.drawOrder)
  const world = new Float32Array(soa.worldMatrices)
  const local = new Float32Array(soa.localVertices)
  const uvs = new Float32Array(soa.localUvs)

  const out: BatchGeometry[] = []
  const batchCount = plan.batchCount

  for (let b = 0; b < batchCount; b++) {
    const base = b * SS_BATCH_STRIDE
    if (batches[base + SsBatchField.kind] !== SsBatchKind.Normal) continue

    const startRank = batches[base + SsBatchField.startRank]!
    const count = batches[base + SsBatchField.count]!
    if (count === 0) continue

    const positions: SkPoint[] = []
    const texs: SkPoint[] = []
    const indices: number[] = []

    for (let k = 0; k < count; k++) {
      const partIndex = drawOrder[startRank + k]!
      const m = partIndex * SS_MATRIX_STRIDE
      const v = partIndex * SS_VERTEX_STRIDE
      // Column-major 4x4, 2D slice: x' = m0*x + m4*y + m12.
      const m0 = world[m]!
      const m1 = world[m + 1]!
      const m4 = world[m + 4]!
      const m5 = world[m + 5]!
      const m12 = world[m + 12]!
      const m13 = world[m + 13]!

      const vertexBase = positions.length
      for (let c = 0; c < 4; c++) {
        const o = v + CORNER[c]!
        const x = local[o]!
        const y = local[o + 1]!
        positions.push(Skia.Point(m0 * x + m4 * y + m12, m1 * x + m5 * y + m13))
        // Texture pixel space, not normalised — Skia's image shader samples in
        // pixels, so these go through untouched.
        texs.push(Skia.Point(uvs[o]!, uvs[o + 1]!))
      }
      for (let i = 0; i < 6; i++) indices.push(vertexBase + QUAD_INDICES[i]!)
    }

    if (positions.length === 0) continue
    out.push({
      vertices: Skia.MakeVertices(VertexMode.Triangles, positions, texs, undefined, indices),
      vertexCount: positions.length,
      textureHash: batches[base + SsBatchField.textureHash]!,
      blendType: batches[base + SsBatchField.blendType]!,
    })
  }
  return out
}

/**
 * Variant (b): C++ already produced the vertex arrays; JS only reshapes them
 * into what `MakeVertices` accepts.
 *
 * That reshape is the point of the comparison. If it costs nearly as much as
 * (a)'s full bake, the bake was never the bottleneck.
 */
export function bakeInNative(ctx: SsContext): BatchGeometry[] {
  const baked = ctx.bake()

  const batches = new Int32Array(baked.batches)
  const positions = new Float32Array(baked.positions)
  const texCoords = new Float32Array(baked.texCoords)
  const indexBuf = new Uint16Array(baked.indices)

  const out: BatchGeometry[] = []
  for (let b = 0; b < baked.batchCount; b++) {
    const base = b * SS_BATCH_STRIDE
    const vertexCount = batches[base + SsBatchField.vertexCount]!
    if (vertexCount === 0) continue

    const vertexOffset = batches[base + SsBatchField.vertexOffset]!
    const indexOffset = batches[base + SsBatchField.indexOffset]!
    const indexCount = batches[base + SsBatchField.indexCount]!

    const pts: SkPoint[] = new Array(vertexCount)
    const uvs: SkPoint[] = new Array(vertexCount)
    for (let i = 0; i < vertexCount; i++) {
      const f = (vertexOffset + i) * 2
      pts[i] = Skia.Point(positions[f]!, positions[f + 1]!)
      uvs[i] = Skia.Point(texCoords[f]!, texCoords[f + 1]!)
    }

    const indices: number[] = new Array(indexCount)
    for (let i = 0; i < indexCount; i++) indices[i] = indexBuf[indexOffset + i]!

    out.push({
      vertices: Skia.MakeVertices(VertexMode.Triangles, pts, uvs, undefined, indices),
      vertexCount,
      textureHash: batches[base + SsBatchField.textureHash]!,
      blendType: batches[base + SsBatchField.blendType]!,
    })
  }
  return out
}

/**
 * Variant (c): C++ bakes *and* draws.
 *
 * The canvas and paint go across as opaque handles (Nitro `CustomType`,
 * unwrapped in `cpp/SsSkiaBridge.cpp`), and no vertex ever becomes a JS value.
 * One JSI call per player per frame, whatever the vertex count.
 *
 * Returns the number of vertices drawn so the bench can report the same figure
 * the other two variants do.
 */
export function drawInNative(ctx: SsContext, canvas: SkCanvas, paint: SkPaint): number {
  // Ringo has one cellmap, and `drawInto` matches a single-entry texture table
  // unconditionally, so the hash is irrelevant here. The array is reused and
  // mutated rather than rebuilt so the measurement does not include an
  // allocation per player per frame that the real player does not pay either
  // (Layer 2 caches its bindings the same way).
  TEXTURES[0]!.paint = paint
  return ctx.drawInto(canvas, TEXTURES)
}

const TEXTURES: SsTextureBinding[] = [{ textureHash: 0, paint: {} }]
