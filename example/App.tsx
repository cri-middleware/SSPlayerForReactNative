import { useState } from 'react'
import { Platform, Pressable, SafeAreaView, StatusBar, StyleSheet, Text, View } from 'react-native'

import { BenchScreen } from './src/bench/BenchScreen'
import { PlayerScreen } from './src/player/PlayerScreen'

type Screen = 'player' | 'bench'

/**
 * Two screens, because this app answers two different questions.
 *
 *  * **player** — Phase 1's target: Ringo animating through the real
 *    `<SpriteStudioView>` API. What you want when checking that a change still
 *    renders.
 *  * **bench** — the Phase 0 measurement harness. It still auto-runs the whole
 *    variant × instance-count sweep the moment you open it, so a number stays
 *    reproducible by someone who was not here: launch, tap *Bench*, wait, read
 *    the table.
 */
const INITIAL_SCREEN: Screen = 'player'

/**
 * Height to keep clear of Android's status bar, 0 elsewhere.
 *
 * `react-native-safe-area-context` is the real answer and would also cover the
 * gesture bar and cutouts, but it is a native dependency this example does not
 * otherwise need — and one more autolinked module is exactly what the Android
 * bring-up did not need. `StatusBar.currentHeight` covers the case that
 * actually bites.
 */
const ANDROID_STATUS_BAR_INSET =
  Platform.OS === 'android' ? (StatusBar.currentHeight ?? 0) : 0

export default function App() {
  const [screen, setScreen] = useState<Screen>(INITIAL_SCREEN)

  return (
    <SafeAreaView style={styles.root}>
      {/*
        React Native's `SafeAreaView` is iOS-only, and RN 0.86 draws Android
        edge-to-edge — so without this the tab row sits *under* the status bar,
        which then swallows its taps. The buttons look fine and simply do not
        respond, which is a confusing way to find out.
      */}
      <View style={[styles.tabs, { paddingTop: ANDROID_STATUS_BAR_INSET }]}>
        <Tab active={screen === 'player'} onPress={() => setScreen('player')}>
          Player
        </Tab>
        <Tab active={screen === 'bench'} onPress={() => setScreen('bench')}>
          Bench
        </Tab>
      </View>
      {screen === 'player' ? <PlayerScreen /> : <BenchScreen />}
    </SafeAreaView>
  )
}

function Tab({
  active,
  onPress,
  children,
}: {
  active: boolean
  onPress: () => void
  children: React.ReactNode
}) {
  return (
    <Pressable style={[styles.tab, active && styles.tabActive]} onPress={onPress}>
      <Text style={[styles.tabText, active && styles.tabTextActive]}>{children}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#101014' },
  tabs: { flexDirection: 'row', gap: 8, padding: 12, backgroundColor: '#1a1a20' },
  tab: {
    paddingVertical: 6,
    paddingHorizontal: 16,
    borderRadius: 8,
    backgroundColor: '#2c2c34',
  },
  tabActive: { backgroundColor: '#0a84ff' },
  tabText: { color: '#c7c7cc', fontSize: 14 },
  tabTextActive: { color: '#fff', fontWeight: '600' },
})
