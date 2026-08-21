/**
 * The override layer's vocabulary. **Import-free on purpose** — `ssPackColor`
 * sits in `packColor.ts` because it needs Skia, and this file is re-exported
 * whole by `index.web.ts`, where Skia cannot be touched at import time.
 */

/**
 * The PartColor blend, which has **four** values and not twelve.
 *
 * `PartAttributePartColor.blend_type` is typed as the same enum as
 * `DrawBatch.blend_type` and only its first four values are valid — anything
 * higher clamps to Mix. The two live on different axes (`parts_color` §1-0
 * opens by warning against conflating them), so this enum is deliberately
 * separate from the framebuffer one rather than shared with it.
 */
export const SsPartColorBlend = { mix: 0, mul: 1, add: 2, sub: 3 } as const
export type SsPartColorBlendValue =
  (typeof SsPartColorBlend)[keyof typeof SsPartColorBlend]

/**
 * How long an override outlives the animation that is playing under it.
 *
 * The default here is `permanent`, which is not the C-API's default but is what
 * a *declarative* prop means: a `parts` map carrying `hat: { visible: false }`
 * says the hat is hidden for as long as that prop says so, and one the next keyframe
 * silently undoes would make the prop describe one frame.
 */
export const SsOverridePriority = {
  untilNextKeyframe: 0,
  untilNextAnimation: 1,
  permanent: 2,
} as const
export type SsOverridePriorityValue =
  (typeof SsOverridePriority)[keyof typeof SsOverridePriority]

/** Which cell a part samples, by name. Both are hashed through the Brain. */
export interface SsCellRef {
  /** Cellmap name as the `.ssab` carries it — no `.ssce`. */
  cellmap: string
  cell: string
}

/**
 * What to override on one part. Every field is optional and an omitted one is
 * left to the animation — this is a patch, not a replacement.
 */
export interface SsPartOverride {
  visible?: boolean
  /** Propagates a `visible: false` to descendants. Defaults to true. */
  cascade?: boolean
  /**
   * A colour, as anything Skia parses (`'#f00'`, `'rgba(...)'`) or a packed
   * `0xRRGGBBAA` number.
   *
   * Strings go through `Skia.Color` rather than a parser written here, for the
   * same reason hashes go through the Brain: a second implementation of a
   * shared notion is one more than can be kept in agreement.
   */
  color?: string | number
  colorBlend?: SsPartColorBlendValue
  cell?: SsCellRef
  priority?: SsOverridePriorityValue
}

/** Part name → what to override on it. */
export type SsPartOverrides = Readonly<Record<string, SsPartOverride>>
