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

/// `0xAARRGGBB` (an unpremultiplied `SkColor`) from an alpha in 0..1, white.
uint32_t WhiteWithAlpha(float alpha) {
  const float clamped = alpha < 0.0f ? 0.0f : (alpha > 1.0f ? 1.0f : alpha);
  const uint32_t a = static_cast<uint32_t>(clamped * 255.0f + 0.5f);
  return (a << 24) | 0x00ffffffu;
}

/// The batch fields that are a straight copy out of the FlatBuffer, with the
/// geometry ranges left at zero for the caller to fill in.
SsBatchDesc DescribeBatch(const ss::runtime::DrawBatch* batch) {
  SsBatchDesc desc{};
  desc.kind = static_cast<int32_t>(batch->kind());
  desc.blendType = static_cast<int32_t>(batch->blend_type());
  desc.textureHash = static_cast<int32_t>(batch->texture_hash());
  desc.flags = static_cast<int32_t>(batch->flags());
  desc.startRank = static_cast<int32_t>(batch->start_rank());
  desc.count = static_cast<int32_t>(batch->count());
  return desc;
}

}  // namespace

void SsBaker::bake(const ss::runtime::FrameData* fd, const SsSoAPointers& soa) {
  batches_.clear();
  positions_.clear();
  texCoords_.clear();
  colors_.clear();
  indices_.clear();
  parts_.clear();

  if (fd == nullptr || soa.worldMatrices == nullptr || soa.localVertices == nullptr ||
      soa.localUvs == nullptr) {
    return;
  }

  const auto* batches = fd->draw_batches();
  const auto* drawOrder = fd->draw_order();
  if (batches == nullptr || drawOrder == nullptr) return;

  // The third part count in play, after `soa.partCount` and `batch->count()`.
  // Guarded separately below rather than trusted against either — see the
  // `partCount` trap in AGENTS.md.
  const auto* parts = fd->parts();
  const uint32_t partStateCount = parts != nullptr ? parts->size() : 0;

  const uint32_t drawOrderCount = drawOrder->size();
  batches_.reserve(batches->size());

  for (const ss::runtime::DrawBatch* batch : *batches) {
    SsBatchDesc desc = DescribeBatch(batch);
    desc.vertexOffset = static_cast<int32_t>(positions_.size() / 2);
    desc.indexOffset = static_cast<int32_t>(indices_.size());
    desc.partOffset = static_cast<int32_t>(parts_.size());

    // Normal and Mask: both are one textured quad per part off the same local
    // verts, so one loop bakes them and only the draw path tells them apart — a
    // Mask batch's quads write coverage instead of colour (`SsMask.hpp`).
    // Note the per-kind difference the remaining kinds will have to respect:
    // Normal and Shape verts are *local* and need the world matrix, while Mesh
    // and Effect arrive in world space already and must not be transformed again.
    const auto kind = batch->kind();
    if (kind == ss::runtime::DrawBatchKind_Normal || kind == ss::runtime::DrawBatchKind_Mask) {
      for (uint32_t k = 0; k < batch->count(); ++k) {
        const uint32_t rank = static_cast<uint32_t>(batch->start_rank()) + k;
        if (rank >= drawOrderCount) break;
        const uint32_t partIndex = drawOrder->Get(rank);
        if (partIndex >= soa.partCount) continue;

        const float* m = soa.worldMatrices + static_cast<size_t>(partIndex) * 16;
        const float* lv = soa.localVertices + static_cast<size_t>(partIndex) * 10;
        const float* uv = soa.localUvs + static_cast<size_t>(partIndex) * 10;

        const ss::runtime::PartState* state =
            partIndex < partStateCount ? parts->Get(partIndex) : nullptr;

        SsPartDraw info;
        info.partIndex = partIndex;
        info.drawRank = static_cast<int32_t>(rank);
        info.vertexOffset = static_cast<int32_t>(positions_.size() / 2);
        info.indexOffset = static_cast<int32_t>(indices_.size());
        const bool hasPartColor = SsReadPartColor(fd, state, &info.partColor);
        // Alpha alone never needs the shader: a vertex colour reproduces
        // `a = texel.a * col.a` exactly, and at rate 0 the RGB formula is a
        // texel passthrough (§1-2-4). Only a real tint is peeled out.
        info.needsPartColorShader = hasPartColor && info.partColor.tintsRgb();

        // §1-3: with a PartColor the hierarchical alpha is already folded into
        // the corner alphas, so `PartState.alpha` must NOT be applied again.
        const float partAlpha = state != nullptr ? state->alpha() : 1.0f;
        const SsPartColorCorner* corners[4] = {&info.partColor.lt, &info.partColor.rt,
                                               &info.partColor.lb, &info.partColor.rb};

        // Column-major 4x4, 2D slice: x' = m0*x + m4*y + m12.
        const uint16_t base = static_cast<uint16_t>(positions_.size() / 2 - desc.vertexOffset);
        for (int c = 0; c < 4; ++c) {
          const float x = lv[kCornerFloat[c]];
          const float y = lv[kCornerFloat[c] + 1];
          positions_.push_back(m[0] * x + m[4] * y + m[12]);
          positions_.push_back(m[1] * x + m[5] * y + m[13]);
          texCoords_.push_back(uv[kCornerFloat[c]]);
          texCoords_.push_back(uv[kCornerFloat[c] + 1]);
          colors_.push_back(WhiteWithAlpha(hasPartColor ? corners[c]->a : partAlpha));
        }
        for (int i = 0; i < 6; ++i) {
          indices_.push_back(static_cast<uint16_t>(base + kQuadIndices[i]));
        }
        info.vertexCount = 4;
        info.indexCount = 6;
        parts_.push_back(info);
      }
    } else if (kind == ss::runtime::DrawBatchKind_Mesh) {
      bakeMeshBatch(fd, soa, batch, desc, partStateCount, drawOrder, drawOrderCount);
    }

    desc.vertexCount = static_cast<int32_t>(positions_.size() / 2) - desc.vertexOffset;
    desc.indexCount = static_cast<int32_t>(indices_.size()) - desc.indexOffset;
    desc.partCount = static_cast<int32_t>(parts_.size()) - desc.partOffset;
    batches_.push_back(desc);
  }
}

