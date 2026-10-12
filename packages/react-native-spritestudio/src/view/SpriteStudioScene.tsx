import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native'
import { Canvas, Picture, Skia } from '@shopify/react-native-skia'

import { MAX_STEP_MS, type SpriteStudioPlayer } from '../player/SpriteStudioPlayer'
import { useFramePicture } from './useFramePicture'

/** One player enrolled in a scene, in the shape the scene's tick consumes. */
export interface SsSceneMember {
  player: SpriteStudioPlayer
  /** Explicit draw order; ties break on enrolment order. */
  z: number
  /** Monotonic, so mount order is a stable tiebreak under equal `z`. */
  seq: number
}

interface SsSceneRegistry {
  /** Enrols a player and returns the leave function. */
  join(member: Omit<SsSceneMember, 'seq'>): () => void
  /** The scene's pixel size, which is what a sprite fits itself against. */
  size: { width: number; height: number }
}

const SceneContext = createContext<SsSceneRegistry | null>(null)

/**
 * The registry a `<SpriteStudioSprite>` enrols in, or null outside a scene.
 *
 * Exported so a sprite can say plainly that it needs a scene rather than
 * failing as a component that renders nothing.
 */
export function useSsScene(): SsSceneRegistry | null {
  return useContext(SceneContext)
}

export interface SpriteStudioSceneProps {
  children?: ReactNode
  style?: StyleProp<ViewStyle>
  /** Stops the whole scene's clock — every sprite in it, in one place. */
  paused?: boolean
  onError?: (error: unknown) => void
}

/**
 * Layer 4 — **many animations, one canvas and one clock**.
 *
 * `<SpriteStudioView>` is one animation fitted to its own box, and N of them
 * are N Skia canvases and N `requestAnimationFrame` loops. A scene is one of
 * each however many sprites are in it: the tick walks its members in draw
 * order, advances each and draws each into a single recording.
 *
 * This is the arrangement Layer 3 was built for and the reason `advance(dt)` is
 * externally clocked — its own comment says "so the whole tree ticks off one
 * clock instead of N". Until this component existed, nothing above it took the
 * offer up.
 *
 * Ordering is `z` then enrolment order. Enrolment order rather than JSX order
 * because a sprite can be nested inside any component in between, and React
 * gives no reliable document order across that; `z` is the way to say it
 * explicitly, and it is worth saying whenever it matters.
 */
export function SpriteStudioScene({
  children,
  style,
  paused = false,
  onError,
}: SpriteStudioSceneProps): ReactNode {
  const [size, setSize] = useState({ width: 0, height: 0 })
  const members = useRef(new Set<SsSceneMember>()).current
  const seq = useRef(0)
  // Re-sorted only on a join or a leave, which a `z` change is: the sprite
  // enrols again.
  const order = useRef({ list: [] as SsSceneMember[], stale: true }).current

  const picture = useFramePicture()

  const errorRef = useRef(onError)
  errorRef.current = onError

  // The registry identity must not change with `size`, or every sprite's
  // enrolment effect would re-run on a layout pass and the whole scene would
  // churn its draw order. `size` is read through a ref instead.
  const sizeRef = useRef(size)
  sizeRef.current = size
  const registry = useMemo<SsSceneRegistry>(
    () => ({
      join(member) {
        const entry: SsSceneMember = { ...member, seq: seq.current++ }
        members.add(entry)
        order.stale = true
        return () => {
          members.delete(entry)
          order.stale = true
        }
      },
      get size() {
        return sizeRef.current
      },
    }),
    [members, order]
  )

  // --- the one frame loop -------------------------------------------------
  useEffect(() => {
    if (size.width === 0 || paused) return

    let raf = 0
    let last = performance.now()
    // One for the loop's life: a recorder records again after each finish.
    const recorder = Skia.PictureRecorder()

    const tick = (): void => {
      raf = requestAnimationFrame(tick)
      const now = performance.now()
      const dtMs = Math.min(now - last, MAX_STEP_MS)
      last = now

      try {
        let redraw = order.stale
        if (order.stale) {
          order.list = [...members].sort((a, b) => a.z - b.z || a.seq - b.seq)
          order.stale = false
        }
        for (const member of order.list) {
          member.player.advance(dtMs)
          if (!redraw && member.player.needsDraw) redraw = true
        }
        if (!redraw) return
        const canvas = recorder.beginRecording()
        for (const member of order.list) member.player.draw(canvas)
        picture.value = recorder.finishRecordingAsPicture()
      } catch (error) {
        cancelAnimationFrame(raf)
        errorRef.current?.(error)
      }
    }

    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [members, order, picture, size.width, size.height, paused])

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
      <SceneContext.Provider value={registry}>{children}</SceneContext.Provider>
    </View>
  )
}
