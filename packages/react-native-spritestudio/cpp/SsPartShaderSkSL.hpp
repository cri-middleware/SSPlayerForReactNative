#pragma once

/// The 13 built-in integration shaders (`ss-*`) as SkSL runtime effects.
///
/// **Included only from `SsSkiaDraw.cpp`** — same rule as `SsBlend.hpp` and
/// `SsPartColorShader.hpp`, and for the same reason.
///
/// Two references, and the split is deliberate (see AGENTS.md's rule):
/// **SSPlayerForFlutter** for the architecture, because it faces this port's
/// constraint — no custom per-vertex varyings, so per-part values are rebuilt
/// per fragment instead of arriving from a vertex stage. **SSPlayerForGodot**
/// for the arithmetic, because its bodies cite the SS6 SDK original per
/// constant with file and line, which is the only way to check a magic number.
/// Godot's bodies do not port verbatim: they read `TEXTURE` / `UV` /
/// `partcolor_color` / `partcolor_varg`, which are Godot varyings.
///
/// The preamble below replaces them. SkSL has no preprocessor, so where Flutter
/// writes `SS_SETUP()` each body here opens with the same four explicit lines.
///
/// One simplification falls out of drawing through `drawVertices`: `coord`
/// arrives in **texture pixels**, so Godot's `TEXTURE_PIXEL_SIZE` (a normalised
/// 1/size step) is simply `1.0` here, and no shader has to carry the texture
/// size to take a one-texel step. `uTexSize` is still needed by the two that
/// work in normalised cell space.

#include <cstdio>

#include "include/core/SkShader.h"
#include "include/core/SkString.h"
#include "include/effects/SkRuntimeEffect.h"

#include "SsPartColor.hpp"
#include "SsPartShader.hpp"

namespace ssplayer {

/// Shared by all 13 programs: the uniform block, the `(s,t)` reconstruction,
/// the straight-alpha sampler and the PartColor tail.
///
/// `uUvOrigin`/`uUvInv` are `SsMakeUvInverse`'s output, exactly as
/// `SsPartColorShader.hpp` uses them — the quad's four UV corners are an affine
/// image of the unit square, so the inverse is exact.
inline const char* kSsShaderPreamble = R"SKSL(
uniform shader atlas;

uniform float2 uUvOrigin;  // the lt corner's UV, in texture pixels
uniform float4 uUvInv;     // 2x2 inverse [m00,m01,m10,m11]: uv-origin -> (s,t)
uniform float2 uTexSize;   // atlas size in pixels
uniform float4 uCoef;      // PartColor coefficient row (fSrc, fDst, mulFlag, _)
uniform float4 uRate;      // corner rates (lt, rt, lb, rb)
uniform float4 uColLT;     // straight-alpha rgba, 0..1
uniform float4 uColRT;
uniform float4 uColLB;
uniform float4 uColRB;
uniform float4 uParams;    // the SHDR attribute's param0..param3
uniform float4 uCellRect;  // cell UV rect (minU, minV, maxU, maxV), normalised

// Quad-local (s,t) in [0,1]^2. Clamped for edge fragments; interior ones
// already land inside the square.
float2 ssLocal(float2 coord) {
    float2 d = coord - uUvOrigin;
    return float2(clamp(uUvInv.x * d.x + uUvInv.y * d.y, 0.0, 1.0),
                  clamp(uUvInv.z * d.x + uUvInv.w * d.y, 0.0, 1.0));
}

// Godot's `partcolor_color`, rebuilt: bilinear over the four corners.
float4 ssColorAt(float2 st) {
    return mix(mix(uColLT, uColRT, st.x), mix(uColLB, uColRB, st.x), st.y);
}

// Godot's `partcolor_varg.w`-adjacent strength, rebuilt the same way.
float ssRateAt(float2 st) {
    return mix(mix(uRate.x, uRate.y, st.x), mix(uRate.z, uRate.w, st.x), st.y);
}

// Godot's `ss_input_texture`. Skia hands back premultiplied; the SS maths
// expects straight alpha. `coord` is in texture pixels, so a one-texel step is
// 1.0 and callers offset it directly.
float4 ssTex(float2 coord) {
    half4 c = atlas.eval(coord);
    float a = float(c.a);
    return float4(a > 0.0 ? float3(c.rgb) / a : float3(c.rgb), a);
}

// Godot's `ss_partcolor_blend` plus its `ss_output_color` premultiply, which is
// Flutter's `ssBlend`. The two ports agree on this formula, which is what
// corroborates `SsPartColor.hpp`'s coefficient row.
//
// `col.a` already carries the part's hierarchical alpha (parts_color §1-3), so
// `PartState.alpha` is deliberately not re-multiplied here.
half4 ssFinish(float4 pixel, float4 col, float rate) {
    float vx = 1.0 + uCoef.x * rate;
    float vy = uCoef.y * rate;
    float3 rgb = pixel.rgb * vx + mix(float3(1.0), pixel.rgb, uCoef.z) * col.rgb * vy;
    rgb = clamp(rgb, 0.0, 1.0);
    float a = pixel.a * col.a;
    return half4(half3(rgb * a), half(a));
}
)SKSL";

