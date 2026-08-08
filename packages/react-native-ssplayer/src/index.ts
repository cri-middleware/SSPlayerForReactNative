import { NitroModules } from 'react-native-nitro-modules'
import type { SsRuntime } from './specs/SsRuntime.nitro'

export type {
  SsRuntime,
  SsContext,
  SsResource,
  SsFramePlan,
  SsSoAFrame,
  SsBakedFrame,
} from './specs/SsRuntime.nitro'

/**
 * PHASE 0 SPIKE. The shipping surface is `<SpriteStudioView>` plus an L3 player
 * (design doc ch.2); none of that exists yet, because the L1/L2 boundary those
 * layers sit on is what the spike is measuring. Until then this exports Layer 1
 * raw so `example/` can drive the two candidate designs side by side.
 */
export const SsRuntimeModule =
  NitroModules.createHybridObject<SsRuntime>('SsRuntime')

/**
 * Field indices into one `SsBatchDesc` — see `cpp/SsBatchDesc.hpp`. JS reads the
 * batch array as a flat `Int32Array` and indexes it as
 * `batchIndex * SS_BATCH_STRIDE + SsBatchField.kind`, which keeps the per-frame
 * batch walk allocation-free.
 */
export const SS_BATCH_STRIDE = 10

export const SsBatchField = {
  kind: 0,
  blendType: 1,
  textureHash: 2,
  flags: 3,
  /** Variant (a): first rank into `SsFramePlan.drawOrder`. */
  startRank: 4,
  /** Variant (a): number of parts. */
  count: 5,
  /** Variant (b): first vertex (not float) into `positions` / `texCoords`. */
  vertexOffset: 6,
  vertexCount: 7,
  /** Variant (b): first entry into `indices`. */
  indexOffset: 8,
  indexCount: 9,
} as const

/** `DrawBatchKind` from framedata.fbs. */
export const SsBatchKind = {
  Normal: 0,
  Shape: 1,
  Instance: 2,
  Effect: 3,
  Mesh: 4,
  Text: 5,
  Nines: 6,
  Mask: 7,
} as const

/** Floats per part in `SsSoAFrame.worldMatrices` (column-major 4x4). */
export const SS_MATRIX_STRIDE = 16
/** Floats per part in `localVertices` / `localUvs`: `lt, rt, lb, rb, center`. */
export const SS_VERTEX_STRIDE = 10
/** Floats per part in `cellMeta`: `pivotX, pivotY, sizeW, sizeH, rectLeft, rectTop`. */
export const SS_CELL_META_STRIDE = 6
