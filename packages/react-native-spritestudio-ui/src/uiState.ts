import type { SpriteStudioPlayer, SsLabelTable } from 'react-native-spritestudio'

/**
 * A state a SpriteStudio button shows. By default each plays from the label of
 * the same name in one animation, up to the frame before the next label.
 */
export type SsUiState = 'normal' | 'hover' | 'pressed' | 'disabled' | 'focused'

/**
 * The one state to show when several hold at once: `disabled` over `pressed`
 * over `hover` over `focused`, and `normal` when none does.
 */
export function ssUiStateOf(flags: {
  disabled?: boolean
  pressed?: boolean
  hovered?: boolean
  focused?: boolean
}): SsUiState {
  if (flags.disabled) return 'disabled'
  if (flags.pressed) return 'pressed'
  if (flags.hovered) return 'hover'
  if (flags.focused) return 'focused'
  return 'normal'
}

const CHAINS: Readonly<Record<SsUiState, readonly SsUiState[]>> = {
  normal: ['normal'],
  hover: ['hover', 'normal'],
  pressed: ['pressed', 'hover', 'normal'],
  disabled: ['disabled', 'normal'],
  focused: ['focused', 'normal'],
}

/**
 * What a state plays instead of the label named after it: the section of
 * `animation` that starts at `label`.
 *
 * With only `animation`, the whole of it. With only `label`, that label in the
 * animation the states are read from. A section runs to the frame before the
 * next label, or to the end of the animation.
 */
export type SsUiClip = { animation: string; label?: string } | { animation?: string; label: string }

/** Per-state replacements for the labels named after the states. */
export type SsUiClips = Partial<Record<SsUiState, SsUiClip>>

export const SS_REDUCED_MOTION_LABEL = 'reduced_motion'

/** A section a state plays, and whether to hold its first frame rather than play it. */
export interface SsUiSection {
  animation: string
  startFrame: number
  endFrame: number
  hold: boolean
}

function labelFrameOf(table: SsLabelTable, label: string): number | null {
  for (const entry of table.labels) {
    if (entry.name === label) return entry.frame
  }
  if (label === '_start') return table.startFrame
  if (label === '_end') return table.endFrame
  return null
}

/**
 * The section starting at `label` in `table`: to the frame before the next
 * label — any label, the state names or not — or to the end of the animation.
 * Null when the table has no `label`.
 */
export function labelSectionOf(
  table: SsLabelTable,
  label: string
): { startFrame: number; endFrame: number } | null {
  const start = labelFrameOf(table, label)
  if (start == null) return null
  for (const entry of table.labels) {
    if (entry.frame > start) return { startFrame: start, endFrame: entry.frame - 1 }
  }
  return { startFrame: start, endFrame: table.endFrame }
}

/**
 * The section `state` plays in `animation`: the first of its chain that has a
 * clip in `clips` or a label of its own name, or else the whole animation.
 * Null when `tableOf` knows no `animation`.
 *
 * Under `reducedMotion` the section is held, except where it came from
 * `normal` (or the whole animation `normal` falls back to) and `animation` has a
 * `reduced_motion` label: that label's section plays instead.
 *
 * A clip that names an animation or a label the pack does not have is handed
 * to `onMissingClip`, and the state goes on as if it had none.
 */
export function resolveUiSection(
  state: SsUiState,
  options: {
    animation: string
    tableOf: (animation: string) => SsLabelTable | null
    clips?: SsUiClips
    reducedMotion?: boolean
    onMissingClip?: (state: SsUiState, clip: SsUiClip) => void
  }
): SsUiSection | null {
  const { animation, tableOf, clips = {}, reducedMotion = false, onMissingClip } = options
  const base = tableOf(animation)
  if (base == null) return null
  let name = animation
  let range: { startFrame: number; endFrame: number } | null = null
  let source: SsUiState | null = null
  for (const s of CHAINS[state]) {
    const clip = clips[s]
    if (clip != null) {
      const clipName = clip.animation ?? animation
      const table = clipName === animation ? base : tableOf(clipName)
      range =
        table == null
          ? null
          : clip.label == null
            ? { startFrame: table.startFrame, endFrame: table.endFrame }
            : labelSectionOf(table, clip.label)
      if (range != null) {
        name = clipName
        source = s
        break
      }
      onMissingClip?.(s, clip)
    }
    range = labelSectionOf(base, s)
    if (range != null) {
      source = s
      break
    }
  }
  range ??= { startFrame: base.startFrame, endFrame: base.endFrame }
  if (reducedMotion && (source === 'normal' || source === null)) {
    const calm = labelSectionOf(base, SS_REDUCED_MOTION_LABEL)
    if (calm != null) return { animation, ...calm, hold: false }
  }
  return { animation: name, ...range, hold: reducedMotion }
}

