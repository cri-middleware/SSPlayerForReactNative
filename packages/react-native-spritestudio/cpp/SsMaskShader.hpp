#pragma once

/// The two SkSL halves of masking: writing the coverage bitmap, and replaying it
/// at the masked target (`40_components/40_mask.md` §3-2).
///
/// **Included only from `SsSkiaDraw.cpp`, inside its `SSPLAYER_ENABLE_SKIA_DIRECT`
/// guard** — the same rule as `SsBlend.hpp` and `SsPartColorShader.hpp`.
/// `SsMask.hpp` holds the Skia-free arithmetic these two are handed.
///
/// Both reconstruct the quad's `(s,t)` from the **UV**, the way
/// `SsPartColorShader.hpp` does: `drawVertices` evaluates the paint's shader at
/// the interpolated texcoord, so the canvas matrix drops out and no
/// fragment-space inverse has to be computed. SSPlayerForFlutter's
/// `mask_write.frag` has no texcoord to lean on and pays for a world-space
/// inverse per writer; that whole uniform disappears here.
///
/// ### Why the replay does bit arithmetic rather than bit operations
///
/// Runtime effects are ES2-restricted (`SkRuntimeEffect::Options::allowPrivate…`
/// lifts it, and Skia's own header warns the software renderer will still fail),
/// so there are no bitwise operators and no dynamic vector indexing. The
/// 24-bit sets therefore come apart with `floor`/`mod`, one plane at a time
/// with constant swizzles, in a loop with a constant bound.
///
/// ### Why the bits live in ALPHA
///
/// They used to live in the RGB channels, 8 bits each, and that is a colour, so
/// Skia colour-manages it. The coverage image is tagged sRGB — it has to be,
/// because `drawInto` runs on a recording canvas that has no colour space to
/// match and `DeferredFromPicture` rejects a null one — while RN Skia's Apple
/// surface is **Display P3** whenever the screen's gamut is. The gamut matrix
/// then scales each channel by ~0.82/0.97/0.91 and bleeds them into each other,
/// so a bit pattern arrives as a different bit pattern: on `Mask.ssab` six of
/// the nine writers decoded as the wrong writer, which is the iOS-only mask
/// divergence this repo chased for a phase. Android never showed it because its
/// GL surface is unmanaged, and neither did the host check, which handed the
/// coverage and the destination the *same* colour space and so made every
/// conversion the identity by construction.
///
/// Alpha is not a colour: `SkColorSpaceXformSteps` transforms RGB and passes
/// alpha through untouched, so an 8-bit alpha plane survives any destination
/// exactly (measured: all 256 values round-trip through sRGB -> Display P3).
/// One plane is 8 writers, so the coverage image carries up to
/// `kSsMaskPlaneCount` of them **stacked vertically** — plane `p` occupies rows
/// `[p * height, (p+1) * height)` — and only as many as the frame needs are
/// built. That keeps it one image, one child shader and one deferred picture,
/// where the three A8 images this was first sketched as would have been three
/// of each.

#include <cstdio>

#include "include/core/SkImage.h"
#include "include/core/SkSamplingOptions.h"
#include "include/core/SkShader.h"
#include "include/core/SkString.h"
#include "include/core/SkTileMode.h"
#include "include/effects/SkRuntimeEffect.h"

#include "SsMask.hpp"
#include "SsPartColor.hpp"

namespace ssplayer {

/// One writer's contribution to the coverage bitmap.
///
/// `uBit.x` is the writer's bit as an 8-bit alpha within its own plane, and
/// `uBit.y` is §2-5's cutout threshold (negative = no cutout). The quad goes in
/// with `SkBlendMode::kPlus` so the disjoint per-writer bits OR together
/// losslessly. RGB stays 0, which keeps the returned colour a valid
/// premultiplied one whatever the bit is.
inline const char* kSsMaskWriteSkSL = R"SKSL(
uniform shader atlas;
uniform float2 uBit;

half4 main(float2 coord) {
    // §2-5: only texels above the threshold contribute. threshold == 0 writes
    // every non-transparent texel; a negative one is the textureless case, where
    // the geometry itself is the mask.
    if (uBit.y >= 0.0 && float(atlas.eval(coord).a) <= uBit.y) {
        return half4(0.0);
    }
    return half4(0.0, 0.0, 0.0, half(uBit.x));
}
)SKSL";

/// The masked target's test, wrapping whatever shader it would otherwise draw
/// with (the atlas, or the PartColor tint over it).
///
/// Scope is already resolved on the CPU, so `uInc` / `uInv` are just this
/// target's two writer sets — 24 bits each, as three byte-valued floats.
inline const char* kSsMaskReplaySkSL = R"SKSL(
uniform shader inner;
uniform shader coverage;

