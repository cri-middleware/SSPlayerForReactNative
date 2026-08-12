/**
 * Playing what `onAudio` reports — **app-side, on purpose**.
 *
 * `react-native-spritestudio` never produces sound: an `SsAudioEvent` says what
 * to play, how many times and where the file is, and stops there. React Native
 * ships no audio API at all, so playing it means a library, and the package
 * choosing one would make every project that authors no audio carry it. That is
 * the whole argument, and this file is the other half of it — the reference
 * wiring, in the example app where the dependency belongs.
 *
 * It uses `expo-audio` because this example is an Expo app. Nothing above cares:
 * swap it for `react-native-audio-api` (a Web Audio port, and the better fit if
 * you are firing many overlapping SE) and only this file changes.
 */
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio'
import { File, Paths } from 'expo-file-system'
import {
  SsRuntimeModule,
  resolveAgainst,
  schemeOf,
  type SsAudioEvent,
} from 'react-native-spritestudio'

/**
 * One player per file, not per event.
 *
 * A key can be crossed every loop of the animation, and `Sound.ssab`'s BGM is a
 * 1.2 MB mp3 — building a player each time would decode it again on every pass.
 * Keyed on the *resolved* URI, so the two conversions of one pack (reference and
 * embedded) cannot collide.
 */
const players = new Map<string, AudioPlayer>()

/** Cache files already written, so `readAsset` runs once per file. */
const cached = new Map<string, string>()

let audioModeSet = false

/**
 * **The iOS silent switch is the first thing to check when nothing plays.**
 *
 * Without this, an app on a handset with the ringer switched off is silent and
 * every event still fires — which looks exactly like a broken event path.
 * `mixWithOthers` is the right interruption mode here: these are sound effects
 * on top of an animation, not media playback, so they should not stop the
 * user's music.
 */
function ensureAudioMode(): void {
  if (audioModeSet) return
  audioModeSet = true
  void setAudioModeAsync({ playsInSilentMode: true, interruptionMode: 'mixWithOthers' })
}

/**
 * Turns a pack-relative sound path into something an audio library can open.
 *
 * The three URI kinds a pack can come from are the three cases here, and only
 * one needs work. `file` and `remote` are already openable. **`asset` is not**:
 * it names an entry in the app's asset directory, which on iOS is inside the
 * `.app` and on Android is an APK entry with no filesystem path at all — that
 * is why the package hands out `readAsset` rather than a path, and why the
 * bytes are copied to the cache directory to give the player a real file.
 */
function playableUri(uri: string): string {
  if (schemeOf(uri) !== 'asset') return uri

  const hit = cached.get(uri)
  if (hit != null) return hit

  const file = new File(Paths.cache, `ss-audio-${uri.replace(/[^a-zA-Z0-9._-]/g, '_')}`)
  if (!file.exists) {
    file.create({ overwrite: true })
    file.write(new Uint8Array(SsRuntimeModule.readAsset(uri)))
  }
  cached.set(uri, file.uri)
  return file.uri
}

/**
 * Plays one audio key, or says why it did not.
 *
 * Returns `null` when the sound started, and a short reason otherwise — the
 * screen prints it, because a key that silently does nothing is the failure
 * that looks like a working build.
 *
 * `baseUri` is the `.ssab`'s own URI: a sound's `filePath` is relative to it,
 * exactly like a cellmap's `image_path`, so it goes through the same
 * `resolveAgainst` seam every other sibling reference does.
 */
export function playAudioEvent(baseUri: string, event: SsAudioEvent): string | null {
  if (event.filePath.length === 0) return 'no SoundList entry'
  // An embedded pack keeps the bytes in `embedded_assets` and ships no sibling
  // file, so the path is real but nothing is there to open. The package does not
  // expose those bytes yet — see its ROADMAP.
  if (event.embedded) return 'embedded — bytes not reachable yet'

  ensureAudioMode()
  const uri = resolveAgainst(baseUri, event.filePath)

  let player = players.get(uri)
  if (player == null) {
    player = createAudioPlayer(playableUri(uri))
    players.set(uri, player)
  }

  // `loop_num` is a **count**, and `expo-audio`'s `loop` is a boolean, so the
  // repeat is driven here. SpriteStudio has no infinite audio loop, which is
  // what makes a count the right reading of the field rather than a flag.
  let remaining = Math.max(1, event.loopNum) - 1
  if (remaining > 0) {
    const sub = player.addListener('playbackStatusUpdate', (status) => {
      if (!status.didJustFinish) return
      if (remaining <= 0) {
        sub.remove()
        return
      }
      remaining -= 1
      void player.seekTo(0).then(() => player.play())
    })
  }

  // Restart rather than overlap: one player is one voice, so a key crossed again
  // while it is still sounding retriggers it. Overlapping instances of one sound
  // want a Web Audio-style library, not a media player.
  void player.seekTo(0).then(() => player.play())
  return null
}

/** Drops every player. The screen calls this when the pack changes. */
export function releaseAudioPlayers(): void {
  for (const player of players.values()) player.remove()
  players.clear()
}
