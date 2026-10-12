import {
  createContext,
  forwardRef,
  useContext,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewProps,
  type ViewStyle,
} from 'react-native'
import { Canvas, Picture, Skia, type SkPicture } from '@shopify/react-native-skia'
import { useSharedValue } from 'react-native-reanimated'

import { resolveRootTransform, type SsAlign } from '../core/fit'
import { MAX_STEP_MS, SpriteStudioPlayer } from '../player/SpriteStudioPlayer'
import { intrinsicSize } from './intrinsicSize'
import { reportError } from './reportError'
import {
  useSpriteStudioPlayer,
  type SsPlayerProps,
} from './useSpriteStudioPlayer'

/**
 * The rest are a `<View>`'s own — `testID`, the accessibility props,
 * `pointerEvents`, `onLayout` — and reach the view unchanged.
 */
export interface SpriteStudioViewProps
  extends SsPlayerProps,
    Omit<ViewProps, 'style' | 'children'> {
  /**
   * The `.ssab` — a path into the app's asset directory
   * (`'ss/overall/Basic.ssab'`), a filesystem path, or a URL. Never a
   * `require()`: see `SsSource`.
   *
   * Inherited from `SsPlayerProps` along with `textures`, `animation`,
   * `playing`, `speed`, `loop`, the `fit`/`frame`/`frameScope`/`measureFrames`
   * measurement controls and the three callbacks — all of which mean exactly
   * what they mean on `<SpriteStudioSprite>`.
   */

  /** Which point of the art lands on the matching point of the view. */
  align?: SsAlign
  flipX?: boolean
  flipY?: boolean
  /**
   * Pixels from where `fit`/`align` put the art. Under `fit="none"` this is
   * measured from the view's centre, which is what it always meant.
   */
  offset?: { x: number; y: number }
  /** Multiplier **on top of** the fit's scale. */
  scale?: number

  /**
   * Sized like an `<Image>` of the authored canvas where this leaves it open:
   * with no width or height the view is the canvas, one unit to a point, and
   * with one of them the canvas's aspect ratio sets the other.
   */
  style?: StyleProp<ViewStyle>
  /**
   * Laid over the animation, covering the view's box — where a
   * `<SpriteStudioPartAnchor>` finds its player. Mounted with the first
   * drawable frame, not over the placeholder.
   */
  children?: ReactNode
  /**
   * Shown until the first frame is drawable — the pack loaded and at least one
   * texture registered.
   *
   * Worth having as a prop rather than left to `onLoad`: until the textures
   * land `drawInto` skips every batch, so the honest alternative is a blank
   * rectangle that looks exactly like a broken pack. `ssPreload` is the way to
   * make this window short enough not to matter.
   */
  placeholder?: ReactNode
}

export interface SpriteStudioViewRef {
  /** The Layer 3 player, for everything the props do not cover. */
  readonly player: SpriteStudioPlayer | null
}

/**
 * Every prop this component or the hook reads. A `Record` over `SsPlayerProps`,
 * so a prop added there does not compile until it is listed — and so never
 * reaches the `<View>` as an unknown attribute.
 */
const OWN_PROPS: Record<
  | keyof SsPlayerProps
  | 'align'
  | 'flipX'
  | 'flipY'
  | 'offset'
  | 'scale'
  | 'style'
  | 'placeholder'
  | 'children',
  true
> = {
  source: true,
  textures: true,
  animation: true,
  playing: true,
  speed: true,
  loop: true,
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
  children: true,
}

function viewPropsOf(props: SpriteStudioViewProps): Omit<ViewProps, 'style' | 'children'> {
  const rest: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(props)) {
    if (!(key in OWN_PROPS)) rest[key] = value
  }
  return rest
}

const ViewPlayerContext = createContext<SpriteStudioPlayer | null>(null)

/**
 * The player of the `<SpriteStudioView>` whose `children` this is rendered in,
 * or null outside one.
 */
export function useSsViewPlayer(): SpriteStudioPlayer | null {
  return useContext(ViewPlayerContext)
}

