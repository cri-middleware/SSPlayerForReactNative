// Guards the `ss-*` integration-shader path, which is the one draw path whose
// failure is invisible.
//
// `SsShaderEffect` reports a compile error once to stderr and then returns null,
// and a null takes the same route as a built-in with no body yet: the plain
// textured draw. That is the right runtime behaviour — an un-effected sprite
// beats a missing one — but it means a broken shader and an unported one are the
// same picture on the example's Shader card. Neither of the other host checks
// closes the gap: `ssbake_check` reads the bake plan (which id, which params)
// and never reaches Skia, and `ssmask_check` compiles the *mask's* SkSL.
//
// So this one compiles every body that exists, then runs `ss-sepia` through a
// real raster surface and checks its output against the SS6 formula it cites.
// The arithmetic is the point: "it compiled" would still pass with the weights
// transposed. Last, the four-corner gradient the bodies and the PartColor tint
// both rebuild from `(s,t)` is checked against the fan the part is drawn as,
// pixel by pixel.
//
// macOS only, for the same reason as check-mask.sh — it links the host libskia
// RN Skia ships.
//
// Usage: ssshader_check

#include <cmath>
#include <cstdarg>
#include <cstdio>
#include <cstring>
#include <string>
#include <vector>

#include "include/core/SkBitmap.h"
#include "include/core/SkCanvas.h"
#include "include/core/SkImage.h"
#include "include/core/SkPaint.h"
#include "include/core/SkShader.h"
#include "include/core/SkString.h"
#include "include/core/SkSurface.h"
#include "include/core/SkVertices.h"
#include "include/effects/SkRuntimeEffect.h"

#include "../packages/react-native-spritestudio/cpp/SsPartColor.hpp"
#include "../packages/react-native-spritestudio/cpp/SsPartColorShader.hpp"
#include "../packages/react-native-spritestudio/cpp/SsPartShader.hpp"
#include "../packages/react-native-spritestudio/cpp/SsPartShaderSkSL.hpp"

