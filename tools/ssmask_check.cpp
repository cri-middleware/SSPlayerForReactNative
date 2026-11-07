// Host-side guard for the mask draw path.
//
// `ssbake_check` covers the plan — roles, scope, ranges — but the plan was never
// the fragile half. Everything that actually broke lived on the Skia side and
// broke *silently*: the coverage image came back null, so `masking` stayed false
// and every target drew unmasked. Nothing threw, nothing logged, and the plan
// still reported seven healthy writers. That is the failure this program exists
// to make loud.
//
// Six checks, in order of how early they would catch a regression:
//
//   1. **The SkSL compiles.** Runtime effects are ES2-restricted, so an ordinary
//      -looking edit (a bitwise operator, a non-constant loop bound) fails at
//      runtime on a device and degrades to "no mask" rather than to an error.
//   2. **The coverage encoding round-trips, bit for bit.** The bits ride through
//      an 8-bit image and a colour-managed sampler, and any transfer function
//      between the two decodes as writers that never covered the pixel. Checked
//      for all 96 bits, through the real write *and* replay shaders.
//   2b. **A deformed target reads the coverage where it is drawn.** Its corners
//      are not a parallelogram, so the replay has to weight their coverage UVs
//      over the fan the part is drawn as; any other weighting reads the mask a
//      few pixels from the part.
//   3. **The whole path still masks something.** The real `DrawBakedFrame` over
//      a real `.ssab`, rendered twice — with the mask input and without — and
//      the two framebuffers must differ. This is the one that catches "the
//      coverage silently became null" again. The masked frame must also open
//      no layer: each one is an offscreen render on the UI thread every frame.
//   4. **A mask reaches into an instance child.** The same draw, over a scene
//      whose mask has to cross an instance boundary. One mount at
//      a time, against the pack's real atlases, with the caller's coverage
//      withheld / its transform zeroed / its polarity flipped as controls.
//      **Skipped when its pack is not deployed** — it needs sample art this
//      repository does not ship.
//   5. **The coverage is kept while its writers stand still.** One frame drawn
//      twice through one scratch must reuse the first coverage image and draw
//      the same pixels as a fresh one; a new atlas must replace it. A kept
//      image that went stale would mask with last frame's shapes.
//
// macOS only: it links the `libskia.a` that RN Skia ships for the host, which
// has no Linux slice. Build and run: tools/check-mask.sh

#include <algorithm>
#include <cmath>
#include <cstdarg>
#include <cstdio>
#include <cstdlib>
#include <vector>

#include "include/core/SkBitmap.h"
#include "include/core/SkCanvas.h"
#include "include/core/SkColorSpace.h"
#include "include/core/SkImage.h"
#include "include/core/SkPaint.h"
#include "include/core/SkPicture.h"
#include "include/core/SkPictureRecorder.h"
#include "include/core/SkShader.h"
#include "include/core/SkData.h"
#include "include/core/SkString.h"
#include "include/core/SkSurface.h"
#include "include/core/SkVertices.h"
#include "include/effects/SkRuntimeEffect.h"
#include "include/encode/SkPngEncoder.h"
#include "include/utils/SkNoDrawCanvas.h"

#include "../packages/react-native-spritestudio/cpp/SsAnimeBinary.hpp"
#include "../packages/react-native-spritestudio/cpp/SsBaker.hpp"
#include "../packages/react-native-spritestudio/cpp/SsInstance.hpp"
#include "../packages/react-native-spritestudio/cpp/SsMask.hpp"
#include "../packages/react-native-spritestudio/cpp/SsMaskShader.hpp"
#include "../packages/react-native-spritestudio/cpp/SsSkiaDraw.hpp"

extern "C" {
void* ss_resource_create_copy(const unsigned char* ptr, size_t len);
void ss_resource_destroy(void* resource);
void* ss_runtime_create(void);
void ss_runtime_destroy(void* context);
bool ss_runtime_bind_resource(void* context, void* resource);
bool ss_runtime_setup_animation(void* context, const char* name);
void ss_runtime_set_render_mode(void* context, uint8_t mode);
void ss_runtime_play(void* context);
float ss_runtime_update(void* context, float delta);
bool ss_runtime_get_frame_data(void* context, float frame_no, const unsigned char** out_data,
                               size_t* out_len);
void ss_runtime_get_world_matrices(void* context, const float** out_data, size_t* out_len);
void ss_runtime_get_local_vertices(void* context, const float** out_data, size_t* out_len);
void ss_runtime_get_local_uvs(void* context, const float** out_data, size_t* out_len);
void ss_runtime_get_cell_meta(void* context, const float** out_data, size_t* out_len);
void ss_runtime_get_mesh_vertices_x(void* context, const float** out_data, size_t* out_len);
void ss_runtime_get_mesh_vertices_y(void* context, const float** out_data, size_t* out_len);
void ss_runtime_get_mesh_vertex_offsets(void* context, const uint32_t** out_data,
                                        size_t* out_len);
void ss_runtime_get_mesh_uvs(void* context, const float** out_data, size_t* out_len);
void ss_runtime_get_mesh_indices(void* context, const int32_t** out_data, size_t* out_len);
void ss_runtime_get_mesh_index_offsets(void* context, const uint32_t** out_data, size_t* out_len);
// Shape. Not optional here even though only check 3 and 4 load a `.ssab`: a
// converted Spine clipping arrives as a Shape mask, so without these a pack
// whose every writer is a Shape presents as a pack with no writers at all.
void ss_runtime_get_shape_vertices(void* context, const float** out_data, size_t* out_len);
void ss_runtime_get_shape_vertex_box_coords(void* context, const float** out_data,
                                            size_t* out_len);
void ss_runtime_get_shape_vertex_counts(void* context, const int32_t** out_data, size_t* out_len);
const unsigned char* ss_runtime_get_ssab_buf(void* context);
uintptr_t ss_runtime_get_ssab_len(void* context);
}

