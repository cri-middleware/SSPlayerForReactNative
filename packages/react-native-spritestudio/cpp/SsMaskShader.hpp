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
/// 24-bit sets therefore come apart with `floor`/`mod`, one channel at a time
/// with constant swizzles, in a loop with a constant bound.

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
/// `uBit.rgb` is the writer's bit already placed in its owning channel, and
/// `uBit.a` is §2-5's cutout threshold (negative = no cutout). The quad goes in
/// with `SkBlendMode::kPlus` so the disjoint per-writer bits OR together
/// losslessly — which is also why the output alpha must be 1 rather than the
/// texel's: `kPlus` is premultiplied and would scale the bit away.
inline const char* kSsMaskWriteSkSL = R"SKSL(
uniform shader atlas;
uniform float4 uBit;

half4 main(float2 coord) {
    // §2-5: only texels above the threshold contribute. threshold == 0 writes
    // every non-transparent texel; a negative one is the textureless case, where
    // the geometry itself is the mask.
    if (uBit.a >= 0.0 && float(atlas.eval(coord).a) <= uBit.a) {
        return half4(0.0);
    }
    return half4(half3(uBit.rgb), 1.0);
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

uniform float2 uCovSize;       // coverage bitmap size, pixels
uniform float2 uUvOrigin;      // the quad's lt corner UV, texture pixels
uniform float4 uUvInv;         // 2x2 inverse [m00,m01,m10,m11]: uv-origin -> (s,t)
uniform float4 uCovA;          // coverage uv at (lt, rt)
uniform float4 uCovB;          // coverage uv at (lb, rb)
uniform float3 uInc;           // increment-plane writer set, 3 bytes
uniform float3 uInv;           // invert-plane writer set, 3 bytes
uniform float  uVisibleInside; // §2-4 polarity: 1 = draw inside the mask

// (any increment bit set, invert bits set) contributed by one coverage channel.
float2 ss_plane(float byte, float mInc, float mInv) {
    // Both uniforms, so this branch is coherent across the whole draw: a pack
    // with 8 writers or fewer never enters the loop for the other two channels.
    if (mInc == 0.0 && mInv == 0.0) return float2(0.0);
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
    if (cuv.x >= 0.0 && cuv.x <= 1.0 && cuv.y >= 0.0 && cuv.y <= 1.0) {
        half4 cov = coverage.eval(cuv * uCovSize);
        // Rounded back to whole bytes before anything reads a bit out of them:
        // the sample arrives as n/255 through a half, and flooring the raw
        // product would lose the top bit at the boundary.
        float3 bytes = floor(float3(cov.rgb) * 255.0 + 0.5);
        float2 acc = ss_plane(bytes.r, uInc.x, uInv.x)
                   + ss_plane(bytes.g, uInc.y, uInv.y)
                   + ss_plane(bytes.b, uInc.z, uInv.z);
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

/// The colour writer `bit` writes into the coverage bitmap: its own bit, in its
/// own channel, as a 0..1 component.
inline void SsMaskBitColor(int32_t bit, float* rgb) {
  rgb[0] = rgb[1] = rgb[2] = 0.0f;
  const int channel = bit / 8;
  if (channel < 0 || channel > 2) return;
  rgb[channel] = static_cast<float>(1 << (bit % 8)) / 255.0f;
}

/// The shader that writes `writer`'s bit, sampling `atlas` for the §2-5 cutout.
inline sk_sp<SkShader> MakeMaskWriteShader(const sscore::SsMaskWriter& writer,
                                           sk_sp<SkShader> atlas) {
  SkRuntimeEffect* effect = SsMaskWriteEffect();
  if (effect == nullptr || atlas == nullptr) return nullptr;

  float rgb[3];
  SsMaskBitColor(writer.bit, rgb);

  SkRuntimeShaderBuilder builder(sk_ref_sp(effect));
  builder.child("atlas") = std::move(atlas);
  builder.uniform("uBit") = SkV4{rgb[0], rgb[1], rgb[2], writer.threshold};
  return builder.makeShader();
}

/// The shader that runs `bits`'s test over `inner`.
///
/// `uv` is the quad's four UV corners (8 floats: lt, rt, lb, rb, texture pixels)
/// and `covUv` its four coverage UVs in the same corner order.
inline sk_sp<SkShader> MakeMaskReplayShader(sk_sp<SkShader> inner, sk_sp<SkImage> coverage,
                                            const sscore::SsMaskBits& bits, const float* uv,
                                            const float* covUv) {
  SkRuntimeEffect* effect = SsMaskReplayEffect();
  if (effect == nullptr || inner == nullptr || coverage == nullptr || uv == nullptr ||
      covUv == nullptr) {
    return nullptr;
  }

  sscore::SsUvInverse inv;
  sscore::SsMakeUvInverse(uv, &inv);

  // Nearest is required, not a preference: with linear filtering adjacent bits
  // blend and decode as writers that never covered the pixel (§3-2 note).
  // kDecal keeps a sample that escapes the bounds check transparent rather than
  // repeating the edge.
  sk_sp<SkShader> covShader = coverage->makeShader(
      SkTileMode::kDecal, SkTileMode::kDecal, SkSamplingOptions(SkFilterMode::kNearest));
  if (covShader == nullptr) return nullptr;

  const auto byteOf = [](uint32_t set, int index) {
    return static_cast<float>((set >> (index * 8)) & 0xffu);
  };

  SkRuntimeShaderBuilder builder(sk_ref_sp(effect));
  builder.child("inner") = std::move(inner);
  builder.child("coverage") = std::move(covShader);
  builder.uniform("uCovSize") =
      SkV2{static_cast<float>(coverage->width()), static_cast<float>(coverage->height())};
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
