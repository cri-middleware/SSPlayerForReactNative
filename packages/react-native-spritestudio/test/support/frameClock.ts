/**
 * A hand-cranked `requestAnimationFrame`, because everything that draws here is
 * clocked by one.
 *
 * `performance.now()` comes with it: `<SpriteStudioView>`, `<SpriteStudioScene>`
 * and `startClock` all compute their delta from it, so a real clock would make
 * every `advance(dt)` assertion a race. Installed fresh before each test.
 */
let now = 0
let nextId = 1
const pending = new Map<number, FrameRequestCallback>()

export function installFrameClock(): void {
  now = 0
  nextId = 1
  pending.clear()
  globalThis.requestAnimationFrame = (callback: FrameRequestCallback): number => {
    const id = nextId++
    pending.set(id, callback)
    return id
  }
  globalThis.cancelAnimationFrame = ((handle: number | null | undefined): void => {
    if (handle != null) pending.delete(handle)
  }) as typeof cancelAnimationFrame
  performance.now = (): number => now
}

/**
 * Runs the frames queued right now, `ms` later.
 *
 * A callback that re-queues itself — which every loop here does — lands in the
 * *next* step rather than spinning inside this one.
 */
export function stepFrame(ms = 16): void {
  now += ms
  const due = [...pending.values()]
  pending.clear()
  for (const callback of due) callback(now)
}

/** Zero means nothing is clocking — what a cancelled loop looks like. */
export function pendingFrames(): number {
  return pending.size
}