namespace {

int g_failures = 0;

void Fail(const char* fmt, ...) {
  std::va_list args;
  va_start(args, fmt);
  std::fprintf(stderr, "FAIL ");
  std::vfprintf(stderr, fmt, args);
  va_end(args);
  std::fprintf(stderr, "\n");
  ++g_failures;
}

bool Exists(const char* path) {
  std::FILE* f = std::fopen(path, "rb");
  if (f == nullptr) return false;
  std::fclose(f);
  return true;
}

std::vector<uint8_t> ReadFile(const char* path) {
  std::FILE* f = std::fopen(path, "rb");
  if (f == nullptr) {
    std::fprintf(stderr, "cannot open %s\n", path);
    std::exit(2);
  }
  std::fseek(f, 0, SEEK_END);
  const long size = std::ftell(f);
  std::fseek(f, 0, SEEK_SET);
  std::vector<uint8_t> bytes(static_cast<size_t>(size));
  if (std::fread(bytes.data(), 1, bytes.size(), f) != bytes.size()) {
    std::fprintf(stderr, "short read on %s\n", path);
    std::exit(2);
  }
  std::fclose(f);
  return bytes;
}

/// An opaque atlas, so the cutout never removes a writer for want of a real
/// texture — this program is testing the encoding, not the threshold.
sk_sp<SkShader> WhiteAtlas() {
  SkBitmap bm;
  bm.allocN32Pixels(16, 16, true);
  bm.eraseARGB(255, 255, 255, 255);
  bm.setImmutable();
  return bm.asImage()->makeShader(SkTileMode::kRepeat, SkTileMode::kRepeat,
                                  SkSamplingOptions(SkFilterMode::kNearest));
}

/// The same, in a colour nothing else in the frame draws.
///
/// Check 4 asks whether a *mounted child* lost pixels, and a child painted the
/// same white as the scene behind it loses none that a framebuffer diff can see
/// — masking it away just reveals more white. The first version of that check
/// passed vacuously for exactly this reason.
sk_sp<SkShader> GreenAtlas() {
  SkBitmap bm;
  bm.allocN32Pixels(16, 16, true);
  bm.eraseARGB(255, 0, 255, 0);
  bm.setImmutable();
  return bm.asImage()->makeShader(SkTileMode::kRepeat, SkTileMode::kRepeat,
                                  SkSamplingOptions(SkFilterMode::kNearest));
}

/// The `[x0, x1) x [0, h)` slice of a box as `SkVertices`, positions and
/// texcoords equal, so the replay's `(s,t)` reconstruction is the identity on
/// the unit box and the coverage UV weighting is exercised without a cell's UV
/// layout in the way.
sk_sp<SkVertices> SliceQuad(float x0, float x1, float h) {
  const SkPoint pos[4] = {{x0, 0}, {x1, 0}, {x0, h}, {x1, h}};
  const uint16_t idx[6] = {0, 1, 2, 1, 3, 2};
  return SkVertices::MakeCopy(SkVertices::kTriangles_VertexMode, 4, pos, pos, nullptr, 6, idx);
}

sk_sp<SkVertices> UnitQuad(float w, float h) { return SliceQuad(0.0f, w, h); }

// --- 1. the shaders compile ------------------------------------------------

void CheckShadersCompile() {
  // Through the effects the draw path calls, not a private compile of the SkSL
  // text: the replay only compiles with `ssFanWeights` ahead of it, and those
  // functions are where that is put together.
  const struct {
    const char* name;
    SkRuntimeEffect* (*effect)();
  } kAll[] = {
      {"mask-write", ssplayer::SsMaskWriteEffect},
      {"mask-replay", ssplayer::SsMaskReplayEffect},
  };
  for (const auto& s : kAll) {
    if (s.effect() == nullptr) {
      Fail("%s did not compile (runtime effects are ES2 — no bitwise ops) — see the "
           "[SsPlayer] line above",
           s.name);
    }
  }
}

// --- 2. the coverage encoding round-trips ----------------------------------

constexpr int kW = 64;
constexpr int kH = 16;

/// One writer for `BuildCoverage`: its bit, the horizontal slice of the box it
/// covers (as a fraction of the width), and whether it goes down flat.
struct CoverSpec {
  int bit;
  float x0;
  float x1;
  bool flat;
};

/// Builds a coverage image exactly the way `SsSkiaDraw::BuildCoverage` does: the
/// bit in **alpha**, one 8-bit plane per 8 writers, planes laid out in the grid
/// `SsMaskCoverageGrid` gives, in one deferred picture image.
///
/// **The colour space is not a parameter, and that is the point.** `drawInto`
/// runs on a *recording* canvas, which has no colour space at all, so
/// `BuildCoverage`'s "match the destination" fallback is taken every single
/// time and the coverage is **always** sRGB. Handing this the destination's
/// space — which is what this program used to do — wires src and dst together,
/// makes every conversion the identity by construction, and tests nothing. It
/// is why an RGB encoding that six of `Mask.ssab`'s nine writers did not
/// survive on a Display P3 destination passed here for a whole phase.
ssplayer::SsMaskCoverage BuildCoverage(const std::vector<CoverSpec>& specs, int w, int h) {
  ssplayer::SsMaskCoverage out;

  int planeCount = 1;
  for (const CoverSpec& spec : specs) {
    planeCount = std::max(planeCount, ssplayer::SsMaskBitPlane(spec.bit) + 1);
  }
  int columns = 1;
  int rows = 1;
  ssplayer::SsMaskCoverageGrid(planeCount, &columns, &rows);

  SkPictureRecorder recorder;
  SkCanvas* canvas = recorder.beginRecording(SkRect::MakeIWH(w * columns, h * rows));

  for (const CoverSpec& spec : specs) {
    sscore::SsMaskWriter writer;
    writer.bit = spec.bit;
    writer.threshold = 0.0f;

    SkPaint cover;
    if (spec.flat) {
      // The Shape-writer path: no atlas to threshold, so the bit goes down as a
      // flat colour — black, with the bit in alpha. Stating no colour space is
      // correct here and was not when the bit lived in RGB: alpha is not
      // colour-managed, so there is nothing for a destination to convert.
      cover.setColor4f({0.0f, 0.0f, 0.0f, ssplayer::SsMaskBitAlpha(spec.bit)}, nullptr);
    } else {
      cover.setShader(ssplayer::MakeMaskWriteShader(writer, WhiteAtlas()));
    }
    cover.setBlendMode(SkBlendMode::kPlus);
    cover.setAntiAlias(false);
    const int plane = ssplayer::SsMaskBitPlane(spec.bit);
    canvas->save();
    canvas->translate(static_cast<float>(ssplayer::SsMaskPlaneColumn(plane) * w),
                      static_cast<float>(ssplayer::SsMaskPlaneRow(plane) * h));
    canvas->drawVertices(SliceQuad(spec.x0 * w, spec.x1 * w, static_cast<float>(h)),
                         SkBlendMode::kModulate, cover);
    canvas->restore();
  }

  // Non-null, because a null colour space makes `DeferredFromPicture` return
  // null outright — whatever its doc comment says — and the whole mask then
  // silently does nothing.
  ssplayer::SsSetMaskCoverageImage(
      out, SkImages::DeferredFromPicture(recorder.finishRecordingAsPicture(),
                                         SkISize::Make(w * columns, h * rows), nullptr,
                                         nullptr, SkImages::BitDepth::kU8,
                                         SkColorSpace::MakeSRGB()));
  out.width = w;
  out.height = h;
  out.planeCount = planeCount;
  return out;
}

/// Replays `bits` over the whole box and reports the alpha a few px inside each
/// half. `visibleInside` is true throughout, so a pixel a writer in the set
/// covered must be KEPT and one it did not must be dropped.
///
/// `dstCs` is the **destination's** colour space; the coverage's is fixed at
/// sRGB, because that is the pairing production actually has. Anything Skia
/// does between the two lands on the bits.
bool ReplayHalves(const ssplayer::SsMaskCoverage& coverage, const sscore::SsMaskBits& bits,
                  sk_sp<SkColorSpace> dstCs, int* leftA, int* rightA) {
  const float uv[8] = {0, 0, kW, 0, 0, kH, kW, kH};
  const float covUv[8] = {0, 0, 1, 0, 0, 1, 1, 1};
  sk_sp<SkShader> replay = ssplayer::MakeMaskReplayShader(WhiteAtlas(), coverage, bits, uv, covUv);
  if (replay == nullptr) return false;

  sk_sp<SkSurface> surface = SkSurfaces::Raster(SkImageInfo::MakeN32Premul(kW, kH, dstCs));
  SkCanvas* canvas = surface->getCanvas();
  canvas->clear(SK_ColorTRANSPARENT);
  SkPaint paint;
  paint.setShader(std::move(replay));
  paint.setAntiAlias(false);
  canvas->drawVertices(UnitQuad(kW, kH), SkBlendMode::kModulate, paint);

  SkBitmap out;
  out.allocN32Pixels(kW, kH);
  surface->readPixels(out, 0, 0);
  // Sampled a few px inside each half so a rounding disagreement at the seam is
  // not read as a decode failure.
  *leftA = SkColorGetA(out.getColor(4, kH / 2));
  *rightA = SkColorGetA(out.getColor(kW - 5, kH / 2));
  return true;
}

/// Every bit, one at a time, covering the left half of the box.
void CheckBitRoundTrip(const char* label, sk_sp<SkColorSpace> dstCs, bool flat = false) {
  for (int bit = 0; bit < sscore::kSsMaxMaskWriters; ++bit) {
    const ssplayer::SsMaskCoverage coverage =
        BuildCoverage({{bit, 0.0f, 0.5f, flat}}, kW, kH);
    if (!coverage.valid()) {
      // Exactly the regression that shipped: a null image disables masking with
      // no other symptom.
      Fail("%s bit %d: coverage image is null (DeferredFromPicture rejects a null "
           "colour space — the mask then silently does nothing)",
           label, bit);
      return;
    }

    sscore::SsMaskBits bits;
    bits.set(bit, false);
    bits.visibleInside = true;

    int left = 0;
    int right = 0;
    if (!ReplayHalves(coverage, bits, dstCs, &left, &right)) {
      Fail("%s bit %d: replay shader would not build", label, bit);
      return;
    }
    if (left == 0) {
      Fail("%s bit %d: covered half was dropped — the bit did not survive the "
           "image round-trip (a colour-space transform is decoding it away, or "
           "plane %d is being read at the wrong band)",
           label, bit, ssplayer::SsMaskBitPlane(bit));
    }
    if (right != 0) {
      Fail("%s bit %d: uncovered half survived — a bit is being read that no "
           "writer set",
           label, bit);
    }
  }
}

/// Writers in planes of different grid cells, covering different halves — so a
/// plane read at the wrong cell, or one plane's bits leaking into another's
/// decode, shows up as the wrong half surviving.
///
/// `Mask.ssab` itself reaches two planes (nine writers), and an instance tree
/// like `InstancePropagationTired3` reaches the fourth column: its 80 writers
/// are ten planes.
void CheckPlaneIsolation(const char* label, sk_sp<SkColorSpace> dstCs) {
  const ssplayer::SsMaskCoverage coverage =
      BuildCoverage({{1, 0.0f, 0.5f, false},
                     {9, 0.5f, 1.0f, false},
                     {17, 0.0f, 1.0f, true},
                     {26, 0.0f, 0.5f, false},
                     {90, 0.5f, 1.0f, true}},
                    kW, kH);
  if (!coverage.valid()) {
    Fail("%s: coverage image is null", label);
    return;
  }
  if (coverage.planeCount != 12) {
    Fail("%s: %d planes built for bits reaching the twelfth", label, coverage.planeCount);
    return;
  }

  const struct {
    const char* what;
    int bits[2];
    int bitCount;
    bool wantLeft;
    bool wantRight;
  } kCases[] = {
      {"plane 0 (bit 1), left half", {1}, 1, true, false},
      {"plane 1 (bit 9), right half", {9}, 1, false, true},
      {"plane 2 (bit 17), whole box", {17}, 1, true, true},
      {"plane 3, column 1 (bit 26), left half", {26}, 1, true, false},
      {"plane 11, column 3 (bit 90), right half", {90}, 1, false, true},
      {"planes 0+1, both halves", {1, 9}, 2, true, true},
  };
  for (const auto& c : kCases) {
    sscore::SsMaskBits bits;
    for (int i = 0; i < c.bitCount; ++i) bits.set(c.bits[i], false);
    bits.visibleInside = true;

    int left = 0;
    int right = 0;
    if (!ReplayHalves(coverage, bits, dstCs, &left, &right)) {
      Fail("%s / %s: replay shader would not build", label, c.what);
      return;
    }
    if ((left != 0) != c.wantLeft) {
      Fail("%s / %s: left half %s — a plane is being read at the wrong band", label, c.what,
           c.wantLeft ? "was dropped" : "survived");
    }
    if ((right != 0) != c.wantRight) {
      Fail("%s / %s: right half %s — a plane is being read at the wrong band", label, c.what,
           c.wantRight ? "was dropped" : "survived");
    }
  }
}

// --- 2b. a deformed target reads the coverage where it is drawn -------------

/// One target whose corners are not a parallelogram — `rb` pulled in, as a
/// vertex deformation does — drawn as the bake's fan over a coverage that
/// covers the left of the box. The coverage UV is the position over the box,
/// so every pixel's answer follows from where it is: kept left of the seam,
/// dropped right of it. A bilinear replay got 12 of this target's pixels wrong,
/// inside the part and clear of the seam: it read the mask from where the part
/// was not drawn.
void CheckDeformedTarget() {
  constexpr int kN = 64;
  constexpr float kSeam = 24.0f;
  const ssplayer::SsMaskCoverage coverage =
      BuildCoverage({{0, 0.0f, kSeam / kN, false}}, kN, kN);
  if (!coverage.valid()) {
    Fail("deformed target: coverage image is null");
    return;
  }

  // lt, rt, lb, rb, then the centre at the corners' mean, which is where the
  // Brain puts a deformed part's fifth vertex. The texcoords are the cell's,
  // which a deformation does not move.
  SkPoint pos[5] = {{0, 0}, {kN, 0}, {0, kN}, {24, 48}, {0, 0}};
  pos[4] = {(pos[0].fX + pos[1].fX + pos[2].fX + pos[3].fX) * 0.25f,
            (pos[0].fY + pos[1].fY + pos[2].fY + pos[3].fY) * 0.25f};
  const SkPoint tex[5] = {{0, 0}, {kN, 0}, {0, kN}, {kN, kN}, {kN * 0.5f, kN * 0.5f}};
  const uint16_t fan[12] = {4, 0, 1, 4, 1, 3, 4, 3, 2, 4, 2, 0};
  const float uv[8] = {0, 0, kN, 0, 0, kN, kN, kN};
  float covUv[8];
  for (int c = 0; c < 4; ++c) {
    covUv[c * 2] = pos[c].fX / kN;
    covUv[c * 2 + 1] = pos[c].fY / kN;
  }

  sscore::SsMaskBits bits;
  bits.set(0, false);
  bits.visibleInside = true;
  sk_sp<SkShader> replay =
      ssplayer::MakeMaskReplayShader(WhiteAtlas(), coverage, bits, uv, covUv);
  if (replay == nullptr) {
    Fail("deformed target: replay shader would not build");
    return;
  }

  sk_sp<SkSurface> surface = SkSurfaces::Raster(SkImageInfo::MakeN32Premul(kN, kN));
  SkCanvas* canvas = surface->getCanvas();
  canvas->clear(SK_ColorTRANSPARENT);
  SkPaint paint;
  paint.setShader(std::move(replay));
  paint.setAntiAlias(false);
  canvas->drawVertices(
      SkVertices::MakeCopy(SkVertices::kTriangles_VertexMode, 5, pos, tex, nullptr, 12, fan),
      SkBlendMode::kModulate, paint);
  SkBitmap out;
  out.allocN32Pixels(kN, kN);
  surface->readPixels(out, 0, 0);

  // The outline, lt -> rt -> rb -> lb. A pixel within a pixel of it, or of the
  // seam, is left out: what is asked is where the mask is read, not how an
  // edge rasterises.
  const SkPoint ring[4] = {pos[0], pos[1], pos[3], pos[2]};
  const auto deepInside = [&](float x, float y) {
    for (int e = 0; e < 4; ++e) {
      const SkPoint a = ring[e];
      const SkPoint b = ring[(e + 1) % 4];
      const float cross = (b.fX - a.fX) * (y - a.fY) - (b.fY - a.fY) * (x - a.fX);
      if (cross / SkPoint::Length(b.fX - a.fX, b.fY - a.fY) < 1.0f) return false;
    }
    return true;
  };
  int checked = 0;
  int wrong = 0;
  for (int y = 0; y < kN; ++y) {
    for (int x = 0; x < kN; ++x) {
      const float cx = x + 0.5f;
      const float cy = y + 0.5f;
      if (!deepInside(cx, cy) || std::fabs(cx - kSeam) < 1.0f) continue;
      ++checked;
      const bool kept = SkColorGetA(out.getColor(x, y)) != 0;
      if (kept != (cx < kSeam)) {
        if (wrong < 4) {
          Fail("deformed target: pixel (%d, %d) %s — the mask was read from where the part "
               "is not drawn",
               x, y, kept ? "survived right of the seam" : "was dropped left of it");
        }
        ++wrong;
      }
    }
  }
  if (wrong > 4) Fail("deformed target: %d more pixels like these", wrong - 4);
  if (wrong == 0) std::printf("    %d pixels, each read at its own position\n", checked);
}

// --- a loaded, baked pack --------------------------------------------------

/// One `.ssab` played to a frame and baked, with everything the draw path wants.
///
/// Hoisted out of check 3 because check 4 needs **two** of them at once: a mask
/// that crosses an instance boundary has a caller and a callee, and they are
/// separate packs with separate runtimes.
struct Baked {
  void* resource = nullptr;
  void* ctx = nullptr;
  std::vector<sscore::SsMaskPartFlags> flags;
  sscore::SsBaker baker;

