import { beforeEach, describe, expect, it, vi } from 'vitest'

import { frameShown } from '../src/player/frames'
import type { SpriteStudioPlayer } from '../src/player/SpriteStudioPlayer'
import { useSsPartTransform } from '../src/view/useSsPartTransform'
import type { SsPartTransform } from '../src/specs/SsRuntime.nitro'
import { pendingFrames } from './support/frameClock'
import { act, renderHook } from './support/render'

// Nothing is mocked here: the hook takes a player as an argument and imports
// only its type, so a stand-in object is the whole of the seam.
interface Followed {
  transform: SsPartTransform | null
  root: { x: number; y: number; scale: number; flipX: boolean; flipY: boolean } | null
  skinned: boolean
  reads: number
}

const local = (over: Partial<SsPartTransform> = {}): SsPartTransform => ({
  valid: true,
  x: 10,
  y: 20,
  rotation: 0.5,
  scaleX: 1,
  scaleY: 1,
  determinant: 1,
  ...over,
})

function followedPlayer(state: Followed): SpriteStudioPlayer {
  return {
    getPartTransform: () => {
      state.reads += 1
      return state.transform
    },
    get rootTransform() {
      return state.root
    },
    isPartSkinnedMesh: () => state.skinned,
  } as unknown as SpriteStudioPlayer
}

let player: SpriteStudioPlayer

/** The player shows a frame — what its `draw` does. */
const show = (): void => frameShown(player)

let state: Followed

beforeEach(() => {
  state = {
    transform: null,
    root: { x: 0, y: 0, scale: 1, flipX: false, flipY: false },
    skinned: false,
    reads: 0,
  }
  player = followedPlayer(state)
})

/** The stub shared value counts its writes; the real `SharedValue` type does not. */
const writesOf = (value: unknown): number => (value as { writes: number }).writes

const follow = (player: SpriteStudioPlayer | null) =>
  renderHook(
    (props: { player: SpriteStudioPlayer | null }) =>
      useSsPartTransform(props.player, 'hand'),
    { player }
  )

describe('useSsPartTransform', () => {
  it('reports nothing until the part has a matrix', async () => {
    const harness = await follow(player)

    await act(async () => show())

    expect(harness.result.current.value.valid).toBe(false)
  })

  // A shared value assignment crosses to the UI thread, so an unresolved part
  // would otherwise do that sixty times a second to say the same thing.
  it('does not write while there is nothing to say', async () => {
    const harness = await follow(player)

    await act(async () => {
      show()
      show()
      show()
    })

    expect(writesOf(harness.result.current)).toBe(0)
  })

  it('drops the last part when the name changes to one that does not resolve', async () => {
    state.transform = local()
    const harness = await renderHook(
      (props: { part: string }) => useSsPartTransform(player, props.part),
      { part: 'hand' }
    )
    await act(async () => show())
    expect(harness.result.current.value.valid).toBe(true)

    state.transform = null
    await harness.rerender({ part: 'typo' })

    expect(harness.result.current.value.valid).toBe(false)
  })

  // Exactly the mapping `SsInternalPlayer.draw` applies — translate, then scale.
  it('carries the part into view pixels through the root transform', async () => {
    state.transform = local()
    state.root = { x: 100, y: 50, scale: 2, flipX: false, flipY: false }
    const harness = await follow(player)

    await act(async () => show())

    expect(harness.result.current.value).toEqual({
      valid: true,
      x: 120,
      y: 90,
      rotation: 0.5,
      scaleX: 2,
      scaleY: 2,
    })
  })

  // The draw mirrors the art with the root's signed scale, so under one flip the
  // screen shows the angle negated; the scale stays a size, so nothing turns over.
  it('mirrors the position and the angle under a flip', async () => {
    state.transform = local()
    state.root = { x: 100, y: 50, scale: 2, flipX: true, flipY: false }
    const harness = await follow(player)

    await act(async () => show())

    expect(harness.result.current.value).toMatchObject({
      x: 80,
      y: 90,
      rotation: -0.5,
      // The reported scale is a size, so it stays positive under the mirror.
      scaleX: 2,
      scaleY: 2,
    })
  })

  it('negates the angle under a vertical flip, and turns it half over under both', async () => {
    state.transform = local()
    state.root = { x: 100, y: 50, scale: 2, flipX: false, flipY: true }
    const harness = await follow(player)
    await act(async () => show())
    expect(harness.result.current.value.rotation).toBeCloseTo(-0.5)

    state.root = { x: 100, y: 50, scale: 2, flipX: true, flipY: true }
    await act(async () => show())
    expect(harness.result.current.value.rotation).toBeCloseTo(0.5 + Math.PI)
  })

  // A scene redraws every member when one of them moves, so a still part is
  // read again — and writing the same pose would still have the UI thread
  // re-run every style built on it.
  it('writes only when the pose changes', async () => {
    state.transform = local()
    const harness = await follow(player)

    await act(async () => {
      show()
      show()
      show()
    })
    expect(writesOf(harness.result.current)).toBe(1)

    state.transform = local({ x: 11 })
    await act(async () => show())
    expect(writesOf(harness.result.current)).toBe(2)
    expect(harness.result.current.value.x).toBe(11)
  })

  it('goes back to nothing when the part stops resolving', async () => {
    state.transform = local()
    const harness = await follow(player)
    await act(async () => show())

    state.transform = null
    await act(async () => show())

    expect(harness.result.current.value.valid).toBe(false)
  })

  // Non-blocking, and once: the check reads the `.ssab` across JSI, so it runs
  // on the first frame the part resolves and never again.
  it('warns once that a skinned mesh will not track its art', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    state.transform = local()
    state.skinned = true
    const harness = await follow(player)

    await act(async () => {
      show()
      show()
    })

    expect(warn).toHaveBeenCalledOnce()
    expect(warn.mock.calls[0]?.[0]).toMatch(/skinned \(bone-bound\) mesh part/)
    // Still published — the sibling Players mark the target rather than refuse it.
    expect(harness.result.current.value.valid).toBe(true)
  })

  // A follower mounted on a still player would otherwise wait for a frame
  // that never comes.
  it('reads the frame already shown when it mounts', async () => {
    state.transform = local()
    const harness = await follow(player)

    expect(harness.result.current.value.valid).toBe(true)
  })

  // The view's loop draws only when something changed, and the follower reads
  // on those frames — never on a loop of its own.
  it('reads once per frame the player shows, and runs no loop of its own', async () => {
    state.transform = local()
    await follow(player)
    expect(pendingFrames()).toBe(0)
    expect(state.reads).toBe(1)

    await act(async () => {
      show()
      show()
    })

    expect(state.reads).toBe(3)
    expect(pendingFrames()).toBe(0)
  })

  it('stops sampling when the player goes away', async () => {
    const harness = await follow(player)
    const reads = state.reads

    await harness.rerender({ player: null })
    show()

    expect(state.reads).toBe(reads)
    expect(harness.result.current.value.valid).toBe(false)
  })
})