/// `ss-sepia`, ported from SSPlayerForGodot's `ss_sepia.fs`, which in turn cites
/// SS6's `Common/Drawer/GLSL/ss-sepia.fs`.
///
/// `param0` is the signed strength: `> 0` warms the luminance-grey toward sepia,
/// `< 0` leaves it plain greyscale, `== 0` is a passthrough (the mix factor is
/// `abs(param0)`).
inline const char* kSsShaderSepia = R"SKSL(
half4 main(float2 coord) {
    float2 st = ssLocal(coord);
    float4 col = ssColorAt(st);
    float rate = ssRateAt(st);
    float4 Pixel = ssTex(coord);

    float fPower = uParams.x;
    // ITU-R BT.601 weights, SS6 ss-sepia.fs:33-35.
    float gray = dot(Pixel.rgb, float3(0.298912, 0.586611, 0.114478));
    float3 GrayRgb = float3(gray);
    // Sepia tint scale, SS6 ss-sepia.fs:43-45.
    float3 SepiaRgb = GrayRgb * float3(1.07, 0.74, 0.43);
    // step(edge, x) is 1 when x >= edge, so this picks grey when fPower <= 0.
    float3 toned = mix(SepiaRgb, GrayRgb, step(fPower, 0.0));
    float3 rgb = mix(Pixel.rgb, toned, abs(fPower));

    return ssFinish(float4(rgb, Pixel.a), col, rate);
}
)SKSL";

/// One body per `SsShaderId`, in that enum's order.
///
/// A null entry is a built-in this port has not ported yet: the caller then
/// keeps the plain textured/PartColor path, which is the same fallback an
/// unrecognised `id_hash` takes.
inline const char* const* SsShaderBodies() {
  static const char* const kBodies[sscore::kSsShaderCount] = {
      kSsShaderSepia,  // Sepia
      nullptr,         // Hsb
      nullptr,         // Step
      nullptr,         // Pix
      nullptr,         // Noise
      nullptr,         // Bmask
      nullptr,         // Outline
      nullptr,         // Blur
      nullptr,         // Wave
      nullptr,         // Move
      nullptr,         // Scatter
      nullptr,         // Circle
      nullptr,         // Spot
  };
  return kBodies;
}

