#pragma once

/// The built-in integration shaders (`ss-*`) as SkSL runtime effects — **one of
/// the thirteen so far**. `SsShaderBodies()` is null for the other twelve, which
/// then take the plain textured path; see ROADMAP.md.
///
/// **Included only from `SsSkiaDraw.cpp`** — same rule as `SsBlend.hpp` and
/// `SsPartColorShader.hpp`, and for the same reason.
///
/// Two references, and the split is deliberate:
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

#include <algorithm>
#include <cstdio>

#include "include/core/SkImage.h"
#include "include/core/SkShader.h"
#include "include/core/SkString.h"
#include "include/core/SkTileMode.h"
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
// `col.a` already carries the part's hierarchical alpha, so
// `PartState.alpha` is deliberately not re-multiplied here.
half4 ssFinish(float4 pixel, float4 col, float rate) {
    float vx = 1.0 + uCoef.x * rate;
    float vy = uCoef.y * rate;
    float3 rgb = pixel.rgb * vx + mix(float3(1.0), pixel.rgb, uCoef.z) * col.rgb * vy;
    rgb = clamp(rgb, 0.0, 1.0);
    float a = pixel.a * col.a;
    return half4(half3(rgb * a), half(a));
}

// A fragment the built-in cuts (Godot and SS6 `discard`). A runtime effect
// cannot discard, and does not need to: the output is premultiplied, so zero
// alpha is zero contribution under every blend this port uses.
half4 ssCut() { return half4(0.0); }

const float kSsPi = 3.1415926535897932;

// Godot's `UV`. Its shaders work in normalised texture coordinates while this
// one works in texture pixels, so a port converts only where the arithmetic
// genuinely needs the normalised value — the pseudo-random hashes, whose output
// depends on the scale of their input, and `ss-wave`'s frequency term.
float2 ssUv(float2 coord) { return coord / max(uTexSize, float2(1.0)); }

// SS6's hash, shared verbatim by `ss-noise` (ss-noise.fs:31-34) and `ss-scatter`
// (ss-scatter.fs:33-36).
float ssRand(float2 p) { return fract(sin(dot(p, float2(12.9898, 78.233))) * 43758.5453); }
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

/// `ss-hsb`, from SSPlayerForGodot's `ss_hsb.fs` (SS6 `ss-hsb.fs`).
///
/// `param0/1/2` are signed Hue / Saturation / Brightness shifts. The two
/// conversion helpers are the SS6 originals, declared here rather than in the
/// preamble so the other twelve do not carry them.
inline const char* kSsShaderHsb = R"SKSL(
float4 ssRgbToHsb(float4 c) {
    float4 K = float4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
    float4 p = mix(float4(c.bg, K.wz), float4(c.gb, K.xy), step(c.b, c.g));
    float4 q = mix(float4(p.xyw, c.r), float4(c.r, p.yzx), step(p.x, c.r));
    float d = q.x - min(q.w, q.y);
    float e = 1.0e-10;
    return float4(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x, c.a);
}

float4 ssHsbToRgb(float4 hsb) {
    float4 K = float4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
    float3 p = abs(fract(hsb.xxx + K.xyz) * 6.0 - K.www);
    return float4(hsb.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), hsb.y), hsb.w);
}

half4 main(float2 coord) {
    float2 st = ssLocal(coord);
    float4 col = ssColorAt(st);
    float rate = ssRateAt(st);
    float4 Pixel = ssTex(coord);

    float4 hsb = ssRgbToHsb(Pixel);
    hsb.x += uParams.x;
    hsb.y = clamp(hsb.y + uParams.y, 0.0, 1.0);
    hsb.z = clamp(hsb.z + uParams.z, 0.0, 1.0);
    if (hsb.x < 0.0) hsb.x += 1.0;
    if (hsb.x > 1.0) hsb.x -= 1.0;
    float4 shifted = ssHsbToRgb(hsb);

    return ssFinish(shifted, col, rate);
}
)SKSL";

