#pragma once

/// Framebuffer blend mapping: which `SkBlendMode` (or sequence of them) realises
/// a SpriteStudio `BlendType`.
///
/// **Included only from `SsSkiaDraw.cpp`, inside its `SSPLAYER_ENABLE_SKIA_DIRECT`
/// guard** — this header names Skia types directly, which is the one thing
/// `SsSkiaDraw.hpp` exists to keep out of its consumers.
///
/// ## Where this comes from
///
/// Every SS blend is a fixed-function GL blend
/// state `out = Cs·srcFactor + Cb·dstFactor` (RGB) with a premultiplied source
/// and a premultiplied-coverage alpha channel `[ONE, 1-SRC_ALPHA]`:
///
///   | SS BlendType    | srcRGB          | dstRGB          | rgbEq            |
///   |-----------------|-----------------|-----------------|------------------|
///   | Mix             | ONE             | 1-SRC_ALPHA     | ADD              |
///   | Mul / Mulalpha  | DST_COLOR       | 1-SRC_ALPHA     | ADD              |
///   | Add             | ONE             | ONE             | ADD              |
///   | Sub             | ONE             | ONE             | REVERSE_SUBTRACT |
///   | Screen          | 1-DST_COLOR     | ONE             | ADD              |
///   | Exclusion       | 1-DST_COLOR     | 1-SRC_COLOR     | ADD              |
///   | Invert          | 1-DST_COLOR     | ZERO            | ADD              |
///
/// **Only RGB varies — alpha is premultiplied source-over for every mode.**
///
/// Skia's separable blend modes are defined on **premultiplied** colours, so read
/// against a premultiplied `Cs` most rows have an exact stock equivalent:
///
///   * Mix       → `kSrcOver`   (`Cs + Cb·(1-αs)`)
///   * Add       → `kPlus`      (`Cs + Cb`, both clamp)
///   * Mul/α/2   → `kMultiply`  (`Cs·Cb + Cb·(1-αs)`)
///   * Screen/2  → `kScreen`    (`Cs + Cb - Cs·Cb`)
///   * Exclusion → `kExclusion` (`Cs + Cb - 2·Cs·Cb`)
///
/// Screen and Exclusion are exact for *any* backdrop alpha — their `αs`/`αb`
/// terms cancel identically. `kMultiply` keeps one extra term, `Cs·(1-αb)`, so
/// Mul is exact wherever the backdrop is **opaque** (which is what SS itself
/// assumes — it renders onto an opaque target) and diverges over transparency.
/// `kModulate` would be the literal `DST_COLOR, ZERO` row and would fix that
/// corner, at the cost of blacking out every semi-transparent texel of every Mul
/// part; `kMultiply` stays.
///
/// Div2 and Overlay2 have no GL mapping either, so they draw as Mix.
///
/// Sub and Invert have no single stock equivalent — Skia offers neither a
/// reverse-subtract nor a "replace dst with `Cs·(1-Cb)`" — and are reconstructed
/// from three passes instead; see `BlendPlanFor`.
///
/// Note this is the **framebuffer** blend. PartColor's 4-mode blend is a
/// shader-side concern with its own coefficient table and is unrelated.
///
/// These reach the framebuffer through `SkPaint::setBlendMode`, **not** through
/// `drawVertices`'s `SkBlendMode` argument — that one blends against vertex
/// colours and Skia ignores it when there are none, which renders every type as
/// Mix.

#include <cstdint>

#include "include/core/SkBlendMode.h"
#include "include/core/SkColorFilter.h"
#include "include/core/SkRefCnt.h"

#include "format/framedata.h"

namespace ssplayer {

/// The single stock blend mode for `blendType`.
///
/// For Sub and Invert this returns the honest one-pass *approximation*
/// (`kDifference`, exact only in the narrow regime each mode is authored for).
/// `SsSkiaDraw` uses `BlendPlanFor` where it can, which is exact; this is for a
/// part that cannot run a multi-pass plan: a masked part, and a Mesh routed
/// through the clip shader.
inline SkBlendMode BlendModeFor(int32_t blendType) {
  switch (static_cast<ss::runtime::BlendType>(blendType)) {
    case ss::runtime::BlendType_Add:
      return SkBlendMode::kPlus;
    case ss::runtime::BlendType_Mul:
    case ss::runtime::BlendType_Mulalpha:
    case ss::runtime::BlendType_Mul2:
      return SkBlendMode::kMultiply;
    case ss::runtime::BlendType_Screen:
    case ss::runtime::BlendType_Screen2:
      return SkBlendMode::kScreen;
    case ss::runtime::BlendType_Exclusion:
      return SkBlendMode::kExclusion;
    case ss::runtime::BlendType_Sub:
    case ss::runtime::BlendType_Invert:
      return SkBlendMode::kDifference;
    case ss::runtime::BlendType_Mix:
    case ss::runtime::BlendType_Div2:     // no GL mapping upstream → Mix
    case ss::runtime::BlendType_Overlay2: // no GL mapping upstream → Mix
      break;
  }
  // Also the fallback for a value outside the enum, which is a Brain the build
  // does not understand — draw it plainly rather than not at all.
  return SkBlendMode::kSrcOver;
}

/// What one pass of a `BlendPlan` puts through its blend mode.
enum class BlendPassSource {
  /// The part itself — the ordinary textured draw.
  kPart,
  /// The part's **coverage only**: opaque white wherever the part puts any alpha
  /// at all, nothing where it puts none.
  kCoverage,
  /// Opaque black over the whole geometry.
  kBlack,
};

struct BlendPass {
  SkBlendMode mode;
  BlendPassSource source;
};

/// Up to three passes over one part's geometry, in order.
struct BlendPlan {
  BlendPass passes[3];
  int count;

