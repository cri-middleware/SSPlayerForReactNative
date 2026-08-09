import { useRef, useState } from 'react'
import { Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native'
import {
  SpriteStudioView,
  type SpriteStudioViewRef,
} from 'react-native-spritestudio'

const ANIMATION = 'anime_1'

/**
 * The same animation converted two ways, so both texture routes are visible.
 *
 * Nothing here selects a route: `SsTextureLoader` decides per texture, taking
 * `embedded` bytes when the `.ssab` carries them and otherwise resolving
 * `image_path` against the `.ssab`'s own directory. The toggle just points at a
 * different pack — `overall-embedded/` was converted with `--embedded`, and
 * `overall/` keeps `common.png` as a sibling file.
 *
 * The reference pack is what React Native used not to be able to draw. While
 * the `.ssab` was named with a `require()` there was no directory for
 * `common.png` to be a sibling *of*, and this screen had to hand the texture
 * over by hand. The pack directories ship as app assets now (see the plugin
 * entry in `app.json`), so `ss/overall/` is a real directory on the device.
 *
 * Paths are relative to the app's asset root, which the plugin fills from
 * `example/assets/ss`.
 */
const PACKS = {
  embedded: 'ss/overall-embedded',
  reference: 'ss/overall',
} as const

type Mode = keyof typeof PACKS

/**
 * Which `.ssab` inside the pack.
 *
 * `Basic` is the plain Normal-parts case and the one to check a render change
 * against. `BlendMode` is the SDK's blend test animation — every framebuffer
 * blend type side by side, which is the only way to see `SsBlend.hpp`'s table at
 * all, and in particular the two modes (Sub, Invert) that Skia has no single
 * blend mode for and that `SsSkiaDraw` reconstructs from three passes.
 *
 * Both live in both packs and both animate `anime_1`, so this axis is
 * independent of the texture-route toggle below.
 */
const SSABS = ['Basic', 'BlendMode'] as const

type Ssab = (typeof SSABS)[number]

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
  const [mode, setMode] = useState<Mode>('embedded')
  const [ssab, setSsab] = useState<Ssab>('Basic')
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
            source={`${PACKS[mode]}/${ssab}.ssab`}
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
        <Text style={styles.label}>Animation</Text>
        <View style={styles.row}>
          {SSABS.map((s) => (
            <Choice key={s} active={ssab === s} onPress={() => setSsab(s)}>
              {s}
            </Choice>
          ))}
        </View>
        <Text style={styles.label}>Textures</Text>
        <View style={styles.row}>
          {(Object.keys(PACKS) as Mode[]).map((m) => (
            <Choice key={m} active={mode === m} onPress={() => setMode(m)}>
              {m === 'embedded' ? 'embedded (in .ssab)' : 'reference (sibling file)'}
            </Choice>
          ))}
        </View>
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