/// `ss-step`, from `ss_step.fs` (SS6 `ss-step.fs`).
///
/// `param0` is the signed threshold — its sign picks whether the bright or the
/// dark end is the target — `param1` the number of posterise stages, `param2`
/// the mix between a flat mono step and the texture's own colour.
inline const char* kSsShaderStep = R"SKSL(
half4 main(float2 coord) {
    float2 st = ssLocal(coord);
    float4 col = ssColorAt(st);
    float rate = ssRateAt(st);
    float4 Pixel = ssTex(coord);

    float fThreshold = uParams.x;
    float fStage = uParams.y;
    float fColor = uParams.z;

    float d = 1.0 + 255.0 * abs(fStage);
    float e = 1.0e-10;
    float t = abs(fThreshold);
    float b = abs(step(fThreshold, 0.0) - max(Pixel.r, max(Pixel.g, Pixel.b)));
    float r = clamp(floor((b - t) / (t + e) * 256.0 / d) * d / 256.0, 0.0, 1.0);
    float c = step(t, b) * r;
    float3 v = mix(float3(c), Pixel.rgb * c, fColor);

    return ssFinish(float4(v, Pixel.a), col, rate);
}
)SKSL";

/// `ss-pix`, from `ss_pix.fs` (SS6 `ss-pix.fs`).
///
/// `param0` is the block size: `1 + 96 * fPower` source texels per cell, so 0
/// leaves the one-texel grid alone. Godot quantises normalised UV against
/// `TEXTURE_PIXEL_SIZE`; in texture pixels the two cancel and the whole step is
/// `floor(coord / v) * v`.
inline const char* kSsShaderPix = R"SKSL(
half4 main(float2 coord) {
    float2 st = ssLocal(coord);
    float4 col = ssColorAt(st);
    float rate = ssRateAt(st);

    float v = 1.0 + 96.0 * uParams.x;
    float2 snapped = floor(coord / v) * v;
    float4 Pixel = ssTex(snapped);

    return ssFinish(Pixel, col, rate);
}
)SKSL";

/// `ss-noise`, from `ss_noise.fs` (SS6 `ss-noise.fs`).
///
/// `param0` is the intensity, `param1` decorrelates the channels, `param2` is a
/// phase an animation can scroll. The hash is fed **normalised** UV, as SS6 and
/// Godot feed it: its output depends on the scale of its input, so quantising in
/// pixels and hashing in pixels would give a different — still plausible —
/// pattern from the other players.
inline const char* kSsShaderNoise = R"SKSL(
half4 main(float2 coord) {
    float2 st = ssLocal(coord);
    float4 col = ssColorAt(st);
    float rate = ssRateAt(st);
    float4 Pixel = ssTex(coord);

    float fPower = uParams.x;
    float fColor = uParams.y;
    float fPhase = uParams.z;

    // Quantised to the source-texel grid so the pattern is stable per texel
    // rather than aliasing with the screen.
    float2 u = ssUv(floor(coord));
    float2 t = u + float2(fPhase);

    float3 c;
    c.r = ssRand(t);
    c.g = mix(c.r, ssRand(t * c.r), fColor);
    c.b = mix(c.g, ssRand(t * c.g), fColor);

    float3 rgb = clamp(mix(Pixel.rgb, c, fPower), 0.0, 1.0);
    return ssFinish(float4(rgb, Pixel.a), col, rate);
}
)SKSL";

/// `ss-bmask`, from `ss_bmask.fs` (SS6 `ss-bmask.fs`).
///
/// `param0` is a signed brightness cutoff: positive keeps the pixels brighter
/// than it, negative keeps the darker ones. Godot discards; `ssCut` is this
/// port's equivalent.
inline const char* kSsShaderBmask = R"SKSL(
half4 main(float2 coord) {
    float2 st = ssLocal(coord);
    float4 col = ssColorAt(st);
    float rate = ssRateAt(st);
    float4 Pixel = ssTex(coord);

    float fBrightness = uParams.x;
    float b = abs(step(fBrightness, 0.0) - max(Pixel.r, max(Pixel.g, Pixel.b)));
    if (b <= abs(fBrightness)) return ssCut();

    return ssFinish(Pixel, col, rate);
}
)SKSL";

