/**
 * The web barrel — **the same names, none of the drawing**.
 *
 * This package targets iOS and Android. What this entry point is for is the app
 * that ships web *as well*, and plays SpriteStudio only on the native half: it
 * lets that app's web bundle build, and makes any actual use throw a message
 * naming this package rather than Nitro or a missing CanvasKit. See
 * `web/unavailable.ts` for why importing is what breaks today, and ROADMAP.md
 * for the react-native-web route this is deliberately not.
 *
 * Two kinds of export below. **Portable** ones are re-exported verbatim: every
 * module named here is import-clean (type-only imports, or none), so nothing it
 * pulls touches Skia or Nitro — the placement arithmetic, the path resolution,
 * the caches and the vocabulary enums all work on web and are worth having in
 * shared code. Everything else is a stub, typed through `typeof import(...)` so
 * the two barrels keep one type surface without this file importing a single
 * module that would throw at import.
 */

import { unavailableOnWeb } from './web/unavailable'

// --- Layer 4 ---------------------------------------------------------------
export const SpriteStudioView: typeof import('./view/SpriteStudioView').SpriteStudioView =
  unavailableOnWeb('SpriteStudioView')
export const useSsViewPlayer: typeof import('./view/SpriteStudioView').useSsViewPlayer =
  unavailableOnWeb('useSsViewPlayer')
export type {
  SpriteStudioViewProps,
  SpriteStudioViewRef,
} from './view/SpriteStudioView'

export const useSsTextures: typeof import('./view/useSsTextures').useSsTextures =
  unavailableOnWeb('useSsTextures')
/** Data, not a backend — the same empty string the native barrel exports. */
export const SS_DEFAULT_CELLMAP = ''
export type {
  SsTextureSource,
  SsTextureSources,
} from './view/useSsTextures'

export const SpriteStudioScene: typeof import('./view/SpriteStudioScene').SpriteStudioScene =
  unavailableOnWeb('SpriteStudioScene')
export const useSsScene: typeof import('./view/SpriteStudioScene').useSsScene =
  unavailableOnWeb('useSsScene')
export type {
  SpriteStudioSceneProps,
  SsSceneMember,
  SsSceneRegistry,
} from './view/SpriteStudioScene'

export const SpriteStudioSprite: typeof import('./view/SpriteStudioSprite').SpriteStudioSprite =
  unavailableOnWeb('SpriteStudioSprite')
export type {
  SpriteStudioSpriteProps,
  SpriteStudioSpriteRef,
} from './view/SpriteStudioSprite'

export const useSpriteStudioPlayer: typeof import('./view/useSpriteStudioPlayer').useSpriteStudioPlayer =
  unavailableOnWeb('useSpriteStudioPlayer')
export type {
  SsPlayerProps,
  SsPlayerState,
} from './view/useSpriteStudioPlayer'

export const useSsPartTransform: typeof import('./view/useSsPartTransform').useSsPartTransform =
  unavailableOnWeb('useSsPartTransform')
export type { SsPartScreenTransform } from './view/useSsPartTransform'

export const SpriteStudioPartAnchor: typeof import('./view/SpriteStudioPartAnchor').SpriteStudioPartAnchor =
  unavailableOnWeb('SpriteStudioPartAnchor')
export type { SpriteStudioPartAnchorProps } from './view/SpriteStudioPartAnchor'

// --- Layer 3 ---------------------------------------------------------------
export const SpriteStudioPlayer: typeof import('./player/SpriteStudioPlayer').SpriteStudioPlayer =
  unavailableOnWeb('SpriteStudioPlayer')
/** Data. Kept in step with `SpriteStudioPlayer.ts`, which is where it is explained. */
export const MAX_STEP_MS = 1000 / 15
export type {
  SpriteStudioPlayerApi,
  SpriteStudioPlayerOptions,
  SsAnimationCallback,
  SsMeasureRequest,
} from './player/SpriteStudioPlayer'

export const loadResource: typeof import('./player/source').loadResource =
  unavailableOnWeb('loadResource')
export const releaseResource: typeof import('./player/source').releaseResource =
  unavailableOnWeb('releaseResource')
export const resolveSourceUri: typeof import('./player/source').resolveSourceUri =
  unavailableOnWeb('resolveSourceUri')
export const sourceUriOf: typeof import('./player/source').sourceUriOf =
  unavailableOnWeb('sourceUriOf')
export type { LoadedResource, SsSource } from './player/source'

export const ssPreload: typeof import('./player/preload').ssPreload =
  unavailableOnWeb('ssPreload')
export const ssUnload: typeof import('./player/preload').ssUnload =
  unavailableOnWeb('ssUnload')
export const ssPreloadedSources: typeof import('./player/preload').ssPreloadedSources =
  unavailableOnWeb('ssPreloadedSources')

export const ssCheckForLeaks: typeof import('./player/leakCheck').ssCheckForLeaks =
  unavailableOnWeb('ssCheckForLeaks')
export const ssLiveHandles: typeof import('./player/leakCheck').ssLiveHandles =
  unavailableOnWeb('ssLiveHandles')
export type { SsLeakCheckResult } from './player/leakCheck'

// --- Layer 2 ---------------------------------------------------------------
export const SsInternalPlayer: typeof import('./core/SsInternalPlayer').SsInternalPlayer =
  unavailableOnWeb('SsInternalPlayer')

export const SsTextureRegistry: typeof import('./core/SsTextureRegistry').SsTextureRegistry =
  unavailableOnWeb('SsTextureRegistry')
export type { SsTextureOptions } from './core/SsTextureRegistry'

export const SsTextureLoader: typeof import('./core/SsTextureLoader').SsTextureLoader =
  unavailableOnWeb('SsTextureLoader')
export const loadImageData: typeof import('./core/SsTextureLoader').loadImageData =
  unavailableOnWeb('loadImageData')
export type { SsTextureLoadPass, SsTextureLoadReport } from './core/SsTextureLoader'

/** Skia parses the colour strings, so this is the one bit of the vocabulary that stubs. */
export const ssPackColor: typeof import('./core/packColor').ssPackColor =
  unavailableOnWeb('ssPackColor')

// --- Layer 2, portable ------------------------------------------------------
//
// Everything below is the real implementation. Each module is import-clean, so
// none of it reaches a backend — and all of it is the kind of thing shared code
// legitimately wants on both platforms.
export { ssClearCaches, ssImageCache, ssResourceCache } from './core/caches'
export { SsRefCache, type SsRefCacheOptions } from './core/SsRefCache'
export {
  fileSystemPathOf,
  normalizeUri,
  resolveAgainst,
  schemeOf,
  type SsUriScheme,
} from './core/assets'
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
  SsTrackBlend,
  SsTrackSync,
  SS_ROOT_TRANSFORM_IDENTITY,
  type SsRootTransform,
} from './core/types'
export {
  resolveRootTransform,
  type SsAlign,
  type SsFit,
  type SsFrameScope,
  type SsPlacement,
} from './core/fit'

// --- Layer 1 ---------------------------------------------------------------
export { SsRuntimeModule } from './runtime.web'
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
  SkCanvasHandle,
  SkImageHandle,
  SkPaintHandle,
} from './specs/SsRuntime.nitro'
