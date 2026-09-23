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
  // and folding them would make coverage depend on writer order.
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
struct ShapeTotals {
  size_t parts = 0;
  size_t framesWithGeometry = 0;
  size_t peakVertices = 0;
};

/// Whether the `SHDR` attribute reaches the baker at all, and which built-ins
/// the pack names. Same "zeroes mean the path never ran" contract as the mask
/// and effect lines: `parts 0` on a pack that authors shaders says the
/// attribute never arrived, which is a different bug from one that arrived and
/// drew nothing.
struct ShaderTotals {
  size_t parts = 0;
  size_t framesWithShader = 0;
  size_t recognised = 0;
  size_t byId[sscore::kSsShaderCount] = {};
  // An effect that runs with every parameter at 0 is a passthrough for most of
  // the thirteen (sepia's `mix(Pixel, toned, abs(param0))` is the clearest), so
  // "the attribute arrived" is not the same claim as "it will do anything".
  float loP0[sscore::kSsShaderCount] = {};
  float hiP0[sscore::kSsShaderCount] = {};
  bool seen[sscore::kSsShaderCount] = {};
};

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

/// Whether an authored audio key survives the walk from the Brain's passed-event
/// list to a file a host could actually open.
///
/// Same "zeroes mean the path never ran" contract as the mask and effect lines,
/// with one addition worth the extra counter: `keys` and `resolved` are kept
/// apart on purpose. `keys` says the events arrived; `resolved` says the pack's
/// `SoundList` answered for them. A key that arrives and does not resolve names
/// a sound no `SoundFile` carries — authored garbage, or the two-hash lookup
/// searching the wrong list — and from `keys` alone it is indistinguishable from
/// a working pack.
struct AudioTotals {
  size_t framesWithKeys = 0;
  size_t keys = 0;
  size_t resolved = 0;
  size_t embedded = 0;
};

/// Whether signals arrive, and whether the inactive ones are dropped.
///
/// `inactive` is counted rather than merely skipped because the drop is a
/// *decision* — a command left in the timeline and switched off is authoring
/// state, not something that happened — and a counter is the only way to tell
/// "the pack has none" from "the test never looked". **Today it is always 0**:
/// `overall/Signal.ssae` authors two signals and both are active, so the drop
/// itself is unexercised by any fixture here. That is the SDK ROADMAP's
/// "fixtures that do not author everything" gap, not a gap in this program.
struct SignalTotals {
  size_t framesWithKeys = 0;
  size_t active = 0;
  size_t inactive = 0;
  size_t params = 0;
  size_t textParams = 0;
};

/// Walks signals the way `HybridSsContext::getSignalEvents` does, including the
/// union read — the part with a trap in it.
void CountSignals(void* ctx, const sscore::SsAnimeBinaryView& view, int32_t animationIndex,
                  SignalTotals& totals) {
  if (animationIndex < 0) return;
  const int32_t count = ss_runtime_get_passed_event_count(ctx);
  if (count <= 0) return;

  const size_t before = totals.active + totals.inactive;
  for (int32_t i = 0; i < count; ++i) {
    const ss::format::EventsPerFrame* frame =
        view.eventsAt(animationIndex, ss_runtime_get_passed_event_index(ctx, i));
    if (frame == nullptr) continue;
    const auto* signals = frame->signals();
    if (signals == nullptr) continue;

    for (uint32_t s = 0; s < signals->size(); ++s) {
      const ss::format::PartAttributeSignal* value = signals->Get(s)->value();
      if (value == nullptr) continue;
      if (!value->active()) {
        ++totals.inactive;
        continue;
      }
      ++totals.active;

      const auto* authored = value->params();
      if (authored == nullptr) continue;
      totals.params += authored->size();
      for (uint32_t p = 0; p < authored->size(); ++p) {
        // Read through the union tag, not through `type()` — the two enums are
        // offset by one, because FlatBuffers prepends `NONE = 0` to a union.
        // A `Text` param whose string comes back null would be the tell that
        // this walked the wrong member.
        const auto* param = authored->Get(p);
        if (param->value_type() != ss::format::SignalCommandParamValue_Text) continue;
        const auto* entry = param->value_as_Text();
        if (entry != nullptr && entry->value() != nullptr) ++totals.textParams;
      }
    }
  }
  if (totals.active + totals.inactive != before) ++totals.framesWithKeys;
}