uniform float2 uPlaneSize;     // ONE coverage plane's size, pixels
uniform float2 uUvOrigin;      // the quad's lt corner UV, texture pixels
uniform float4 uUvInv;         // 2x2 inverse [m00,m01,m10,m11]: uv-origin -> (s,t)
uniform float4 uCovA;          // coverage uv at (lt, rt)
uniform float4 uCovB;          // coverage uv at (lb, rb)
uniform float3 uInc;           // increment-plane writer set, 3 bytes
uniform float3 uInv;           // invert-plane writer set, 3 bytes
uniform float  uVisibleInside; // §2-4 polarity: 1 = draw inside the mask

// Plane `plane`'s byte at the coverage uv `cuv`. The planes are stacked
// vertically in the one image, so the band offset is a whole plane height.
float ss_byte(float2 cuv, float plane) {
    half4 cov = coverage.eval(float2(cuv.x, cuv.y + plane) * uPlaneSize);
    // Rounded back to a whole byte before anything reads a bit out of it: the
    // sample arrives as n/255 through a half, and flooring the raw product
    // would lose the top bit at the boundary.
    return floor(float(cov.a) * 255.0 + 0.5);
}

// (any increment bit set, invert bits set) contributed by one coverage plane.
float2 ss_plane(float byte, float mInc, float mInv) {
    float anyI = 0.0;
    float par = 0.0;
    float p = 1.0;
    for (int k = 0; k < 8; k++) {
        float b  = floor(mod(byte / p, 2.0));
        float mi = floor(mod(mInc / p, 2.0));
        float mv = floor(mod(mInv / p, 2.0));
        anyI += b * mi;
        par  += b * mv;
        p *= 2.0;
    }
    return float2(anyI, par);
}

half4 main(float2 coord) {
    half4 src = inner.eval(coord);

    float2 d = coord - uUvOrigin;
    float s = clamp(uUvInv.x * d.x + uUvInv.y * d.y, 0.0, 1.0);
    float t = clamp(uUvInv.z * d.x + uUvInv.w * d.y, 0.0, 1.0);
    // The coverage UV of each corner is computed on the CPU, so this one
    // bilinear step covers the whole local -> coverage map: the quad's own
    // deformation, the player-local box, and the bitmap normalisation together.
    float2 cuv = mix(mix(uCovA.xy, uCovA.zw, s), mix(uCovB.xy, uCovB.zw, s), t);

    bool masked = false;
    // §3-3: outside the box counts as "no writer". Without this, sampling at the
    // edge would let a writer's coverage bleed across the rest of the scene.
    //
    // The upper bound is **exclusive**, and with stacked planes that is
    // load-bearing rather than pedantic: `cuv.y == 1.0` lands on row 0 of the
    // *next* plane, so a sample at the box's far edge would decode as some
    // other writer's bits. Skia's kDecal used to absorb exactly that case, back
    // when one plane filled the whole image and there was nothing below it.
    if (cuv.x >= 0.0 && cuv.x < 1.0 && cuv.y >= 0.0 && cuv.y < 1.0) {
        // Each plane is read only when this target has a writer in it — both
        // uniforms, so the branch is coherent across the whole draw and a pack
        // with 8 writers or fewer samples the coverage exactly once.
        float2 acc = float2(0.0);
        if (uInc.x != 0.0 || uInv.x != 0.0) acc += ss_plane(ss_byte(cuv, 0.0), uInc.x, uInv.x);
        if (uInc.y != 0.0 || uInv.y != 0.0) acc += ss_plane(ss_byte(cuv, 1.0), uInc.y, uInv.y);
        if (uInc.z != 0.0 || uInv.z != 0.0) acc += ss_plane(ss_byte(cuv, 2.0), uInc.z, uInv.z);
        // §3-1-4: the two planes stay apart to the very end — "any" on the
        // counter, odd/even on the invert side — and then union.
        masked = acc.x > 0.5 || mod(acc.y, 2.0) >= 0.5;
    }

    // §2-4: draw where `masked == visible_inside`. A runtime effect cannot
    // discard, and returning transparent is what a discard would have achieved
    // under every blend mode this path draws with.
    if (masked != (uVisibleInside > 0.5)) return half4(0.0);
    return src;
}
)SKSL";

/// Compiles `sksl` once, reporting a failure once. Null degrades to the
/// unmasked draw — a part that ignores its mask is a far better failure than a
/// missing one, and the log line says which it is.
inline SkRuntimeEffect* SsMaskEffect(const char* sksl, const char* what) {
  SkRuntimeEffect::Result result = SkRuntimeEffect::MakeForShader(SkString(sksl));
  if (result.effect == nullptr) {
    std::fprintf(stderr, "[SsPlayer] %s SkSL failed to compile: %s\n", what,
                 result.errorText.c_str());
    return nullptr;
  }
  // Leaked deliberately, as in SsPartColorShader.hpp: it lives for the process,
  // and a function-local static sk_sp would run its destructor after Skia may
  // already be gone.
  return result.effect.release();
}

