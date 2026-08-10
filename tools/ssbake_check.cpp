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

#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>

#include "../packages/react-native-spritestudio/cpp/SsAnimeBinary.hpp"
#include "../packages/react-native-spritestudio/cpp/SsBaker.hpp"
#include "../packages/react-native-spritestudio/cpp/SsEffect.hpp"
#include "../packages/react-native-spritestudio/cpp/SsInstance.hpp"
#include "../packages/react-native-spritestudio/cpp/SsMask.hpp"
// cbindgen's own header, for the same reason `cpp/` uses it rather than a
// hand-copied subset: the C-API is `extern "C"`, so a signature that has drifted
// still links and then misbehaves. This program exists to catch exactly that
// class of mismatch, so it must not carry a second copy of the declarations.
#include "ssruntime.h"

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

/// What the effect path produced over the run.
///
/// Printed unconditionally, zeroes included, for the reason the mask totals are:
/// a path that never ran reports the same clean bill as one that ran perfectly.
/// A pack with effect parts that reports 0 quads is a visible result.
struct InstanceTotals {
  size_t parts = 0;
  size_t framesWithMounts = 0;
  size_t mountFrames = 0;
  size_t peakMounts = 0;
};

struct EffectTotals {
  size_t parts = 0;
  size_t framesWithGeometry = 0;
  size_t peakQuads = 0;
  size_t quadFrames = 0;
};

/// Counts the effect geometry in a baked frame, and checks the batches it made.
///
/// An Effect batch is the one kind that produces several descriptors, so its
/// ranges are the ones most worth asserting: each has to sit inside the shared
/// arrays and hold indices inside its own vertex range, which the caller's loop
/// covers, and each has to be non-degenerate, which it does not.
void CheckEffectBatches(const sscore::SsBaker& baker, int frame, EffectTotals* totals) {
  size_t quads = 0;
  for (const sscore::SsBatchDesc& d : baker.batches()) {
    if (d.kind != ss::runtime::DrawBatchKind_Effect) continue;
    if (d.vertexCount % 4 != 0 || d.indexCount % 6 != 0 ||
        d.indexCount / 6 != d.vertexCount / 4) {
      Fail("effect.quadShape", d.indexCount, d.vertexCount, frame, d.startRank);
    }
    if (d.partCount != 1) Fail("effect.partCount", d.partCount, 1, frame, d.startRank);
    quads += static_cast<size_t>(d.vertexCount) / 4;
  }
  if (quads == 0) return;
  ++totals->framesWithGeometry;
  totals->quadFrames += quads;
  if (quads > totals->peakQuads) totals->peakQuads = quads;
}