/// `ss-outline`, from `ss_outline.fs` (SS6 `ss-outline.fs`).
///
/// `param0`'s magnitude is the alpha cutoff for a four-neighbour cross: a pixel
/// survives when it is above the cutoff and at least one orthogonal neighbour is
/// below it, which is the alpha edge. The neighbours are one texel away, and a
/// texel is 1.0 in this coordinate space.
inline const char* kSsShaderOutline = R"SKSL(
half4 main(float2 coord) {
    float2 st = ssLocal(coord);
    float4 col = ssColorAt(st);
    float rate = ssRateAt(st);

    float fRatio = abs(uParams.x);
    float e = 1.0e-5;

    float lo = 0.0;
    lo += step(ssTex(coord + float2(-1.0, 0.0)).a, fRatio);
    lo += step(ssTex(coord + float2(1.0, 0.0)).a, fRatio);
    lo += step(ssTex(coord + float2(0.0, -1.0)).a, fRatio);
    lo += step(ssTex(coord + float2(0.0, 1.0)).a, fRatio);

    float hi = step(fRatio + e, ssTex(coord).a);
    float v = min(hi * lo, 1.0);
    if (v <= 0.0) return ssCut();

    // SS6 feeds the outline intensity in as both rgb and alpha.
    return ssFinish(float4(float3(v), v), col, rate);
}
)SKSL";

/// `ss-blur`, from `ss_blur.fs` (SS6 `ss-blur.fs`).
///
/// Nine taps over a radius of `param0 * 16` texels. **The one built-in that does
/// not fold the PartColor composite** — SS6 multiplies each tap by the vertex
/// colour and averages, never touching `getBlendColor`, so this is the one body
/// that must not call `ssFinish`. `SsPartShader::foldsPartColor` is the C++ side
/// of the same fact.
inline const char* kSsShaderBlur = R"SKSL(
half4 main(float2 coord) {
    float2 st = ssLocal(coord);
    float4 col = ssColorAt(st);

    float2 d = float2(uParams.x * 16.0);

    float4 sum = ssTex(coord);
    sum += ssTex(coord + float2(d.x, d.y));
    sum += ssTex(coord + float2(d.x, 0.0));
    sum += ssTex(coord + float2(0.0, d.y));
    sum += ssTex(coord - float2(d.x, d.y));
    sum += ssTex(coord + float2(d.x, -d.y));
    sum += ssTex(coord + float2(-d.x, d.y));
    sum += ssTex(coord - float2(d.x, 0.0));
    sum += ssTex(coord - float2(0.0, d.y));
    float4 Pixel = sum / 9.0;

    float4 outc = Pixel * col;
    float a = clamp(outc.a, 0.0, 1.0);
    return half4(half3(clamp(outc.rgb, 0.0, 1.0) * a), half(a));
}
)SKSL";

/// `ss-wave`, from `ss_wave.fs` (SS6 `ss-wave.fs`).
///
/// A sinusoidal horizontal warp driven by the texture's V: `param0` is the
/// frequency, `param1` the amplitude, `param2` the phase (0..1 is one period).
/// The frequency term reads V normalised, which is why this one needs
/// `uTexSize`; the amplitude is in texel widths, so it stays in this space.
inline const char* kSsShaderWave = R"SKSL(
half4 main(float2 coord) {
    float2 st = ssLocal(coord);
    float4 col = ssColorAt(st);
    float rate = ssRateAt(st);

    float fWidth = uParams.x;
    float fHeight = uParams.y;
    float fPhase = uParams.z;

    float v = ssUv(coord).y;
    float l = 384.0 * fHeight * 0.5;
    float s = l * sin(v * 384.0 * fWidth * 0.5 + kSsPi * 2.0 * fPhase);

    float4 Pixel = ssTex(float2(coord.x + s, coord.y));
    return ssFinish(Pixel, col, rate);
}
)SKSL";

