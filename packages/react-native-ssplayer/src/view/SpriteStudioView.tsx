import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'
import { View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native'
import {
  Canvas,
  Picture,
  Skia,
  type SkPicture,
} from '@shopify/react-native-skia'
import { useSharedValue } from 'react-native-reanimated'

import { SpriteStudioPlayer } from '../player/SpriteStudioPlayer'
import type { SsSource } from '../player/source'
import { useSsTextures, type SsTextureSources } from './useSsTextures'

export interface SpriteStudioViewProps {
  /** The `.ssab` — a `require()`d asset, a URL, or a path. */
  source: SsSource
  /** The cellmap textures. A bare source covers a one-cellmap pack. */
  textures: SsTextureSources
  /** Which animation in the pack to set up. */
  animation?: string

  playing?: boolean
  /** Multiplier on the authored frame rate; negative plays backwards. */
  speed?: number
  /** 0 = infinite. */
  loop?: number
  flipX?: boolean
  flipY?: boolean
  /**
   * Where the animation's origin sits inside the view, in pixels, measured from
   * the view's centre. A SpriteStudio origin is wherever the author put it —
   * often at a character's feet — so this is how you get the art into the box.
   */
  offset?: { x: number; y: number }
  scale?: number

  style?: StyleProp<ViewStyle>

  onLoad?: () => void
  onError?: (error: unknown) => void
  /** Fires once per completed run, not on every frame past the end. */
  onComplete?: () => void
}

export interface SpriteStudioViewRef {
  /** The Layer 3 player, for everything the props do not cover. */
  readonly player: SpriteStudioPlayer | null
}

/**
 * Layer 4 — the declarative view.
 *
 * A Skia `Canvas` plus a frame loop. Each tick advances Layer 3 and re-records
 * one `SkPicture`; the picture goes to the canvas through a Reanimated shared
 * value, so a frame costs no React render.
 *
 * The heavy lifting is one `drawInto` call per frame regardless of vertex count
 * — Phase 0 measured that routing vertices through JS caps the frame rate no
 * matter where they are baked (`docs/phase0-spike.md`), so Layer 1 owns the
 * drawing and this component owns only the clock and the placement.
 */
export const SpriteStudioView = forwardRef<
  SpriteStudioViewRef,
  SpriteStudioViewProps
>(function SpriteStudioView(props, ref) {
  const {
    source,
    textures,
    animation,
    playing = true,
    speed = 1,
    loop = 0,
    flipX = false,
    flipY = false,
    offset,
    scale = 1,
    style,
    onLoad,
    onError,
    onComplete,
  } = props

  const [player, setPlayer] = useState<SpriteStudioPlayer | null>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const images = useSsTextures(textures)

  // `<Picture>` has no null state, so seed it with an empty recording rather
  // than letting the first frame render before the loop has run once.
  const emptyPicture = useMemo(() => {
    const recorder = Skia.PictureRecorder()
    recorder.beginRecording()
    return recorder.finishRecordingAsPicture()
  }, [])
  const picture = useSharedValue<SkPicture>(emptyPicture)

  // Callbacks go through a ref so a caller passing inline arrows does not
  // restart the frame loop on every render.
  const callbacks = useRef({ onLoad, onError, onComplete })
  callbacks.current = { onLoad, onError, onComplete }

  useImperativeHandle(ref, () => ({ player }), [player])

  // --- load ---------------------------------------------------------------
  useEffect(() => {
    const next = new SpriteStudioPlayer()
    setPlayer(next)
    next
      .load(source, { animation })
      .then(() => {
        callbacks.current.onLoad?.()
      })
      .catch((error: unknown) => {
        callbacks.current.onError?.(error)
      })
    return () => {
      // Explicit teardown, never GC: every buffer Layer 1 handed out is a
      // borrow of memory this player owns (design doc ch.9 F).
      next.dispose()
      setPlayer(null)
    }
  }, [source, animation])

  // --- textures -----------------------------------------------------------
  useEffect(() => {
    if (player == null || images == null) return
    for (const [name, image] of Object.entries(images)) {
      player.textures.register(name, image)
    }
  }, [player, images])

  // --- transport props ----------------------------------------------------
  useEffect(() => {
    player?.setSpeed(speed)
  }, [player, speed])

  useEffect(() => {
    player?.setLoop(loop)
  }, [player, loop])

  useEffect(() => {
    if (player == null) return
    if (playing) player.play()
    else player.pause()
  }, [player, playing])

  useEffect(() => {
    if (player == null) return
    player.onComplete = () => callbacks.current.onComplete?.()
    return () => {
      player.onComplete = null
    }
  }, [player])

  // --- placement ----------------------------------------------------------
  useEffect(() => {
    if (player == null) return
    player.setRootTransform({
      x: size.width / 2 + (offset?.x ?? 0),
      y: size.height / 2 + (offset?.y ?? 0),
      scale,
      flipX,
      flipY,
    })
  }, [player, size.width, size.height, offset?.x, offset?.y, scale, flipX, flipY])

  // --- the frame loop -----------------------------------------------------
  useEffect(() => {
    if (player == null || images == null || size.width === 0) return

    let raf = 0
    let last = performance.now()

    const tick = (): void => {
      raf = requestAnimationFrame(tick)
      const now = performance.now()
      // Cap the step so returning from the background does not fast-forward
      // through every frame that was missed.
      const dt = Math.min((now - last) / 1000, 1 / 15)
      last = now

      try {
        player.advance(dt)
        const recorder = Skia.PictureRecorder()
        const canvas = recorder.beginRecording()
        player.draw(canvas)
        picture.value = recorder.finishRecordingAsPicture()
      } catch (error) {
        cancelAnimationFrame(raf)
        callbacks.current.onError?.(error)
      }
    }

    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [player, images, size.width, size.height, picture])

  const onLayout = (event: LayoutChangeEvent): void => {
    const { width, height } = event.nativeEvent.layout
    setSize((prev) =>
      prev.width === width && prev.height === height ? prev : { width, height }
    )
  }

  return (
    <View style={style} onLayout={onLayout}>
      <Canvas style={{ flex: 1 }}>
        <Picture picture={picture} />
      </Canvas>
    </View>
  )
})