  ~Baked() {
    if (ctx != nullptr) ss_runtime_destroy(ctx);
    if (resource != nullptr) ss_resource_destroy(resource);
  }

  /// `animation` may be null, which takes the pack's first — the same default
  /// the player uses when a subject names none.
  bool load(const char* ssabPath, const char* animation, int atFrame) {
    const std::vector<uint8_t> ssab = ReadFile(ssabPath);
    resource = ss_resource_create_copy(ssab.data(), ssab.size());
    ctx = ss_runtime_create();
    if (resource == nullptr || ctx == nullptr || !ss_runtime_bind_resource(ctx, resource)) {
      Fail("could not bind %s", ssabPath);
      return false;
    }
    ss_runtime_set_render_mode(ctx, 0);

    const sscore::SsAnimeBinaryView view(ss_runtime_get_ssab_buf(ctx),
                                         static_cast<size_t>(ss_runtime_get_ssab_len(ctx)));
    std::string first;
    if (animation == nullptr) {
      if (view.animationCount() == 0) {
        Fail("%s has no animations", ssabPath);
        return false;
      }
      const std::string_view name = view.animationName(0);
      first.assign(name.data(), name.size());
      animation = first.c_str();
    }
    if (!ss_runtime_setup_animation(ctx, animation)) {
      Fail("setup_animation('%s') on %s failed", animation, ssabPath);
      return false;
    }
    ss_runtime_play(ctx);
    flags = view.maskFlags();

    float frameNo = 0.0f;
    for (int i = 0; i < atFrame; ++i) frameNo = ss_runtime_update(ctx, 1000.0f / 60.0f);

    const unsigned char* fdPtr = nullptr;
    size_t fdLen = 0;
    ss_runtime_get_frame_data(ctx, frameNo, &fdPtr, &fdLen);
    if (fdPtr == nullptr) {
      Fail("%s has no frame data at frame %d", ssabPath, atFrame);
      return false;
    }
    fd = ss::runtime::GetFrameData(fdPtr);

    sscore::SsSoAPointers soa;
    size_t len = 0;
    ss_runtime_get_world_matrices(ctx, &soa.worldMatrices, &len);
    soa.partCount = len / 16;
    ss_runtime_get_local_vertices(ctx, &soa.localVertices, &len);
    ss_runtime_get_local_uvs(ctx, &soa.localUvs, &len);
    ss_runtime_get_cell_meta(ctx, &soa.cellMeta, &len);
    ss_runtime_get_mesh_vertices_x(ctx, &soa.meshVerticesX, &soa.meshVertexCount);
    ss_runtime_get_mesh_vertices_y(ctx, &soa.meshVerticesY, &len);
    ss_runtime_get_mesh_vertex_offsets(ctx, &soa.meshVertexOffsets, &soa.meshVertexOffsetCount);
    ss_runtime_get_mesh_uvs(ctx, &soa.meshUvs, &soa.meshUvCount);
    ss_runtime_get_mesh_indices(ctx, &soa.meshIndices, &soa.meshIndexCount);
    ss_runtime_get_mesh_index_offsets(ctx, &soa.meshIndexOffsets, &soa.meshIndexOffsetCount);
    ss_runtime_get_shape_vertices(ctx, &soa.shapeVertices, &soa.shapeVertexCount);
    ss_runtime_get_shape_vertex_box_coords(ctx, &soa.shapeBoxCoords, &soa.shapeBoxCoordCount);
    ss_runtime_get_shape_vertex_counts(ctx, &soa.shapeVertexCounts, &soa.shapeVertexCountCount);

    baker.bake(fd, soa);
    return true;
  }

