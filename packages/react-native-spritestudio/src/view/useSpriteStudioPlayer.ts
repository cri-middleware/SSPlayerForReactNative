import { useEffect, useRef, useState } from 'react'

import type { SsPartOverrides } from '../core/parts'
import type {
  SsAudioEvent,
  SsBox,
  SsSignalEvent,
  SsUserDataEvent,
} from '../specs/SsRuntime.nitro'
import {
  SpriteStudioPlayer,
  type SsMeasureRequest,
} from '../player/SpriteStudioPlayer'
import { sourceUriOf, type SsSource } from '../player/source'
import type { SsFit, SsFrameScope } from '../core/fit'
import { reportError } from './reportError'
import { SS_DEFAULT_CELLMAP, useSsTextures, type SsTextureSources } from './useSsTextures'

/**
 * Everything about *which animation and how it plays* — as opposed to where it
 * is drawn, which is `SsPlacement`.
 *
 * Shared by `<SpriteStudioView>` and `<SpriteStudioSprite>` so the two cannot
 * drift on what `playing` or `animation` mean. The split matches the components:
 * a view fits one animation to itself, a sprite sits at a point in a scene, and
 * everything else about them is identical.
 */
export interface SsPlayerProps {
  /** The `.ssab` to play: a bundled asset, a file path or an `http(s)` URL. */
  source: SsSource
  /** Atlases supplied by the caller. A pack's own are loaded either way. */
  textures?: SsTextureSources
  /** Which animation in the pack. Omitted, the pack's first one plays. */
  animation?: string
  /**
   * Milliseconds to crossfade over when `animation` **changes**. Default `0`,
   * which switches outright — re-posing and heading out, as `setAnimation`
   * does. Above `0` the change is a `crossfade` on track 0 instead: the outgoing
   * animation fades while the incoming one plays from its head, and the other
   * tracks stay. The first animation of a load is always set up outright.
   *
   * With this prop in use, switch track 0 through `animation` rather than
   * through the player's `crossfade(0, …)` / `setTrackAnimation(0, …)` /
   * `setAnimation`: the prop only acts when it changes, so a clip reached behind
   * its back is one the prop cannot then return from. The tracks above 0 are
   * the player's alone.
   */
  transitionMs?: number
  /** Default `true`. `false` leaves it on its first frame. */
  playing?: boolean
  /** Multiplier on the authored frame rate. Default `1`. */
  speed?: number
  /** How many times to play. Default `0`, which is forever. */
  loop?: number

  /** How the content box is scaled to the view. Default `'contain'`. */
  fit?: SsFit
  /** The content box, in player-local units. Omitted, the animation's authored canvas. */
  frame?: SsBox
  /**
   * Measure the box instead of using the authored canvas — over this animation
   * or the whole pack. Omitted, nothing is measured.
   */
  frameScope?: SsFrameScope
  /** Caps the measuring walk. Default `0`, which is one authored cycle. */
  measureFrames?: number

  /**
   * Per-part overrides on top of the animation, keyed by part name.
   *
   * Declarative: a part dropped from the map goes back to the animation, so the
   * prop describes the state rather than a history of calls.
   */
  parts?: SsPartOverrides
  /** Fires once per authored user-data key the playhead crosses. */
  onUserData?: (event: SsUserDataEvent) => void
  /**
   * Fires once per authored audio key the playhead crosses.
   *
   * The event says what to play and where the file is — **playing it is the
   * app's job**, since this package brings no audio stack of its own.
   */
  onAudio?: (event: SsAudioEvent) => void
  /**
   * Fires once per active signal the playhead crosses — a named command and its
   * parameters, for the app to dispatch. Signals switched off in the timeline
   * are not reported.
   */
  onSignal?: (event: SsSignalEvent) => void

  /**
   * The pack loaded and its animation is set up. Hands over the player, so
   * reading `getAnimationNames()` needs neither the ref nor an effect.
   */
  onLoad?: (player: SpriteStudioPlayer) => void
  /** Without one, the error goes to `console.error` rather than nowhere. */
  onError?: (error: unknown) => void
  /** The animation reached its end. Carries which one, since a player outlives them. */
  onAnimationFinished?: (animation: string) => void
  /** The playhead crossed a loop boundary. */
  onAnimationLooped?: (animation: string) => void
  /** Playback started from the beginning — not on resume. */
  onAnimationStarted?: (animation: string) => void
  /** A different animation was mounted. Not fired for a restart of the same one. */
  onAnimationChanged?: (animation: string) => void
}

export interface SsPlayerState {
  player: SpriteStudioPlayer | null
  /** The measured content box, or null before one lands (or when none was asked for). */
  measured: SsBox | null
  /**
   * The authored canvas of the animation the load started on, or null before
   * one is set up. Not moved by an animation switch.
   */
  canvas: SsBox | null
  /** Loaded **and** carrying at least one texture — the first drawable frame. */
  ready: boolean
}