/**
 * Plays the section an {@link SsUiState} calls for on a `player` the host owns.
 *
 * {@link show} switches at once and plays the new section from its first
 * frame, looping; the section that was playing is dropped. Under reduced
 * motion it holds the section's first frame instead, stopped, so no event
 * fires — except that `normal`, and the states that fall back to it, play the
 * `reduced_motion` label's section when the animation has one.
 *
 * It takes the player's playback over: it selects animations, sets sections
 * and the loop count, and plays and stops.
 */
export class SsUiStateDriver {
  /**
   * The animation the states' labels are read from. When omitted, the one the
   * player has selected the first time a state is shown, or else the pack's
   * first.
   */
  readonly animation: string | undefined
  readonly clips: SsUiClips

  private base: string | null = null
  private shownOn: object | null = null
  private shownAnimation: string | null = null
  private current: SsUiState | null = null
  private reduced = false
  private readonly reported = new Set<string>()

  constructor(
    readonly player: SpriteStudioPlayer,
    options: { animation?: string; clips?: SsUiClips } = {}
  ) {
    this.animation = options.animation
    this.clips = options.clips ?? {}
  }

  /** The state last shown, or null before one has been. */
  get state(): SsUiState | null {
    return this.current
  }

  /**
   * Shows `state` — or nothing before the player has loaded a pack.
   *
   * Showing the state already shown, with the same `reducedMotion`, does
   * nothing while the player still has the pack and the animation it was
   * given, so it can be called on every change the player announces. After
   * another load, or a switch made elsewhere, it shows the state again.
   */
  show(state: SsUiState, reducedMotion = false): void {
    const player = this.player
    const internal = player.internal
    if (internal == null) return
    if (
      internal === this.shownOn &&
      state === this.current &&
      reducedMotion === this.reduced &&
      player.currentAnimation === this.shownAnimation
    ) {
      return
    }
    this.shownOn = internal
    this.current = state
    this.reduced = reducedMotion

    const names = player.getAnimationNames()
    const base =
      this.base != null && names.includes(this.base)
        ? this.base
        : (this.animation ?? player.currentAnimation ?? names[0])
    if (base == null) return
    this.base = base

    const section = resolveUiSection(state, {
      animation: base,
      tableOf: (name) => player.getLabelTable(name),
      clips: this.clips,
      reducedMotion,
      onMissingClip: (s, clip) => this.reportMissingClip(s, clip),
    })
    if (section == null) {
      player.setAnimation(base)
      return
    }
    this.shownAnimation = section.animation
    if (!player.setAnimation(section.animation)) {
      this.shownAnimation = null
      return
    }
    player.setAnimationSection(section.startFrame, section.endFrame)
    if (section.hold) {
      player.stop()
    } else {
      player.setLoopCount(0)
      player.play()
    }
  }

  private reportMissingClip(state: SsUiState, clip: SsUiClip): void {
    const key = `${state}|${clip.animation ?? ''}|${clip.label ?? ''}`
    if (this.reported.has(key)) return
    this.reported.add(key)
    const what = [
      clip.animation != null ? `animation '${clip.animation}'` : null,
      clip.label != null ? `label '${clip.label}'` : null,
    ]
      .filter((part) => part != null)
      .join(' with ')
    console.warn(
      `react-native-spritestudio-ui: the clip for ${state} names ${what}, which the loaded ` +
        `pack does not have, so ${state} plays as if it had none.`
    )
  }
}