  const ss::runtime::FrameData* fd = nullptr;
};

// --- 3. the whole path still masks -----------------------------------------

/// Renders `.ssab` twice, with and without the mask input, and requires the two
/// framebuffers to differ.
void CheckEndToEnd(const char* ssabPath, const char* animation, int atFrame) {
  Baked pack;
  if (!pack.load(ssabPath, animation, atFrame)) return;
  const std::vector<sscore::SsMaskPartFlags>& flags = pack.flags;
  const sscore::SsBaker& baker = pack.baker;

  sscore::SsMaskPlan plan;
  if (!plan.build(pack.fd, baker, flags.data(), flags.size())) {
    Fail("%s / %s has no mask writers at frame %d — this check needs a pack that "
         "actually masks, or it proves nothing",
         ssabPath, animation, atFrame);
    return;
  }

  SkPaint paint;
  paint.setShader(WhiteAtlas());
  const ::ssplayer::SsPaintBinding binding{0u, &paint};

  constexpr int kSize = 512;
  const auto render = [&](bool withMask, SkBitmap* out) {
    sk_sp<SkSurface> surface = SkSurfaces::Raster(SkImageInfo::MakeN32Premul(kSize, kSize));
    SkCanvas* canvas = surface->getCanvas();
    canvas->clear(SK_ColorBLACK);
    // The root transform, applied once, exactly as the harness does it.
    canvas->translate(kSize / 2.0f, kSize / 2.0f);
    canvas->scale(1.0f, -1.0f);

    ::ssplayer::SsMaskInput input;
    if (withMask) {
      input.plan = &plan;
      input.flags = flags.data();
      input.flagCount = flags.size();
    }
    ::ssplayer::DrawBakedFrame(canvas, &binding, 1, baker, input);
    out->allocN32Pixels(kSize, kSize);
    surface->readPixels(*out, 0, 0);
  };

  SkBitmap plain;
  SkBitmap masked;
  render(false, &plain);
  render(true, &masked);

  size_t differing = 0;
  size_t litPlain = 0;
  size_t litMasked = 0;
  for (int y = 0; y < kSize; ++y) {
    for (int x = 0; x < kSize; ++x) {
      const SkColor a = plain.getColor(x, y);
      const SkColor b = masked.getColor(x, y);
      if (a != b) ++differing;
      if (a != SK_ColorBLACK) ++litPlain;
      if (b != SK_ColorBLACK) ++litMasked;
    }
  }

  std::printf("    %s / %s @%d: %zu writers, lit %zu -> %zu, %zu px differ\n", ssabPath,
              animation, atFrame, plan.writers().size(), litPlain, litMasked, differing);
  if (differing == 0) {
    Fail("the mask changed nothing — %zu writers were planned and none reached the "
         "framebuffer",
         plan.writers().size());
  }

  struct LayerCounter : SkNoDrawCanvas {
    LayerCounter() : SkNoDrawCanvas(kSize, kSize) {}
    int layers = 0;
    SaveLayerStrategy getSaveLayerStrategy(const SaveLayerRec& rec) override {
      ++layers;
      return SkNoDrawCanvas::getSaveLayerStrategy(rec);
    }
  } counter;
  ::ssplayer::SsMaskInput input;
  input.plan = &plan;
  input.flags = flags.data();
  input.flagCount = flags.size();
  ::ssplayer::DrawBakedFrame(&counter, &binding, 1, baker, input);
  if (counter.layers != 0) {
    Fail("the masked frame opened %d layer%s — each is an offscreen render every frame",
         counter.layers, counter.layers == 1 ? "" : "s");
  }
}

// --- 4. the mask crosses into an instance child -----------------------------

/// The pack's real atlases, keyed by `DrawBatch.texture_hash`.
///
/// Check 3 gets away with one opaque white shader because it only asks whether
/// *anything* masked. Check 4 cannot: the cutout reads the writer's texel
/// alpha, so a flat atlas makes every writer cover its whole quad. Here that
/// turns three arch shapes into three overlapping rectangles, and with the
/// invert OP their parity comes out as vertical stripes that no authored mask
/// has — the child then lands in a stripe that happens to be even, and the
/// check concludes the mask never reached it. The real PNGs are the difference
/// between testing this asset and testing a rectangle.
struct Atlases {
  std::vector<SkPaint> paints;
  std::vector<::ssplayer::SsPaintBinding> bindings;

