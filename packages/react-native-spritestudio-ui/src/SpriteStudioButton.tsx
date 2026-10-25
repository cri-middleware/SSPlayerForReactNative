import { forwardRef, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import {
  AccessibilityInfo,
  Pressable,
  StyleSheet,
  View,
  type GestureResponderEvent,
  type PressableProps,
} from 'react-native'
import {
  SpriteStudioView,
  useSsViewPlayer,
  type SpriteStudioViewProps,
  type SpriteStudioViewRef,
} from 'react-native-spritestudio'

import { SsUiStateDriver, ssUiStateOf, type SsUiClips } from './uiState'

type SsButtonViewProps = Pick<
  SpriteStudioViewProps,
  | 'source'
  | 'textures'
  | 'animation'
  | 'speed'
  | 'fit'
  | 'frame'
  | 'frameScope'
  | 'measureFrames'
  | 'parts'
  | 'onUserData'
  | 'onAudio'
  | 'onSignal'
  | 'onLoad'
  | 'onError'
  | 'onAnimationFinished'
  | 'onAnimationLooped'
  | 'onAnimationStarted'
  | 'onAnimationChanged'
  | 'align'
  | 'flipX'
  | 'flipY'
  | 'offset'
  | 'scale'
  | 'style'
  | 'placeholder'
>

const VIEW_PROPS: Record<keyof SsButtonViewProps, true> = {
  source: true,
  textures: true,
  animation: true,
  speed: true,
  fit: true,
  frame: true,
  frameScope: true,
  measureFrames: true,
  parts: true,
  onUserData: true,
  onAudio: true,
  onSignal: true,
  onLoad: true,
  onError: true,
  onAnimationFinished: true,
  onAnimationLooped: true,
  onAnimationStarted: true,
  onAnimationChanged: true,
  align: true,
  flipX: true,
  flipY: true,
  offset: true,
  scale: true,
  style: true,
  placeholder: true,
}

/**
 * The props of a `<SpriteStudioView>` that still mean something on a button —
 * `animation` is where the states' labels are read from — and those of a
 * `<Pressable>`, which the button is. The playback props are the button's.
 */
export interface SpriteStudioButtonProps
  extends SsButtonViewProps,
    Omit<PressableProps, 'style' | 'children'> {
  /** Per-state replacements for the labels named after the states. */
  clips?: SsUiClips
  /**
   * The parts a press counts on, by name or index: a touch that starts on
   * none of their outlines is not a press. Omitted, the whole box takes one.
   * Only touches are narrowed — keyboard focus and a screen reader's
   * activation reach the button as before.
   */
  hitParts?: ReadonlyArray<string | number>
  /** With no `hitParts`, whether a press counts on any part with an outline rather than on the whole box. */
  hitOnArtwork?: boolean
  /** Whether to hold still. Omitted, it follows the system's reduce motion setting. */
  reducedMotion?: boolean
}

function ownViewProps(props: SpriteStudioButtonProps): {
  view: SsButtonViewProps
  rest: Record<string, unknown>
} {
  const view: Record<string, unknown> = {}
  const rest: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(props)) {
    if (key in VIEW_PROPS) view[key] = value
    else rest[key] = value
  }
  return { view: view as SsButtonViewProps, rest }
}

function useSystemReducedMotion(active: boolean): boolean | null {
  const [enabled, setEnabled] = useState<boolean | null>(null)
  useEffect(() => {
    if (!active) return
    let live = true
    AccessibilityInfo.isReduceMotionEnabled().then(
      (value) => {
        if (live) setEnabled(value)
      },
      () => {
        if (live) setEnabled(false)
      }
    )
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setEnabled)
    return () => {
      live = false
      subscription.remove()
    }
  }, [active])
  return enabled
}

interface SurfaceProps extends Omit<PressableProps, 'style' | 'children'> {
  animation?: string
  clips?: SsUiClips
  hitParts?: ReadonlyArray<string | number>
  hitOnArtwork?: boolean
  reducedMotion?: boolean
}