/// `ss-move`, from `ss_move.fs` (SS6 `ss-move.fs`).
///
/// A directional smear: `param0` is the signed distance, `param1` the direction
/// in units of pi, `param2` the per-step blend strength.
///
/// The loop bound is a **constant** where Godot's is dynamic, because ES2 — the
/// profile a runtime effect compiles under — requires it. The trip count is the
/// same 128 Godot caps at, with the tail skipped rather than not run.
inline const char* kSsShaderMove = R"SKSL(
half4 main(float2 coord) {
    float2 st = ssLocal(coord);
    float4 col = ssColorAt(st);
    float rate = ssRateAt(st);

    float fDistance = uParams.x;
    float fDirection = uParams.y;
    float fPower = uParams.z;

    float count = min(floor(abs(fDistance) * 96.0), 128.0);
    float2 vel = float2(sin(fDirection * kSsPi), cos(fDirection * kSsPi)) * sign(fDistance);

    float2 c = coord + vel * count;
    c -= vel;
    float4 Pixel = ssTex(c);
    for (int i = 1; i < 128; ++i) {
        if (float(i) >= count) break;
        c -= vel;
        Pixel = mix(ssTex(c), Pixel, 0.96 * abs(fPower));
    }

    return ssFinish(Pixel, col, rate);
}
)SKSL";

/// `ss-scatter`, from `ss_scatter.fs` (SS6 `ss-scatter.fs`).
///
/// Each texel cell is gated by `param1` and, when it passes, samples along a
/// per-cell random angle at `param0 * 96` texels. `param2` scrolls the pattern.
/// The hash reads normalised UV for the same reason `ss-noise`'s does.
inline const char* kSsShaderScatter = R"SKSL(
half4 main(float2 coord) {
    float2 st = ssLocal(coord);
    float4 col = ssColorAt(st);
    float rate = ssRateAt(st);

    float fPower = uParams.x;
    float fRatio = uParams.y;
    float fPhase = uParams.z;

    float2 u = ssUv(floor(coord));
    float2 t = u + float2(fPhase);
    float r = ssRand(t) * kSsPi * 2.0 - kSsPi;
    float gate = step(ssRand(t * r), fRatio);
    float2 v = float2(sin(r), cos(r)) * 96.0 * fPower * gate;

    float4 Pixel = ssTex(coord + v);
    return ssFinish(Pixel, col, rate);
}
)SKSL";

/// `ss-circle`, from `ss_circle.fs` (SS6 `ss-circle.fs`).
///
/// Unwraps the part's cell into a disc: the radius becomes u (0 at the rim, 1 at
/// the centre) and the angle becomes v, offset by `param0` and flipped by
/// `param1`. One of the two that read `uCellRect`; Godot lifts its UV rect into
/// pixel space to keep the disc round on a non-square cell, which is the space
/// this port is already in.
inline const char* kSsShaderCircle = R"SKSL(
half4 main(float2 coord) {
    float2 st = ssLocal(coord);
    float4 col = ssColorAt(st);
    float rate = ssRateAt(st);

    float fPhase = uParams.x;
    float fDirection = uParams.y;
    float e = 1.0e-10;

    float2 lt = uCellRect.xy;
    float2 rb = uCellRect.zw;
    float2 c = (lt + rb) * 0.5;
    float2 d = rb - lt;
    float2 v = coord - c;
    float r = min(abs(rb.x - c.x), abs(rb.y - c.y)) + e;
    float dis = length(v);
    if (dis > r) return ssCut();

    // The angle is undefined at the exact centre, where any direction serves.
    float2 nv = dis > e ? v / dis : float2(1.0, 0.0);
    float uu = 1.0 - dis / r;
    float vv = (atan(nv.y, nv.x) / kSsPi + 1.0) * 0.5 + fPhase;
    if (vv < 0.0) vv += 1.0;
    if (vv > 1.0) vv -= 1.0;
    if (fDirection <= 0.0) vv = 1.0 - vv;

    float4 Pixel = ssTex(lt + d * float2(uu, vv));
    return ssFinish(Pixel, col, rate);
}
)SKSL";