  bool load(const sscore::SsAnimeBinaryView& view, const char* dir) {
    const uint32_t count = view.textureCount();
    paints.reserve(count);
    for (uint32_t i = 0; i < count; ++i) {
      const sscore::SsTextureEntry tex = view.textureAt(i);
      sk_sp<SkData> encoded;
      if (tex.embedded != nullptr && tex.embeddedLength > 0) {
        encoded = SkData::MakeWithCopy(tex.embedded, tex.embeddedLength);
      } else if (!tex.imagePath.empty()) {
        char path[512];
        std::snprintf(path, sizeof(path), "%s/%.*s", dir, static_cast<int>(tex.imagePath.size()),
                      tex.imagePath.data());
        encoded = SkData::MakeFromFileName(path);
        if (encoded == nullptr) {
          Fail("cannot read %s, which %.*s names", path, static_cast<int>(tex.name.size()),
               tex.name.data());
          return false;
        }
      }
      sk_sp<SkImage> image = SkImages::DeferredFromEncodedData(std::move(encoded));
      if (image == nullptr) {
        Fail("%.*s did not decode", static_cast<int>(tex.name.size()), tex.name.data());
        return false;
      }
      SkPaint paint;
      // Nearest and clamp, so a texel's alpha reaches the threshold as it was
      // authored rather than blended with its neighbour.
      paint.setShader(image->makeShader(SkTileMode::kClamp, SkTileMode::kClamp,
                                        SkSamplingOptions(SkFilterMode::kNearest)));
      paints.push_back(std::move(paint));
    }
    // Filled after the vector has stopped growing: `PaintFor` keeps the pointer.
    for (uint32_t i = 0; i < count; ++i) {
      bindings.push_back({view.textureAt(i).textureHash, &paints[i]});
    }
    return count > 0;
  }
};

/// Stands in for `HybridSsContext`'s two halves: it records what the mount
/// composed for each instance part, then draws the child exactly as layer 2 does
/// — the caller's plan and coverage, this player's own flags.
///
/// **That mirroring is not itself pinned here.** The composition arithmetic
/// (the AND and OR, `M_child`) lives in `SsSkiaDraw.cpp` and is what
/// the assertions below read; the seven lines that carry it into the child's
/// `DrawBakedFrame` live in `HybridSsContext.cpp`, which this program cannot
/// link. The example's `MaskInstance` card is what covers those.
struct MountRecorder : ::ssplayer::SsInstanceRenderer {
  const Baked* child = nullptr;
  const ::ssplayer::SsPaintBinding* bindings = nullptr;
  size_t bindingCount = 0;

