// Host-side guard for the FrameData read path.
//
// The reader itself is flatc-generated now (`cpp/format/framedata.h`), so field
// offsets no longer need diffing against a reference walk — `check-framedata.sh`
// regenerates that header and diffs it, which covers schema drift outright.
//
// What a static check cannot cover is a *stale committed header against a newer
// `native/libssruntime`*: the offsets are then internally consistent and simply
// wrong, and the failure is a silently misread buffer. So this program drives a
// real `.ssab` through the Brain and, for every frame:
//
//   1. runs `flatbuffers::Verifier` over the buffer — the structural check that
//      is deliberately *not* paid per-frame on device (see `refreshFrame()`);
//   2. bakes it with the shipping `SsBaker` under ASan, so an out-of-bounds walk
//      is a report here instead of a wrong pixel on a device;
//   3. asserts the baker's own range invariants.
//
// It includes the committed header, not a freshly generated one, on purpose:
// the header under test has to be the one that ships.
//
// Build and run: tools/check-framedata.sh

#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>

#include "../packages/react-native-spritestudio/cpp/SsBaker.hpp"

extern "C" {
void* ss_resource_create_copy(const unsigned char* ptr, size_t len);
void ss_resource_destroy(void* resource);
void* ss_runtime_create(void);
void ss_runtime_destroy(void* context);
bool ss_runtime_bind_resource(void* context, void* resource);
bool ss_runtime_setup_animation(void* context, const char* name);
void ss_runtime_set_render_mode(void* context, uint8_t mode);
float ss_runtime_update(void* context, float delta);
void ss_runtime_get_frame_data(void* context, float frame_no, unsigned char** out_data,
                               size_t* out_len);
void ss_runtime_get_world_matrices(void* context, const float** out_data, size_t* out_len);
void ss_runtime_get_local_vertices(void* context, const float** out_data, size_t* out_len);
void ss_runtime_get_local_uvs(void* context, const float** out_data, size_t* out_len);
void ss_runtime_get_cell_meta(void* context, const float** out_data, size_t* out_len);
}

namespace {

int g_failures = 0;

void Fail(const char* what, long long got, long long want, int frame, int index) {
  if (g_failures < 20) {
    std::fprintf(stderr, "FAIL frame %d, %s[%d]: got=%lld want<=%lld\n", frame, what, index, got,
                 want);
  }
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

/// The counts JS is handed come from two independent getters — `parts` out of
/// the FlatBuffer, and the part count out of the world-matrix length. Nothing
/// across the FFI enforces that they agree, and `getPlan()` clamps rather than
/// trusting them, so surface a disagreement here where it is diagnosable.
void CheckPartCounts(const ss::runtime::FrameData* fd, size_t soaPartCount, int frame) {
  const auto* parts = fd->parts();
  const uint32_t fbPartCount = parts != nullptr ? parts->size() : 0;
  if (fbPartCount != soaPartCount) {
    Fail("partCount(parts vs world matrices)", fbPartCount,
         static_cast<long long>(soaPartCount), frame, 0);
  }
}

}  // namespace

int main(int argc, char** argv) {
  if (argc < 3) {
    std::fprintf(stderr, "usage: ssbake_check <file.ssab> <animation> [frames]\n");
    return 2;
  }
  const char* ssabPath = argv[1];
  const char* animation = argv[2];
  const int frames = argc > 3 ? std::atoi(argv[3]) : 120;

  const std::vector<uint8_t> ssab = ReadFile(ssabPath);
  void* resource = ss_resource_create_copy(ssab.data(), ssab.size());
  if (resource == nullptr) {
    std::fprintf(stderr, "ss_resource_create_copy failed for %s\n", ssabPath);
    return 1;
  }
  void* ctx = ss_runtime_create();
  if (!ss_runtime_bind_resource(ctx, resource)) {
    std::fprintf(stderr, "ss_runtime_bind_resource failed\n");
    return 1;
  }
  ss_runtime_set_render_mode(ctx, 0);  // RenderMode::Direct
  if (!ss_runtime_setup_animation(ctx, animation)) {
    std::fprintf(stderr, "ss_runtime_setup_animation('%s') failed\n", animation);
    return 1;
  }

  sscore::SsBaker baker;
  size_t maxVertices = 0;
  size_t maxBatches = 0;

  for (int frame = 0; frame < frames; ++frame) {
    const float frameNo = ss_runtime_update(ctx, 1.0f / 60.0f);

    unsigned char* fdPtr = nullptr;
    size_t fdLen = 0;
    ss_runtime_get_frame_data(ctx, frameNo, &fdPtr, &fdLen);
    if (fdPtr == nullptr || fdLen == 0) continue;

    // The structural check the device path skips. If this rejects a buffer the
    // Brain just wrote, the committed `format/framedata.h` is out of step with
    // `native/libssruntime` — regenerate it (`npm run generate-fbs-code`).
    ::flatbuffers::Verifier verifier(fdPtr, fdLen);
    if (!ss::runtime::VerifyFrameDataBuffer(verifier)) {
      std::fprintf(stderr, "frame %d: VerifyFrameDataBuffer rejected a %zu byte buffer\n", frame,
                   fdLen);
      ++g_failures;
      continue;
    }
    const ss::runtime::FrameData* fd = ss::runtime::GetFrameData(fdPtr);

    // Exercise the baker on the same buffer so an out-of-bounds read shows up
    // here (under ASan) rather than on a device.
    sscore::SsSoAPointers soa;
    size_t len = 0;
    ss_runtime_get_world_matrices(ctx, &soa.worldMatrices, &len);
    soa.partCount = len / 16;
    ss_runtime_get_local_vertices(ctx, &soa.localVertices, &len);
    ss_runtime_get_local_uvs(ctx, &soa.localUvs, &len);
    ss_runtime_get_cell_meta(ctx, &soa.cellMeta, &len);

    CheckPartCounts(fd, soa.partCount, frame);
    baker.bake(fd, soa);

    if (baker.vertexCount() > maxVertices) maxVertices = baker.vertexCount();
    if (baker.batches().size() > maxBatches) maxBatches = baker.batches().size();

    // The baker's own invariants: every batch's range must sit inside the
    // arrays, and every index must sit inside its own batch.
    for (const sscore::SsBatchDesc& d : baker.batches()) {
      if (d.vertexOffset + d.vertexCount > static_cast<int32_t>(baker.vertexCount())) {
        Fail("bake.vertexRange", d.vertexOffset + d.vertexCount,
             static_cast<long long>(baker.vertexCount()), frame, 0);
      }
      for (int32_t i = 0; i < d.indexCount; ++i) {
        const uint16_t v = baker.indices()[d.indexOffset + i];
        if (v >= d.vertexCount) {
          Fail("bake.index", v, d.vertexCount, frame, static_cast<int>(i));
          break;
        }
      }
    }
  }

  ss_runtime_destroy(ctx);
  ss_resource_destroy(resource);

  if (g_failures > 0) {
    std::fprintf(stderr, "\nFAILED: %d problems over %d frames\n", g_failures, frames);
    return 1;
  }
  std::printf("OK: %d frames, peak %zu vertices / %zu batches\n", frames, maxVertices, maxBatches);
  return 0;
}
