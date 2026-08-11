import { useEffect, useRef, useState } from 'react'

import type { SsPartOverrides } from '../core/parts'
import type { SsBox, SsUserDataEvent } from '../specs/SsRuntime.nitro'
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
  source: SsSource
  textures?: SsTextureSources
  animation?: string
  playing?: boolean
  speed?: number
  loop?: number

  fit?: SsFit
  frame?: SsBox
  frameScope?: SsFrameScope
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

  onLoad?: () => void
  onError?: (error: unknown) => void
  onComplete?: () => void
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
  const callbacks = useRef({ onLoad, onError, onComplete, onUserData: props.onUserData })
  callbacks.current = { onLoad, onError, onComplete, onUserData: props.onUserData }

  // --- load ---------------------------------------------------------------
  //
  // Keyed on the resolved URI rather than on `source`: an inline `{ uri }` is a
  // new object every render, and reloading the pack on each one would be an
  // expensive way to draw the same frame.
  const sourceUri = sourceUriOf(source)
  const measureScope = fit === 'none' || frame != null ? null : frameScope
  useEffect(() => {
    const next = new SpriteStudioPlayer()
    setPlayer(next)
    const measure: SsMeasureRequest | undefined =
      measureScope == null
        ? undefined
        : { scope: measureScope, maxFrames: measureFrames }
    next
      .load(sourceUri, { animation, measure })
      .then(() => callbacks.current.onLoad?.())
      .catch((error: unknown) => callbacks.current.onError?.(error))
    return () => {
      // Explicit teardown, never GC: every buffer Layer 1 handed out is a borrow
      // of memory this player owns (design doc ch.9 F). It also hands back the
      // cache leases, which is what lets the pack be freed when the last user
      // of it unmounts.
      next.dispose()
      setPlayer(null)
    }
  }, [sourceUri, animation, measureScope, measureFrames])

  // --- textures -----------------------------------------------------------
  useEffect(() => {
    if (player == null || images == null) return
    for (const [name, image] of Object.entries(images)) {
      player.textures.register(name, image)
    }
  }, [player, images])

  // --- transport ----------------------------------------------------------
  useEffect(() => {
    player?.setSpeed(speed)
  }, [player, speed])

  useEffect(() => {
    player?.setLoop(loop)
  }, [player, loop])

  useEffect(() => {
    if (player == null) return
    if (playing) player.play()
    else player.pause()
  }, [player, playing])

  useEffect(() => {
    if (player == null) return
    player.onComplete = () => callbacks.current.onComplete?.()
    player.onUserData = (event) => callbacks.current.onUserData?.(event)
    return () => {
      player.onComplete = null
      player.onUserData = null
    }
  }, [player])

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