/// `ss-spot`, from `ss_spot.fs` (SS6 `ss-spot.fs`).
///
/// A radial spotlight on the cell's centre: `param0` scales the radius,
/// `param1` blends the `1/r` falloff toward a linear one, `param2` mixes the lit
/// colour between white and the texture. The other reader of `uCellRect`.
inline const char* kSsShaderSpot = R"SKSL(
half4 main(float2 coord) {
    float2 st = ssLocal(coord);
    float4 col = ssColorAt(st);
    float rate = ssRateAt(st);

    float p = abs(uParams.x);
    float decay = abs(uParams.y);
    float fColor = uParams.z;
    float e = 1.0e-10;

    float2 lt = uCellRect.xy;
    float2 rb = uCellRect.zw;
    float2 c = (lt + rb) * 0.5;
    float l = min(abs(rb.x - c.x), abs(rb.y - c.y)) + e;
    float2 v = c - coord;

    float fR = max(p / (length(v / l) + e) - p, 0.0);
    float fL = max(p - length(v / l), 0.0);
    fR = clamp(mix(fR, fL, decay), 0.0, 1.0);

    float3 sampled = ssTex(coord).rgb;
    float4 Pixel = float4(mix(float3(1.0), sampled, fColor), fR);
    return ssFinish(Pixel, col, rate);
}
)SKSL";

/// One body per `SsShaderId`, in that enum's order.
///
/// A null entry is a built-in this port has not ported yet: the caller then
/// keeps the plain textured/PartColor path, which is the same fallback an
/// unrecognised `id_hash` takes.
inline const char* const* SsShaderBodies() {
  static const char* const kBodies[sscore::kSsShaderCount] = {
      kSsShaderSepia,    // Sepia
      kSsShaderHsb,      // Hsb
      kSsShaderStep,     // Step
      kSsShaderPix,      // Pix
      kSsShaderNoise,    // Noise
      kSsShaderBmask,    // Bmask
      kSsShaderOutline,  // Outline
      kSsShaderBlur,     // Blur
      kSsShaderWave,     // Wave
      kSsShaderMove,     // Move
      kSsShaderScatter,  // Scatter
      kSsShaderCircle,   // Circle
      kSsShaderSpot,     // Spot
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

  // The atlas's pixel size, asked of the shader rather than plumbed: `PaintFor`
  // hands over a paint, and a `SsPaintBinding` carries no dimensions. Anything
  // that is not a plain image shader falls back to 1x1, which leaves the
  // normalised-UV readers (`ss-noise`, `ss-scatter`, `ss-wave`) working off
  // pixel counts — a different pattern, not a broken draw.
  SkV2 texSize{1.0f, 1.0f};
  if (const SkImage* image = atlas->isAImage(nullptr, static_cast<SkTileMode*>(nullptr))) {
    texSize = SkV2{static_cast<float>(image->width()), static_cast<float>(image->height())};
  }

  // The cell's bounds, as the axis-aligned box of the quad's four UV corners.
  // For every kind that carries a `SHDR` those corners *are* the cell — flips
  // reorder them, which min/max undoes — so `ss-circle` and `ss-spot` get their
  // rect without a second source of truth to keep in step.
  float minU = uv[0], maxU = uv[0], minV = uv[1], maxV = uv[1];
  for (int i = 1; i < 4; ++i) {
    minU = std::min(minU, uv[i * 2]);
    maxU = std::max(maxU, uv[i * 2]);
    minV = std::min(minV, uv[i * 2 + 1]);
    maxV = std::max(maxV, uv[i * 2 + 1]);
  }

  SkRuntimeShaderBuilder builder(sk_ref_sp(effect));
  builder.child("atlas") = std::move(atlas);
  builder.uniform("uUvOrigin") = SkV2{inv.origin[0], inv.origin[1]};
  builder.uniform("uUvInv") = SkV4{inv.m[0], inv.m[1], inv.m[2], inv.m[3]};
  builder.uniform("uTexSize") = texSize;
  builder.uniform("uCellRect") = SkV4{minU, minV, maxU, maxV};
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
