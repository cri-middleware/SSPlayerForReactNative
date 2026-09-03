import { useState } from 'react'
import { Platform, Pressable, SafeAreaView, StatusBar, StyleSheet, Text, View } from 'react-native'

import { PartFollowScreen } from './src/partfollow/PartFollowScreen'
import { PlayerScreen } from './src/player/PlayerScreen'

/**
 * Two screens, one at a time, chosen by the tab bar:
 *
 *  * **Viewer** — every pack animating through the real `<SpriteStudioView>`
 *    API. This is what you open to check that a change still renders.
 *  * **Part follow** — a fish pinned to Ringo with `useSsPartTransform`, and the
 *    demo for `isPartSkinnedMesh`: which parts a follower can and cannot sit on.
 *
 * Only the active screen is mounted, so the two never run frame loops or hold
 * native handles at the same time — which is what keeps the Viewer's own leak
 * check reading a clean baseline.
 *
 * (There used to be a second screen of a different kind — a measurement harness
 * that drove Layer 1 directly to decide where the L1/L2 boundary belongs. It was
 * retired once the question was settled; it is in git history if ever needed.)
 */
type Tab = 'viewer' | 'follow'

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
  const [tab, setTab] = useState<Tab>('viewer')
  return (
    <SafeAreaView style={styles.root}>
      {/*
        React Native's `SafeAreaView` is iOS-only, and RN 0.86 draws Android
        edge-to-edge — so without this the top of the screen sits *under* the
        status bar, and anything tappable up there silently stops responding.
      */}
      <View style={[styles.body, { paddingTop: ANDROID_STATUS_BAR_INSET }]}>
        <View style={styles.tabs}>
          <TabButton label="Viewer" active={tab === 'viewer'} onPress={() => setTab('viewer')} />
          <TabButton label="Part follow" active={tab === 'follow'} onPress={() => setTab('follow')} />
        </View>
        {tab === 'viewer' ? <PlayerScreen /> : <PartFollowScreen />}
      </View>
    </SafeAreaView>
  )
}

function TabButton({
  label,
  active,
  onPress,
}: {
  label: string
  active: boolean
  onPress: () => void
}) {
  return (
    <Pressable style={[styles.tab, active && styles.tabActive]} onPress={onPress}>
      <Text style={[styles.tabText, active && styles.tabTextActive]}>{label}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#101014' },
  body: { flex: 1 },
  tabs: { flexDirection: 'row', gap: 8, paddingHorizontal: 12, paddingVertical: 8 },
  tab: { paddingVertical: 8, paddingHorizontal: 16, borderRadius: 8, backgroundColor: '#1a1a20' },
  tabActive: { backgroundColor: '#0a84ff' },
  tabText: { color: '#8e8e93', fontSize: 14, fontWeight: '600' },
  tabTextActive: { color: '#ffffff' },
})
