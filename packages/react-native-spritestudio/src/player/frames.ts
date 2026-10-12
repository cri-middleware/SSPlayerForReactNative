/**
 * The frames a player shows, for the part followers inside this package.
 *
 * A frame is shown right after `SpriteStudioPlayer.draw`, or after each step of
 * `startClock` for a player nothing draws. A view draws only when something
 * changed, so a follower that waits for this reads once per new frame, on the
 * loop that is already running, and not at all while the player stands still.
 *
 * Kept off `SpriteStudioPlayer` on purpose: a per-frame callback for apps is a
 * deliberate non-goal (ROADMAP), and this exists only so `useSsPartTransform`
 * need not run a loop of its own.
 */
const listeners = new WeakMap<object, Set<() => void>>()

/** Runs `listener` after each frame `player` shows. Returns the unsubscribe. */
export function onFrameShown(player: object, listener: () => void): () => void {
  let set = listeners.get(player)
  if (set == null) {
    set = new Set()
    listeners.set(player, set)
  }
  set.add(listener)
  return () => {
    set.delete(listener)
  }
}

/** Called by the player once it has shown a frame. */
export function frameShown(player: object): void {
  const set = listeners.get(player)
  if (set == null) return
  for (const listener of set) listener()
}
