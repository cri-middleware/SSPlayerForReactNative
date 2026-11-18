import { useRef, type ComponentType } from 'react'

/** A host element, so a test finds it by name, as with the `react-native` stub. */
const AnimatedView = 'Animated.View' as unknown as ComponentType<Record<string, unknown>>
export default { View: AnimatedView }

/** Evaluated in render: there is no UI thread here to run it on. */
export function useAnimatedStyle<T>(worklet: () => T): T {
  return worklet()
}

/**
 * The shared value: a stable mutable box, not a React state cell.
 *
 * An accessor rather than a plain field, like the real one — and it counts its
 * writes, because "only write when it changes" is a claim `useSsPartTransform`
 * makes about a value that crosses to the UI thread sixty times a second.
 */
export interface SharedValue<T> {
  value: T
  readonly writes: number
}

export function useSharedValue<T>(initial: T): SharedValue<T> {
  return useRef(makeShared(initial)).current
}

function makeShared<T>(initial: T): SharedValue<T> {
  let current = initial
  let writes = 0
  return {
    get value() {
      return current
    },
    set value(next: T) {
      current = next
      writes += 1
    },
    get writes() {
      return writes
    },
  }
}

/**
 * A reaction runs on the UI thread when what `prepare` returns changes. There
 * is no UI thread here, so a test runs them with {@link flushReactions}.
 */
const reactions: Array<{
  prepare: () => unknown
  react: (current: unknown, previous: unknown) => void
  last: unknown
}> = []

export function useAnimatedReaction<T>(
  prepare: () => T,
  react: (current: T, previous: T | null) => void
): void {
  const registered = useRef(false)
  if (!registered.current) {
    registered.current = true
    reactions.push({
      prepare,
      react: react as (current: unknown, previous: unknown) => void,
      last: null,
    })
  }
}

/** Runs every reaction whose prepared value changed since it last ran. */
export function flushReactions(): void {
  for (const reaction of reactions) {
    const current = reaction.prepare()
    if (current === reaction.last) continue
    reaction.react(current, reaction.last)
    reaction.last = current
  }
}

export function resetReactions(): void {
  reactions.length = 0
}

/** Calls straight through: the stub's reactions already run on the JS thread. */
export function runOnJS<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  return fn
}
