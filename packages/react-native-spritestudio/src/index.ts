/**
 * SpriteStudio player for React Native.
 *
 * Four layers, top to bottom:
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
  useSsViewPlayer,
  type SpriteStudioViewProps,
  type SpriteStudioViewRef,
} from './view/SpriteStudioView'
export {
  useSsTextures,
  SS_DEFAULT_CELLMAP,
  type SsTextureSource,
  type SsTextureSources,
} from './view/useSsTextures'
/**
 * The many-animations arrangement: one canvas and one clock for a whole scene,
 * which is what `SpriteStudioPlayer.advance(dt)` being externally clocked was
 * always for.
 */
export {
  SpriteStudioScene,
  useSsScene,
  type SpriteStudioSceneProps,
  type SsSceneMember,
} from './view/SpriteStudioScene'
export {
  SpriteStudioSprite,
  type SpriteStudioSpriteProps,
  type SpriteStudioSpriteRef,
} from './view/SpriteStudioSprite'
export {
  useSpriteStudioPlayer,
  type SsPlayerProps,
  type SsPlayerState,
} from './view/useSpriteStudioPlayer'
/**
 * Part following, published through a Reanimated shared value — the seam that
 * does not change when the frame tick eventually moves to the UI thread.
 */
export {
  useSsPartTransform,
  type SsPartScreenTransform,
} from './view/useSsPartTransform'
export {
  SpriteStudioPartAnchor,
  type SpriteStudioPartAnchorProps,
} from './view/SpriteStudioPartAnchor'

// --- Layer 3 ---------------------------------------------------------------
export {
  SpriteStudioPlayer,
  MAX_STEP_MS,
  type SpriteStudioPlayerApi,
  type SpriteStudioPlayerOptions,
  type SsAnimationCallback,
  type SsMeasureRequest,
} from './player/SpriteStudioPlayer'
export {
  loadResource,
  releaseResource,
  resolveSourceUri,
  sourceUriOf,
  type LoadedResource,
  type SsSource,
} from './player/source'
/**
 * Preloading. Worth reaching for whenever a pack is about to be mounted several
 * times, or mounted after a navigation: the caches make N players of one pack
 * cost one parse and one atlas decode, and this is how that cost is paid before
 * the mount rather than during it.
 */
export { ssPreload, ssUnload, ssPreloadedSources } from './player/preload'
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
/**
 * The shared caches. Exported for the app that wants to drop them under memory
 * pressure — and because the leak check has to drain them to mean anything.
 */
export { ssClearCaches, ssImageCache, ssResourceCache } from './core/caches'
export { SsRefCache, type SsRefCacheOptions } from './core/SsRefCache'
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
/** The override layer's vocabulary: what a `parts` prop may say. */
export { ssPackColor } from './core/packColor'
export {
  SsOverridePriority,
  SsBlendOp,
  type SsCellRef,
  type SsPartOverride,
  type SsPartOverrides,
  type SsOverridePriorityValue,
  type SsBlendOpValue,
} from './core/parts'
export {
  SsPlaybackDirection,
  SsPlaybackStyle,
  SS_ROOT_TRANSFORM_IDENTITY,
  type SsRootTransform,
} from './core/types'
/**
 * Placement. React-free and Skia-free, so both Layer 4 components resolve a
 * root transform through one copy of the arithmetic.
 */
export {
  resolveRootTransform,
  type SsAlign,
  type SsFit,
  type SsFrameScope,
  type SsPlacement,
} from './core/fit'

// --- Layer 1 ---------------------------------------------------------------
export { SsRuntimeModule } from './runtime'
export { SsSignalParamType } from './specs/SsRuntime.nitro'
export type {
  SsRuntime,
  SsAudioEvent,
  SsBox,
  SsPartTransform,
  SsSignalEvent,
  SsSignalParam,
  SsUserDataEvent,
  SsContext,
  SsLiveHandles,
  SsResource,
  SsTextureBinding,
  SsTextureInfo,
} from './specs/SsRuntime.nitro'
