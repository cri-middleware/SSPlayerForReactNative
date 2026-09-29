import type { ComponentType } from 'react'

/**
 * Stands in for `react-native` under vitest. Only what `view/` reaches.
 *
 * `View` is a **host** element rather than a function component, so a test can
 * find one in the rendered tree by name (`root.findAllByType('View')`) — which
 * is how the placeholder is asserted on.
 */
export const View = 'View' as unknown as ComponentType<Record<string, unknown>>

export const StyleSheet = {
  absoluteFill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  create: <T>(styles: T): T => styles,
  flatten: (style: unknown): Record<string, unknown> | undefined => {
    if (style == null || style === false) return undefined
    if (!Array.isArray(style)) return style as Record<string, unknown>
    return Object.assign({}, ...style.map((entry) => StyleSheet.flatten(entry) ?? {}))
  },
}

/** `useSsTextures` is the only caller: a `require()` id becomes a URI. */
export const Image = {
  resolveAssetSource: (id: number): { uri: string } | null => ({
    uri: `https://localhost:8081/assets/${id}.png`,
  }),
}
