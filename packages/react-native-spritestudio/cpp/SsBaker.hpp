#pragma once

// Variant (b) of the Phase 0 spike: the per-vertex geometry bake, in C++.
//
// Deliberately free of Nitro and of JSI so `tools/ssbake_check.cpp` can link it
// on the host and drive it under ASan, where an out-of-bounds walk shows up as a
// report rather than as a wrong pixel on a device. The Nitro hybrid
// (`HybridSsContext`) only wraps the buffers this produces in ArrayBuffers.
//
// SCOPE: Normal batches only. Mesh / Shape / Effect / Instance / Mask, PartColor
// and the SHDR shaders are Phase 1-2 work (design doc ch.8). That is enough to
// answer Phase 0's question — see the note in `bake()`.

#include <cstddef>
#include <cstdint>
#include <vector>

#include "SsBatchDesc.hpp"
#include "format/framedata.h"

namespace sscore {

/// The Brain's SoA buffers for the current frame, as lent by the
/// `ss_runtime_get_*` getters. Every pointer is a borrow that dies at the next
/// `ss_runtime_update` (design doc ch.9 F).
struct SsSoAPointers {
  const float* worldMatrices = nullptr;  ///< 16 floats per part, column-major 4x4
  const float* localVertices = nullptr;  ///< 10 floats per part: lt, rt, lb, rb, center
  const float* localUvs = nullptr;       ///< 10 floats per part, texture pixel space
  const float* cellMeta = nullptr;       ///< 6 floats per part
  size_t partCount = 0;
};

/// Bakes one frame into flat vertex/index/batch arrays.
///
/// Buffers are members and are only ever `resize`d down to the frame's needs, so
/// after the first few frames the bake allocates nothing — the zero-allocation
/// shape `30_core/30_render_loop.md` §3 asks for.
class SsBaker {
 public:
  /// Rebuilds every output array from `fd` + `soa`. Safe to call with a null
  /// `fd` or null SoA pointers: it just produces empty output.
  void bake(const ss::runtime::FrameData* fd, const SsSoAPointers& soa);

  /// Batch descriptors for *every* batch in the frame, in draw order — including
  /// the kinds this spike does not draw, which come back with zero
  /// vertex/index counts so a JS-side walk sees the real batch structure.
  const std::vector<SsBatchDesc>& batches() const noexcept { return batches_; }

  /// 2 floats per vertex, world space.
  const std::vector<float>& positions() const noexcept { return positions_; }
  /// 2 floats per vertex, texture pixel space (Skia's image shader wants pixels).
  const std::vector<float>& texCoords() const noexcept { return texCoords_; }
  /// Triangle list; entries are relative to their own batch's `vertexOffset`.
  const std::vector<uint16_t>& indices() const noexcept { return indices_; }

  size_t vertexCount() const noexcept { return positions_.size() / 2; }
  size_t indexCount() const noexcept { return indices_.size(); }

 private:
  std::vector<SsBatchDesc> batches_;
  std::vector<float> positions_;
  std::vector<float> texCoords_;
  std::vector<uint16_t> indices_;
};

/// Fills `out` with one descriptor per batch, geometry ranges left at zero.
/// This is what `getPlan()` hands variant (a) — the FlatBuffer walk, which is
/// native in both variants, without any of the baking that is under test.
void BuildBatchPlan(const ss::runtime::FrameData* fd, std::vector<SsBatchDesc>& out);

}  // namespace sscore
