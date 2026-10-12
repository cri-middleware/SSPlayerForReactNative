import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { SpriteStudioPlayer } from '../src/player/SpriteStudioPlayer'
import { useSsPartTransform } from '../src/view/useSsPartTransform'
import type { SsPartTransform } from '../src/specs/SsRuntime.nitro'
import { pendingFrames, stepFrame } from './support/frameClock'
import { act, renderHook } from './support/render'

// Nothing is mocked here: the hook takes a player as an argument and imports
// only its type, so a stand-in object is the whole of the seam.
interface Followed {
  transform: SsPartTransform | null
  root: { x: number; y: number; scale: number; flipX: boolean; flipY: boolean } | null
  skinned: boolean
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
    getPartTransform: () => state.transform,
    get rootTransform() {
      return state.root
    },
    isPartSkinnedMesh: () => state.skinned,
  } as unknown as SpriteStudioPlayer
}

let state: Followed

beforeEach(() => {
  state = {
    transform: null,
    root: { x: 0, y: 0, scale: 1, flipX: false, flipY: false },
    skinned: false,
  }
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
    const harness = await follow(followedPlayer(state))

    await act(async () => stepFrame(16))

    expect(harness.result.current.value.valid).toBe(false)
  })

  // A shared value assignment crosses to the UI thread, so an unresolved part
  // would otherwise do that sixty times a second to say the same thing.
  it('does not write while there is nothing to say', async () => {
    const harness = await follow(followedPlayer(state))

    await act(async () => {
      stepFrame(16)
      stepFrame(16)
      stepFrame(16)
    })

    expect(writesOf(harness.result.current)).toBe(0)
  })

  // Exactly the mapping `SsInternalPlayer.draw` applies — translate, then scale.
  it('carries the part into view pixels through the root transform', async () => {
    state.transform = local()
    state.root = { x: 100, y: 50, scale: 2, flipX: false, flipY: false }
    const harness = await follow(followedPlayer(state))

    await act(async () => stepFrame(16))

    expect(harness.result.current.value).toEqual({
      valid: true,
      x: 120,
      y: 90,
      rotation: 0.5,
      scaleX: 2,
      scaleY: 2,
    })
  })

  // The Brain mirrors the hierarchy itself, so the angle out of the world matrix
  // already turns the way the screen does — negating here would turn every
  // follower the wrong way.
  it('mirrors the position under a flip without turning the part', async () => {
    state.transform = local()
    state.root = { x: 100, y: 50, scale: 2, flipX: true, flipY: false }
    const harness = await follow(followedPlayer(state))

    await act(async () => stepFrame(16))

    expect(harness.result.current.value).toMatchObject({
      x: 80,
      y: 90,
      rotation: 0.5,
      // The reported scale is a size, so it stays positive under the mirror.
      scaleX: 2,
      scaleY: 2,
    })
  })

  // A stopped player's part does not move, and writing the same pose would
  // still have the UI thread re-run every style built on it.
  it('writes only when the pose changes', async () => {
    state.transform = local()
    const harness = await follow(followedPlayer(state))

    await act(async () => {
      stepFrame(16)
      stepFrame(16)
      stepFrame(16)
    })
    expect(writesOf(harness.result.current)).toBe(1)

    state.transform = local({ x: 11 })
    await act(async () => stepFrame(16))
    expect(writesOf(harness.result.current)).toBe(2)
    expect(harness.result.current.value.x).toBe(11)
  })

  it('goes back to nothing when the part stops resolving', async () => {
    state.transform = local()
    const harness = await follow(followedPlayer(state))
    await act(async () => stepFrame(16))

    state.transform = null
    await act(async () => stepFrame(16))

    expect(harness.result.current.value.valid).toBe(false)
  })

  // Non-blocking, and once: the check reads the `.ssab` across JSI, so it runs
  // on the first frame the part resolves and never again.
  it('warns once that a skinned mesh will not track its art', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    state.transform = local()
    state.skinned = true
    const harness = await follow(followedPlayer(state))

    await act(async () => {
      stepFrame(16)
      stepFrame(16)
    })

    expect(warn).toHaveBeenCalledOnce()
    expect(warn.mock.calls[0]?.[0]).toMatch(/skinned \(bone-bound\) mesh part/)
    // Still published — the sibling Players mark the target rather than refuse it.
    expect(harness.result.current.value.valid).toBe(true)
  })

  it('stops sampling when the player goes away', async () => {
    const harness = await follow(followedPlayer(state))
    expect(pendingFrames()).toBe(1)

    await harness.rerender({ player: null })

    expect(pendingFrames()).toBe(0)
    expect(harness.result.current.value.valid).toBe(false)
  })
})