  /// Which mount to draw, or -1 for all of them.
  ///
  /// One at a time, always. `Walk_Gate` mounts two characters at the **same**
  /// transform and `True_Light` three, so a frame drawn with all of them shows
  /// an unmasked copy sitting exactly on top of the masked one — every pixel a
  /// mask removed is painted straight back by the mount next to it, and the
  /// comparison reads "the mask did nothing".
  int32_t onlyPart = -1;

  /// False reproduces the behaviour before the inheritance landed: the child
  /// draws, and nothing about the caller's mask reaches it.
  bool forward = true;
  /// Overrides, each isolating one field the draw path is supposed to honour.
  bool forceInside = false;
  bool dropSlotXf = false;
  /// Drops the handed-over coverage, leaving the child to rasterise the
  /// caller's plan against its own geometry — which is what this file did before
  /// that hand-over was implemented.
  bool dropCoverage = false;

  struct Seen {
    uint32_t partIndex;
    bool gotPlan;
    bool gotCoverage;
    bool mounted;
    sscore::SsMaskContext context;
    float slotXf[6];
    size_t drawn;
  };
  std::vector<Seen> seen;

  /// The child's ranks on the tree sequence. `HybridSsContext` numbers the
  /// whole tree; here the caller's plan was built from its ranks alone, so the
  /// child sits between its instance part's rank and the next one.
  std::vector<float> seq;

