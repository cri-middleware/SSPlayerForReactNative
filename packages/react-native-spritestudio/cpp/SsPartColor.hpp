#pragma once

// PartColor (`parts_color` §1): the **shader-side** blend, on a different axis
// from `SsBlend.hpp`'s framebuffer one. Four modes only — anything else clamps
// to Mix (§1-1).
//
// Skia-free, like the rest of `SsBaker`'s inputs, so the host harness links it.

#include <cstdint>

#include "format/framedata.h"

namespace sscore {

/// One corner's sample: straight-alpha rgba in 0..1 plus the composite strength
/// `rate`.
///
/// `a` already carries the part's hierarchical alpha, **pre-folded by the
/// Brain** — never re-multiply `PartState.alpha` on this path (§1-3).
struct SsPartColorCorner {
  float r = 1.0f;
  float g = 1.0f;
  float b = 1.0f;
  float a = 1.0f;
  float rate = 0.0f;
};

/// A part's resolved PartColor: §1-4's coefficient row plus the four corners.
struct SsPartColor {
  /// `(fSrc, fDst, mulFlag, _)`.
  float coef[4] = {-1.0f, 1.0f, 0.0f, 0.0f};
  SsPartColorCorner lt, rt, lb, rb;

  /// Whether the formula changes RGB at all. Every `rate == 0` collapses it to
  /// the texel passing straight through (§1-2-4), which the vertex-colour path
  /// reproduces exactly — so only a true tint needs peeling out for the shader.
  bool tintsRgb() const {
    return lt.rate != 0.0f || rt.rate != 0.0f || lb.rate != 0.0f || rb.rate != 0.0f;
  }
};

/// §1-4's `_PartColorCoef` table. `blend_type` is the full 12-value `BlendType`,
/// but only its first four entries name PartColor modes, so anything at or above
/// 4 is clamped to Mix (§1-1).
inline const float* SsPartColorCoef(int32_t blendType) {
  static const float kCoef[4][4] = {
      {-1.0f, 1.0f, 0.0f, 0.0f},  // Mix
      {-1.0f, 1.0f, 1.0f, 0.0f},  // Mul — .z=1 makes the pixel the coefficient
      {0.0f, 1.0f, 0.0f, 0.0f},   // Add
      {0.0f, -1.0f, 0.0f, 0.0f},  // Sub
  };
  const int32_t i = (blendType >= 0 && blendType < 4) ? blendType : 0;
  return kCoef[i];
}

/// The affine that takes a quad's UV back to unit-square `(s,t)`:
/// `(s,t) = m . (uv - origin)`.
///
/// A sprite quad's UV corners are an affine image of the unit square exactly as
/// its positions are, so this inverse is exact — which is what lets the PartColor
/// shader reconstruct the corner gradient from the texcoord alone, with no
/// dependence on the canvas matrix. Skia-free so the host harness can check the
/// round-trip; `SsPartColorShader.hpp` only feeds the result to a uniform.
struct SsUvInverse {
  float origin[2] = {0.0f, 0.0f};
  float m[4] = {0.0f, 0.0f, 0.0f, 0.0f};  // [m00, m01, m10, m11]
};

/// Builds the inverse for a quad's `uv` (8 floats: lt, rt, lb, rb).
///
/// False for a zero-area UV quad — a degenerate cell, where there is no gradient
/// to reconstruct. `out` is then the collapse-to-`lt` answer (a zero matrix),
/// which is defined rather than a division by zero.
inline bool SsMakeUvInverse(const float* uv, SsUvInverse* out) {
  if (uv == nullptr || out == nullptr) return false;
  *out = SsUvInverse{};
  out->origin[0] = uv[0];
  out->origin[1] = uv[1];

  const float e1x = uv[2] - uv[0], e1y = uv[3] - uv[1];  // lt -> rt, the s axis
  const float e2x = uv[4] - uv[0], e2y = uv[5] - uv[1];  // lt -> lb, the t axis
  const float det = e1x * e2y - e2x * e1y;
  if (det == 0.0f) return false;

  const float inv = 1.0f / det;
  out->m[0] = e2y * inv;
  out->m[1] = -e2x * inv;
  out->m[2] = -e1y * inv;
  out->m[3] = e1x * inv;
  return true;
}

inline SsPartColorCorner SsReadPartColorCorner(
    const ss::runtime::SsAttributePartColorKeyValueColor& c) {
  const ss::runtime::U8Color& u = c.rgba();
  return SsPartColorCorner{u.r() / 255.0f, u.g() / 255.0f, u.b() / 255.0f, u.a() / 255.0f,
                           c.rate()};
}

/// Resolves `part`'s PartColor out of the frame, or returns false when it has
/// none (`part_color < 0` — §1-2, the sibling ports' `hasPc` test).
inline bool SsReadPartColor(const ss::runtime::FrameData* fd, const ss::runtime::PartState* part,
                            SsPartColor* out) {
  if (fd == nullptr || part == nullptr || out == nullptr) return false;
  const int idx = part->part_color();
  if (idx < 0) return false;
  const auto* all = fd->parts_color();
  if (all == nullptr || static_cast<uint32_t>(idx) >= all->size()) return false;

  const ss::runtime::PartAttributePartColor* pc = all->Get(static_cast<uint32_t>(idx));
  const float* coef = SsPartColorCoef(static_cast<int32_t>(pc->blend_type()));
  for (int i = 0; i < 4; ++i) out->coef[i] = coef[i];
  out->lt = SsReadPartColorCorner(pc->lt());
  out->rt = SsReadPartColorCorner(pc->rt());
  out->lb = SsReadPartColorCorner(pc->lb());
  out->rb = SsReadPartColorCorner(pc->rb());
  return true;
}

}  // namespace sscore
