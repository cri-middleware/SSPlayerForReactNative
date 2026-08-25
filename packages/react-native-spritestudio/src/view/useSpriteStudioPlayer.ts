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
import { useSsTextures, type SsTextureSources } from './useSsTextures'

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
  /** Default `true`. `false` leaves it on its first frame. */
  playing?: boolean
  /** Multiplier on the authored frame rate. Default `1`. */
  speed?: number
  /** How many times to play. Default `0`, which is forever. */
  loop?: number

  /** How the content box is scaled to the view. Default `'contain'`. */
  fit?: SsFit
  /** The content box, in player-local units — supply it to skip measuring. */
  frame?: SsBox
  /** Whether an unsupplied box covers this animation or the whole pack. */
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

  onLoad?: () => void
  onError?: (error: unknown) => void
  /** The animation reached its end. Carries which one, since a player outlives them. */
  onComplete?: (animation: string) => void
  /** The playhead crossed a loop boundary. */
  onLoop?: (animation: string) => void
  /** Playback started from the beginning — not on resume. */
  onAnimationStart?: (animation: string) => void
  /** A different animation was mounted. Not fired for a restart of the same one. */
  onAnimationChange?: (animation: string) => void
}

export interface SsPlayerState {
  player: SpriteStudioPlayer | null
  /** The measured content box, or null before one lands (or when none was asked for). */
  measured: SsBox | null
  /** Loaded **and** carrying at least one texture — the first drawable frame. */
  ready: boolean
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
    frameScope = 'animation',
    measureFrames = 0,
    parts,
    onLoad,
    onError,
    onComplete,
  } = props

  const [player, setPlayer] = useState<SpriteStudioPlayer | null>(null)
  const images = useSsTextures(textures)

  // Through a ref so a caller passing inline arrows does not restart the load.
  const callbacks = useRef({
    onLoad,
    onError,
    onComplete,
    onUserData: props.onUserData,
    onAudio: props.onAudio,
    onSignal: props.onSignal,
    onLoop: props.onLoop,
    onAnimationStart: props.onAnimationStart,
    onAnimationChange: props.onAnimationChange,
  })
  callbacks.current = {
    onLoad,
    onError,
    onComplete,
    onUserData: props.onUserData,
    onAudio: props.onAudio,
    onSignal: props.onSignal,
    onLoop: props.onLoop,
    onAnimationStart: props.onAnimationStart,
    onAnimationChange: props.onAnimationChange,
  }

  // --- load ---------------------------------------------------------------
  //
  // Keyed on the resolved URI rather than on `source`: an inline `{ uri }` is a
  // new object every render, and reloading the pack on each one would be an
  // expensive way to draw the same frame.
  const sourceUri = sourceUriOf(source)
  const measureScope = fit === 'none' || frame != null ? null : frameScope

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
    // Only the two lifecycle forwarders, not the whole set: `onLoop` and
    // `onComplete` cannot fire before the first `advance`, and the three event
    // forwarders are deliberately installed only while their prop is present —
    // Layer 3 gates its per-frame reads on them.
    next.onAnimationStart = (a) => callbacks.current.onAnimationStart?.(a)
    next.onAnimationChange = (a) => callbacks.current.onAnimationChange?.(a)
    // The transport for the same reason. These are Layer 3's own record, which
    // `applySettings()` replays onto the animation once it is set up, so setting
    // them on a player with no resource is not a race — it is how it is meant to
    // be primed.
    next.setSpeed(speed)
    next.setLoop(loop)

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
        callbacks.current.onLoad?.()
      })
      .catch((error: unknown) => callbacks.current.onError?.(error))
    return () => {
      // Explicit teardown, never GC: every buffer Layer 1 handed out is a borrow
      // of memory this player owns (AGENTS.md's borrow rule). It also hands back the
      // cache leases, which is what lets the pack be freed when the last user
      // of it unmounts.
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
  useEffect(() => {
    if (player == null || animation == null) return
    if (applied.current === animation) return
    if (!player.setAnimation(animation)) return
    applied.current = animation
    // A switch selects and poses; it does not start. Head out into the new
    // animation only if this component is meant to be playing at all.
    if (playingRef.current) player.play()
  }, [player, animation, loadTick])

  // --- textures -----------------------------------------------------------
  useEffect(() => {
    if (player == null || images == null) return
    for (const [name, image] of Object.entries(images)) {
      player.textures.register(name, image)
    }
  }, [player, images])

  // --- transport ----------------------------------------------------------
  //
  // Keyed on the **prop only**, not on `player`: every player is primed with
  // these at construction, so re-running on a new one is redundant — and worse
  // than redundant for `playing`. `play()` on a transport that is already
  // running is a *restart* (`ss_runtime_play` rewinds) and reports itself as
  // one, so after a cached load — which resolves in a microtask, before React
  // commits the render that publishes the player — a `player`-keyed effect
  // rewound the animation and fired a second `onAnimationStart`.
  useEffect(() => {
    player?.setSpeed(speed)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [speed])

  useEffect(() => {
    player?.setLoop(loop)
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
  const wantsLoop = props.onLoop != null
  const wantsStart = props.onAnimationStart != null
  const wantsChange = props.onAnimationChange != null
  useEffect(() => {
    if (player == null) return
    player.onComplete = (animation) => callbacks.current.onComplete?.(animation)
    if (wantsLoop) {
      player.onLoop = (animation) => callbacks.current.onLoop?.(animation)
    }
    if (wantsStart) {
      player.onAnimationStart = (a) => callbacks.current.onAnimationStart?.(a)
    }
    if (wantsChange) {
      player.onAnimationChange = (a) => callbacks.current.onAnimationChange?.(a)
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
      player.onComplete = null
      player.onUserData = null
      player.onAudio = null
      player.onSignal = null
      player.onLoop = null
      player.onAnimationStart = null
      player.onAnimationChange = null
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
  const [ready, setReady] = useState(false)
  useEffect(() => {
    if (player == null) {
      setMeasured(null)
      setReady(false)
      return
    }
    const read = (): void => {
      setMeasured(player.contentBox)
      setReady(player.isLoaded && player.textures.size > 0)
    }
    read()
    return player.addListener(read)
  }, [player])

  return { player, measured, ready }
}