function sameBox(a: SsBox | null, b: SsBox | null): boolean {
  if (a == null || b == null) return a === b
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
}

/**
 * The cellmap a bare `textures` source replaces, or null while the pack has not
 * loaded — or has several, which the shorthand cannot choose between.
 */
function soleCellmapOf(player: SpriteStudioPlayer): string | null {
  const names = player.cellmapNames()
  if (names.length === 1) return names[0]!
  if (__DEV__ && names.length > 1) {
    console.warn(
      `react-native-spritestudio: a bare textures source is the shorthand for a pack ` +
        `with one cellmap, and this one has ${names.length} (${names.join(', ')}). ` +
        `Key the textures by cellmap name.`
    )
  }
  return null
}

/**
 * Owns one Layer 3 player for a component: loads it, keeps the transport props
 * on it, and reports when it is drawable.
 *
 * Deliberately **not** a clock. Who advances the player is the caller's
 * business, and that is the whole difference between the two Layer 4
 * components: a `<SpriteStudioView>` runs its own frame loop, while every
 * `<SpriteStudioSprite>` in a scene is advanced by the one loop the scene owns.
 */
export function useSpriteStudioPlayer(props: SsPlayerProps): SsPlayerState {
  const {
    source,
    textures,
    animation,
    playing = true,
    speed = 1,
    loop = 0,
    fit = 'contain',
    frame,
    frameScope,
    measureFrames = 0,
    parts,
    onLoad,
    onError,
    onAnimationFinished,
  } = props

  const [player, setPlayer] = useState<SpriteStudioPlayer | null>(null)
  const images = useSsTextures(textures)

  // Through a ref so a caller passing inline arrows does not restart the load.
  const callbacks = useRef({
    onLoad,
    onError,
    onAnimationFinished,
    onUserData: props.onUserData,
    onAudio: props.onAudio,
    onSignal: props.onSignal,
    onAnimationLooped: props.onAnimationLooped,
    onAnimationStarted: props.onAnimationStarted,
    onAnimationChanged: props.onAnimationChanged,
  })
  callbacks.current = {
    onLoad,
    onError,
    onAnimationFinished,
    onUserData: props.onUserData,
    onAudio: props.onAudio,
    onSignal: props.onSignal,
    onAnimationLooped: props.onAnimationLooped,
    onAnimationStarted: props.onAnimationStarted,
    onAnimationChanged: props.onAnimationChanged,
  }

  // --- load ---------------------------------------------------------------
  //
  // Keyed on the resolved URI rather than on `source`: an inline `{ uri }` is a
  // new object every render, and reloading the pack on each one would be an
  // expensive way to draw the same frame.
  const sourceUri = sourceUriOf(source)
  const measureScope = fit === 'none' || frame != null ? null : (frameScope ?? null)

  // What the player has been *asked* to play, which is not always what the
  // `animation` prop says: a change arriving mid-load reaches a player with no
  // resource yet. Written before `load()` because that is the call which applies
  // it, so the effect below sees the two agree and does not restart it.
  const applied = useRef<string | undefined>(undefined)
  // Read by the load and animation effects, which must not re-run when the prop
  // flips — that is the transport effect's job, and re-running the load there
  // would re-read the pack.
  const playingRef = useRef(playing)
  playingRef.current = playing
  // Read when `animation` changes, never a trigger of its own: a new duration
  // says how the *next* switch fades, not that one should happen now.
  const transitionRef = useRef(props.transitionMs ?? 0)
  transitionRef.current = props.transitionMs ?? 0
  // Bumped when a load lands, so that effect gets a second chance at a prop it
  // could not apply while the load was in flight.
  const [loadTick, setLoadTick] = useState(0)

  useEffect(() => {
    const next = new SpriteStudioPlayer()
    setPlayer(next)
    const measure: SsMeasureRequest | undefined =
      measureScope == null
        ? undefined
        : { scope: measureScope, maxFrames: measureFrames }

    // Before `load()`, all of it, because `load()` reaches the end of its own
    // promise chain synchronously — it sets the animation up and starts
    // playback there. The effects below cannot get here first: they are keyed on
    // the `player` *state*, which is still null on this commit, so they do not
    // run until React has committed the `setPlayer` above. A microtask beats a
    // commit, so anything installed there arrives after the events it wanted.
    //
    // Only the two lifecycle forwarders, not the whole set: `onAnimationLooped` and
    // `onAnimationFinished` cannot fire before the first `advance`, and the three event
    // forwarders are deliberately installed only while their prop is present —
    // Layer 3 gates its per-frame reads on them.
    next.onAnimationStarted = (a) => callbacks.current.onAnimationStarted?.(a)
    next.onAnimationChanged = (a) => callbacks.current.onAnimationChanged?.(a)
    // The transport for the same reason. These are Layer 3's own record, which
    // `applySettings()` replays onto the animation once it is set up, so setting
    // them on a player with no resource is not a race — it is how it is meant to
    // be primed.
    next.setSpeedScale(speed)
    next.setLoopCount(loop)

    applied.current = animation
    next
      .load(sourceUri, { animation, measure })
      .then(() => {
        // `load` selects and poses; starting is a separate verb, so the first
        // play happens here. `playing={false}` therefore leaves the animation on
        // its first frame without ever having played — which is what the prop
        // says, and what it could not do while `setAnimation` started playback.
        if (playingRef.current) next.play()
        setLoadTick((tick) => tick + 1)
        callbacks.current.onLoad?.(next)
      })
      .catch((error: unknown) =>
        reportError(callbacks.current.onError, error, `'${sourceUri}' did not load`)
      )
    return () => {
      // Explicit teardown, never GC: every buffer Layer 1 handed out is a borrow
      // of memory this player owns (the lifetime rule in `specs/SsRuntime.nitro.ts`).
      // It also hands back the cache leases, which is what lets the pack be freed
      // when the last user of it unmounts.
      next.dispose()
      setPlayer(null)
    }
    // `animation` is deliberately **not** a dependency: switching animations
    // must not tear the player down. Doing so dropped the cache leases, so the
    // `.ssab` was re-read and its atlases re-decoded for a change `setAnimation`
    // does in one call — every pick from the example's 24-animation dropdown was
    // a reload from the APK. The effect below owns it instead; the value read
    // here is the one that render had, which is what `load()` should start on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceUri, measureScope, measureFrames])

  // --- animation ------------------------------------------------------------
  //
  // `setAnimation` re-measures an animation-scoped box, re-applies the transport
  // and replays the overrides, so this is the whole of the switch. It returns
  // false while there is no resource yet — a prop that changed mid-load — and
  // `applied` is left alone so `loadTick` brings it back here when the load
  // lands.
  //
  // With `transitionMs`, a change of a clip already showing is a crossfade on
  // track 0 rather than a setup. The player names the incoming animation from
  // the call on, so a later change back to the one it left is a real switch.
  // No `play()` after it: a crossfade keeps the clock as it is — a playing
  // character plays into the new clip, a held one holds the fade too.
  //
  // Except on the run a load landing brings: what the load set up has not been
  // shown yet, so there is nothing on screen to fade from — a change that
  // arrived mid-load is the load's first animation, and is set up outright.
  const landedTick = useRef(0)
  useEffect(() => {
    const landing = loadTick !== landedTick.current
    landedTick.current = loadTick
    if (player == null || animation == null) return
    if (applied.current === animation) return
    const fade = landing ? 0 : transitionRef.current
    if (fade > 0 && player.currentAnimation != null && player.isLoaded) {
      if (player.currentAnimation !== animation && !player.crossfade(0, animation, fade)) return
      applied.current = animation
      return
    }
    if (!player.setAnimation(animation)) return
    applied.current = animation
    // A switch selects and poses; it does not start. Head out into the new
    // animation only if this component is meant to be playing at all.
    if (playingRef.current) player.play()
  }, [player, animation, loadTick])

  // --- textures -----------------------------------------------------------
  //
  // Through `setCellmapTexture` rather than straight into the registry. The
  // pack's own atlases land in that same registry, so a bare source registered
  // under `SS_DEFAULT_CELLMAP` met a table of two and matched no batch: the
  // shorthand drew the pack's atlas. The replacement seam keys by name, holds
  // one set before the load until the pack lands, and puts the pack's own atlas
  // back when the prop drops it.
  //
  // `loadTick` because the shorthand names the pack's one cellmap, which only a
  // loaded pack can say.
  useEffect(() => {
    if (player == null || images == null) return
    const replaced: string[] = []
    for (const [key, image] of Object.entries(images)) {
      const name = key === SS_DEFAULT_CELLMAP ? soleCellmapOf(player) : key
      if (name != null && player.setCellmapTexture(name, image)) replaced.push(name)
    }
    return () => {
      for (const name of replaced) player.setCellmapTexture(name, null)
    }
  }, [player, images, loadTick])

  // --- transport ----------------------------------------------------------
  //
  // Keyed on the **prop only**, not on `player`: every player is primed with
  // these at construction, so re-running on a new one is redundant — and worse
  // than redundant for `playing`. `play()` on a transport that is already
  // running is a *restart* (`ss_runtime_play` rewinds) and reports itself as
  // one, so after a cached load — which resolves in a microtask, before React
  // commits the render that publishes the player — a `player`-keyed effect
  // rewound the animation and fired a second `onAnimationStarted`.
  useEffect(() => {
    player?.setSpeedScale(speed)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [speed])

  useEffect(() => {
    player?.setLoopCount(loop)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loop])

  useEffect(() => {
    if (player == null) return
    if (!playing) {
      player.pause()
      return
    }
    // `playing` going false → true means "carry on", not "start over", so a held
    // transport is resumed. Only one that is not running at all is headed out —
    // a player mounted with `playing={false}`, or one whose animation finished.
    //
    // Layer 3 publishes the four verbs separately, as the SDK's transport
    // contract asks; mapping a boolean onto them belongs here, in the only layer
    // that knows a boolean prop exists.
    if (player.isPlaying) player.resume()
    else player.play()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing])

  // Installed only while the corresponding prop is actually supplied, because
  // Layer 3 gates its per-frame event reads on whether a handler is set — a
  // permanently-installed forwarder that calls into an absent prop would defeat
  // that gate and pay one Nitro array marshal per event frame to reach a `?.`.
  // The deps are booleans rather than the props themselves, so an inline arrow
  // still does not re-run this; that is what the ref above is for.
  const wantsUserData = props.onUserData != null
  const wantsAudio = props.onAudio != null
  const wantsSignal = props.onSignal != null
  const wantsLoop = props.onAnimationLooped != null
  const wantsStart = props.onAnimationStarted != null
  const wantsChange = props.onAnimationChanged != null
  useEffect(() => {
    if (player == null) return
    player.onAnimationFinished = (animation) => callbacks.current.onAnimationFinished?.(animation)
    if (wantsLoop) {
      player.onAnimationLooped = (animation) => callbacks.current.onAnimationLooped?.(animation)
    }
    if (wantsStart) {
      player.onAnimationStarted = (a) => callbacks.current.onAnimationStarted?.(a)
    }
    if (wantsChange) {
      player.onAnimationChanged = (a) => callbacks.current.onAnimationChanged?.(a)
    }
    if (wantsUserData) {
      player.onUserData = (event) => callbacks.current.onUserData?.(event)
    }
    if (wantsAudio) {
      player.onAudio = (event) => callbacks.current.onAudio?.(event)
    }
    if (wantsSignal) {
      player.onSignal = (event) => callbacks.current.onSignal?.(event)
    }
    return () => {
      player.onAnimationFinished = null
      player.onUserData = null
      player.onAudio = null
      player.onSignal = null
      player.onAnimationLooped = null
      player.onAnimationStarted = null
      player.onAnimationChanged = null
    }
  }, [player, wantsUserData, wantsAudio, wantsSignal, wantsLoop, wantsStart, wantsChange])

  // --- overrides ----------------------------------------------------------
  //
  // An absent map is `{}` rather than skipped, so removing the prop reverts what
  // it had set — the same rule as removing one part from it.
  //
  // Keyed on the map's *contents*, not its identity: `parts={{ hat: … }}` is a
  // new object on every render, and re-applying would mean a `findPartIndex`
  // and three clear-or-set calls per part per render for a map that had not
  // changed. Serialising a handful of small entries is far cheaper than that,
  // and it is what makes the prop safe to write inline — which is how a
  // declarative prop is always going to be written.
  const partsKey = parts == null ? '' : JSON.stringify(parts)
  const partsRef = useRef(parts)
  partsRef.current = parts
  useEffect(() => {
    player?.setPartOverrides(partsRef.current ?? {})
  }, [player, partsKey])

  // --- what the caller renders against ------------------------------------
  //
  // Both come off one subscription. The measured box arrives asynchronously —
  // the load has to finish first — and the textures later still, so neither can
  // be read during render and expected to re-render when it changes.
  const [measured, setMeasured] = useState<SsBox | null>(null)
  const [canvas, setCanvas] = useState<SsBox | null>(null)
  const [ready, setReady] = useState(false)
  useEffect(() => {
    if (player == null) {
      setMeasured(null)
      setCanvas(null)
      setReady(false)
      return
    }
    // The canvas of the animation a load starts on, kept across switches:
    // canvases differ within a pack (Ringo's `dead` is 1300 wide against 800),
    // and following them would shrink the character as it dies. A load builds
    // a new internal player, which is what takes the canvas again.
    let keptFor: unknown = null
    let kept: SsBox | null = null
    const read = (): void => {
      setMeasured(player.contentBox)
      if (player.internal !== keptFor) {
        keptFor = player.internal
        kept = null
      }
      kept ??= player.canvasBox
      const nextCanvas = kept
      setCanvas((previous) => (sameBox(previous, nextCanvas) ? previous : nextCanvas))
      setReady(player.isLoaded && player.textures.size > 0)
    }
    read()
    return player.addListener(read)
  }, [player])

  return { player, measured, canvas, ready }
}