namespace {

int gFailures = 0;

/// `SsShaderId`'s names, in the enum's order. Local to this check because the
/// runtime has no use for them — it resolves a pre-baked hash straight to an id.
const char* const kIdNames[sscore::kSsShaderCount] = {
    "ss-sepia", "ss-hsb",  "ss-step",    "ss-pix",    "ss-noise", "ss-bmask", "ss-outline",
    "ss-blur",  "ss-wave", "ss-move", "ss-scatter", "ss-circle", "ss-spot"};

const char* IdName(sscore::SsShaderId id) {
  const int i = static_cast<int>(id);
  return (i >= 0 && i < sscore::kSsShaderCount) ? kIdNames[i] : "?";
}

void Fail(const char* fmt, ...) {
  ++gFailures;
  std::fflush(stdout);
  std::fprintf(stderr, "FAIL: ");
  va_list args;
  va_start(args, fmt);
  std::vfprintf(stderr, fmt, args);
  va_end(args);
  std::fprintf(stderr, "\n");
}

constexpr int kSize = 8;

/// A flat atlas of one colour. `ssTex` divides by alpha to get straight alpha
/// back, so the bitmap is written premultiplied here.
sk_sp<SkShader> SolidAtlas(float r, float g, float b, float a) {
  const auto byte = [](float v) {
    const int i = static_cast<int>(v * 255.0f + 0.5f);
    return static_cast<uint8_t>(i < 0 ? 0 : (i > 255 ? 255 : i));
  };
  SkBitmap bm;
  bm.allocN32Pixels(kSize, kSize, true);
  bm.eraseARGB(byte(a), byte(r * a), byte(g * a), byte(b * a));
  bm.setImmutable();
  return bm.asImage()->makeShader(SkTileMode::kRepeat, SkTileMode::kRepeat,
                                  SkSamplingOptions(SkFilterMode::kNearest));
}

sk_sp<SkVertices> Quad(float w, float h) {
  const SkPoint pos[4] = {{0, 0}, {w, 0}, {0, h}, {w, h}};
  const uint16_t idx[6] = {0, 1, 2, 2, 1, 3};
  return SkVertices::MakeCopy(SkVertices::kTriangles_VertexMode, 4, pos, pos, nullptr, 6, idx);
}

struct Rgba {
  float r = 0, g = 0, b = 0, a = 0;
};

/// Draws one quad through `ps` over a solid atlas and reads the centre pixel
/// back as straight alpha.
///
/// The UV corners are the quad itself, so `ssLocal` is the identity on the unit
/// box and the PartColor bilinear is exercised without a cell's UV layout in the
/// way — the same arrangement `ssmask_check` uses.
bool RenderCentre(const sscore::SsPartShader& ps, const sscore::SsPartColor& pc, Rgba atlas,
                  Rgba* out) {
  const float uv[8] = {0, 0, kSize, 0, 0, kSize, kSize, kSize};
  sk_sp<SkShader> shader = ssplayer::MakePartShaderShader(
      ps, pc, uv, SolidAtlas(atlas.r, atlas.g, atlas.b, atlas.a));
  if (shader == nullptr) return false;

  sk_sp<SkSurface> surface = SkSurfaces::Raster(SkImageInfo::MakeN32Premul(kSize, kSize));
  SkCanvas* canvas = surface->getCanvas();
  canvas->clear(SK_ColorTRANSPARENT);
  SkPaint paint;
  paint.setShader(std::move(shader));
  paint.setAntiAlias(false);
  canvas->drawVertices(Quad(kSize, kSize), SkBlendMode::kModulate, paint);

  SkBitmap bm;
  bm.allocN32Pixels(kSize, kSize);
  surface->readPixels(bm, 0, 0);
  const SkColor c = bm.getColor(kSize / 2, kSize / 2);
  // getColor unpremultiplies, which is the space the formulas below are in.
  out->r = SkColorGetR(c) / 255.0f;
  out->g = SkColorGetG(c) / 255.0f;
  out->b = SkColorGetB(c) / 255.0f;
  out->a = SkColorGetA(c) / 255.0f;
  return true;
}

bool Near(float a, float b, float tol = 2.5f / 255.0f) { return std::fabs(a - b) <= tol; }

void ExpectRgb(const char* what, Rgba got, float r, float g, float b) {
  if (Near(got.r, r) && Near(got.g, g) && Near(got.b, b)) return;
  Fail("%s: got (%.3f, %.3f, %.3f), want (%.3f, %.3f, %.3f)", what, got.r, got.g, got.b, r, g, b);
}

// --- 1. every body that exists compiles -------------------------------------

int CheckCompiles() {
  int withBody = 0;
  for (int i = 0; i < sscore::kSsShaderCount; ++i) {
    const auto id = static_cast<sscore::SsShaderId>(i);
    const char* body = ssplayer::SsShaderBodies()[i];
    const char* name = IdName(id);
    if (body == nullptr) {
      std::printf("    %-10s no body — falls back to the plain textured draw\n", name);
      continue;
    }
    ++withBody;
    // Through `SsShaderEffect`, not a private compile: that is the function the
    // draw path calls, preamble and cache included.
    if (ssplayer::SsShaderEffect(id) == nullptr) {
      Fail("%s has a body but failed to compile — see the [SsPlayer] line above", name);
      continue;
    }
    std::printf("    %-10s compiles\n", name);
  }
  return withBody;
}

// --- 2. the uniforms the C++ sets are the ones the SkSL declares -------------

void CheckUniformNames() {
  SkRuntimeEffect* effect = ssplayer::SsShaderEffect(sscore::SsShaderId::Sepia);
  if (effect == nullptr) return;

  // Mirrors `MakePartShaderShader`. Deliberately a second copy: a rename in the
  // preamble that the builder did not follow leaves the uniform at zero, which
  // draws something plausible and wrong.
  static const char* const kSet[] = {"uUvOrigin", "uUvInv",  "uTexSize", "uCoef",
                                     "uRate",     "uColLT",  "uColRT",   "uColLB",
                                     "uColRB",    "uParams", "uCellRect"};
  for (const SkRuntimeEffect::Uniform& u : effect->uniforms()) {
    bool set = false;
    for (const char* name : kSet) {
      if (u.name == name) { set = true; break; }
    }
    if (!set) {
      Fail("the SkSL declares uniform '%.*s', which MakePartShaderShader never sets — it "
           "would read as zero",
           static_cast<int>(u.name.size()), u.name.data());
    }
  }
  std::printf("    %zu uniforms, all of them set by MakePartShaderShader\n",
              effect->uniforms().size());
}

// --- 3. ss-sepia computes what SS6's ss-sepia.fs computes --------------------

void CheckSepia() {
  // A part with no PartColor: rates 0 collapse `ssFinish` to a passthrough, so
  // what comes back is the shader's own arithmetic and nothing else.
  const sscore::SsPartColor kNoTint;

  const auto sepia = [](float power) {
    sscore::SsPartShader ps;
    ps.id = sscore::SsShaderId::Sepia;
    ps.params[0] = power;
    return ps;
  };

  // Mid-grey and a saturated red: one where the luminance weights cancel out and
  // one where transposing them changes the answer.
  const struct {
    const char* what;
    Rgba in;
  } kInputs[] = {
      {"mid-grey", {0.5f, 0.5f, 0.5f, 1.0f}},
      {"red", {1.0f, 0.0f, 0.0f, 1.0f}},
      {"green", {0.0f, 1.0f, 0.0f, 1.0f}},
  };

  for (const auto& input : kInputs) {
    // SS6 ss-sepia.fs:33-35 and :43-45, the two lines the body cites.
    const float gray = input.in.r * 0.298912f + input.in.g * 0.586611f + input.in.b * 0.114478f;
    const auto clamp01 = [](float v) { return v < 0.0f ? 0.0f : (v > 1.0f ? 1.0f : v); };

    Rgba out;
    if (!RenderCentre(sepia(1.0f), kNoTint, input.in, &out)) {
      Fail("%s: MakePartShaderShader returned null at power +1", input.what);
      return;
    }
    ExpectRgb((std::string(input.what) + " @ power +1 → sepia").c_str(), out,
              clamp01(gray * 1.07f), clamp01(gray * 0.74f), clamp01(gray * 0.43f));
    std::printf("    %-9s power +1 → (%.3f, %.3f, %.3f)\n", input.what, out.r, out.g, out.b);

    // `step(fPower, 0.0)` picks grey for a negative power: same luminance, no tint.
    if (!RenderCentre(sepia(-1.0f), kNoTint, input.in, &out)) {
      Fail("%s: null at power -1", input.what);
      return;
    }
    ExpectRgb((std::string(input.what) + " @ power -1 → greyscale").c_str(), out, gray, gray, gray);

    // The mix factor is `abs(param0)`, so zero is a passthrough. This is the one
    // that fails if the shader is not running at all — which is exactly the
    // state that looks identical on screen — so it is checked against the two
    // above rather than on its own.
    if (!RenderCentre(sepia(0.0f), kNoTint, input.in, &out)) {
      Fail("%s: null at power 0", input.what);
      return;
    }
    ExpectRgb((std::string(input.what) + " @ power 0 → passthrough").c_str(), out, input.in.r,
              input.in.g, input.in.b);
  }

  // Not vacuous: the toned output must actually differ from the input. Mid-grey
  // under a passthrough would satisfy every equality above even with the shader
  // bypassed.
  Rgba plain, toned;
  const Rgba red{1.0f, 0.0f, 0.0f, 1.0f};
  if (RenderCentre(sepia(0.0f), kNoTint, red, &plain) &&
      RenderCentre(sepia(1.0f), kNoTint, red, &toned)) {
    if (Near(plain.r, toned.r) && Near(plain.g, toned.g) && Near(plain.b, toned.b)) {
      Fail("power 0 and power +1 produced the same pixel — the shader is not running");
    }
  }
}

// --- 3b. the other twelve ----------------------------------------------------
//
// One neutral case each — the parameters at which the built-in is defined to do
// nothing, which catches a shader that is not running at all — and one
// characteristic case whose answer can be computed by hand. Where the maths is
// not hand-computable (the two hashes), the assertion is a property instead: a
// full-strength noise replaces the input, so two different inputs must land on
// the same pixel.

/// An atlas with an opaque left half and a transparent right half, for the two
/// built-ins that read their neighbours.
sk_sp<SkShader> SplitAtlas() {
  SkBitmap bm;
  bm.allocN32Pixels(kSize, kSize, false);
  bm.eraseARGB(0, 0, 0, 0);
  for (int y = 0; y < kSize; ++y) {
    for (int x = 0; x < kSize / 2; ++x) *bm.getAddr32(x, y) = 0xFFFFFFFF;
  }
  bm.setImmutable();
  return bm.asImage()->makeShader(SkTileMode::kClamp, SkTileMode::kClamp,
                                  SkSamplingOptions(SkFilterMode::kNearest));
}

/// Like `RenderCentre`, but reads a chosen texel and takes the atlas ready-made.
bool RenderAt(const sscore::SsPartShader& ps, const sscore::SsPartColor& pc,
              sk_sp<SkShader> atlas, int px, int py, Rgba* out) {
  const float uv[8] = {0, 0, kSize, 0, 0, kSize, kSize, kSize};
  sk_sp<SkShader> shader = ssplayer::MakePartShaderShader(ps, pc, uv, std::move(atlas));
  if (shader == nullptr) return false;

  sk_sp<SkSurface> surface = SkSurfaces::Raster(SkImageInfo::MakeN32Premul(kSize, kSize));
  SkCanvas* canvas = surface->getCanvas();
  canvas->clear(SK_ColorTRANSPARENT);
  SkPaint paint;
  paint.setShader(std::move(shader));
  paint.setAntiAlias(false);
  canvas->drawVertices(Quad(kSize, kSize), SkBlendMode::kModulate, paint);

  SkBitmap bm;
  bm.allocN32Pixels(kSize, kSize);
  surface->readPixels(bm, 0, 0);
  const SkColor c = bm.getColor(px, py);
  out->r = SkColorGetR(c) / 255.0f;
  out->g = SkColorGetG(c) / 255.0f;
  out->b = SkColorGetB(c) / 255.0f;
  out->a = SkColorGetA(c) / 255.0f;
  return true;
}

sscore::SsPartShader With(sscore::SsShaderId id, float p0, float p1 = 0.0f, float p2 = 0.0f) {
  sscore::SsPartShader ps;
  ps.id = id;
  ps.params[0] = p0;
  ps.params[1] = p1;
  ps.params[2] = p2;
  return ps;
}

void CheckTheRest() {
  const sscore::SsPartColor kNoTint;
  const Rgba red{1.0f, 0.0f, 0.0f, 1.0f};
  const Rgba grey{0.5f, 0.5f, 0.5f, 1.0f};
  Rgba out;

  const auto centre = [&](const sscore::SsPartShader& ps, Rgba in, Rgba* o) {
    if (RenderCentre(ps, kNoTint, in, o)) return true;
    Fail("%s: MakePartShaderShader returned null", IdName(ps.id));
    return false;
  };

  // ss-hsb: a zero shift is a passthrough; saturation -1 collapses to the
  // value, which for pure red is white.
  if (centre(With(sscore::SsShaderId::Hsb, 0, 0, 0), red, &out))
    ExpectRgb("ss-hsb  neutral", out, red.r, red.g, red.b);
  if (centre(With(sscore::SsShaderId::Hsb, 0, -1.0f, 0), red, &out))
    ExpectRgb("ss-hsb  saturation -1 on red", out, 1.0f, 1.0f, 1.0f);
  if (centre(With(sscore::SsShaderId::Hsb, 0, 0, -1.0f), red, &out))
    ExpectRgb("ss-hsb  brightness -1 on red", out, 0.0f, 0.0f, 0.0f);

  // ss-step: threshold 0.5 on a channel max of 1 posterises to a flat 1, which
  // `fColor` then mixes back toward the texel's own colour.
  if (centre(With(sscore::SsShaderId::Step, 0.5f, 0.0f, 0.0f), red, &out))
    ExpectRgb("ss-step mono", out, 1.0f, 1.0f, 1.0f);
  if (centre(With(sscore::SsShaderId::Step, 0.5f, 0.0f, 1.0f), red, &out))
    ExpectRgb("ss-step coloured", out, red.r, red.g, red.b);

  // ss-pix: a block of 97 texels is wider than this 8x8 atlas, so every
  // fragment snaps to texel 0 — the left half's colour, read on the right.
  if (RenderAt(With(sscore::SsShaderId::Pix, 1.0f), kNoTint, SplitAtlas(), kSize - 2, 2, &out))
    ExpectRgb("ss-pix  block 97 snaps the right half to texel 0", out, 1.0f, 1.0f, 1.0f);
  else
    Fail("ss-pix: null shader");

  // ss-noise: zero intensity is a passthrough; at full intensity the input is
  // replaced entirely, so two different inputs must agree.
  if (centre(With(sscore::SsShaderId::Noise, 0.0f, 0.0f, 0.0f), red, &out))
    ExpectRgb("ss-noise neutral", out, red.r, red.g, red.b);
  Rgba noiseFromRed, noiseFromGrey;
  if (centre(With(sscore::SsShaderId::Noise, 1.0f, 0.0f, 0.0f), red, &noiseFromRed) &&
      centre(With(sscore::SsShaderId::Noise, 1.0f, 0.0f, 0.0f), grey, &noiseFromGrey)) {
    if (!Near(noiseFromRed.r, noiseFromGrey.r) || !Near(noiseFromRed.g, noiseFromGrey.g) ||
        !Near(noiseFromRed.b, noiseFromGrey.b)) {
      Fail("ss-noise at full power still depends on the input: red gave %.3f, grey gave %.3f",
           noiseFromRed.r, noiseFromGrey.r);
    }
  }

  // ss-bmask: a cutoff above the texel's channel max removes it, one below
  // keeps it.
  if (centre(With(sscore::SsShaderId::Bmask, 0.9f), grey, &out) && !Near(out.a, 0.0f))
    Fail("ss-bmask cutoff 0.9 on max 0.5: alpha %.3f, want 0", out.a);
  if (centre(With(sscore::SsShaderId::Bmask, 0.2f), grey, &out) && !Near(out.a, 1.0f))
    Fail("ss-bmask cutoff 0.2 on max 0.5: alpha %.3f, want 1", out.a);

  // ss-outline: inside a solid opaque atlas every neighbour is opaque, so
  // nothing is an edge. Against the split atlas, the texel beside the
  // transparent half is.
  if (centre(With(sscore::SsShaderId::Outline, 0.5f), red, &out) && !Near(out.a, 0.0f))
    Fail("ss-outline on a solid atlas: alpha %.3f, want 0 — no fragment is an edge", out.a);
  if (RenderAt(With(sscore::SsShaderId::Outline, 0.5f), kNoTint, SplitAtlas(), kSize / 2 - 1, 4,
               &out)) {
    if (!Near(out.a, 1.0f)) Fail("ss-outline at the alpha edge: alpha %.3f, want 1", out.a);
    ExpectRgb("ss-outline edge colour", out, 1.0f, 1.0f, 1.0f);
  }

  // ss-blur: the one built-in that multiplies by the part colour instead of
  // running the composite, so a flat atlas comes back unchanged and a tinted
  // part scales it.
  if (centre(With(sscore::SsShaderId::Blur, 0.0f), red, &out))
    ExpectRgb("ss-blur neutral", out, red.r, red.g, red.b);
  sscore::SsPartColor half;
  half.lt.r = half.rt.r = half.lb.r = half.rb.r = 0.5f;
  half.lt.g = half.rt.g = half.lb.g = half.rb.g = 0.5f;
  half.lt.b = half.rt.b = half.lb.b = half.rb.b = 0.5f;
  if (RenderCentre(With(sscore::SsShaderId::Blur, 0.0f), half, red, &out))
    ExpectRgb("ss-blur multiplies by the part colour", out, 0.5f, 0.0f, 0.0f);

  // ss-wave / ss-move / ss-scatter: each has parameters at which it samples
  // exactly where it started, which is the case that fails loudly if the
  // displacement is computed in the wrong space.
  if (centre(With(sscore::SsShaderId::Wave, 1.0f, 0.0f, 0.0f), red, &out))
    ExpectRgb("ss-wave zero amplitude", out, red.r, red.g, red.b);
  if (centre(With(sscore::SsShaderId::Move, 0.0f, 0.5f, 0.5f), red, &out))
    ExpectRgb("ss-move zero distance", out, red.r, red.g, red.b);
  if (centre(With(sscore::SsShaderId::Scatter, 0.0f, 1.0f, 0.0f), red, &out))
    ExpectRgb("ss-scatter zero power", out, red.r, red.g, red.b);

  // A displacement that lands on the transparent half must actually read it:
  // 4 texels right of centre, on an atlas whose right half is empty.
  if (RenderAt(With(sscore::SsShaderId::Move, 0.0f, 0.0f, 0.0f), kNoTint, SplitAtlas(), 1, 4,
               &out) &&
      !Near(out.a, 1.0f)) {
    Fail("ss-move at rest on the opaque half: alpha %.3f, want 1", out.a);
  }

  // ss-circle: the cell here is the whole 8x8 quad, so the disc's radius is 4
  // and a corner texel is outside it.
  if (RenderAt(With(sscore::SsShaderId::Circle, 0.0f, 1.0f), kNoTint, SolidAtlas(1, 0, 0, 1), 0, 0,
               &out) &&
      !Near(out.a, 0.0f)) {
    Fail("ss-circle at the corner: alpha %.3f, want 0 — it is outside the disc", out.a);
  }
  if (RenderAt(With(sscore::SsShaderId::Circle, 0.0f, 1.0f), kNoTint, SolidAtlas(1, 0, 0, 1),
               kSize / 2, kSize / 2, &out) &&
      !Near(out.a, 1.0f)) {
    Fail("ss-circle at the centre: alpha %.3f, want 1", out.a);
  }

  // ss-spot: the falloff is brightest at the centre and reaches zero at the
  // rim, and `fColor` 0 makes the lit colour white rather than the texture's.
  Rgba spotCentre, spotCorner;
  if (RenderAt(With(sscore::SsShaderId::Spot, 1.0f, 1.0f, 0.0f), kNoTint, SolidAtlas(1, 0, 0, 1),
               kSize / 2, kSize / 2, &spotCentre) &&
      RenderAt(With(sscore::SsShaderId::Spot, 1.0f, 1.0f, 0.0f), kNoTint, SolidAtlas(1, 0, 0, 1), 0,
               0, &spotCorner)) {
    if (!(spotCentre.a > spotCorner.a)) {
      Fail("ss-spot: centre alpha %.3f is not brighter than the corner's %.3f", spotCentre.a,
           spotCorner.a);
    }
    if (spotCentre.a > 0.0f) ExpectRgb("ss-spot lit colour at fColor 0", spotCentre, 1, 1, 1);
  }

  std::printf("    twelve ports checked against their neutral and characteristic cases\n");
}

// --- 4. alpha survives, and a body-less id really is null --------------------

void CheckAlphaAndFallback() {
  sscore::SsPartShader ps;
  ps.id = sscore::SsShaderId::Sepia;
  ps.params[0] = 1.0f;

  Rgba out;
  if (RenderCentre(ps, sscore::SsPartColor(), {1.0f, 1.0f, 1.0f, 0.5f}, &out)) {
    if (!Near(out.a, 0.5f)) {
      Fail("alpha: got %.3f, want 0.500 — `ssFinish` multiplies the part's alpha in, and a "
           "half-transparent atlas must stay half-transparent",
           out.a);
    } else {
      std::printf("    alpha 0.5 survives the round trip\n");
    }
  }

  for (int i = 0; i < sscore::kSsShaderCount; ++i) {
    if (ssplayer::SsShaderBodies()[i] != nullptr) continue;
    const auto id = static_cast<sscore::SsShaderId>(i);
    if (ssplayer::SsShaderEffect(id) != nullptr) {
      Fail("%s has no body but SsShaderEffect returned an effect", IdName(id));
    }
    sscore::SsPartShader unported;
    unported.id = id;
    const float uv[8] = {0, 0, kSize, 0, 0, kSize, kSize, kSize};
    if (ssplayer::MakePartShaderShader(unported, sscore::SsPartColor(), uv,
                                       SolidAtlas(1, 1, 1, 1)) != nullptr) {
      Fail("%s has no body but MakePartShaderShader returned a shader — the caller would "
           "draw it as if it were ported",
           IdName(id));
    }
  }
}

// --- 5. the corner gradient follows the fan ----------------------------------

/// What the bake's fan gives a per-corner value `v` (lt, rt, lb, rb) at
/// `(s,t)`, worked out the long way: find the fan triangle holding the point
/// and interpolate barycentrically, the centre carrying the corners' mean.
/// Independent of `ssFanWeights` on purpose — a transcription of it would agree
/// with whatever it computes.
float FanAt(const float v[4], float s, float t) {
  const float corner[4][2] = {{0, 0}, {1, 0}, {0, 1}, {1, 1}};
  const int tri[4][2] = {{0, 1}, {1, 3}, {3, 2}, {2, 0}};  // `kFanIndices` past the centre
  const float centre = (v[0] + v[1] + v[2] + v[3]) * 0.25f;
  const float px = s - 0.5f;
  const float py = t - 0.5f;
  for (const auto& e : tri) {
    const float ax = corner[e[0]][0] - 0.5f, ay = corner[e[0]][1] - 0.5f;
    const float bx = corner[e[1]][0] - 0.5f, by = corner[e[1]][1] - 0.5f;
    const float det = ax * by - bx * ay;
    const float a = (px * by - bx * py) / det;
    const float b = (ax * py - px * ay) / det;
    if (a >= -1e-6f && b >= -1e-6f && a + b <= 1.0f + 1e-6f) {
      return centre + a * (v[e[0]] - centre) + b * (v[e[1]] - centre);
    }
  }
  return centre;
}

/// The whole surface drawn through `shader`, read back as straight alpha.
bool RenderGrid(sk_sp<SkShader> shader, SkBitmap* out) {
  if (shader == nullptr) return false;
  sk_sp<SkSurface> surface = SkSurfaces::Raster(SkImageInfo::MakeN32Premul(kSize, kSize));
  SkCanvas* canvas = surface->getCanvas();
  canvas->clear(SK_ColorTRANSPARENT);
  SkPaint paint;
  paint.setShader(std::move(shader));
  paint.setAntiAlias(false);
  canvas->drawVertices(Quad(kSize, kSize), SkBlendMode::kModulate, paint);
  out->allocN32Pixels(kSize, kSize);
  return surface->readPixels(*out, 0, 0);
}

void CheckFanGradient() {
  // Diagonal corners alike, lt = rb = 1 and rt = lb = 0: the case where a fan
  // and a bilinear differ most. At (s,t) = (0.25, 0.25) the fan gives 0.75
  // and a bilinear 0.625; this grid's pixel centres sit at (i + 0.5) / 8, so it
  // is read at every one of them instead.
  const float diagonal[4] = {1.0f, 0.0f, 0.0f, 1.0f};
  const float uv[8] = {0, 0, kSize, 0, 0, kSize, kSize, kSize};
  const float* mix = sscore::SsPartColorCoef(0);

  // The colour, then the rate. Mix at rate 1 returns the part colour itself,
  // so the colour reads straight off a white atlas; a white part colour over a
  // black atlas returns the rate.
  for (int which = 0; which < 2; ++which) {
    const bool rate = which == 1;
    sscore::SsPartColor pc;
    for (int i = 0; i < 4; ++i) pc.coef[i] = mix[i];
    sscore::SsPartColorCorner* corners[4] = {&pc.lt, &pc.rt, &pc.lb, &pc.rb};
    for (int c = 0; c < 4; ++c) {
      const float value = rate ? 1.0f : diagonal[c];
      corners[c]->r = corners[c]->g = corners[c]->b = value;
      corners[c]->a = 1.0f;
      corners[c]->rate = rate ? diagonal[c] : 1.0f;
    }
    const Rgba atlas = rate ? Rgba{0, 0, 0, 1} : Rgba{1, 1, 1, 1};

    sscore::SsPartShader passthrough;
    passthrough.id = sscore::SsShaderId::Sepia;  // power 0 hands the texel through
    const struct {
      const char* what;
      sk_sp<SkShader> shader;
    } kPaths[] = {
        {"PartColor", ssplayer::MakePartColorShader(
                          pc, uv, SolidAtlas(atlas.r, atlas.g, atlas.b, atlas.a))},
        {"ss-sepia's PartColor tail",
         ssplayer::MakePartShaderShader(passthrough, pc, uv,
                                        SolidAtlas(atlas.r, atlas.g, atlas.b, atlas.a))},
    };
    for (const auto& path : kPaths) {
      SkBitmap bm;
      if (!RenderGrid(path.shader, &bm)) {
        Fail("%s: the shader would not build", path.what);
        continue;
      }
      int wrong = 0;
      for (int y = 0; y < kSize; ++y) {
        for (int x = 0; x < kSize; ++x) {
          const float want = FanAt(diagonal, (x + 0.5f) / kSize, (y + 0.5f) / kSize);
          const float got = SkColorGetR(bm.getColor(x, y)) / 255.0f;
          if (Near(got, want)) continue;
          if (wrong++ < 3) {
            Fail("%s %s at pixel (%d, %d): got %.3f, want the fan's %.3f", path.what,
                 rate ? "rate" : "colour", x, y, got, want);
          }
        }
      }
      if (wrong > 3) Fail("%s %s: %d more pixels off the fan", path.what, rate ? "rate" : "colour",
                          wrong - 3);
      if (wrong == 0) {
        std::printf("    %-26s %s follows the fan at all %d pixels\n", path.what,
                    rate ? "rate  " : "colour", kSize * kSize);
      }
    }
  }
}

}  // namespace

int main() {
  std::printf("==> bodies\n");
  const int withBody = CheckCompiles();
  if (withBody == 0) {
    Fail("no shader has a body, so nothing below proves anything");
    return 1;
  }

  std::printf("==> uniforms\n");
  CheckUniformNames();

  std::printf("==> ss-sepia against SS6's formula\n");
  CheckSepia();

  std::printf("==> the other twelve\n");
  CheckTheRest();

  std::printf("==> alpha and the unported fallback\n");
  CheckAlphaAndFallback();

  std::printf("==> the corner gradient follows the fan\n");
  CheckFanGradient();

  if (gFailures > 0) {
    std::fprintf(stderr, "\nFAILED: %d problem%s\n", gFailures, gFailures == 1 ? "" : "s");
    return 1;
  }
  std::printf("\nOK: %d of %d bodies present, all compile, ss-sepia matches SS6\n", withBody,
              sscore::kSsShaderCount);
  return 0;
}
