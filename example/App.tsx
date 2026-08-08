import { useState } from 'react'
import { Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native'

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

export default function App() {
  const [screen, setScreen] = useState<Screen>(INITIAL_SCREEN)

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.tabs}>
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
