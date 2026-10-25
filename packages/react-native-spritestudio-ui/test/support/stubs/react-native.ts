import type { ComponentType } from 'react'

export const View = 'View' as unknown as ComponentType<Record<string, unknown>>
export const Pressable = 'Pressable' as unknown as ComponentType<Record<string, unknown>>

export const StyleSheet = {
  absoluteFill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
}

type Listener = (enabled: boolean) => void

export const reduceMotion = {
  enabled: false,
  listeners: new Set<Listener>(),
  set(enabled: boolean): void {
    this.enabled = enabled
    for (const listener of this.listeners) listener(enabled)
  },
  reset(): void {
    this.enabled = false
    this.listeners.clear()
  },
}

export const AccessibilityInfo = {
  isReduceMotionEnabled: (): Promise<boolean> => Promise.resolve(reduceMotion.enabled),
  addEventListener(_event: 'reduceMotionChanged', listener: Listener): { remove(): void } {
    reduceMotion.listeners.add(listener)
    return { remove: () => void reduceMotion.listeners.delete(listener) }
  },
}