void SsBaker::bakeMeshBatch(const ss::runtime::FrameData* fd, const SsSoAPointers& soa,
                            const ss::runtime::DrawBatch* batch, const SsBatchDesc& desc,
                            uint32_t partStateCount,
                            const ::flatbuffers::Vector<uint16_t>* drawOrder,
                            uint32_t drawOrderCount) {
  if (soa.meshVerticesX == nullptr || soa.meshVerticesY == nullptr ||
      soa.meshVertexOffsets == nullptr || soa.meshUvs == nullptr || soa.meshIndices == nullptr ||
      soa.meshIndexOffsets == nullptr) {
    return;
  }
  const auto* parts = fd->parts();

  for (uint32_t k = 0; k < batch->count(); ++k) {
    const uint32_t rank = static_cast<uint32_t>(batch->start_rank()) + k;
    if (rank >= drawOrderCount) break;
    const uint32_t partIndex = drawOrder->Get(rank);

    // The offsets arrays are CSR with length partCount + 1, so `p + 1` has to be
    // in range before `offsets[p + 1]` can be read at all.
    if (static_cast<size_t>(partIndex) + 1 >= soa.meshVertexOffsetCount) continue;
    if (static_cast<size_t>(partIndex) + 1 >= soa.meshIndexOffsetCount) continue;

    const uint32_t v0 = soa.meshVertexOffsets[partIndex];
    const uint32_t v1 = soa.meshVertexOffsets[partIndex + 1];
    // An empty range is how a non-Mesh part appears here — not an error.
    if (v1 <= v0 || static_cast<size_t>(v1) > soa.meshVertexCount) continue;
    if (static_cast<size_t>(v1) * 2 > soa.meshUvCount) continue;

    const uint32_t i0 = soa.meshIndexOffsets[partIndex];
    const uint32_t i1 = soa.meshIndexOffsets[partIndex + 1];
    if (i1 <= i0 || (i1 - i0) % 3 != 0) continue;
    if (static_cast<size_t>(i1) > soa.meshIndexCount) continue;

    const uint32_t vertCount = v1 - v0;
    const ss::runtime::PartState* state =
        (parts != nullptr && partIndex < partStateCount) ? parts->Get(partIndex) : nullptr;

    SsPartDraw info;
    info.partIndex = partIndex;
    info.drawRank = static_cast<int32_t>(rank);
    info.vertexOffset = static_cast<int32_t>(positions_.size() / 2);
    info.indexOffset = static_cast<int32_t>(indices_.size());
    // A mesh is a triangle soup, not four corners in lt/rt/lb/rb order — so
    // nothing downstream may invert its UV to recover a `(s,t)` square.
    info.quadShaped = false;

    // §1-2: a mesh's PartColor is **whole-only** — `lt`'s colour and rate go to
    // every vertex. Copying it into all four corners is what lets the existing
    // shader serve a mesh: with the corners equal its bilinear collapses to a
    // constant, so the UV reconstruction it would otherwise need drops out.
    const bool hasPartColor = SsReadPartColor(fd, state, &info.partColor);
    if (hasPartColor) {
      info.partColor.rt = info.partColor.lt;
      info.partColor.lb = info.partColor.lt;
      info.partColor.rb = info.partColor.lt;
    }
    info.needsPartColorShader = hasPartColor && info.partColor.tintsRgb();

    const float partAlpha = state != nullptr ? state->alpha() : 1.0f;
    const uint32_t color = WhiteWithAlpha(hasPartColor ? info.partColor.lt.a : partAlpha);

    const uint16_t base = static_cast<uint16_t>(positions_.size() / 2 - desc.vertexOffset);
    for (uint32_t v = v0; v < v1; ++v) {
      // Already world-space: the Brain did the skinning, so the world matrix
      // must NOT be applied a second time.
      positions_.push_back(soa.meshVerticesX[v]);
      positions_.push_back(soa.meshVerticesY[v]);
      texCoords_.push_back(soa.meshUvs[static_cast<size_t>(v) * 2]);
      texCoords_.push_back(soa.meshUvs[static_cast<size_t>(v) * 2 + 1]);
      colors_.push_back(color);
    }
    // Part-local 0-based, so they are rebased onto this part's slice of the
    // batch — the batch is one draw call, which is exactly the case the mesh doc
    // says needs the vertex base added.
    for (uint32_t i = i0; i < i1; ++i) {
      const int32_t local = soa.meshIndices[i];
      if (local < 0 || static_cast<uint32_t>(local) >= vertCount) {
        // A malformed index would walk outside the part; drop the triangle
        // rather than the whole part.
        indices_.push_back(base);
        continue;
      }
      indices_.push_back(static_cast<uint16_t>(base + local));
    }

    info.vertexCount = static_cast<int32_t>(vertCount);
    info.indexCount = static_cast<int32_t>(i1 - i0);
    parts_.push_back(info);
  }
}

}  // namespace sscore