inline SkRuntimeEffect* SsMaskWriteEffect() {
  static SkRuntimeEffect* effect = SsMaskEffect(kSsMaskWriteSkSL, "mask coverage");
  return effect;
}

inline SkRuntimeEffect* SsMaskReplayEffect() {
  static SkRuntimeEffect* effect = SsMaskEffect(kSsMaskReplaySkSL, "mask replay");
  return effect;
}

/// Which coverage plane `bit` lives in.
inline int SsMaskBitPlane(int32_t bit) { return static_cast<int>(bit) / 8; }

/// `bit`'s value inside its own plane, as a 0..1 alpha component.
inline float SsMaskBitAlpha(int32_t bit) {
  if (bit < 0 || bit >= sscore::kSsMaxMaskWriters) return 0.0f;
  return static_cast<float>(1 << (bit % 8)) / 255.0f;
}

/// The coverage bitmap, and how its planes sit inside it.
///
/// `width` / `height` are ONE plane's; the image is `planeCount` of them
/// stacked vertically. The replay is handed the plane size rather than the
/// image size for that reason — see the shader's `uPlaneSize`.
struct SsMaskCoverage {
  sk_sp<SkImage> image;
  int width = 0;
  int height = 0;
  int planeCount = 0;

  bool valid() const { return image != nullptr && width > 0 && height > 0 && planeCount > 0; }
};

/// The shader that writes `writer`'s bit, sampling `atlas` for the §2-5 cutout.
inline sk_sp<SkShader> MakeMaskWriteShader(const sscore::SsMaskWriter& writer,
                                           sk_sp<SkShader> atlas) {
  SkRuntimeEffect* effect = SsMaskWriteEffect();
  if (effect == nullptr || atlas == nullptr) return nullptr;

  SkRuntimeShaderBuilder builder(sk_ref_sp(effect));
  builder.child("atlas") = std::move(atlas);
  builder.uniform("uBit") = SkV2{SsMaskBitAlpha(writer.bit), writer.threshold};
  return builder.makeShader();
}

/// The shader that runs `bits`'s test over `inner`.
///
/// `uv` is the quad's four UV corners (8 floats: lt, rt, lb, rb, texture pixels)
/// and `covUv` its four coverage UVs in the same corner order.
inline sk_sp<SkShader> MakeMaskReplayShader(sk_sp<SkShader> inner, const SsMaskCoverage& coverage,
                                            const sscore::SsMaskBits& bits, const float* uv,
                                            const float* covUv) {
  SkRuntimeEffect* effect = SsMaskReplayEffect();
  if (effect == nullptr || inner == nullptr || !coverage.valid() || uv == nullptr ||
      covUv == nullptr) {
    return nullptr;
  }

  sscore::SsUvInverse inv;
  sscore::SsMakeUvInverse(uv, &inv);

  // Nearest is required, not a preference: with linear filtering adjacent bits
  // blend and decode as writers that never covered the pixel (§3-2 note) — and
  // with the planes stacked it would blend across a plane boundary too.
  // kDecal keeps a sample that escapes the bounds check transparent rather than
  // repeating the edge.
  sk_sp<SkShader> covShader = coverage.image->makeShader(
      SkTileMode::kDecal, SkTileMode::kDecal, SkSamplingOptions(SkFilterMode::kNearest));
  if (covShader == nullptr) return nullptr;

  const auto byteOf = [](uint32_t set, int index) {
    return static_cast<float>((set >> (index * 8)) & 0xffu);
  };

  SkRuntimeShaderBuilder builder(sk_ref_sp(effect));
  builder.child("inner") = std::move(inner);
  builder.child("coverage") = std::move(covShader);
  builder.uniform("uPlaneSize") =
      SkV2{static_cast<float>(coverage.width), static_cast<float>(coverage.height)};
  builder.uniform("uUvOrigin") = SkV2{inv.origin[0], inv.origin[1]};
  builder.uniform("uUvInv") = SkV4{inv.m[0], inv.m[1], inv.m[2], inv.m[3]};
  builder.uniform("uCovA") = SkV4{covUv[0], covUv[1], covUv[2], covUv[3]};
  builder.uniform("uCovB") = SkV4{covUv[4], covUv[5], covUv[6], covUv[7]};
  builder.uniform("uInc") =
      SkV3{byteOf(bits.increment, 0), byteOf(bits.increment, 1), byteOf(bits.increment, 2)};
  builder.uniform("uInv") =
      SkV3{byteOf(bits.invert, 0), byteOf(bits.invert, 1), byteOf(bits.invert, 2)};
  builder.uniform("uVisibleInside") = bits.visibleInside ? 1.0f : 0.0f;
  return builder.makeShader();
}

}  // namespace ssplayer
