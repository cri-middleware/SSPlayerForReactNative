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

/// One quad as `SkVertices`, positions and texcoords equal, so the replay's
/// `(s,t)` reconstruction is the identity on the unit box and the coverage UV
/// bilinear is exercised without a cell's UV layout in the way.
sk_sp<SkVertices> UnitQuad(float w, float h) {
  const SkPoint pos[4] = {{0, 0}, {w, 0}, {0, h}, {w, h}};
  const uint16_t idx[6] = {0, 1, 2, 1, 3, 2};
  return SkVertices::MakeCopy(SkVertices::kTriangles_VertexMode, 4, pos, pos, nullptr, 6, idx);
}

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

/// Builds a coverage bitmap in which `bit` covers the LEFT half of a `w x h`
/// box, exactly the way `SsSkiaDraw::BuildCoverage` does.
sk_sp<SkImage> CoverageWithBit(int bit, int w, int h, sk_sp<SkColorSpace> cs, bool flat) {
  sscore::SsMaskWriter writer;
  writer.bit = bit;
  writer.threshold = 0.0f;

  // Settled first, because a flat writer states its colour *in* it — see below.
  sk_sp<SkColorSpace> coverageCs = cs != nullptr ? cs : SkColorSpace::MakeSRGB();

  SkPictureRecorder recorder;
  SkCanvas* canvas = recorder.beginRecording(SkRect::MakeIWH(w, h));

  SkPaint cover;
  if (flat) {
    // The Shape-writer path: no atlas to threshold, so the bit goes down as a
    // flat colour. It has to be stated in the coverage's colour space — a null
    // there means sRGB, and on a wide-gamut destination Skia would convert it,
    // which turns a bit pattern into something that is not one.
    float rgb[3];
    ssplayer::SsMaskBitColor(bit, rgb);
    cover.setColor4f({rgb[0], rgb[1], rgb[2], 1.0f}, coverageCs.get());
  } else {
    cover.setShader(ssplayer::MakeMaskWriteShader(writer, WhiteAtlas()));
  }
  cover.setBlendMode(SkBlendMode::kPlus);
  cover.setAntiAlias(false);
  canvas->drawVertices(UnitQuad(static_cast<float>(w) / 2.0f, static_cast<float>(h)),
                       SkBlendMode::kModulate, cover);

  // The same fallback `BuildCoverage` applies: an unmanaged destination still
  // needs a non-null colour space here, because a null one makes
  // `DeferredFromPicture` return null outright.
  return SkImages::DeferredFromPicture(recorder.finishRecordingAsPicture(),
                                       SkISize::Make(w, h), nullptr, nullptr,
                                       SkImages::BitDepth::kU8, std::move(coverageCs));
}

/// Runs the replay over a full-box quad and reports whether each half survived.
///
/// `visibleInside` is true, so a pixel the writer covered must be KEPT and one it
/// did not must be dropped — the left half opaque, the right half transparent.
void CheckBitRoundTrip(const char* label, sk_sp<SkColorSpace> cs, bool flat = false) {
  constexpr int kW = 64;
  constexpr int kH = 16;

  for (int bit = 0; bit < sscore::kSsMaxMaskWriters; ++bit) {
    sk_sp<SkImage> coverage = CoverageWithBit(bit, kW, kH, cs, flat);
    if (coverage == nullptr) {
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

    const float uv[8] = {0, 0, kW, 0, 0, kH, kW, kH};
    const float covUv[8] = {0, 0, 1, 0, 0, 1, 1, 1};
    sk_sp<SkShader> replay =
        ssplayer::MakeMaskReplayShader(WhiteAtlas(), coverage, bits, uv, covUv);
    if (replay == nullptr) {
      Fail("%s bit %d: replay shader would not build", label, bit);
      return;
    }

    sk_sp<SkSurface> surface =
        SkSurfaces::Raster(SkImageInfo::MakeN32Premul(kW, kH, cs));
    SkCanvas* canvas = surface->getCanvas();
    canvas->clear(SK_ColorTRANSPARENT);
    SkPaint paint;
    paint.setShader(std::move(replay));
    paint.setAntiAlias(false);
    canvas->drawVertices(UnitQuad(kW, kH), SkBlendMode::kModulate, paint);

    SkBitmap out;
    out.allocN32Pixels(kW, kH);
    surface->readPixels(out, 0, 0);

    // Sampled a few px inside each half so a rounding disagreement at the seam
    // is not read as a decode failure.
    const SkColor inside = out.getColor(4, kH / 2);
    const SkColor outside = out.getColor(kW - 5, kH / 2);
    if (SkColorGetA(inside) == 0) {
      Fail("%s bit %d: covered half was dropped — the bit did not survive the "
           "image round-trip (a colour-space transform is decoding it away)",
           label, bit);
    }
    if (SkColorGetA(outside) != 0) {
      Fail("%s bit %d: uncovered half survived — a bit is being read that no "
           "writer set",
           label, bit);
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
  // Both destinations, because the coverage takes its colour space from the
  // canvas: an unmanaged one falls back to sRGB, a managed one must match.
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

  std::printf("==> the whole draw path still masks\n");
  CheckEndToEnd(ssab, animation, frame);

  if (g_failures > 0) {
    std::fprintf(stderr, "\nFAILED: %d problems\n", g_failures);
    return 1;
  }
  std::printf("\nOK\n");
  return 0;
}