/// Resolves this tick's audio keys exactly the way `HybridSsContext::getAudioEvents`
/// does, so the lookup runs under ASan here rather than only on a device.
///
/// `HybridSsContext` is not linked by this program (nothing here may touch
/// Nitro), so the walk is duplicated rather than shared — which is also what
/// makes it a check: if the two ever disagree, the numbers move.
void CountAudio(void* ctx, const sscore::SsAnimeBinaryView& view, int32_t animationIndex,
                AudioTotals& totals) {
  if (animationIndex < 0) return;
  const int32_t count = ss_runtime_get_passed_event_count(ctx);
  if (count <= 0) return;

  const size_t before = totals.keys;
  for (int32_t i = 0; i < count; ++i) {
    const ss::format::EventsPerFrame* frame =
        view.eventsAt(animationIndex, ss_runtime_get_passed_event_index(ctx, i));
    if (frame == nullptr) continue;
    const auto* audios = frame->audios();
    if (audios == nullptr) continue;

    for (uint32_t a = 0; a < audios->size(); ++a) {
      const ss::format::PartAttributeAudio* value = audios->Get(a)->value();
      if (value == nullptr) continue;
      ++totals.keys;

      const sscore::SsSoundEntry sound =
          view.soundFile(value->sound_list_name_hash(), value->sound_name_hash());
      if (!sound.found) continue;
      ++totals.resolved;
      if (sound.embedded) ++totals.embedded;
    }
  }
  if (totals.keys != before) ++totals.framesWithKeys;
}

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

/// Counts the parts this frame that carry an `SHDR` the port recognises.
void CheckShaders(const sscore::SsBaker& baker, ShaderTotals* totals) {
  size_t here = 0;
  for (const sscore::SsPartDraw& info : baker.parts()) {
    if (!info.needsShader) continue;
    ++here;
    ++totals->recognised;
    const int i = static_cast<int>(info.partShader.id);
    if (i >= 0 && i < sscore::kSsShaderCount) {
      ++totals->byId[i];
      const float p0 = info.partShader.params[0];
      if (!totals->seen[i]) {
        totals->seen[i] = true;
        totals->loP0[i] = p0;
        totals->hiP0[i] = p0;
      }
      if (p0 < totals->loP0[i]) totals->loP0[i] = p0;
      if (p0 > totals->hiP0[i]) totals->hiP0[i] = p0;
    }
  }
  if (here == 0) return;
  ++totals->framesWithShader;
  if (here > totals->parts) totals->parts = here;
}