function ButtonSurface(props: SurfaceProps): ReactElement {
  const {
    animation,
    clips,
    hitParts,
    hitOnArtwork = false,
    reducedMotion,
    disabled,
    onPressIn,
    onPressOut,
    onHoverIn,
    onHoverOut,
    onFocus,
    onBlur,
    ...pressable
  } = props
  const player = useSsViewPlayer()
  const [pressed, setPressed] = useState(false)
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const system = useSystemReducedMotion(reducedMotion == null)
  const reduced = reducedMotion ?? system

  useEffect(() => {
    if (disabled) setPressed(false)
  }, [disabled])

  const clipsKey = clips == null ? '' : JSON.stringify(clips)
  const driver = useMemo(
    () => (player == null ? null : new SsUiStateDriver(player, { animation, clips })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [player, animation, clipsKey]
  )

  const state = ssUiStateOf({ disabled: disabled ?? false, pressed, hovered, focused })
  const shown = useRef({ driver, state, reduced })
  shown.current = { driver, state, reduced }

  useEffect(() => {
    if (driver == null || reduced == null) return
    driver.show(state, reduced)
  }, [driver, state, reduced])

  useEffect(() => {
    if (player == null) return
    return player.addListener(() => {
      const { driver: current, state: now, reduced: still } = shown.current
      if (current != null && still != null) current.show(now, still)
    })
  }, [player])

  const narrows = hitParts != null || hitOnArtwork
  const refuse = (event: GestureResponderEvent): boolean => {
    if (player == null) return false
    const { locationX, locationY } = event.nativeEvent
    return player.hitTestPart(locationX, locationY, hitParts) < 0
  }

  const labelled =
    pressable.accessibilityLabel != null || pressable['aria-label'] != null
  const accessibility = labelled
    ? { accessibilityRole: 'button' as const }
    : { accessible: false, importantForAccessibility: 'no-hide-descendants' as const }

  return (
    <View
      style={StyleSheet.absoluteFill}
      onStartShouldSetResponderCapture={narrows ? refuse : undefined}
    >
      <Pressable
        {...accessibility}
        {...pressable}
        style={StyleSheet.absoluteFill}
        disabled={disabled}
        onPressIn={(event) => {
          setPressed(true)
          onPressIn?.(event)
        }}
        onPressOut={(event) => {
          setPressed(false)
          onPressOut?.(event)
        }}
        onHoverIn={(event) => {
          setHovered(true)
          onHoverIn?.(event)
        }}
        onHoverOut={(event) => {
          setHovered(false)
          onHoverOut?.(event)
        }}
        onFocus={(event) => {
          setFocused(true)
          onFocus?.(event)
        }}
        onBlur={(event) => {
          setFocused(false)
          onBlur?.(event)
        }}
      />
    </View>
  )
}

/**
 * A `<SpriteStudioView>` that is a button: a `<Pressable>` over the view's box
 * whose states each play a section of one animation.
 *
 * Pressed, hovered, focused and `disabled` map to `pressed`, `hover`, `focused`
 * and `disabled`, one at a time in that order of precedence, and none of them
 * to `normal`. Each state plays, looping, from the label of its name to the
 * frame before the next label; a state without a label falls back — `pressed`
 * to `hover`, the rest to `normal` — and with no labels the whole animation
 * plays. Under reduced motion each state holds its first frame, and `normal`
 * plays a `reduced_motion` label instead when the animation has one.
 *
 * Without an `accessibilityLabel` it is decoration to a screen reader; with
 * one it is read as a button.
 *
 * It takes its player's playback over: `playing`, `loop` and `transitionMs`
 * are not props here, and the player from the ref is not one to play or stop.
 */
export const SpriteStudioButton = forwardRef<SpriteStudioViewRef, SpriteStudioButtonProps>(
  function SpriteStudioButton(props, ref) {
    const { view, rest } = ownViewProps(props)
    return (
      <SpriteStudioView {...view} ref={ref} playing={false}>
        <ButtonSurface {...(rest as SurfaceProps)} animation={view.animation} />
      </SpriteStudioView>
    )
  }
)
