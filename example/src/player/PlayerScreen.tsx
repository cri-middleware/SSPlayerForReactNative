import { useRef, useState } from 'react'
import { Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native'
import {
  SpriteStudioView,
  type SpriteStudioViewRef,
} from '@spritestudio/react-native-ssplayer'

const SSAB = require('../../assets/ss/Ringo/Ringo.ssab')
const TEXTURE = require('../../assets/ss/Ringo/Ringo.png')

/** The authored canvas height Ringo's art fits into, in player-local pixels. */
const RINGO_DESIGN_HEIGHT = 460

/**
 * Phase 1's target: Ringo animating through the real API.
 *
 * Everything the Phase 0 harness did by hand — the context pool, the picture
 * recording, the frame loop, the root transform — is inside
 * `<SpriteStudioView>` here. What is left is props.
 */
export function PlayerScreen() {
  const ref = useRef<SpriteStudioViewRef>(null)
  const [playing, setPlaying] = useState(true)
  const [speed, setSpeed] = useState(1)
  const [flipX, setFlipX] = useState(false)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [error, setError] = useState<string | null>(null)

  const onLayout = (event: LayoutChangeEvent) => {
    setSize(event.nativeEvent.layout)
  }

  // Ringo's world origin is at its feet and the art extends upwards, so the
  // origin belongs near the bottom of the box rather than at its centre.
  const scale = size.height === 0 ? 1 : Math.min(size.width, size.height) / RINGO_DESIGN_HEIGHT
  const offset = { x: 0, y: size.height * 0.42 }

  return (
    <View style={styles.root}>
      <View style={styles.stage} onLayout={onLayout}>
        {size.height > 0 && (
          <SpriteStudioView
            ref={ref}
            style={StyleSheet.absoluteFill}
            source={SSAB}
            textures={TEXTURE}
            animation="dance"
            playing={playing}
            speed={speed}
            flipX={flipX}
            scale={scale}
            offset={offset}
            onError={(e) => setError(String(e))}
          />
        )}
      </View>

      <View style={styles.panel}>
        {error != null && <Text style={styles.error}>{error}</Text>}
        <View style={styles.row}>
          <Choice active={playing} onPress={() => setPlaying((p) => !p)}>
            {playing ? 'Pause' : 'Play'}
          </Choice>
          <Choice active={false} onPress={() => ref.current?.player?.stop()}>
            Stop
          </Choice>
          <Choice active={flipX} onPress={() => setFlipX((f) => !f)}>
            Flip X
          </Choice>
        </View>
        <Text style={styles.label}>Speed</Text>
        <View style={styles.row}>
          {[0.25, 0.5, 1, 2].map((s) => (
            <Choice key={s} active={speed === s} onPress={() => setSpeed(s)}>
              {`${s}x`}
            </Choice>
          ))}
        </View>
      </View>
    </View>
  )
}

function Choice({
  active,
  onPress,
  children,
}: {
  active: boolean
  onPress: () => void
  children: React.ReactNode
}) {
  return (
    <Pressable style={[styles.choice, active && styles.choiceActive]} onPress={onPress}>
      <Text style={[styles.choiceText, active && styles.choiceTextActive]}>{children}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#101014' },
  stage: { flex: 1 },
  panel: { backgroundColor: '#1a1a20', padding: 16, gap: 8 },
  label: { color: '#8e8e93', fontSize: 12, textTransform: 'uppercase' },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  choice: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 8,
    backgroundColor: '#2c2c34',
  },
  choiceActive: { backgroundColor: '#0a84ff' },
  choiceText: { color: '#c7c7cc', fontSize: 14 },
  choiceTextActive: { color: '#fff', fontWeight: '600' },
  error: { color: '#ff6961', fontSize: 13 },
})
