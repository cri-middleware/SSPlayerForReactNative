import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native'

import type { SsBox } from '../specs/SsRuntime.nitro'

/**
 * The size a view takes from `box` where the caller's style leaves it open —
 * `<Image>`'s rule for a bundled image, which lays out at its own size.
 *
 * An axis is open when nothing in the style sizes it. With both open the view
 * is the box, one unit to a point; with one open the box's aspect ratio
 * fills in the other. A `flex` or an explicit `alignSelf: 'stretch'` sizes an
 * axis the style cannot say which of, so either leaves the style alone: an
 * aspect ratio under `flex: 1` wins over the stretch and pushes the view past
 * its parent.
 */
export function intrinsicSize(
  style: StyleProp<ViewStyle>,
  box: SsBox | null
): ViewStyle | null {
  if (box == null || box.width <= 0 || box.height <= 0) return null
  const s: ViewStyle = StyleSheet.flatten(style) ?? {}
  if (
    (s.flex ?? 0) > 0 ||
    (s.flexGrow ?? 0) > 0 ||
    s.flexBasis != null ||
    s.alignSelf === 'stretch'
  ) {
    return null
  }

  // An absolutely positioned view is sized by two opposite insets.
  const absolute = s.position === 'absolute'
  const inset = absolute ? s.inset : undefined
  const across = (low: unknown, high: unknown): boolean =>
    absolute && (inset != null || (low != null && high != null))
  const widthSet =
    s.width != null ||
    across(s.left ?? s.start ?? s.insetInlineStart ?? s.insetInline,
      s.right ?? s.end ?? s.insetInlineEnd ?? s.insetInline)
  const heightSet =
    s.height != null ||
    across(s.top ?? s.insetBlockStart ?? s.insetBlock,
      s.bottom ?? s.insetBlockEnd ?? s.insetBlock)

  if (widthSet && heightSet) return null
  const aspectRatio = box.width / box.height
  if (widthSet || heightSet) return s.aspectRatio != null ? null : { aspectRatio }
  if (s.aspectRatio != null) return { width: box.width }
  return { width: box.width, height: box.height }
}