  size_t drawInstance(void* canvas, uint32_t partIndex, float alphaScale,
                      const ::ssplayer::SsMaskInput& mask) override {
    Seen record{partIndex,    mask.plan != nullptr, mask.coverage != nullptr,
                mask.mounted, mask.context,         {}, 0};
    for (int i = 0; i < 6; ++i) record.slotXf[i] = mask.slotXf[i];
    if (onlyPart >= 0 && static_cast<uint32_t>(onlyPart) != partIndex) {
      seen.push_back(record);
      return 0;
    }

    ::ssplayer::SsMaskInput input;
    input.flags = child->flags.data();
    input.flagCount = child->flags.size();
    input.mounted = true;
    if (forward && mask.plan != nullptr) {
      input.plan = mask.plan;
      input.coverage = dropCoverage ? nullptr : mask.coverage;
      input.context = mask.context;
      input.context.visibleInside = forceInside || mask.context.visibleInside;
      for (int i = 0; i < 6; ++i) {
        input.slotXf[i] = dropSlotXf ? (i == 0 || i == 3 ? 1.0f : 0.0f) : mask.slotXf[i];
      }
      input.seq = seq.data();
      input.seqCount = seq.size();
    }
    record.drawn = ::ssplayer::DrawBakedFrame(canvas, bindings, bindingCount, child->baker, input);
    seen.push_back(record);
    return record.drawn;
  }
};

/// `Walk_Gate` mounts the same character pack twice and marks **one** of the two
/// as a mask target, so the AND has a positive and a negative case inside a
/// single frame — which is why this check names that file rather than building a
/// synthetic pair.
void CheckInstanceInheritance(const char* dir, const char* parentFile, const char* animation,
                              const char* childFile, int atFrame) {
  char parentPathBuf[512];
  char childPathBuf[512];
  std::snprintf(parentPathBuf, sizeof(parentPathBuf), "%s/%s", dir, parentFile);
  std::snprintf(childPathBuf, sizeof(childPathBuf), "%s/%s", dir, childFile);
  const char* parentPath = parentPathBuf;
  const char* childPath = childPathBuf;

  // Skipped, not failed. This check needs `example/SpriteStudio_Source/Mask/`,
  // which is third-party sample art this repository does not ship — so an
  // absence here is the normal state of a fresh clone, and the other three
  // checks still say everything they said before. It is loud about it because a
  // silent skip is how a check stops being run at all.
  if (!Exists(parentPath)) {
    std::printf("    SKIPPED: %s is not deployed.\n", parentPath);
    std::printf("    This one needs the SpriteStudio `Mask` sample in\n");
    std::printf("    example/SpriteStudio_Source/Mask/ — see README.md — and then\n");
    std::printf("    `pnpm run deploy-examples`. Nothing else here depends on it.\n");
    return;
  }
  Baked parent;
  if (!parent.load(parentPath, animation, atFrame)) return;

  // The animation **the parent names**, not the pack's first — `Instance_Maid`
  // opens on `Stand` and the scene mounts `Walk`. Both poses happen to sit in
  // the same place, so this is not what the comparisons below turn on; it is
  // here so the check is drawing the scene the asset describes rather than one
  // assembled out of whatever came first.
  const sscore::SsAnimeBinaryView parentView(
      ss_runtime_get_ssab_buf(parent.ctx),
      static_cast<size_t>(ss_runtime_get_ssab_len(parent.ctx)));
  std::string childAnimation;
  for (const sscore::SsInstancePart& part : parentView.instanceParts()) {
    if (part.partIndex < parent.flags.size() && parent.flags[part.partIndex].isTarget()) {
      childAnimation = part.animeName;
      break;
    }
  }
  if (childAnimation.empty()) {
    Fail("%s / %s mounts nothing on a mask target", parentPath, animation);
    return;
  }

  Baked child;
  if (!child.load(childPath, childAnimation.c_str(), atFrame)) return;

  sscore::SsMaskPlan plan;
  if (!plan.build(parent.fd, parent.baker, parent.flags.data(), parent.flags.size())) {
    Fail("%s / %s plans no mask at frame %d — this check needs one that does",
         parentPath, animation, atFrame);
    return;
  }
  if (parent.baker.instances().empty()) {
    Fail("%s / %s mounts nothing at frame %d", parentPath, animation, atFrame);
    return;
  }

  // The caller draws through its real atlases, because its writers' coverage is
  // what the child is tested against. The child draws through a flat colour it
  // alone uses: these comparisons count *its* pixels, and a sprite sharing the
  // scene's palette cannot be counted.
  Atlases atlases;
  if (!atlases.load(parentView, dir)) return;
  SkPaint childPaint;
  childPaint.setShader(GreenAtlas());
  const ::ssplayer::SsPaintBinding childBinding{0u, &childPaint};

  constexpr int kSize = 512;
  const auto render = [&](MountRecorder& renderer, SkBitmap* out) {
    renderer.child = &child;
    renderer.bindings = &childBinding;
    renderer.bindingCount = 1;
    sk_sp<SkSurface> surface = SkSurfaces::Raster(SkImageInfo::MakeN32Premul(kSize, kSize));
    SkCanvas* canvas = surface->getCanvas();
    canvas->clear(SK_ColorBLACK);
    canvas->translate(kSize / 2.0f, kSize / 2.0f);
    // Scaled down as well as flipped: these scenes are ~1180 player-local units
    // wide, and at 1:1 the mounts would land outside a 512 box entirely — which
    // would make every comparison below trivially "no pixels differ".
    canvas->scale(0.4f, -0.4f);

    ::ssplayer::SsMaskInput input;
    input.plan = &plan;
    input.flags = parent.flags.data();
    input.flagCount = parent.flags.size();
    ::ssplayer::DrawBakedFrame(canvas, atlases.bindings.data(), atlases.bindings.size(),
                               parent.baker, input, &renderer);
    out->allocN32Pixels(kSize, kSize);
    surface->readPixels(*out, 0, 0);
  };

  /// Pixels the *child* put on screen, which is the only population these
  /// comparisons are about — the parent draws identically in all four renders.
  const auto count = [&](const SkBitmap& bm) {
    size_t mine = 0;
    for (int y = 0; y < kSize; ++y) {
      for (int x = 0; x < kSize; ++x) {
        const SkColor c2 = bm.getColor(x, y);
        if (SkColorGetG(c2) > SkColorGetR(c2) && SkColorGetG(c2) > SkColorGetB(c2)) ++mine;
      }
    }
    return mine;
  };
  const auto differ = [&](const SkBitmap& a, const SkBitmap& b) {
    size_t n = 0;
    for (int y = 0; y < kSize; ++y) {
      for (int x = 0; x < kSize; ++x) {
        if (a.getColor(x, y) != b.getColor(x, y)) ++n;
      }
    }
    return n;
  };

  // The parent draws identically in every render below, and only one mount ever
  // draws at a time, so every differing pixel belongs to the mount under test.
  const sscore::SsAnimeBinaryView& view = parentView;
  size_t crossed = 0;
  size_t targets = 0;
  for (const sscore::SsInstanceDraw& mount : parent.baker.instances()) {
    const std::string_view name = view.partName(mount.partIndex);
    const bool isTarget =
        mount.partIndex < parent.flags.size() && parent.flags[mount.partIndex].isTarget();
    if (isTarget) ++targets;

    MountRecorder inherit;
    MountRecorder isolated;
    MountRecorder identityXf;
    MountRecorder inside;
    MountRecorder rebuilt;
    isolated.forward = false;
    identityXf.dropSlotXf = true;
    inside.forceInside = true;
    rebuilt.dropCoverage = true;
    const auto* childOrder = child.fd->draw_order();
    const size_t childRanks = childOrder != nullptr ? childOrder->size() : 0;
    for (MountRecorder* r : {&inherit, &isolated, &identityXf, &inside, &rebuilt}) {
      r->onlyPart = static_cast<int32_t>(mount.partIndex);
      r->seq.assign(childRanks, static_cast<float>(mount.drawRank) + 0.5f);
    }

    SkBitmap a, b, c, d, e;
    render(inherit, &a);
    render(isolated, &b);
    render(identityXf, &c);
    render(inside, &d);
    render(rebuilt, &e);

    const MountRecorder::Seen* seen = nullptr;
    for (const MountRecorder::Seen& s2 : inherit.seen) {
      if (s2.partIndex == mount.partIndex) seen = &s2;
    }
    if (seen == nullptr) {
      Fail("%.*s never reached the renderer", static_cast<int>(name.size()), name.data());
      continue;
    }

    std::printf("    %.*s: rank %d target=%d plan=%d coverage=%d drawn=%zu, px %zu -> %zu\n",
                static_cast<int>(name.size()), name.data(), mount.drawRank, isTarget ? 1 : 0,
                seen->gotPlan ? 1 : 0, seen->gotCoverage ? 1 : 0, seen->drawn, count(b), count(a));

    // The plan goes down on every mount — a mask inside the child, or a
    // grandchild whose instance part opts in, can need it whatever this
    // instance part says. What the instance part decides rides in the context.
    if (!seen->gotPlan || !seen->mounted) {
      Fail("%.*s was handed %s%s", static_cast<int>(name.size()), name.data(),
           seen->gotPlan ? "a plan" : "no plan", seen->mounted ? "" : ", as a root");
    }
    // The AND, read off real data rather than a constructed case: these
    // scenes mark some mounts as mask targets and some not, in the same frame.
    if (seen->context.influence != isTarget) {
      Fail("%.*s is%s a mask target but its child's context says %d — the AND",
           static_cast<int>(name.size()), name.data(), isTarget ? "" : " not",
           seen->context.influence ? 1 : 0);
    }
    if (!isTarget) {
      // The child's own parts are composed with `mask_influence == 0`, so the
      // caller's plan changes none of them. This is the half that separates
      // "composition works" from "everything under an instance part gets masked".
      if (differ(a, b) != 0) {
        Fail("%.*s is not a mask target, yet forwarding changed %zu px",
             static_cast<int>(name.size()), name.data(), differ(a, b));
      }
      continue;
    }
    if (seen->drawn == 0 || count(b) == 0) {
      Fail("%.*s put nothing on screen — its comparisons would pass vacuously",
           static_cast<int>(name.size()), name.data());
      continue;
    }
    if (!seen->gotCoverage) {
      Fail("%.*s was handed a plan with no coverage. It would rasterise the "
           "caller's writers against its own geometry and mask nothing",
           static_cast<int>(name.size()), name.data());
    }
    for (int i = 0; i < 6; ++i) {
      if (seen->slotXf[i] != mount.m[i]) {
        Fail("%.*s's slotXf[%d] is %f, but the mount matrix says %f",
             static_cast<int>(name.size()), name.data(), i, seen->slotXf[i], mount.m[i]);
        break;
      }
    }
    // A target out of the writers' scope is handed the plan and correctly
    // masked by none of it, so only the *presence* of one crossing is required.
    if (count(a) < count(b)) {
      ++crossed;
      if (differ(a, c) == 0) {
        Fail("%.*s: zeroing `slotXf` changed nothing, so its vertices are not "
             "being carried into the caller's coverage space (M_child)",
             static_cast<int>(name.size()), name.data());
      }
      if (differ(a, d) == 0) {
        Fail("%.*s: forcing `visible_inside` changed nothing, so the OR is "
             "not reaching the replay",
             static_cast<int>(name.size()), name.data());
      }
      // The coverage hand-over, stated as a difference rather than as a rule: a child
      // left to rasterise the caller's plan against its own geometry does not
      // arrive at the same answer. It does not merely mask *less* — the writers
      // in that plan are the caller's parts, so the shapes it draws are whatever
      // sits at those indices here. Both directions are wrong, which is why this
      // asks for "different" and not "empty".
      if (differ(a, e) == 0) {
        Fail("%.*s: rebuilding the coverage on the child gave the same frame as "
             "receiving the caller's. One of the two is not doing what it says",
             static_cast<int>(name.size()), name.data());
      }
    }
  }

  if (targets == 0 || targets == parent.baker.instances().size()) {
    Fail("%s / %s has %zu of %zu mounts as mask targets — this check needs both "
         "cases in one frame to tell composition from a blanket rule",
         parentPath, animation, targets, parent.baker.instances().size());
  }
  if (crossed == 0) {
    Fail("no mount lost a pixel to the caller's mask. Either the coverage stops "
         "at the instance boundary, or this frame has every child clear of it");
  }
}

// --- 5. the coverage is kept while its writers stand still -----------------

void CheckCoverageKept(const char* ssabPath, const char* animation, int atFrame) {
  Baked pack;
  if (!pack.load(ssabPath, animation, atFrame)) return;
  sscore::SsMaskPlan plan;
  if (!plan.build(pack.fd, pack.baker, pack.flags.data(), pack.flags.size())) {
    Fail("%s / %s has no mask writers at frame %d", ssabPath, animation, atFrame);
    return;
  }

  SkPaint white;
  white.setShader(WhiteAtlas());
  SkPaint green;
  green.setShader(GreenAtlas());

  constexpr int kSize = 512;
  const auto render = [&](SkPaint* paint, ::ssplayer::SsDrawScratch* scratch, SkBitmap* out) {
    sk_sp<SkSurface> surface = SkSurfaces::Raster(SkImageInfo::MakeN32Premul(kSize, kSize));
    SkCanvas* canvas = surface->getCanvas();
    canvas->clear(SK_ColorBLACK);
    canvas->translate(kSize / 2.0f, kSize / 2.0f);
    canvas->scale(1.0f, -1.0f);
    ::ssplayer::SsMaskInput input;
    input.plan = &plan;
    input.flags = pack.flags.data();
    input.flagCount = pack.flags.size();
    const ::ssplayer::SsPaintBinding binding{0u, paint};
    ::ssplayer::DrawBakedFrame(canvas, &binding, 1, pack.baker, input, nullptr, scratch);
    out->allocN32Pixels(kSize, kSize);
    surface->readPixels(*out, 0, 0);
  };
  const auto keptImage = [](const ::ssplayer::SsDrawScratch& scratch) -> const SkImage* {
    return scratch.coverage != nullptr ? scratch.coverage->image.get() : nullptr;
  };

  ::ssplayer::SsDrawScratch scratch;
  SkBitmap first;
  SkBitmap again;
  SkBitmap fresh;
  SkBitmap recoloured;
  render(&white, &scratch, &first);
  const SkImage* kept = keptImage(scratch);
  if (kept == nullptr) {
    Fail("the first frame kept no coverage");
    return;
  }
  render(&white, &scratch, &again);
  if (keptImage(scratch) != kept) Fail("an unchanged frame rebuilt its coverage");
  render(&white, nullptr, &fresh);
  size_t differing = 0;
  for (int y = 0; y < kSize; ++y) {
    for (int x = 0; x < kSize; ++x) {
      if (again.getColor(x, y) != fresh.getColor(x, y)) ++differing;
    }
  }
  if (differing != 0) {
    Fail("the kept coverage draws %zu px differently from a fresh one", differing);
  }
  render(&green, &scratch, &recoloured);
  if (keptImage(scratch) == kept) Fail("a new atlas kept the old coverage");
  std::printf("    kept across an unchanged frame (%zu px differ from a fresh build), "
              "rebuilt for a new atlas\n",
              differing);
}

}  // namespace