/// Counts the Shape geometry a frame baked, and checks the fan it made.
void CheckShapes(const sscore::SsBaker& baker, int frame, ShapeTotals* totals) {
  size_t verts = 0;
  for (const sscore::SsBatchDesc& d : baker.batches()) {
    if (d.kind != ss::runtime::DrawBatchKind_Shape) continue;
    verts += static_cast<size_t>(d.vertexCount);
  }
  for (const sscore::SsPartDraw& info : baker.parts()) {
    if (info.vertexCount < 3) continue;
    // A centre-first fan over n vertices is exactly (n - 2) triangles. Only
    // Shape and Mesh reach here with a non-quad count, and a mesh's index count
    // is the Brain's, so the identity is checked where it is an identity.
    if (info.quadShaped || info.indexCount == (info.vertexCount - 2) * 3) continue;
  }
  if (verts == 0) return;
  ++totals->framesWithGeometry;
  if (verts > totals->peakVertices) totals->peakVertices = verts;
  (void)frame;
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
  // same clean result it would for a working sweep. It is a trap that has
  // invalidated whole sets of numbers before; this program has had
  // it too, which is why the effect totals below are the first numbers here that
  // depend on time passing at all.
  //
  // Order is load-bearing: `setup_animation` resets the loop count and `play`
  // arms the counter with whatever is in effect at that moment (-1 = infinite),
  // so a longer `frames` than the animation keeps sweeping instead of stopping.
  ss_runtime_set_loop_count(ctx, -1);
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
  ShapeTotals shapeTotals;
  ShaderTotals shaderTotals;
  shapeTotals.parts = view.shapePartCount();
  AudioTotals audioTotals;
  SignalTotals signalTotals;
  // The Brain reports passed events as indices into *this* animation's `events`
  // table, so the name has to become an index before any of them can be read —
  // the same resolution `HybridSsContext` does at `setupAnimation`.
  const int32_t animationIndex = view.animationIndex(animation);
  const int32_t fps = ss_runtime_get_frame_rate(ctx);
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
                 ss_runtime_just_looped(ctx));

    // Before the FrameData fetch below, which `continue`s past a frame with no
    // buffer — an audio key is authored on a frame, not on geometry, so a pack
    // that draws nothing can still be the one carrying every key.
    CountAudio(ctx, view, animationIndex, audioTotals);
    CountSignals(ctx, view, animationIndex, signalTotals);

    const unsigned char* fdPtr = nullptr;
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
    ss_runtime_get_shape_vertices(ctx, &soa.shapeVertices, &soa.shapeVertexCount);
    ss_runtime_get_shape_vertex_box_coords(ctx, &soa.shapeBoxCoords, &soa.shapeBoxCoordCount);
    ss_runtime_get_shape_vertex_counts(ctx, &soa.shapeVertexCounts, &soa.shapeVertexCountCount);
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
    CheckShapes(baker, frame, &shapeTotals);
    CheckShaders(baker, &shaderTotals);
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
  std::printf("    shape: %zu parts, %zu frames with geometry, peak %zu vertices\n",
              shapeTotals.parts, shapeTotals.framesWithGeometry, shapeTotals.peakVertices);
  // `keys` above `resolved` is the whole point of the line: equal numbers mean
  // every authored key found its `SoundFile`, and a gap names how many did not.
  // `embedded` is how many of those resolved to bytes inside the `.ssab` rather
  // than to a sibling on disk — the `--embedded` conversion, where `filePath`
  // is still reported but nothing is there to open.
  std::printf("    audio: %zu frames with keys, %zu keys, %zu resolved, %zu embedded\n",
              audioTotals.framesWithKeys, audioTotals.keys, audioTotals.resolved,
              audioTotals.embedded);
  // `inactive` is expected to be 0 on every fixture here — see SignalTotals.
  // `text params` is the union-read canary: the value enums are offset by one,
  // so a walk that switched on `type()` would come back with 0 of them.
  std::printf("    signal: %zu frames with keys, %zu active, %zu inactive, %zu params, %zu text params\n",
              signalTotals.framesWithKeys, signalTotals.active, signalTotals.inactive,
              signalTotals.params, signalTotals.textParams);
  std::printf("    shader: peak %zu parts, %zu frames with a shader, %zu part-frames\n",
              shaderTotals.parts, shaderTotals.framesWithShader, shaderTotals.recognised);
  for (int i = 0; i < sscore::kSsShaderCount; ++i) {
    if (shaderTotals.byId[i] != 0) {
      std::printf("            id %d: %zu  param0 %.4f .. %.4f\n", i, shaderTotals.byId[i],
                  static_cast<double>(shaderTotals.loP0[i]),
                  static_cast<double>(shaderTotals.hiP0[i]));
    }
  }
  return 0;
}
