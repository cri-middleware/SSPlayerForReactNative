import { Skia } from '@shopify/react-native-skia'

/**
 * A colour as the C-API's packed `0xRRGGBBAA`.
 *
 * `Skia.Color` hands back a float RGBA in 0..1, so the rounding happens here —
 * and `>>> 0` at the end because a value with the top bit set is otherwise a
 * negative int32, which the Nitro boundary would carry across as a negative
 * double and the C++ `static_cast<uint32_t>` would then not recover.
 *
 * Its own file, apart from the rest of the override vocabulary, because it is
 * the only part of it that touches Skia — and `parts.ts` has to stay importable
 * where Skia is not. `index.web.ts` re-exports the enums and types from there
 * verbatim; this is what it stubs.
 */
export function ssPackColor(color: string | number): number {
  if (typeof color === 'number') return color >>> 0
  // Indexed rather than destructured: `Skia.Color` is typed as a `Float32Array`,
  // whose elements TypeScript widens to `number | undefined` under
  // `noUncheckedIndexedAccess`. A colour Skia parsed always has four.
  const rgba = Skia.Color(color)
  const to8 = (v: number | undefined): number =>
    Math.max(0, Math.min(255, Math.round((v ?? 0) * 255)))
  return (
    ((to8(rgba[0]) << 24) |
      (to8(rgba[1]) << 16) |
      (to8(rgba[2]) << 8) |
      to8(rgba[3])) >>>
    0
  )
}
