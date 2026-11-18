import { useEffect, useRef, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import {
  SpriteStudioView,
  SsTrackBlend,
  SsTrackSync,
  type SpriteStudioPlayer,
  type SsSignalEvent,
  type SsUserDataEvent,
} from 'react-native-spritestudio'

import { SsAssets } from '../ss-assets'

/**
 * Motion blending — the track stack, driven by hand.
 *
 * Track 0 is switched through the view's `animation` prop, with `transitionMs`
 * deciding whether a change cuts or crossfades: that is the one route the
 * component offers, so the prop can always return to where it was. Track 1 and
 * the settings go through the player handed to `onLoad`.
 *
 * What to look for:
 *   1. Crossfade, then pick the animation you left: it comes back (the name
 *      changed the moment the fade began).
 *   2. Speed 2×, then crossfade: the incoming animation is 2× too.
 *   3. Loop once, then crossfade: the incoming animation plays once and
 *      finishes.
 *   4. Lay an overlay, loop it once: track 1 finishes and holds its last frame.
 *   5. Crossfade repeatedly, fast: the pose never jumps.
 *   6. On a pack with events, crossfade with "outgoing fires" off and on.
 */

interface Subject {
  label: string
  uri: string
}

const SUBJECTS: Subject[] = [
  // `attack1` is short, `wait1` / `walk` long, and only `dead` has a wider
  // canvas — the canvas switching with the crossfade is visible there.
  { label: 'Ringo', uri: SsAssets['Ringo/Ringo'] },
  // Wait / Run01 / Run02: with sync = start, the two runs keep their stride.
  { label: 'Doll', uri: SsAssets['Doll/Action02_Body'] },
  // Fires user data across the whole animation, so a fade has events on both sides.
  { label: 'UserData', uri: SsAssets['overall/UserData'] },
]

const FADE_MS = 400
const SPEEDS = [1, 2, 0.5]

export function BlendingScreen() {
  const [subject, setSubject] = useState(SUBJECTS[0])
  const [animations, setAnimations] = useState<string[]>([])
  const [animation, setAnimation] = useState<string | undefined>(undefined)
  const [crossfading, setCrossfading] = useState(true)
  const [playing, setPlaying] = useState(true)

  const playerRef = useRef<SpriteStudioPlayer | null>(null)
  const [events, setEvents] = useState<string[]>([])
  const [laid, setLaid] = useState<string | null>(null)

  // The player's state is read, not pushed: re-render on a timer and read it.
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 100)
    return () => clearInterval(id)
  }, [])

  const onLoad = (p: SpriteStudioPlayer) => {
    playerRef.current = p
    const names = p.getAnimationNames()
    setAnimations(names)
    setAnimation(p.currentAnimation ?? names[0])
    setEvents([])
  }

  const pickSubject = (next: Subject) => {
    playerRef.current = null
    setAnimations([])
    setAnimation(undefined)
    setSubject(next)
  }

  const log = (line: string) => setEvents((list) => [line, ...list].slice(0, 6))
  const onUserData = (e: SsUserDataEvent) =>
    log(`user data  ${e.partName} @${e.frameNo}  source ${e.source}`)
  const onSignal = (e: SsSignalEvent) =>
    log(`signal ${e.commandId}  @${e.frameNo}  source ${e.source}`)

  const p = playerRef.current
  // What this screen laid on track 1, while the track still carries something —
  // a setup clears the stack, and `clear` empties the track.
  const overlay = p?.trackMainSource(1) != null ? laid : null
  const speed = p?.trackSpeed(0) ?? 1
  const loops0 = p?.trackLoopCount(0) ?? -1
  const loops1 = p?.trackLoopCount(1) ?? null
  const outgoing = p?.trackOutgoingEventThreshold(0) ?? Infinity
  const alpha1 = p?.trackAlpha(1) ?? null
  const blend1 = p?.trackBlend(1) ?? null
  const sync0 = p?.trackSync(0) ?? null
  const sync1 = p?.trackSync(1) ?? null
  const frame0 = p?.trackFrame(0) ?? null
  const frame1 = p?.trackFrame(1) ?? null
  const fade0 = p?.trackFadeProgress(0) ?? null

  const nextOf = (list: string[], current: string | null) =>
    list[(current == null ? 0 : list.indexOf(current) + 1) % Math.max(1, list.length)]

  return (
    <View style={styles.root}>
      <View style={styles.stage}>
        <SpriteStudioView
          key={subject.uri}
          style={StyleSheet.absoluteFill}
          source={subject.uri}
          animation={animation}
          transitionMs={crossfading ? FADE_MS : 0}
          playing={playing}
          fit="contain"
          onLoad={onLoad}
          onUserData={onUserData}
          onSignal={onSignal}
        />
      </View>

      <ScrollView style={styles.panel} contentContainerStyle={styles.panelContent}>
        <View style={styles.row}>
          {SUBJECTS.map((s) => (
            <Choice key={s.label} active={s === subject} onPress={() => pickSubject(s)}>
              {s.label}
            </Choice>
          ))}
        </View>


        <Text style={styles.label}>Track 0 — {crossfading ? `crossfade ${FADE_MS} ms` : 'cut'}</Text>
        <View style={styles.row}>
          {animations.map((name) => (
            <Choice key={name} active={p?.currentAnimation === name} onPress={() => setAnimation(name)}>
              {name}
            </Choice>
          ))}
        </View>
        <View style={styles.row}>
          <Choice active={crossfading} onPress={() => setCrossfading((c) => !c)}>
            {crossfading ? 'crossfade' : 'cut'}
          </Choice>
          <Choice active={!playing} onPress={() => setPlaying((v) => !v)}>
            {playing ? 'pause' : 'resume'}
          </Choice>
          <Choice active={speed !== 1} onPress={() => p?.setTrackSpeed(0, SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length])}>
            {`speed ${speed}×`}
          </Choice>
          <Choice active={loops0 === 1} onPress={() => p?.setTrackLoopCount(0, loops0 === 1 ? 0 : 1)}>
            {loops0 === 1 ? 'loop once' : 'loop ∞'}
          </Choice>
          {/*
            Both tracks: track 0's for a
            crossfade (the incoming animation starts at the outgoing one's
            phase), track 1's for an overlay laid on it. It applies to what is
            laid next, and a cut resets it.
          */}
          <Choice
            active={sync0 === SsTrackSync.start}
            onPress={() => {
              const next = sync0 === SsTrackSync.start ? SsTrackSync.free : SsTrackSync.start
              p?.setTrackSync(0, next)
              p?.setTrackSync(1, next)
            }}
          >
            {sync0 === SsTrackSync.start ? 'sync start' : 'sync free'}
          </Choice>
          <Choice
            active={Number.isFinite(outgoing)}
            onPress={() => p?.setTrackOutgoingEventThreshold(0, Number.isFinite(outgoing) ? Infinity : 0.5)}
          >
            {Number.isFinite(outgoing) ? 'outgoing fires: first half' : 'outgoing fires: never'}
          </Choice>
          {/*
            Into the animation already playing — the prop cannot ask for it, and
            the name stays the same, so it does not take track 0 away from the
            prop. With "outgoing fires" on, both sides' keys arrive, each with
            its own source.
          */}
          <Choice
            active={false}
            onPress={() => {
              if (p?.currentAnimation != null) p.crossfade(0, p.currentAnimation, FADE_MS * 5)
            }}
          >
            {`refade into itself (${FADE_MS * 5} ms)`}
          </Choice>
          <Choice active={false} onPress={() => p?.fadeTrack(0, (p.trackAlpha(0) ?? 1) > 0.5 ? 0 : 1, FADE_MS)}>
            fade track 0 out / in
          </Choice>
        </View>

        <Text style={styles.label}>Track 1 — overlay</Text>
        <View style={styles.row}>
          <Choice active={overlay != null} onPress={() => {
              const next = nextOf(animations, overlay)
              if (p?.setTrackAnimation(1, next)) setLaid(next)
            }}>
            {overlay == null ? 'lay' : 'next'}
          </Choice>
          <Choice active={false} onPress={() => p?.clearTrack(1)}>
            clear
          </Choice>
          <Choice active={false} onPress={() => p?.setTrackAlpha(1, (alpha1 ?? 1) > 0.75 ? 0.5 : 1)}>
            {`α ${(alpha1 ?? 1) > 0.75 ? '→ 0.5' : '→ 1'}`}
          </Choice>
          <Choice
            active={blend1 === SsTrackBlend.additive}
            onPress={() =>
              p?.setTrackBlend(1, blend1 === SsTrackBlend.additive ? SsTrackBlend.mix : SsTrackBlend.additive)
            }
          >
            {blend1 === SsTrackBlend.additive ? 'additive' : 'mix'}
          </Choice>
          <Choice active={loops1 === 1} onPress={() => p?.setTrackLoopCount(1, loops1 === 1 ? 0 : 1)}>
            {loops1 === 1 ? 'loop once' : 'loop ∞'}
          </Choice>
        </View>

        {/* Below the buttons, so a status line that wraps never moves one. */}
        <Text style={styles.status}>
          {`track 0  ${p?.currentAnimation ?? '—'}  (source ${p?.trackMainSource(0) ?? '—'})` +
            `${fade0 == null ? '' : `  fading ${(fade0 * 100).toFixed(0)}%`}\n` +
            `  frame ${frame0?.toFixed(1) ?? '—'}  sync ${sync0 === SsTrackSync.start ? 'start' : 'free'}
` +
            `  speed ${speed}×  loops ${loops0 === -1 ? '∞' : loops0}` +
            `  ${p?.isFinished ? 'FINISHED' : p?.isPlaying ? 'playing' : 'stopped'}` +
            `\n  outgoing fires ${Number.isFinite(outgoing) ? `while ≥ ${outgoing}` : 'never'}\n` +
            `track 1  ${overlay ?? '—'}` +
            (overlay == null
              ? ''
              : `  frame ${frame1?.toFixed(1) ?? '—'}
  α ${alpha1?.toFixed(2)}  ${blend1 === SsTrackBlend.additive ? 'additive' : 'mix'}` +
                `  sync ${sync1 === SsTrackSync.start ? 'start' : 'free'}` +
                `  loops ${loops1 === -1 ? '∞' : (loops1 ?? '—')}` +
                `  ${p?.isTrackFinished(1) ? 'FINISHED' : ''}`)}
        </Text>
        <Text style={styles.label}>Events</Text>
        <Text style={styles.events}>{events.length === 0 ? '—' : events.join('\n')}</Text>
      </ScrollView>
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
  panel: { backgroundColor: '#1a1a20', maxHeight: '58%' },
  panelContent: { padding: 12, gap: 8 },
  status: { color: '#f2f2f7', fontSize: 12, fontFamily: 'monospace', lineHeight: 17 },
  label: { color: '#8e8e93', fontSize: 12, textTransform: 'uppercase' },
  events: { color: '#c7c7cc', fontSize: 12, fontFamily: 'monospace', lineHeight: 16 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  choice: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: '#2c2c34',
  },
  choiceActive: { backgroundColor: '#0a84ff' },
  choiceText: { color: '#c7c7cc', fontSize: 13 },
  choiceTextActive: { color: '#fff', fontWeight: '600' },
})