  /// True when this plan must be run per part rather than per batch.
  bool multiPass() const { return count > 1; }
};

/// The pass plan that realises `blendType`.
///
/// Sub and Invert are exactly reconstructible from three stock passes, because a
/// `kDifference` against opaque white *is* a destination inversion (`|1-Cb| =
/// 1-Cb`) and inverting twice cancels:
///
///   * **Sub** = `max(0, Cb - Cs)`:
///     invert → `1-Cb`; `kPlus` the part → `clamp(1-Cb+Cs)`; invert again →
///     `1 - clamp(1-Cb+Cs)` = `max(0, Cb-Cs)`. The clamp in pass 2 is what
///     reproduces SS's clamp-to-black, and where the part contributes nothing
///     the two inversions cancel to a no-op.
///   * **Invert** = `Cs·(1-Cb)` with the destination *replaced*:
///     invert → `1-Cb`; `kModulate` the part → `Cs·(1-Cb)`; `kDstOver` opaque
///     black restores the alpha `kModulate` multiplied down. The dst-replace
///     comes for free — `kModulate` zeroes the destination where the part's texel
///     is transparent, which is exactly what a ZERO dst factor does.
///
/// Both are pixel-exact over an **opaque** destination — the case SS assumes,
/// and already the caveat on Mul. Over transparency the RGB still matches but the
/// inversion passes force alpha to 1 across the part's covered area (source-over
/// is the only alpha composite a stock blend mode has), so a part hanging off the
/// animation's opaque content reads as an opaque silhouette rather than a
/// translucent one.
///
/// Two constraints the caller must honour, both load-bearing:
///
///  1. **One part per plan.** The inversion passes must cover each pixel exactly
///     once, so a batch's parts cannot be run through a plan together — two
///     overlapping Sub parts would invert their overlap twice and cancel it.
///  2. **The same geometry every pass.** Build the quad once and draw that same
///     quad once per pass; a different tessellation between passes would leave
///     the inversion un-cancelled at the seams.
inline BlendPlan BlendPlanFor(int32_t blendType) {
  switch (static_cast<ss::runtime::BlendType>(blendType)) {
    case ss::runtime::BlendType_Sub:
      return BlendPlan{{{SkBlendMode::kDifference, BlendPassSource::kCoverage},
                        {SkBlendMode::kPlus, BlendPassSource::kPart},
                        {SkBlendMode::kDifference, BlendPassSource::kCoverage}},
                       3};
    case ss::runtime::BlendType_Invert:
      return BlendPlan{{{SkBlendMode::kDifference, BlendPassSource::kCoverage},
                        {SkBlendMode::kModulate, BlendPassSource::kPart},
                        {SkBlendMode::kDstOver, BlendPassSource::kBlack}},
                       3};
    default:
      return BlendPlan{{{BlendModeFor(blendType), BlendPassSource::kPart}}, 1};
  }
}

/// `rgb = white`, `α = saturate(255·α)` — see `BlendPassSource::kCoverage`.
///
/// The 255 coefficient on alpha saturates any non-zero alpha to 1, which is what
/// makes this "did the part cover this pixel" rather than "how opaque was it".
/// Skia's translation column is normalised 0..1, not 0..255.
///
/// Built once, as `PartColorEffect()` builds its program once and for the same
/// reasons: the matrix is a constant, so a filter per call would be one Skia
/// allocation per pass per part per frame — and Sub and Invert are three-pass
/// plans, two of whose passes come through here, on the path whose whole point
/// is not allocating. The raw pointer is leaked deliberately: it lives for the
/// process, and a function-local static `sk_sp` would destruct at exit, after
/// Skia may already be gone.
inline sk_sp<SkColorFilter> CoverageFilter() {
  static SkColorFilter* filter = [] {
    static const float kMatrix[20] = {
        0, 0, 0, 0,   1,  //
        0, 0, 0, 0,   1,  //
        0, 0, 0, 0,   1,  //
        0, 0, 0, 255, 0,  //
    };
    return SkColorFilters::Matrix(kMatrix).release();
  }();
  return sk_ref_sp(filter);
}

/// `rgba = opaque black` — see `BlendPassSource::kBlack`. Cached like the one
/// above.
inline sk_sp<SkColorFilter> BlackFilter() {
  static SkColorFilter* filter = [] {
    static const float kMatrix[20] = {
        0, 0, 0, 0, 0,  //
        0, 0, 0, 0, 0,  //
        0, 0, 0, 0, 0,  //
        0, 0, 0, 0, 1,  //
    };
    return SkColorFilters::Matrix(kMatrix).release();
  }();
  return sk_ref_sp(filter);
}

}  // namespace ssplayer
