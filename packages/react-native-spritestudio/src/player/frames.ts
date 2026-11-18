/**
 * The frames a player shows, for the part followers inside this package, and
 * the changes that call for a new one, for the view that draws it.
 *
 * A frame is shown right after `SpriteStudioPlayer.draw`, or after each step of
 * `startClock` for a player nothing draws. A view draws only when something
 * changed, so a follower that waits for this reads once per new frame, on the
 * loop that is already running, and not at all while the player stands still.
 *
 * Kept off `SpriteStudioPlayer` on purpose: a per-frame callback for apps is a
 * deliberate non-goal (ROADMAP), and this exists only so `useSsPartTransform`
 * need not run a loop of its own, and so a view's loop can stop while its
 * player does not advance.
 */
function channel(): {
  on(player: object, listener: () => void): () => void
  emit(player: object): void
} {
  const listeners = new WeakMap<object, Set<() => void>>()
  return {
    on(player, listener) {
      let set = listeners.get(player)
      if (set == null) {
        set = new Set()
        listeners.set(player, set)
      }
      set.add(listener)
      return () => {
        set.delete(listener)
      }
    },
    emit(player) {
      const set = listeners.get(player)
      if (set == null) return
      for (const listener of set) listener()
    },
  }
}

const shown = channel()
const changed = channel()

/** Runs `listener` after each frame `player` shows. Returns the unsubscribe. */
export const onFrameShown = shown.on

/** Called by the player once it has shown a frame. */
export const frameShown = shown.emit

export const onFrameChanged = changed.on

/**
 * Called by the player when what it would draw, or whether it advances, may
 * have changed. A change that skips it is not drawn by a view whose player
 * does not advance until something else wakes it.
 */
export const frameChanged = changed.emit
