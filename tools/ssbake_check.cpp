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
//   3. asserts the baker's own range invariants;
//   4. builds the mask plan the draw path builds, and asserts its range
//      invariants too — the plan indexes the baked quads and the `.ssab`'s parts
//      from two different tables, which is exactly the shape of read that ASan
//      is here to catch.
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

#include "../packages/react-native-spritestudio/cpp/SsAnimeBinary.hpp"
#include "../packages/react-native-spritestudio/cpp/SsBaker.hpp"
#include "../packages/react-native-spritestudio/cpp/SsMask.hpp"

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

/// The part count has two independent sources — `parts` out of the FlatBuffer,
/// and the world-matrix length ÷ 16. Nothing across the FFI enforces that they
/// agree, and `SsBaker::bake` only skips out-of-range indices rather than
/// reporting them, so surface a disagreement here where it is diagnosable.
void CheckPartCounts(const ss::runtime::FrameData* fd, size_t soaPartCount, int frame) {
  const auto* parts = fd->parts();
  const uint32_t fbPartCount = parts != nullptr ? parts->size() : 0;
  if (fbPartCount != soaPartCount) {
    Fail("partCount(parts vs world matrices)", fbPartCount,
         static_cast<long long>(soaPartCount), frame, 0);
  }
}

/// What one frame's mask plan turned up, accumulated so the run can say whether
/// the path was exercised at all.
///
/// A plan that never fires reports the same "0 problems" a working one does, and
/// this repo has already shipped one measurement whose constant number meant
/// "nothing ran" rather than "nothing changed". The totals are printed either
/// way, so a `.ssab` with masks that reports 0 writers is a visible result
/// rather than a silent pass.
struct MaskTotals {
  size_t writers = 0;
  size_t targets = 0;
  size_t framesWithPlan = 0;
};

/// Drives the plan the draw path builds and asserts its ranges.
void CheckMaskPlan(const ss::runtime::FrameData* fd, const sscore::SsBaker& baker,
                   const std::vector<sscore::SsMaskPartFlags>& flags, int frame,
                   MaskTotals* totals) {
  if (flags.empty()) return;

  sscore::SsMaskPlan plan;
  if (!plan.build(fd, baker, flags.data(), flags.size())) return;
  ++totals->framesWithPlan;

  const size_t partCount = baker.parts().size();
  for (const sscore::SsMaskWriter& w : plan.writers()) {
    ++totals->writers;
    if (w.partDrawIndex < 0 || static_cast<size_t>(w.partDrawIndex) >= partCount) {
      Fail("mask.partDrawIndex", w.partDrawIndex, static_cast<long long>(partCount), frame,
           w.bit);
    }
    if (w.bit < 0 || w.bit >= sscore::kSsMaxMaskWriters) {
      Fail("mask.bit", w.bit, sscore::kSsMaxMaskWriters - 1, frame, w.bit);
    }
    if (w.partIndex >= flags.size()) {
      Fail("mask.partIndex", w.partIndex, static_cast<long long>(flags.size()), frame, w.bit);
    }
  }

  // The box the coverage bitmap is stretched over. A degenerate one would divide
  // by zero in `coverageUv`, and `build` is supposed to have rejected it.
  if (!(plan.width() > 0.0f) || !(plan.height() > 0.0f)) {
    Fail("mask.bounds", 0, 1, frame, 0);
  }

  // Every target's resolved test, which is also the walk the draw path makes.
  // The two sets must stay disjoint: a writer's OP puts it in exactly one plane,
  // and folding them would make coverage depend on writer order (§3-1-4).
  for (const sscore::SsPartDraw& info : baker.parts()) {
    if (info.partIndex >= flags.size()) continue;
    sscore::SsMaskBits bits;
    if (!plan.bitsFor(info.drawRank, flags[info.partIndex], &bits)) continue;
    ++totals->targets;
    if ((bits.increment & bits.invert) != 0) {
      Fail("mask.planesOverlap", bits.increment & bits.invert, 0, frame,
           static_cast<int>(info.partIndex));
    }
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

  // PartData, so read once — the same split the draw path keeps.
  const sscore::SsAnimeBinaryView view(ss_runtime_get_ssab_buf(ctx),
                                       static_cast<size_t>(ss_runtime_get_ssab_len(ctx)));
  const std::vector<sscore::SsMaskPartFlags> maskFlags = view.maskFlags();

  sscore::SsBaker baker;
  MaskTotals maskTotals;
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
    ss_runtime_get_mesh_vertices_x(ctx, &soa.meshVerticesX, &soa.meshVertexCount);
    ss_runtime_get_mesh_vertices_y(ctx, &soa.meshVerticesY, &len);
    ss_runtime_get_mesh_vertex_offsets(ctx, &soa.meshVertexOffsets, &soa.meshVertexOffsetCount);
    ss_runtime_get_mesh_uvs(ctx, &soa.meshUvs, &soa.meshUvCount);
    ss_runtime_get_mesh_indices(ctx, &soa.meshIndices, &soa.meshIndexCount);
    ss_runtime_get_mesh_index_offsets(ctx, &soa.meshIndexOffsets, &soa.meshIndexOffsetCount);

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

    CheckMaskPlan(fd, baker, maskFlags, frame, &maskTotals);
  }

  ss_runtime_destroy(ctx);
  ss_resource_destroy(resource);

  if (g_failures > 0) {
    std::fprintf(stderr, "\nFAILED: %d problems over %d frames\n", g_failures, frames);
    return 1;
  }
  std::printf("OK: %d frames, peak %zu vertices / %zu batches\n", frames, maxVertices, maxBatches);
  // Printed unconditionally, including the zeroes: on a pack with masks these
  // are the evidence the plan ran, and on one without they say so plainly.
  std::printf("    mask: %zu frames with a plan, %zu writer-frames, %zu target-frames\n",
              maskTotals.framesWithPlan, maskTotals.writers, maskTotals.targets);
  return 0;
}
