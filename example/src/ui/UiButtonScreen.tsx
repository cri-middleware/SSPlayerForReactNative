import { useEffect, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { Canvas, Path, Skia } from 'react-native-skia'
import type { SpriteStudioPlayer } from 'react-native-spritestudio'
import { SpriteStudioButton, type SsUiClips } from 'react-native-spritestudio-ui'

import { SsAssets } from '../ss-assets'

/**
 * SpriteStudio buttons, checked by eye — the counterpart of SSPlayerForWeb's
 * `examples/pixi-example/src/ui-demo.ts`.
 *
 * Ringo stands in for a button's artwork in two `<SpriteStudioButton>`s: the
 * left one takes presses on the parts picked below, the right one on its whole
 * box. Each state plays one of Ringo's animations through a clip, since Ringo
 * has no labels named after the states. The outlines drawn are the ones the
 * hit test uses.
 *
 * What to look for:
 *   1. Left, "apple": only a press on the apple plays attack1 and logs onPress.
 *   2. Right: a press anywhere in its box plays attack1, the release wait1 again.
 *   3. Disabled: both play dead and take no press; enabled again, both go back to wait1.
 *   4. Reduced motion on: each state stands still on its first frame; off, it moves again.
 *   5. A pointer (iPad trackpad, Android mouse): hover plays walk.
 */

const RINGO = SsAssets['Ringo/Ringo']

const CLIPS: SsUiClips = {
  normal: { animation: 'wait1' },
  hover: { animation: 'walk' },
  pressed: { animation: 'attack1' },
  disabled: { animation: 'dead' },
  focused: { animation: 'jump_wait' },
}

const STATE_OF: Record<string, string> = {
  wait1: 'normal',
  walk: 'hover',
  attack1: 'pressed',
  dead: 'disabled',
  jump_wait: 'focused',
}

const HITS: Record<string, { hitParts?: string[]; hitOnArtwork?: boolean }> = {
  box: {},
  any: { hitOnArtwork: true },
  apple: { hitParts: ['apple'] },
  'head+body': { hitParts: ['head', 'body'] },
}

type Motion = 'system' | 'on' | 'off'

export function UiButtonScreen() {
  const [hit, setHit] = useState('apple')
  const [disabled, setDisabled] = useState(false)
  const [motion, setMotion] = useState<Motion>('system')
  const [outlines, setOutlines] = useState(true)
  const [log, setLog] = useState<string[]>([])
  const [states, setStates] = useState<Record<string, string>>({})
  const [players, setPlayers] = useState<Record<string, SpriteStudioPlayer>>({})

  const note = (line: string) => setLog((lines) => [line, ...lines].slice(0, 8))
  const reducedMotion = motion === 'system' ? undefined : motion === 'on'

  const button = (name: string, hits: { hitParts?: string[]; hitOnArtwork?: boolean }) => (
    <View style={styles.cell}>
      <SpriteStudioButton
        style={StyleSheet.absoluteFill}
        source={RINGO}
        clips={CLIPS}
        {...hits}
        disabled={disabled}
        reducedMotion={reducedMotion}
        accessibilityLabel={`${name} Ringo`}
        onLoad={(player) => setPlayers((all) => ({ ...all, [name]: player }))}
        onAnimationChanged={(animation) =>
          setStates((all) => ({ ...all, [name]: STATE_OF[animation] ?? animation }))
        }
        onPress={() => note(`${name}: onPress`)}
        onPressIn={() => note(`${name}: onPressIn`)}
        onPressOut={() => note(`${name}: onPressOut`)}
      />
      {outlines && players[name] != null && (
        <Outlines player={players[name]} parts={hits.hitParts ?? null} whole={hits.hitParts == null && !hits.hitOnArtwork} />
      )}
      <Text style={styles.state} pointerEvents="none">
        {name}: {states[name] ?? '…'}
      </Text>
    </View>
  )

  return (
    <View style={styles.root}>
      <View style={styles.stage}>
        {button('Left', HITS[hit] ?? {})}
        {button('Right', {})}
      </View>
      <ScrollView style={styles.panel} contentContainerStyle={styles.panelContent}>
        <Text style={styles.title}>UI buttons — two Ringos as SpriteStudioButton</Text>
        <Text style={styles.label}>Left takes presses on</Text>
        <View style={styles.row}>
          {Object.keys(HITS).map((key) => (
            <Choice key={key} label={key} active={hit === key} onPress={() => setHit(key)} />
          ))}
        </View>
        <Text style={styles.label}>Both</Text>
        <View style={styles.row}>
          <Choice label={disabled ? 'disabled' : 'enabled'} active={disabled} onPress={() => setDisabled((d) => !d)} />
          <Choice label={outlines ? 'outlines on' : 'outlines off'} active={outlines} onPress={() => setOutlines((o) => !o)} />
        </View>
        <Text style={styles.label}>Reduced motion</Text>
        <View style={styles.row}>
          {(['system', 'on', 'off'] as const).map((m) => (
            <Choice key={m} label={m} active={motion === m} onPress={() => setMotion(m)} />
          ))}
        </View>
        <Text style={styles.label}>Events</Text>
        <Text style={styles.log}>{log.length === 0 ? '—' : log.join('\n')}</Text>
      </ScrollView>
    </View>
  )
}

function Outlines({
  player,
  parts,
  whole,
}: {
  player: SpriteStudioPlayer
  parts: string[] | null
  whole: boolean
}) {
  const [svg, setSvg] = useState('')
  useEffect(() => {
    let raf = 0
    const tick = () => {
      raf = requestAnimationFrame(tick)
      let path = ''
      const names = parts ?? player.partNames().filter((name) => name !== '')
      for (const name of whole ? [] : names) {
        const q = player.getPartQuad(name)
        if (q == null) continue
        path +=
          `M${q.leftTopX} ${q.leftTopY}L${q.rightTopX} ${q.rightTopY}` +
          `L${q.rightBottomX} ${q.rightBottomY}L${q.leftBottomX} ${q.leftBottomY}Z`
      }
      setSvg((previous) => (previous === path ? previous : path))
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [player, parts, whole])
  const path = svg === '' ? null : Skia.Path.MakeFromSVGString(svg)
  return (
    <Canvas style={whole ? [StyleSheet.absoluteFill, styles.box] : StyleSheet.absoluteFill} pointerEvents="none">
      {path != null && <Path path={path} color="#7ee787" style="stroke" strokeWidth={1.5} />}
    </Canvas>
  )
}

function Choice({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable style={[styles.choice, active && styles.choiceActive]} onPress={onPress}>
      <Text style={[styles.choiceText, active && styles.choiceTextActive]}>{label}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#101014' },
  stage: { flex: 1, flexDirection: 'row' },
  cell: { flex: 1, margin: 8 },
  box: { borderWidth: 1, borderColor: '#7ee787', borderStyle: 'dashed' },
  state: { position: 'absolute', left: 8, top: 8, color: '#f2f2f7', fontSize: 13 },
  panel: { backgroundColor: '#1a1a20', maxHeight: '45%' },
  panelContent: { padding: 16, gap: 8 },
  title: { color: '#f2f2f7', fontSize: 16, fontWeight: '600' },
  label: { color: '#8e8e93', fontSize: 12, textTransform: 'uppercase' },
  log: { color: '#c7c7cc', fontSize: 13, lineHeight: 18 },
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
})