int main(int argc, char** argv) {
  const char* ssab = argc > 1 ? argv[1] : "example/assets/ss/overall/Mask.ssab";
  const char* animation = argc > 2 ? argv[2] : "anime_1";
  const int frame = argc > 3 ? std::atoi(argv[3]) : 30;

  std::printf("==> the mask SkSL compiles\n");
  CheckShadersCompile();

  std::printf("==> the coverage encoding round-trips, all %d bits\n", sscore::kSsMaxMaskWriters);
  // The coverage is sRGB in every one of these, because it is sRGB in
  // production; what varies is the destination it is sampled into. RN Skia's
  // Android surface is unmanaged and its Apple one is Display P3 whenever the
  // screen's gamut is, so these are not hypothetical destinations — they are
  // the two this package actually ships onto.
  CheckBitRoundTrip("unmanaged dst", nullptr);
  CheckBitRoundTrip("sRGB dst", SkColorSpace::MakeSRGB());
  // **Wide gamut, and it is not hypothetical**: an iOS surface is routinely
  // Display P3 while the Android emulator is sRGB, so this is the one axis on
  // which the two platforms genuinely disagree — and the first bug it caught
  // showed up as three unrelated parts masking wrongly on iOS only.
  sk_sp<SkColorSpace> p3 =
      SkColorSpace::MakeRGB(SkNamedTransferFn::kSRGB, SkNamedGamut::kDisplayP3);
  CheckBitRoundTrip("Display P3 dst", p3);
  // The Shape writer's flat-colour path, which the shader cases never touch.
  CheckBitRoundTrip("unmanaged dst, flat writer", nullptr, true);
  CheckBitRoundTrip("sRGB dst, flat writer", SkColorSpace::MakeSRGB(), true);
  CheckBitRoundTrip("Display P3 dst, flat writer", p3, true);

  std::printf("==> the coverage planes stay apart\n");
  CheckPlaneIsolation("unmanaged dst", nullptr);
  CheckPlaneIsolation("sRGB dst", SkColorSpace::MakeSRGB());
  CheckPlaneIsolation("Display P3 dst", p3);

  std::printf("==> a deformed target reads the coverage where it is drawn\n");
  CheckDeformedTarget();

  std::printf("==> the whole draw path still masks\n");
  CheckEndToEnd(ssab, animation, frame);

  std::printf("==> the mask reaches into an instance child\n");
  // Frame 150, and **not** `frame`: that one belongs to check 3 and to another
  // pack. `Walk_gate` walks its characters across the scene over ~300 frames, so
  // most of them have the mounts clear of the gate entirely — a true statement
  // about the asset and a useless one about masking. 150 is inside the crossing,
  // where the mask takes roughly two thirds of the child.
  CheckInstanceInheritance("example/assets/ss/MaskInstance", "Walk_Gate.ssab", "Walk_gate",
                           "Instance_Maid.ssab", 150);

  std::printf("==> the coverage is kept while its writers stand still\n");
  CheckCoverageKept(ssab, animation, frame);

  if (g_failures > 0) {
    std::fprintf(stderr, "\nFAILED: %d problems\n", g_failures);
    return 1;
  }
  std::printf("\nOK\n");
  return 0;
}
