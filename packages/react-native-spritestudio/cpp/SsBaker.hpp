#pragma once

// Variant (b) of the Phase 0 spike: the per-vertex geometry bake, in C++.
//
// Deliberately free of Nitro and of JSI so `tools/ssbake_check.cpp` can link it
// on the host and drive it under ASan, where an out-of-bounds walk shows up as a
// report rather than as a wrong pixel on a device. The Nitro hybrid
// (`HybridSsContext`) only wraps the buffers this produces in ArrayBuffers.
//
// SCOPE: Normal and Mask batches. Both are one textured quad per part, so they
// bake identically — a Mask part differs only in what the *draw* path does with
// the result, which is to write coverage instead of colour. Mesh / Shape /
// Effect / Instance and the SHDR shaders are still Phase 2 work (design doc
// ch.8).

#include <cstddef>
#include <cstdint>
#include <vector>

#include "SsBatchDesc.hpp"
#include "SsPartColor.hpp"
#include "format/framedata.h"

namespace sscore {

/// What the draw path needs to know about one baked part, beyond its geometry.
///
/// One entry per part actually baked, in bake order. The **ranges are carried
/// rather than derived**: a Normal or Mask part is always four vertices and six
/// indices, but a Mesh part is however many the Brain skinned, so multiplying by
/// four stopped being an answer the moment Mesh arrived.
struct SsPartDraw {
  /// Which part this is, and where it sits in `draw_order`.
  ///
  /// The rank is carried rather than recomputed because it is the pivot the mask
  /// scope turns on (`SsMask.hpp` §2-1), and bake order only *happens* to equal
  /// draw order — it is the batch walk that makes it so, and a kind this bake
  /// skips would silently shift it.
  uint32_t partIndex = 0;
  int32_t drawRank = -1;

  /// Global ranges into `positions()`/`texCoords()`/`colors()` and `indices()`.
  /// The index *values* stay relative to the owning batch's `vertexOffset`, as
  /// they have always been.
  int32_t vertexOffset = 0;
  int32_t vertexCount = 0;
  int32_t indexOffset = 0;
  int32_t indexCount = 0;

  /// True when this part has to leave its batch and go through the PartColor
  /// shader: a PartColor that actually tints RGB. Alpha alone never sets this —
  /// a vertex colour carries that exactly (§1-2-4).
  bool needsPartColorShader = false;
  /// Only meaningful when `needsPartColorShader`.
  SsPartColor partColor;
};

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
  /// One unpremultiplied `SkColor`-shaped `0xAARRGGBB` per vertex.
  ///
  /// White with the part's alpha in most cases — the whole of what a part's
  /// opacity is, and the §1-2-4 passthrough for a PartColor that only sets
  /// alpha. A quad flagged `needsPartColorShader` gets its colour from the
  /// shader instead, and the draw path passes no colours for it at all, so its
  /// entries here are never read.
  const std::vector<uint32_t>& colors() const noexcept { return colors_; }
  /// Triangle list; entries are relative to their own batch's `vertexOffset`.
  const std::vector<uint16_t>& indices() const noexcept { return indices_; }
  /// One per baked part, in bake order. A batch's run is
  /// `parts()[partOffset .. + partCount]`.
  const std::vector<SsPartDraw>& parts() const noexcept { return parts_; }

  size_t vertexCount() const noexcept { return positions_.size() / 2; }
  size_t indexCount() const noexcept { return indices_.size(); }

 private:
  std::vector<SsBatchDesc> batches_;
  std::vector<float> positions_;
  std::vector<float> texCoords_;
  std::vector<uint32_t> colors_;
  std::vector<uint16_t> indices_;
  std::vector<SsPartDraw> parts_;
};

}  // namespace sscore
