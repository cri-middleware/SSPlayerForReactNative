// Host-side guard for the mask draw path.
//
// `ssbake_check` covers the plan — roles, scope, ranges — but the plan was never
// the fragile half. Everything that actually broke lived on the Skia side and
// broke *silently*: the coverage image came back null, so `masking` stayed false
// and every target drew unmasked. Nothing threw, nothing logged, and the plan
// still reported seven healthy writers. That is the failure this program exists
// to make loud.
//
// Three checks, in order of how early they would catch a regression:
//
//   1. **The SkSL compiles.** Runtime effects are ES2-restricted, so an ordinary
//      -looking edit (a bitwise operator, a non-constant loop bound) fails at
//      runtime on a device and degrades to "no mask" rather than to an error.
//   2. **The coverage encoding round-trips, bit for bit.** The bits ride through
//      an 8-bit image and a colour-managed sampler, and any transfer function
//      between the two decodes as writers that never covered the pixel. Checked
//      for all 24 bits, through the real write *and* replay shaders.
//   3. **The whole path still masks something.** The real `DrawBakedFrame` over
//      a real `.ssab`, rendered twice — with the mask input and without — and
//      the two framebuffers must differ. This is the one that catches "the
//      coverage silently became null" again.
//
// macOS only: it links the `libskia.a` that RN Skia ships for the host, which
// has no Linux slice. Build and run: tools/check-mask.sh

#include <algorithm>
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
#include "include/core/SkString.h"
#include "include/core/SkSurface.h"
#include "include/core/SkVertices.h"
#include "include/effects/SkRuntimeEffect.h"