/// Counts the instance mounts a frame baked, and checks each one.
///
/// A mount carries no geometry, so nothing else in this program would notice it
/// being wrong. What can be checked is that it names a part the frame has and
/// that its matrix is finite — a NaN there propagates into `SkMatrix::concat`
/// and silently drops the whole sub-animation off the canvas.
void CheckInstances(const sscore::SsBaker& baker, size_t soaPartCount, int frame,
                    InstanceTotals* totals) {
  const std::vector<sscore::SsInstanceDraw>& mounts = baker.instances();
  if (mounts.empty()) return;
  ++totals->framesWithMounts;
  totals->mountFrames += mounts.size();
  if (mounts.size() > totals->peakMounts) totals->peakMounts = mounts.size();

  int32_t previousRank = -1;
  for (const sscore::SsInstanceDraw& mount : mounts) {
    if (mount.partIndex >= soaPartCount) {
      Fail("instance.partIndex", mount.partIndex, static_cast<long long>(soaPartCount), frame,
           mount.drawRank);
    }
    // The draw path drains this list in step with the batch walk, so it has to
    // be in rank order or a sub-animation lands at the wrong depth.
    if (mount.drawRank <= previousRank) {
      Fail("instance.rankOrder", mount.drawRank, previousRank, frame, 0);
    }
    previousRank = mount.drawRank;
    for (int i = 0; i < 6; ++i) {
      if (!std::isfinite(mount.m[i])) Fail("instance.matrix", i, 0, frame, mount.drawRank);
    }
    if (!(mount.alpha >= 0.0f) || mount.alpha > 1.0f) {
      Fail("instance.alpha", static_cast<long long>(mount.alpha * 1000), 1000, frame,
           mount.drawRank);
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
  // `setup_animation` leaves the transport **stopped**, so without these the
  // loop below re-checks frame 0 as many times as it is asked to and reports the
  // same clean result it would for a working sweep. AGENTS.md records this as
  // the bug that invalidated every number Phase 0 published; this program has
  // had it too, which is why the effect totals below are the first numbers here
  // that depend on time passing at all.
  //
  // Order is load-bearing: `setup_animation` resets the loop count and `play`
  // arms the counter with whatever is in effect at that moment (-1 = infinite),
  // so a longer `frames` than the animation keeps sweeping instead of stopping.
  ss_runtime_set_loop(ctx, -1);
  ss_runtime_play(ctx);

  // PartData, so read once — the same split the draw path keeps.
  const sscore::SsAnimeBinaryView view(ss_runtime_get_ssab_buf(ctx),
                                       static_cast<size_t>(ss_runtime_get_ssab_len(ctx)));
  const std::vector<sscore::SsMaskPartFlags> maskFlags = view.maskFlags();

  // Effect slots, bound the way `HybridSsContext` binds them — from the pack's
  // metadata, not from any frame's draw order.
  sscore::SsEffectSlots effects;
  effects.bind(resource, view);

  sscore::SsBaker baker;
  MaskTotals maskTotals;
  EffectTotals effectTotals;
  effectTotals.parts = view.effectParts().size();
  InstanceTotals instanceTotals;
  instanceTotals.parts = view.instanceParts().size();
  const int32_t fps = ss_runtime_get_fps(ctx);
  size_t maxVertices = 0;
  size_t maxBatches = 0;

  for (int frame = 0; frame < frames; ++frame) {
    // Milliseconds, like the C-API and like `HybridSsContext::update` — the
    // delta this loop used to pass was `1/60`, which is 0.0167 ms and would have
    // advanced roughly nothing had anything here been time-driven. Nothing was,
    // until the effect slots arrived.
    const float deltaMs = 1000.0f / 60.0f;
    const float frameNo = ss_runtime_update(ctx, deltaMs);
    // After the update, so `is_looped` is this tick's edge — the same ordering
    // `HybridSsContext::update` keeps.
    effects.step(ctx, frameNo, deltaMs / 1000.0f, fps > 0 ? static_cast<float>(fps) : 60.0f,
                 ss_runtime_is_looped(ctx));

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
    baker.bake(fd, soa, effects.frame());

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
    CheckEffectBatches(baker, frame, &effectTotals);
    CheckInstances(baker, soa.partCount, frame, &instanceTotals);
  }

  // Before the context and the resource, exactly as `HybridSsContext::release`
  // orders it: the slots were created against the resource.
  effects.release();
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
  // Same contract as the mask line. `parts > 0` with `peak 0` is the shape of a
  // pack whose effects were enumerated and then never emitted a particle — the
  // one failure the rest of this program cannot see, because a path that does
  // nothing passes every range assertion.
  std::printf("    effect: %zu parts, %zu frames with geometry, peak %zu quads, %zu quad-frames\n",
              effectTotals.parts, effectTotals.framesWithGeometry, effectTotals.peakQuads,
              effectTotals.quadFrames);
  // Same contract again. `parts > 0` with `peak 0` is a pack whose instance
  // parts were enumerated and then never mounted anything — an unresolved pack,
  // or a slot the Brain never reported visible.
  std::printf("    instance: %zu parts, %zu frames with mounts, peak %zu, %zu mount-frames\n",
              instanceTotals.parts, instanceTotals.framesWithMounts, instanceTotals.peakMounts,
              instanceTotals.mountFrames);
  return 0;
}
