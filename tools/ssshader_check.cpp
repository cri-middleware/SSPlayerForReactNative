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
// transposed.
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
      // Not a failure: this is the documented fallback, and ROADMAP tracks the
      // twelve. It is printed so the count is visible when one lands.
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

  std::printf("==> alpha and the unported fallback\n");
  CheckAlphaAndFallback();

  if (gFailures > 0) {
    std::fprintf(stderr, "\nFAILED: %d problem%s\n", gFailures, gFailures == 1 ? "" : "s");
    return 1;
  }
  std::printf("\nOK: %d of %d bodies present, all compile, ss-sepia matches SS6\n", withBody,
              sscore::kSsShaderCount);
  return 0;
}