#include "../packages/react-native-spritestudio/cpp/SsAnimeBinary.hpp"
#include "../packages/react-native-spritestudio/cpp/SsBaker.hpp"
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
void ss_runtime_get_frame_data(void* context, float frame_no, unsigned char** out_data,
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

/// An opaque atlas, so the §2-5 cutout never removes a writer for want of a real
/// texture — this program is testing the encoding, not the threshold.
sk_sp<SkShader> WhiteAtlas() {
  SkBitmap bm;
  bm.allocN32Pixels(16, 16, true);
  bm.eraseARGB(255, 255, 255, 255);
  bm.setImmutable();
  return bm.asImage()->makeShader(SkTileMode::kRepeat, SkTileMode::kRepeat,
                                  SkSamplingOptions(SkFilterMode::kNearest));
}

/// The `[x0, x1) x [0, h)` slice of a box as `SkVertices`, positions and
/// texcoords equal, so the replay's `(s,t)` reconstruction is the identity on
/// the unit box and the coverage UV bilinear is exercised without a cell's UV
/// layout in the way.
sk_sp<SkVertices> SliceQuad(float x0, float x1, float h) {
  const SkPoint pos[4] = {{x0, 0}, {x1, 0}, {x0, h}, {x1, h}};
  const uint16_t idx[6] = {0, 1, 2, 1, 3, 2};
  return SkVertices::MakeCopy(SkVertices::kTriangles_VertexMode, 4, pos, pos, nullptr, 6, idx);
}

sk_sp<SkVertices> UnitQuad(float w, float h) { return SliceQuad(0.0f, w, h); }

// --- 1. the shaders compile ------------------------------------------------

void CheckShadersCompile() {
  const struct {
    const char* name;
    const char* sksl;
  } kAll[] = {
      {"mask-write", ssplayer::kSsMaskWriteSkSL},
      {"mask-replay", ssplayer::kSsMaskReplaySkSL},
  };
  for (const auto& s : kAll) {
    SkRuntimeEffect::Result r = SkRuntimeEffect::MakeForShader(SkString(s.sksl));
    if (r.effect == nullptr) {
      Fail("%s did not compile (runtime effects are ES2 — no bitwise ops):\n%s", s.name,
           r.errorText.c_str());
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
/// bit in **alpha**, one 8-bit plane per 8 writers, planes stacked vertically in
/// one deferred picture image.
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

  SkPictureRecorder recorder;
  SkCanvas* canvas = recorder.beginRecording(SkRect::MakeIWH(w, h * planeCount));

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
    canvas->save();
    canvas->translate(0.0f, static_cast<float>(ssplayer::SsMaskBitPlane(spec.bit) * h));
    canvas->drawVertices(SliceQuad(spec.x0 * w, spec.x1 * w, static_cast<float>(h)),
                         SkBlendMode::kModulate, cover);
    canvas->restore();
  }

  // Non-null, because a null colour space makes `DeferredFromPicture` return
  // null outright — whatever its doc comment says — and the whole mask then
  // silently does nothing.
  out.image = SkImages::DeferredFromPicture(recorder.finishRecordingAsPicture(),
                                            SkISize::Make(w, h * planeCount), nullptr, nullptr,
                                            SkImages::BitDepth::kU8, SkColorSpace::MakeSRGB());
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
    bits.increment = 1u << bit;
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

/// Three writers, one per plane, covering different halves — so a plane read at
/// the wrong band offset, or one plane's bits leaking into another's decode,
/// shows up as the wrong half surviving.
///
/// This is the case `Mask.ssab` itself reaches: nine writers is two planes, and
/// nothing below eight writers ever leaves plane 0.
void CheckPlaneIsolation(const char* label, sk_sp<SkColorSpace> dstCs) {
  const ssplayer::SsMaskCoverage coverage = BuildCoverage(
      {{1, 0.0f, 0.5f, false}, {9, 0.5f, 1.0f, false}, {17, 0.0f, 1.0f, true}}, kW, kH);
  if (!coverage.valid()) {
    Fail("%s: coverage image is null", label);
    return;
  }
  if (coverage.planeCount != 3) {
    Fail("%s: %d planes built for bits spanning three of them", label, coverage.planeCount);
    return;
  }

  const struct {
    const char* what;
    uint32_t set;
    bool wantLeft;
    bool wantRight;
  } kCases[] = {
      {"plane 0 (bit 1), left half", 1u << 1, true, false},
      {"plane 1 (bit 9), right half", 1u << 9, false, true},
      {"plane 2 (bit 17), whole box", 1u << 17, true, true},
      {"planes 0+1, both halves", (1u << 1) | (1u << 9), true, true},
  };
  for (const auto& c : kCases) {
    sscore::SsMaskBits bits;
    bits.increment = c.set;
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

// --- 3. the whole path still masks -----------------------------------------

/// Renders `.ssab` twice, with and without the mask input, and requires the two
/// framebuffers to differ.
void CheckEndToEnd(const char* ssabPath, const char* animation, int atFrame) {
  const std::vector<uint8_t> ssab = ReadFile(ssabPath);
  void* resource = ss_resource_create_copy(ssab.data(), ssab.size());
  void* ctx = ss_runtime_create();
  if (resource == nullptr || ctx == nullptr || !ss_runtime_bind_resource(ctx, resource)) {
    Fail("could not bind %s", ssabPath);
    return;
  }
  ss_runtime_set_render_mode(ctx, 0);
  if (!ss_runtime_setup_animation(ctx, animation)) {
    Fail("setup_animation('%s') failed", animation);
    return;
  }
  ss_runtime_play(ctx);

  const sscore::SsAnimeBinaryView view(ss_runtime_get_ssab_buf(ctx),
                                       static_cast<size_t>(ss_runtime_get_ssab_len(ctx)));
  const std::vector<sscore::SsMaskPartFlags> flags = view.maskFlags();

  float frameNo = 0.0f;
  for (int i = 0; i < atFrame; ++i) frameNo = ss_runtime_update(ctx, 1000.0f / 60.0f);

  unsigned char* fdPtr = nullptr;
  size_t fdLen = 0;
  ss_runtime_get_frame_data(ctx, frameNo, &fdPtr, &fdLen);
  if (fdPtr == nullptr) {
    Fail("no frame data at frame %d", atFrame);
    return;
  }
  const ss::runtime::FrameData* fd = ss::runtime::GetFrameData(fdPtr);

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

  sscore::SsBaker baker;
  baker.bake(fd, soa);

  sscore::SsMaskPlan plan;
  if (!plan.build(fd, baker, flags.data(), flags.size())) {
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

  ss_runtime_destroy(ctx);
  ss_resource_destroy(resource);
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

  std::printf("==> the whole draw path still masks\n");
  CheckEndToEnd(ssab, animation, frame);

  if (g_failures > 0) {
    std::fprintf(stderr, "\nFAILED: %d problems\n", g_failures);
    return 1;
  }
  std::printf("\nOK\n");
  return 0;
}
