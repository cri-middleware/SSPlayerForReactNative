#include "SsBaker.hpp"

namespace sscore {

namespace {

/// A part's four corners in `localVertices` / `localUvs`, as float-pair indices.
/// The Brain writes `lt, rt, lb, rb, center`; the centre is only needed for the
/// Mesh/Shape paths, so the quad bake reads the first four.
constexpr int kCornerFloat[4] = {0, 2, 4, 6};

/// Two triangles over the corner order above (lt, rt, lb, rb). Skia does not
/// cull, so the winding is free — this order matches SSPlayerForFlutter's.
constexpr uint16_t kQuadIndices[6] = {0, 1, 2, 1, 3, 2};

}  // namespace

void BuildBatchPlan(const FrameDataView& fd, std::vector<SsBatchDesc>& out) {
  out.clear();
  if (!fd.valid()) return;

  const uint32_t batchCount = fd.drawBatchCount();
  out.reserve(batchCount);
  for (uint32_t b = 0; b < batchCount; ++b) {
    const DrawBatchView batch = fd.drawBatchAt(b);
    SsBatchDesc desc{};
    desc.kind = static_cast<int32_t>(batch.kind);
    desc.blendType = static_cast<int32_t>(batch.blendType);
    desc.textureHash = static_cast<int32_t>(batch.textureHash);
    desc.flags = static_cast<int32_t>(batch.flags);
    desc.startRank = static_cast<int32_t>(batch.startRank);
    desc.count = static_cast<int32_t>(batch.count);
    out.push_back(desc);
  }
}

void SsBaker::bake(const FrameDataView& fd, const SsSoAPointers& soa) {
  batches_.clear();
  positions_.clear();
  texCoords_.clear();
  indices_.clear();

  if (!fd.valid() || soa.worldMatrices == nullptr || soa.localVertices == nullptr ||
      soa.localUvs == nullptr) {
    return;
  }

  const uint32_t batchCount = fd.drawBatchCount();
  const uint32_t drawOrderCount = fd.drawOrderCount();
  batches_.reserve(batchCount);

  for (uint32_t b = 0; b < batchCount; ++b) {
    const DrawBatchView batch = fd.drawBatchAt(b);

    SsBatchDesc desc{};
    desc.kind = static_cast<int32_t>(batch.kind);
    desc.blendType = static_cast<int32_t>(batch.blendType);
    desc.textureHash = static_cast<int32_t>(batch.textureHash);
    desc.flags = static_cast<int32_t>(batch.flags);
    desc.startRank = static_cast<int32_t>(batch.startRank);
    desc.count = static_cast<int32_t>(batch.count);
    desc.vertexOffset = static_cast<int32_t>(positions_.size() / 2);
    desc.indexOffset = static_cast<int32_t>(indices_.size());

    // Phase 0 draws Normal parts only. That is not a shortcut that biases the
    // measurement: Normal is the *most* arithmetic-heavy per vertex of all the
    // kinds (world matrix multiply per corner), whereas Effect and Mesh arrive
    // in world space already. Scaling vertex count with Normal geometry is
    // therefore the conservative way to reach particle-scale vertex counts.
    if (batch.kind == DrawBatchKind::Normal) {
      for (uint32_t k = 0; k < batch.count; ++k) {
        const uint32_t rank = static_cast<uint32_t>(batch.startRank) + k;
        if (rank >= drawOrderCount) break;
        const uint32_t partIndex = fd.drawOrderAt(rank);
        if (partIndex >= soa.partCount) continue;

        const float* m = soa.worldMatrices + static_cast<size_t>(partIndex) * 16;
        const float* lv = soa.localVertices + static_cast<size_t>(partIndex) * 10;
        const float* uv = soa.localUvs + static_cast<size_t>(partIndex) * 10;

        // Column-major 4x4, 2D slice: x' = m0*x + m4*y + m12.
        const uint16_t base = static_cast<uint16_t>(positions_.size() / 2 - desc.vertexOffset);
        for (int c = 0; c < 4; ++c) {
          const float x = lv[kCornerFloat[c]];
          const float y = lv[kCornerFloat[c] + 1];
          positions_.push_back(m[0] * x + m[4] * y + m[12]);
          positions_.push_back(m[1] * x + m[5] * y + m[13]);
          texCoords_.push_back(uv[kCornerFloat[c]]);
          texCoords_.push_back(uv[kCornerFloat[c] + 1]);
        }
        for (int i = 0; i < 6; ++i) {
          indices_.push_back(static_cast<uint16_t>(base + kQuadIndices[i]));
        }
      }
    }

    desc.vertexCount = static_cast<int32_t>(positions_.size() / 2) - desc.vertexOffset;
    desc.indexCount = static_cast<int32_t>(indices_.size()) - desc.indexOffset;
    batches_.push_back(desc);
  }
}

}  // namespace sscore
