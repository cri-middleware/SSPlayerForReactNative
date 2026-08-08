/**
 * SpriteStudio 7 player for React Native.
 *
 * Four layers, top to bottom (see AGENTS.md):
 *
 *  * **L4** `<SpriteStudioView>` — a Skia canvas, props and a ref.
 *  * **L3** `SpriteStudioPlayer` — transport, clock, events.
 *  * **L2** `SsInternalPlayer` — native lifetime and one draw call per frame.
 *    Free of `react`/`react-native`.
 *  * **L1** `SsRuntimeModule` — the Nitro seam onto the Brain, exported raw as
 *    the escape hatch.
 *
 * Layer 1 still carries the Phase 0 spike's variants (a) and (b) — `getSoA`,
 * `getPlan`, `bake` — because `example/` reproduces the measurement with them.
 * Nothing above Layer 1 uses them; they go away when the harness does.
 */

// --- Layer 4 ---------------------------------------------------------------
export {
  SpriteStudioView,
  type SpriteStudioViewProps,
  type SpriteStudioViewRef,
} from './view/SpriteStudioView'
export {
  useSsTextures,
  SS_DEFAULT_CELLMAP,
  type SsTextureSources,
} from './view/useSsTextures'

// --- Layer 3 ---------------------------------------------------------------
export {
  SpriteStudioPlayer,
  type SpriteStudioPlayerApi,
  type SpriteStudioPlayerOptions,
  type SsCompleteCallback,
} from './player/SpriteStudioPlayer'
export {
  loadResource,
  resolveSourceUri,
  fileSystemPathOf,
  type SsSource,
} from './player/source'

// --- Layer 2 ---------------------------------------------------------------
export { SsInternalPlayer } from './core/SsInternalPlayer'
export {
  SsTextureRegistry,
  type SsTextureOptions,
} from './core/SsTextureRegistry'
export {
  SsPlaybackDirection,
  SsPlaybackStyle,
  SS_ROOT_TRANSFORM_IDENTITY,
  type SsRootTransform,
} from './core/types'

// --- Layer 1 ---------------------------------------------------------------
export { SsRuntimeModule } from './runtime'
export type {
  SsRuntime,
  SsContext,
  SsResource,
  SsFramePlan,
  SsSoAFrame,
  SsBakedFrame,
  SsTextureBinding,
} from './specs/SsRuntime.nitro'

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
