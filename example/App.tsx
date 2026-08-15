import { Platform, SafeAreaView, StatusBar, StyleSheet, View } from 'react-native'

import { PlayerScreen } from './src/player/PlayerScreen'

/**
 * One screen: `overall/Basic` animating through the real `<SpriteStudioView>`
 * API. This is what you open to check that a change still renders.
 *
 * There used to be a second one — a measurement harness that drove Layer 1
 * directly to decide where the L1/L2 boundary belongs. It was retired once the
 * question was settled; it is in git history if it ever needs re-running.
 */

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
  return (
    <SafeAreaView style={styles.root}>
      {/*
        React Native's `SafeAreaView` is iOS-only, and RN 0.86 draws Android
        edge-to-edge — so without this the top of the screen sits *under* the
        status bar, and anything tappable up there silently stops responding.
      */}
      <View style={[styles.body, { paddingTop: ANDROID_STATUS_BAR_INSET }]}>
        <PlayerScreen />
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#101014' },
  body: { flex: 1 },
})