/// The compiled effect for `id`, or null when it has no body yet or would not
/// compile.
///
/// Compiled on first use and cached for the process. A failure is reported once
/// and degrades to the plain textured draw rather than dropping the part — an
/// un-effected sprite is a far better failure than a missing one.
inline SkRuntimeEffect* SsShaderEffect(sscore::SsShaderId id) {
  static SkRuntimeEffect* cache[sscore::kSsShaderCount] = {};
  static bool tried[sscore::kSsShaderCount] = {};

  const int i = static_cast<int>(id);
  if (i < 0 || i >= sscore::kSsShaderCount) return nullptr;
  if (tried[i]) return cache[i];
  tried[i] = true;

  const char* body = SsShaderBodies()[i];
  if (body == nullptr) return nullptr;

  SkString source(kSsShaderPreamble);
  source.append(body);
  SkRuntimeEffect::Result result = SkRuntimeEffect::MakeForShader(source);
  if (result.effect == nullptr) {
    std::fprintf(stderr, "[SsPlayer] ss-shader %d failed to compile: %s\n", i,
                 result.errorText.c_str());
    return nullptr;
  }
  // Leaked deliberately, as `PartColorEffect()` is: it lives for the process,
  // and a static sk_sp would destruct at exit after Skia may already be gone.
  cache[i] = result.effect.release();
  return cache[i];
}

/// The shader realising `ps` over `atlas`, for a quad whose UV corners are `uv`
/// (8 floats: lt, rt, lb, rb, in texture pixels).
///
/// `pc` rides along because twelve of the thirteen fold the PartColor composite
/// as their own output tail — a part carrying both must therefore **not** also
/// go through `MakePartColorShader`, or the tint lands twice. A part with no
/// PartColor passes the default-constructed one, whose rates are 0, which
/// collapses `ssFinish` to a passthrough.
///
/// Null if it cannot be built, which the caller must treat as "draw it plainly".
inline sk_sp<SkShader> MakePartShaderShader(const sscore::SsPartShader& ps,
                                            const sscore::SsPartColor& pc, const float* uv,
                                            sk_sp<SkShader> atlas) {
  SkRuntimeEffect* effect = SsShaderEffect(ps.id);
  if (effect == nullptr || atlas == nullptr || uv == nullptr) return nullptr;

  sscore::SsUvInverse inv;
  sscore::SsMakeUvInverse(uv, &inv);

  SkRuntimeShaderBuilder builder(sk_ref_sp(effect));
  builder.child("atlas") = std::move(atlas);
  builder.uniform("uUvOrigin") = SkV2{inv.origin[0], inv.origin[1]};
  builder.uniform("uUvInv") = SkV4{inv.m[0], inv.m[1], inv.m[2], inv.m[3]};
  // TODO(ss-circle / ss-spot): those two are the only built-ins that read
  // `uTexSize` or `uCellRect`, and neither has a body yet. The atlas size is not
  // on this call path — `PaintFor` hands over a paint, not a size — so plumbing
  // it is part of landing those two, not of this wiring.
  builder.uniform("uTexSize") = SkV2{1.0f, 1.0f};
  builder.uniform("uCellRect") = SkV4{0.0f, 0.0f, 1.0f, 1.0f};
  builder.uniform("uCoef") = SkV4{pc.coef[0], pc.coef[1], pc.coef[2], pc.coef[3]};
  builder.uniform("uRate") = SkV4{pc.lt.rate, pc.rt.rate, pc.lb.rate, pc.rb.rate};
  builder.uniform("uColLT") = SkV4{pc.lt.r, pc.lt.g, pc.lt.b, pc.lt.a};
  builder.uniform("uColRT") = SkV4{pc.rt.r, pc.rt.g, pc.rt.b, pc.rt.a};
  builder.uniform("uColLB") = SkV4{pc.lb.r, pc.lb.g, pc.lb.b, pc.lb.a};
  builder.uniform("uColRB") = SkV4{pc.rb.r, pc.rb.g, pc.rb.b, pc.rb.a};
  builder.uniform("uParams") = SkV4{ps.params[0], ps.params[1], ps.params[2], ps.params[3]};
  return builder.makeShader();
}

}  // namespace ssplayer
