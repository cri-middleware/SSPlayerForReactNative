#pragma once

/// The PartColor formula as an SkSL runtime effect.
///
/// **Included only from `SsSkiaDraw.cpp`, inside its `SSPLAYER_ENABLE_SKIA_DIRECT`
/// guard** — same rule as `SsBlend.hpp`, and for the same reason.
///
/// The port is of **SSPlayerForFlutter**'s `shaders/partcolor.frag`, which
/// solved the same problem against the same primitives: Skia gives vertices only
/// position / texcoord / colour, so the per-vertex `CUSTOM0` packing the
/// Godot and Web ports use has nowhere to live. Each tinted part is therefore
/// drawn on its own quad with the corner colours and rates as **uniforms**, and
/// the gradient is reconstructed analytically in the shader.
///
/// Where this departs from Flutter: Flutter reconstructs quad-local `(s,t)` from
/// the *fragment position* and needs a CPU-computed world-space inverse affine
/// to do it. Here the reconstruction runs off the **UV** instead. `drawVertices`
/// evaluates the paint's shader at the interpolated texcoord, so `coord` arrives
/// in texture-pixel space already — which is independent of the canvas matrix,
/// so the root transform, the device pixel ratio and any enclosing scale drop
/// out of the problem. The quad's four UV corners are an affine image of the
/// unit square exactly as its positions are, so inverting that map is exact and
/// costs two CPU subtractions and a determinant.

#include <cstdio>

#include "include/core/SkColorFilter.h"
#include "include/core/SkPaint.h"
#include "include/core/SkShader.h"
#include "include/core/SkString.h"
#include "include/effects/SkRuntimeEffect.h"

#include "SsPartColor.hpp"

namespace ssplayer {

/// `uCoef`/`uRate`/`uCol*` are the coefficient row and the four corners;
/// `uUvOrigin`/`uUvInv` are the UV→(s,t) inverse described above.
inline const char* kPartColorSkSL = R"SKSL(
uniform shader atlas;

uniform float2 uUvOrigin;  // the lt corner's UV, in texture pixels
uniform float4 uUvInv;     // 2x2 inverse [m00,m01,m10,m11]: uv-origin -> (s,t)
uniform float4 uCoef;      // (fSrc, fDst, mulFlag, _)
uniform float4 uRate;      // corner rates (lt, rt, lb, rb)
uniform float4 uColLT;     // straight-alpha rgba, 0..1
uniform float4 uColRT;
uniform float4 uColLB;
uniform float4 uColRB;

half4 main(float2 coord) {
    float2 d = coord - uUvOrigin;
    // Clamped for edge fragments; interior ones already land inside the square.
    float s = clamp(uUvInv.x * d.x + uUvInv.y * d.y, 0.0, 1.0);
    float t = clamp(uUvInv.z * d.x + uUvInv.w * d.y, 0.0, 1.0);

    float4 col = mix(mix(uColLT, uColRT, s), mix(uColLB, uColRB, s), t);
    float rate = mix(mix(uRate.x, uRate.y, s), mix(uRate.z, uRate.w, s), t);

    // Sampled at the raw UV: the atlas shader is the very one the batched path
    // uses, so this samples identically.
    half4 tex = atlas.eval(coord);
    // Skia hands back premultiplied; the formula composites straight colours.
    float3 pixel = tex.a > 0.0 ? float3(tex.rgb) / float(tex.a) : float3(tex.rgb);

    // varg = (1 + fSrc*rate, fDst*rate, mulFlag): one branch-free formula for
    // Mix / Mul / Add / Sub. rate == 0 collapses it to the texel.
    float vx = 1.0 + uCoef.x * rate;
    float vy = uCoef.y * rate;
    float3 rgb = pixel * vx + mix(float3(1.0), pixel, uCoef.z) * col.rgb * vy;
    rgb = clamp(rgb, 0.0, 1.0);

    // col.a already carries the part's hierarchical alpha — the reason
    // `PartState.alpha` is deliberately absent from this whole path.
    float a = float(tex.a) * col.a;
    return half4(half3(rgb * a), half(a));
}
)SKSL";

/// The compiled effect, or null if it would not compile.
///
/// Compiled once. A failure is reported once and then degrades to the plain
/// textured draw rather than dropping the part — an untinted sprite is a far
/// better failure than a missing one, and the log line says which it is.
inline SkRuntimeEffect* PartColorEffect() {
  static SkRuntimeEffect* effect = [] () -> SkRuntimeEffect* {
    SkRuntimeEffect::Result result =
        SkRuntimeEffect::MakeForShader(SkString(kPartColorSkSL));
    if (result.effect == nullptr) {
      std::fprintf(stderr, "[SsPlayer] PartColor SkSL failed to compile: %s\n",
                   result.errorText.c_str());
      return nullptr;
    }
    // Leaked deliberately: it lives for the process, and a function-local static
    // sk_sp would run its destructor at exit, after Skia may already be gone.
    return result.effect.release();
  }();
  return effect;
}

/// The shader realising `pc` over `atlas`, for a quad whose UV corners are
/// `uv` (8 floats: lt, rt, lb, rb in texture pixels). Null if it cannot be
/// built, which the caller must treat as "draw it plainly".
inline sk_sp<SkShader> MakePartColorShader(const sscore::SsPartColor& pc, const float* uv,
                                           sk_sp<SkShader> atlas) {
  SkRuntimeEffect* effect = PartColorEffect();
  if (effect == nullptr || atlas == nullptr || uv == nullptr) return nullptr;

  // A zero-area UV quad collapses to a zero matrix, so `(s,t)` pins to (0,0)
  // and the tint becomes the lt corner's — defined, rather than a divide by zero.
  sscore::SsUvInverse inv;
  sscore::SsMakeUvInverse(uv, &inv);

  SkRuntimeShaderBuilder builder(sk_ref_sp(effect));
  builder.child("atlas") = std::move(atlas);
  builder.uniform("uUvOrigin") = SkV2{inv.origin[0], inv.origin[1]};
  builder.uniform("uUvInv") = SkV4{inv.m[0], inv.m[1], inv.m[2], inv.m[3]};
  builder.uniform("uCoef") = SkV4{pc.coef[0], pc.coef[1], pc.coef[2], pc.coef[3]};
  builder.uniform("uRate") = SkV4{pc.lt.rate, pc.rt.rate, pc.lb.rate, pc.rb.rate};
  builder.uniform("uColLT") = SkV4{pc.lt.r, pc.lt.g, pc.lt.b, pc.lt.a};
  builder.uniform("uColRT") = SkV4{pc.rt.r, pc.rt.g, pc.rt.b, pc.rt.a};
  builder.uniform("uColLB") = SkV4{pc.lb.r, pc.lb.g, pc.lb.b, pc.lb.a};
  builder.uniform("uColRB") = SkV4{pc.rb.r, pc.rb.g, pc.rb.b, pc.rb.a};
  return builder.makeShader();
}

}  // namespace ssplayer
