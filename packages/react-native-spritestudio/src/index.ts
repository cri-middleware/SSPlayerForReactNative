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
  type SsTextureSource,
  type SsTextureSources,
} from './view/useSsTextures'

// --- Layer 3 ---------------------------------------------------------------
export {
  SpriteStudioPlayer,
  MAX_STEP_MS,
  type SpriteStudioPlayerApi,
  type SpriteStudioPlayerOptions,
  type SsCompleteCallback,
} from './player/SpriteStudioPlayer'
export {
  loadResource,
  resolveSourceUri,
  sourceUriOf,
  type SsSource,
} from './player/source'
/**
 * The leak check. Ships rather than living in the example app, because the
 * platform where a leaked handle actually costs anything is a device, and a
 * check that only exists in this repo cannot be run there.
 */
export {
  ssCheckForLeaks,
  ssLiveHandles,
  type SsLeakCheckResult,
} from './player/leakCheck'

// --- Layer 2 ---------------------------------------------------------------
export { SsInternalPlayer } from './core/SsInternalPlayer'
export {
  SsTextureRegistry,
  type SsTextureOptions,
} from './core/SsTextureRegistry'
export {
  SsTextureLoader,
  loadImageData,
  type SsTextureLoadReport,
} from './core/SsTextureLoader'
/**
 * Path resolution, shared by everything a pack points at. `resolveAgainst` is
 * the seam Instance parts and `.ssqb` sequences will resolve through too.
 */
export {
  fileSystemPathOf,
  normalizeUri,
  resolveAgainst,
  schemeOf,
  type SsUriScheme,
} from './core/assets'
export {
  SsPlaybackDirection,
  SsPlaybackStyle,
  SS_ROOT_TRANSFORM_IDENTITY,
  type SsRootTransform,
} from './core/types'

// --- Layer 1 ---------------------------------------------------------------
export { SsRuntimeModule } from './runtime'
export { SsTexWrapMode, SsTexFilterMode } from './specs/SsRuntime.nitro'
export type {
  SsRuntime,
  SsContext,
  SsLiveHandles,
  SsResource,
  SsTextureBinding,
  SsTextureInfo,
} from './specs/SsRuntime.nitro'
