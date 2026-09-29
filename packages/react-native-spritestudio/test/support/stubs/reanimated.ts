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
