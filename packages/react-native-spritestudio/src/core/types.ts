/**
 * Layer 2 vocabulary — the playback-shape enums and the root transform.
 *
 * They live here rather than on the player so Layer 2 and Layer 3 can both name
 * them without L2 importing L3, the same split the Flutter Player uses
 * (`playback.dart`). Values are the Brain's wire numbers, so they go to
 * `SsContext.setPlaybackDirection` unmapped.
 *
 * **This file, and everything else under `core/`, must not import `react` or
 * `react-native`** — that is what keeps a headless test, a future non-React
 * renderer and the react-native-web route possible.
 */

/** Which way the playhead walks the animation. */
export const SsPlaybackDirection = {
  forward: 0,
  backward: 1,
} as const
export type SsPlaybackDirection =
  (typeof SsPlaybackDirection)[keyof typeof SsPlaybackDirection]

/** What happens when the playhead reaches the far end of the range. */
export const SsPlaybackStyle = {
  /** Jump back to the start (or stop, per the loop count). */
  normal: 0,
  /** Turn around and walk back, so one "loop" is a full round trip. */
  pingPong: 1,
} as const
export type SsPlaybackStyle =
  (typeof SsPlaybackStyle)[keyof typeof SsPlaybackStyle]

/**
 * Where the animation's world origin lands on the canvas, and how it is scaled
 * and mirrored.
 *
 * Applied **exactly once**, as a canvas transform above the geometry. Folding
 * it into the vertex bake would cost a term per vertex and
 * would detach part-following the moment a player flips; keeping it at the root
 * also leaves everything below in player-local space, which is where the mask
 * coverage pass and the SkSL shaders need it.
 */
export interface SsRootTransform {
  /** Canvas-space position of the animation's origin, in pixels. */
  x: number
  y: number
  /** Uniform scale. */
  scale: number
  flipX: boolean
  flipY: boolean
}

export const SS_ROOT_TRANSFORM_IDENTITY: SsRootTransform = {
  x: 0,
  y: 0,
  scale: 1,
  flipX: false,
  flipY: false,
}
