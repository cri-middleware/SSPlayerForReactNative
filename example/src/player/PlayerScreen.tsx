import { useRef, useState } from 'react'
import { Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native'
import {
  SpriteStudioView,
  type SpriteStudioViewRef,
} from '@spritestudio/react-native-ssplayer'

const SSAB = require('../../assets/ss/overall/Basic.ssab')
const ANIMATION = 'anime_1'

/**
 * Supplied explicitly, even though loading a `.ssab` now loads its own textures.
 *
 * This example is inside an npm workspace, and that is exactly where automatic
 * resolution cannot reach: `watchFolders` pushes Metro's server root up to the
 * workspace, so the `.ssab`'s URL is `/assets/example/assets/...`, while Metro
 * resolves an asset request against the *project* root — asking for the sibling
 * lands on `example/example/assets/...` and 404s. A non-monorepo app has the two
 * roots equal and does not need this prop.
 *
 * The other way to make the example self-resolving is
 * `deploy-examples --embedded`, which puts the atlas inside the `.ssab`. Still
 * to be decided — see the ROADMAP.
 */
const TEXTURES = { common: require('../../assets/ss/overall/common.png') }

/** `Basic`'s authored canvas is 480x480 (`<canvasSize>` in Basic.ssae). */
const DESIGN_HEIGHT = 480

/**
 * Phase 1's target: the SDK's own reference animation, through the real API.
 *
 * `overall/Basic` rather than Ringo on purpose. It is the SDK's plain
 * Normal-parts case, so what it draws is a statement about the render path
 * itself — a character asset mixes in authoring choices (mesh deforms, masks)
 * that Phase 1 does not implement yet, and a missing part there says nothing
 * about whether the path works.
 *
 * Everything the Phase 0 harness did by hand — the context pool, the picture
 * recording, the frame loop, the root transform — is inside
 * `<SpriteStudioView>` here. What is left is props.
 *
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

  // `Basic` is authored around its origin, so the origin goes in the middle of
  // the box and the whole canvas is fitted into the shorter axis.
  const scale = size.height === 0 ? 1 : Math.min(size.width, size.height) / DESIGN_HEIGHT
  const offset = { x: 0, y: 0 }

  return (
    <View style={styles.root}>
      <View style={styles.stage} onLayout={onLayout}>
        {size.height > 0 && (
          <SpriteStudioView
            ref={ref}
            style={StyleSheet.absoluteFill}
            source={SSAB}
            textures={TEXTURES}
            animation={ANIMATION}
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