/**
 * Layer 4 — the declarative view: **one animation, fitted to its own box**.
 *
 * A Skia `Canvas` plus a frame loop. Each tick advances Layer 3 and re-records
 * one `SkPicture`; the picture goes to the canvas through a Reanimated shared
 * value, so a frame costs no React render.
 *
 * The heavy lifting is one `drawInto` call per frame regardless of vertex
 * count: Layer 1 owns the drawing, and this component owns only the clock and
 * the placement.
 *
 * **For several animations at once, reach for `<SpriteStudioScene>` instead.**
 * This component is one canvas and one `requestAnimationFrame` loop, so twenty
 * of them are twenty of each; a scene is one of each for the lot, which is the
 * arrangement Layer 3 was built for (`advance(dt)` is externally clocked
 * precisely so a tree can tick off one clock).
 */
export const SpriteStudioView = forwardRef<
  SpriteStudioViewRef,
  SpriteStudioViewProps
>(function SpriteStudioView(props, ref) {
  const {
    align = 'center',
    flipX = false,
    flipY = false,
    offset,
    scale = 1,
    style,
    placeholder,
    children,
  } = props
  const fit = props.fit ?? 'contain'
  const viewProps = viewPropsOf(props)

  const [size, setSize] = useState({ width: 0, height: 0 })
  const { player, measured, canvas, ready } = useSpriteStudioPlayer(props)

  // `<Picture>` has no null state, so seed it with an empty recording rather
  // than letting the first frame render before the loop has run once.
  const emptyPicture = useMemo(() => {
    const recorder = Skia.PictureRecorder()
    recorder.beginRecording()
    return recorder.finishRecordingAsPicture()
  }, [])
  const picture = useSharedValue<SkPicture>(emptyPicture)

  const errorRef = useRef(props.onError)
  errorRef.current = props.onError

  useImperativeHandle(ref, () => ({ player }), [player])

  // --- placement ----------------------------------------------------------
  const box = props.frame ?? measured ?? canvas
  useEffect(() => {
    if (player == null) return
    player.setRootTransform(
      resolveRootTransform(box, size.width, size.height, {
        fit,
        align,
        offset,
        scale,
        flipX,
        flipY,
      })
    )
  }, [
    player,
    box,
    size.width,
    size.height,
    fit,
    align,
    offset?.x,
    offset?.y,
    scale,
    flipX,
    flipY,
  ])

  // --- the frame loop -----------------------------------------------------
  //
  // Deliberately not gated on textures. The pack loads its own asynchronously,
  // and an override may arrive later still; until something is registered
  // `draw()` simply draws nothing, which is the same empty frame waiting would
  // have produced — and this way the clock is already running when they land.
  useEffect(() => {
    if (player == null || size.width === 0 || size.height === 0) return

    let raf = 0
    let last = performance.now()
    // One for the loop's life: a recorder records again after each finish.
    const recorder = Skia.PictureRecorder()

    const tick = (): void => {
      raf = requestAnimationFrame(tick)
      const now = performance.now()
      // `performance.now()` is milliseconds and so is `advance` — the unit runs
      // unconverted from here down to `ss_runtime_update`. Capped so returning
      // from the background does not fast-forward through every missed frame.
      const dtMs = Math.min(now - last, MAX_STEP_MS)
      last = now

      try {
        player.advance(dtMs)
        // A stopped player whose frame, textures and placement have not changed
        // would record the same picture again, and have the UI thread redraw it.
        if (!player.needsDraw) return
        const canvas = recorder.beginRecording()
        player.draw(canvas)
        picture.value = recorder.finishRecordingAsPicture()
      } catch (error) {
        cancelAnimationFrame(raf)
        reportError(errorRef.current, error, 'the frame loop stopped')
      }
    }

    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [player, size.width, size.height, picture])

  const onLayout = (event: LayoutChangeEvent): void => {
    const { width, height } = event.nativeEvent.layout
    setSize((prev) =>
      prev.width === width && prev.height === height ? prev : { width, height }
    )
    viewProps.onLayout?.(event)
  }

  // Under the caller's style, so whatever it does say wins.
  const intrinsic = intrinsicSize(style, box)

  return (
    <View {...viewProps} style={[intrinsic, style]} onLayout={onLayout}>
      <Canvas style={{ flex: 1 }}>
        <Picture picture={picture} />
      </Canvas>
      {!ready && placeholder != null && (
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          {placeholder}
        </View>
      )}
      {ready && children != null && (
        <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
          <ViewPlayerContext.Provider value={player}>{children}</ViewPlayerContext.Provider>
        </View>
      )}
    </View>
  )
})
