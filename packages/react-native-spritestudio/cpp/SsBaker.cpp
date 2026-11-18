#include "SsBaker.hpp"

#include <algorithm>
#include <cstring>

namespace sscore {

namespace {

/// A part's vertices in `localVertices` / `localUvs`, as float-pair indices: the
/// Brain writes `lt, rt, lb, rb, center`.
constexpr int kVertexFloat[5] = {0, 2, 4, 6, 8};

/// Two triangles over the corners (lt, rt, lb, rb), for a part drawn without
/// its centre. Skia does not cull, so the winding is free.
constexpr uint16_t kQuadIndices[6] = {0, 1, 2, 1, 3, 2};

/// Four triangles around the centre (vertex 4), in the winding the two above
/// have, for a part that `NeedsCentre`.
constexpr uint16_t kFanIndices[12] = {4, 0, 1, 4, 1, 3, 4, 3, 2, 4, 2, 0};

/// Whether a Normal or Mask part is drawn as `kFanIndices` around its centre
/// vertex rather than as `kQuadIndices`: when it carries a vertex deformation or
/// a PartColor.
///
/// Two triangles cut the quad along one diagonal, so a deformed part would bend
/// along it and a four-corner PartColor would shade along it. Without either
/// attribute the part is a parallelogram of one colour, which the two triangles
/// draw identically, so the fifth vertex is only spent where it changes a pixel.
/// The Brain counts a Normal batch's `vertex_count` / `index_count` by this same
/// test, and `ssbake_check` holds the bake to those counts.
bool NeedsCentre(const ss::runtime::PartState* state) {
  if (state == nullptr) return false;
  const auto flags = static_cast<uint64_t>(state->update_flag());
  return (flags & (ss::runtime::UpdateAttributeFlags_AttributeVertex |
                   ss::runtime::UpdateAttributeFlags_AttributePartColor)) != 0;
}

/// `0xAARRGGBB` (an unpremultiplied `SkColor`) from an alpha in 0..1, white.
uint32_t WhiteWithAlpha(float alpha) {
  const float clamped = alpha < 0.0f ? 0.0f : (alpha > 1.0f ? 1.0f : alpha);
  const uint32_t a = static_cast<uint32_t>(clamped * 255.0f + 0.5f);
  return (a << 24) | 0x00ffffffu;
}

/// `0xAARRGGBB` from four 0..1 channels, with `alphaScale` folded into the alpha.
uint32_t Argb(float a, float alphaScale, float r, float g, float b);

/// One 0..1 channel as a byte, clamped.
uint32_t Channel(float value) {
  const float clamped = value < 0.0f ? 0.0f : (value > 1.0f ? 1.0f : value);
  return static_cast<uint32_t>(clamped * 255.0f + 0.5f);
}

uint32_t Argb(float a, float alphaScale, float r, float g, float b) {
  return (Channel(a * alphaScale) << 24) | (Channel(r) << 16) | (Channel(g) << 8) | Channel(b);
}

/// The most vertices one batch may hold, since the index arrays are `uint16_t`.
///
/// An effect is the only kind that can approach this: a single emitter is one
/// draw command, but a plan concatenates every emitter in the effect and this
/// bake merges adjacent same-(cellmap, blend) commands into one batch. The cap
/// is what stops that merge from producing an index it cannot express.
constexpr uint32_t kMaxBatchQuads = 0xFFFFu / 4;

/// A cellmap's authored size, or `{0, 0}` when the table does not name it.
SsCellMapSize CellMapSizeFor(const SsEffectFrame& effects, uint32_t textureHash) {
  for (size_t i = 0; i < effects.cellMapSizeCount; ++i) {
    if (effects.cellMapSizes[i].textureHash == textureHash) return effects.cellMapSizes[i];
  }
  return {};
}

/// Whether this part's geometry comes from a buffer of its own rather than from
/// `local_vertices` — i.e. whether it is a Shape or a Mesh.
///
/// Read off the SoA rather than the part type, because the baker has FrameData
/// and no `.ssab`: a shape says so with a non-zero vertex count, a mesh with a
/// non-empty CSR range.
bool HasOwnGeometry(const SsSoAPointers& soa, uint32_t partIndex) {
  if (soa.shapeVertexCounts != nullptr && partIndex < soa.shapeVertexCountCount &&
      soa.shapeVertexCounts[partIndex] > 0) {
    return true;
  }
  if (soa.meshVertexOffsets != nullptr &&
      static_cast<size_t>(partIndex) + 1 < soa.meshVertexOffsetCount &&
      soa.meshVertexOffsets[partIndex + 1] > soa.meshVertexOffsets[partIndex]) {
    return true;
  }
  return false;
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

void SsBaker::bake(const ss::runtime::FrameData* fd, const SsSoAPointers& soa,
                   const SsEffectFrame& effects, float alphaScale) {
  batches_.clear();
  positions_.clear();
  texCoords_.clear();
  colors_.clear();
  indices_.clear();
  parts_.clear();
  instances_.clear();

  if (fd == nullptr || soa.worldMatrices == nullptr || soa.localVertices == nullptr ||
      soa.localUvs == nullptr) {
    return;
  }

  const auto* batches = fd->draw_batches();
  const auto* drawOrder = fd->draw_order();
  if (batches == nullptr || drawOrder == nullptr) return;

  // The third part count in play, after `soa.partCount` and `batch->count()`.
  // Guarded separately below rather than trusted against either: `soa.partCount`
  // is the world-matrix length / 16, this is `FrameData.parts`, and nothing
  // cross-checks the two (`ssbake_check` reports a disagreement).
  const auto* parts = fd->parts();
  const uint32_t partStateCount = parts != nullptr ? parts->size() : 0;

  const uint32_t drawOrderCount = drawOrder->size();
  batches_.reserve(batches->size());

  for (const ss::runtime::DrawBatch* batch : *batches) {
    const auto kind = batch->kind();

    // The one kind that owns its own descriptors — it can produce several, or
    // none, where every other produces exactly one. Handled before `desc` is
    // built so there is no half-filled descriptor to reconcile.
    if (kind == ss::runtime::DrawBatchKind_Effect) {
      bakeEffectBatch(fd, soa, batch, effects, partStateCount, drawOrder, drawOrderCount,
                      alphaScale);
      continue;
    }
    // Instance produces no descriptor at all: it contributes no geometry of its
    // own, only a place to hang somebody else's. The draw path pairs these
    // against the batch by rank.
    if (kind == ss::runtime::DrawBatchKind_Instance) {
      bakeInstanceBatch(fd, soa, batch, partStateCount, drawOrder, drawOrderCount, alphaScale);
      continue;
    }

    SsBatchDesc desc = DescribeBatch(batch);
    desc.vertexOffset = static_cast<int32_t>(positions_.size() / 2);
    desc.indexOffset = static_cast<int32_t>(indices_.size());
    desc.partOffset = static_cast<int32_t>(parts_.size());

    // Normal and Mask: both are one textured quad per part off the same local
    // verts, so one loop bakes them and only the draw path tells them apart — a
    // Mask batch's quads write coverage instead of colour (`SsMask.hpp`).
    // Note the per-kind difference the remaining kinds have to respect: Normal
    // and Shape verts are *local* and need the world matrix, while a Mesh's
    // arrive in world space already and must not be transformed again. An
    // effect is a third case — its particles are in the effect's own simulation
    // space, so they do need the matrix (`bakeEffectBatch`).
    if (kind == ss::runtime::DrawBatchKind_Normal || kind == ss::runtime::DrawBatchKind_Mask) {
      for (uint32_t k = 0; k < batch->count(); ++k) {
        const uint32_t rank = static_cast<uint32_t>(batch->start_rank()) + k;
        if (rank >= drawOrderCount) break;
        const uint32_t partIndex = drawOrder->Get(rank);
        if (partIndex >= soa.partCount) continue;
        // A part turned into a pure mask by `draw_as_mask` gets **two batches at
        // the same rank**: a `Mask` one marking the slot, and its own kind's one
        // carrying the real geometry. Baking the Mask batch as a quad then
        // produces a second, bounding-rectangle copy of the part — which the
        // coverage pass happily takes as another writer, so one authored mask
        // covers a rectangle as well as its true shape, burns a second bit, and
        // samples whatever atlas the texture table hands it. The part's own
        // batch is the one with the geometry; this one has nothing to add.
        if (kind == ss::runtime::DrawBatchKind_Mask && HasOwnGeometry(soa, partIndex)) continue;

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
        // texel passthrough. Only a real tint is peeled out.
        info.needsPartColorShader = hasPartColor && info.partColor.tintsRgb();
        // `SHDR` peels for the same reason a tint does and independently of one:
        // the effect's parameters speak for a single part. When both are present
        // the effect is what runs, since it applies the PartColor tail itself.
        info.needsShader = SsReadPartShader(fd, state, &info.partShader);

        // With a PartColor the hierarchical alpha is already folded into
        // the corner alphas, so `PartState.alpha` must NOT be applied again.
        const float partAlpha = state != nullptr ? state->alpha() : 1.0f;
        const SsPartColorCorner* corners[4] = {&info.partColor.lt, &info.partColor.rt,
                                               &info.partColor.lb, &info.partColor.rb};
        // The centre's alpha is the corners' mean, as its colour is in the
        // shaders' `ssFanWeights`; a vertex colour carries no RGB to average.
        float alphas[5];
        for (int c = 0; c < 4; ++c) alphas[c] = hasPartColor ? corners[c]->a : partAlpha;
        alphas[4] = (alphas[0] + alphas[1] + alphas[2] + alphas[3]) * 0.25f;
        const bool fan = NeedsCentre(state);
        const int vertexCount = fan ? 5 : 4;

        // Column-major 4x4, 2D slice: x' = m0*x + m4*y + m12.
        const uint16_t base = static_cast<uint16_t>(positions_.size() / 2 - desc.vertexOffset);
        for (int c = 0; c < vertexCount; ++c) {
          const float x = lv[kVertexFloat[c]];
          const float y = lv[kVertexFloat[c] + 1];
          positions_.push_back(m[0] * x + m[4] * y + m[12]);
          positions_.push_back(m[1] * x + m[5] * y + m[13]);
          texCoords_.push_back(uv[kVertexFloat[c]]);
          texCoords_.push_back(uv[kVertexFloat[c] + 1]);
          colors_.push_back(WhiteWithAlpha(alphas[c] * alphaScale));
        }
        // Both shader paths draw with **no vertex colours** — each carries alpha
        // itself as `a = texel.a * col.a` — so everything the loop above just
        // put in the vertex colours has to be in the corner alphas instead, or
        // it is silently dropped: `PartState.alpha` when the part has no
        // PartColor of its own, and the instance chain's `alphaScale` either
        // way. Done after the loop, because the loop reads these same corners.
        if (info.needsShader || info.needsPartColorShader) {
          SsPartColorCorner* mutable_corners[4] = {&info.partColor.lt, &info.partColor.rt,
                                                   &info.partColor.lb, &info.partColor.rb};
          for (SsPartColorCorner* corner : mutable_corners) {
            corner->a = (hasPartColor ? corner->a : partAlpha) * alphaScale;
          }
        }
        const uint16_t* quad = fan ? kFanIndices : kQuadIndices;
        const int indexCount = fan ? 12 : 6;
        for (int i = 0; i < indexCount; ++i) {
          indices_.push_back(static_cast<uint16_t>(base + quad[i]));
        }
        info.vertexCount = vertexCount;
        info.indexCount = indexCount;
        parts_.push_back(info);
      }
    } else if (kind == ss::runtime::DrawBatchKind_Shape) {
      bakeShapeBatch(fd, soa, batch, desc, partStateCount, drawOrder, drawOrderCount,
                     alphaScale);
    } else if (kind == ss::runtime::DrawBatchKind_Mesh) {
      bakeMeshBatch(fd, soa, batch, desc, partStateCount, drawOrder, drawOrderCount,
                    alphaScale);
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
                            uint32_t drawOrderCount, float alphaScale) {
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

    // A mesh's PartColor is **whole-only** — `lt`'s colour and rate go to
    // every vertex. Copying it into all four corners is what lets the existing
    // shader serve a mesh: with the corners equal its weighting collapses to a
    // constant, so the UV reconstruction it would otherwise need drops out.
    const bool hasPartColor = SsReadPartColor(fd, state, &info.partColor);
    if (hasPartColor) {
      info.partColor.rt = info.partColor.lt;
      info.partColor.lb = info.partColor.lt;
      info.partColor.rb = info.partColor.lt;
    }
    info.needsPartColorShader = hasPartColor && info.partColor.tintsRgb();

    const float partAlpha = state != nullptr ? state->alpha() : 1.0f;
    const uint32_t color =
        WhiteWithAlpha((hasPartColor ? info.partColor.lt.a : partAlpha) * alphaScale);
    // The tint shader draws with no vertex colours, so the instance chain's
    // `alphaScale` has to ride in the corner alphas or a tinted mesh inside a
    // faded instance stays opaque — as on a Normal quad, above. A tint implies a
    // PartColor, whose corners already carry the part's own alpha.
    if (info.needsPartColorShader) {
      SsPartColorCorner* corners[4] = {&info.partColor.lt, &info.partColor.rt,
                                       &info.partColor.lb, &info.partColor.rb};
      for (SsPartColorCorner* corner : corners) corner->a *= alphaScale;
    }

    const uint16_t base = static_cast<uint16_t>(positions_.size() / 2 - desc.vertexOffset);
    const uint32_t indexCount = i1 - i0;

    // Sized once and written through pointers, not pushed an element at a time:
    // a skinned part runs to hundreds of vertices and thousands of indices, and
    // a capacity check per element keeps these loops from vectorising.
    const size_t vertexAt = positions_.size();
    const size_t colorAt = colors_.size();
    const size_t indexAt = indices_.size();
    positions_.resize(vertexAt + static_cast<size_t>(vertCount) * 2);
    texCoords_.resize(vertexAt + static_cast<size_t>(vertCount) * 2);
    colors_.resize(colorAt + vertCount);
    indices_.resize(indexAt + indexCount);

    // Already world-space: the Brain did the skinning, so the world matrix
    // must NOT be applied a second time.
    float* positions = positions_.data() + vertexAt;
    const float* xs = soa.meshVerticesX + v0;
    const float* ys = soa.meshVerticesY + v0;
    for (uint32_t v = 0; v < vertCount; ++v) {
      positions[v * 2] = xs[v];
      positions[v * 2 + 1] = ys[v];
    }
    // Interleaved u,v already, which is the layout `texCoords_` keeps.
    std::memcpy(texCoords_.data() + vertexAt, soa.meshUvs + static_cast<size_t>(v0) * 2,
                sizeof(float) * 2 * vertCount);
    std::fill(colors_.begin() + static_cast<std::ptrdiff_t>(colorAt), colors_.end(), color);

    // Part-local 0-based, so they are rebased onto this part's slice of the
    // batch, which is one draw call.
    uint16_t* indices = indices_.data() + indexAt;
    const int32_t* local = soa.meshIndices + i0;
    for (uint32_t i = 0; i < indexCount; ++i) {
      // Unsigned, so a negative index fails the same test as one past the end.
      // A malformed index would walk outside the part; it is pointed at the
      // part's first vertex instead, which drops the triangle rather than the
      // whole part.
      const uint32_t at = static_cast<uint32_t>(local[i]);
      indices[i] = static_cast<uint16_t>(base + (at < vertCount ? at : 0u));
    }

    info.vertexCount = static_cast<int32_t>(vertCount);
    info.indexCount = static_cast<int32_t>(indexCount);
    parts_.push_back(info);
  }
}

void SsBaker::bakeEffectBatch(const ss::runtime::FrameData* fd, const SsSoAPointers& soa,
                              const ss::runtime::DrawBatch* batch, const SsEffectFrame& effects,
                              uint32_t partStateCount,
                              const ::flatbuffers::Vector<uint16_t>* drawOrder,
                              uint32_t drawOrderCount, float alphaScale) {
  if (!effects.active()) return;
  const auto* parts = fd->parts();

  for (uint32_t k = 0; k < batch->count(); ++k) {
    const uint32_t rank = static_cast<uint32_t>(batch->start_rank()) + k;
    if (rank >= drawOrderCount) break;
    const uint32_t partIndex = drawOrder->Get(rank);

    // No plan means the slot is dead, not yet started, or past its lifetime —
    // the ordinary case, not an error. `step` writes null for all three.
    if (partIndex >= effects.partCount) continue;
    const uint8_t* planBuf = effects.planByPart[partIndex];
    if (planBuf == nullptr) continue;
    // The particles are in the effect's own simulation space, so the part's
    // world matrix is what places them — no matrix, nothing to place them with.
    if (partIndex >= soa.partCount || soa.worldMatrices == nullptr) continue;

    const auto* plan = ss::runtime::GetEffectDrawPlan(planBuf);
    const auto* commands = plan->commands();
    if (commands == nullptr || commands->size() == 0) continue;

    const float* m = soa.worldMatrices + static_cast<size_t>(partIndex) * 16;
    // The particle colours already carry the emitter's own alpha; the part's
    // hierarchical alpha rides on top, since the slot never sees it. No
    // PartColor here: there is no quad to reconstruct a gradient across.
    const ss::runtime::PartState* state =
        (parts != nullptr && partIndex < partStateCount) ? parts->Get(partIndex) : nullptr;
    const float partAlpha = (state != nullptr ? state->alpha() : 1.0f) * alphaScale;

    const uint32_t commandCount = commands->size();
    uint32_t i = 0;
    while (i < commandCount) {
      const ss::runtime::EffectDrawCommand* first = commands->Get(i);
      // The runtime still emits a command for an emitter whose cell failed to
      // resolve, with `quad_count == 0`. Skip before touching the cellmap.
      if (first->quad_count() == 0) {
        ++i;
        continue;
      }
      const uint32_t cellmapHash = first->cellmap_hash();
      const uint8_t blend = first->blend();

      const SsCellMapSize size = CellMapSizeFor(effects, cellmapHash);
      // Without the authored size there is no way back from the plan's
      // normalised UVs to the texture pixels Skia samples in, and guessing one
      // would sample an arbitrary region of the atlas. Skip the run instead.
      if (!(size.width > 0.0f) || !(size.height > 0.0f)) {
        ++i;
        continue;
      }

      // Merge the maximal run of adjacent
      // commands that share a cellmap and a blend, so a multi-emitter effect
      // costs one draw call rather than one per emitter.
      uint32_t quads = 0;
      uint32_t j = i;
      while (j < commandCount) {
        const ss::runtime::EffectDrawCommand* c = commands->Get(j);
        if (c->quad_count() == 0) break;
        if (c->cellmap_hash() != cellmapHash || c->blend() != blend) break;
        if (quads + c->quad_count() > kMaxBatchQuads) break;
        quads += c->quad_count();
        ++j;
      }
      // A single command over the whole budget: take what fits rather than drop
      // the emitter outright. `ssbake_check` reports the peak quad count, which
      // is where a truncation this deep would have to be noticed.
      if (j == i) {
        quads = kMaxBatchQuads;
        j = i + 1;
      }

      SsBatchDesc desc = DescribeBatch(batch);
      // The Brain leaves an Effect batch's `texture_hash` at 0 and its
      // `blend_type` at the part's, neither of which is what an emitter draws
      // with. Both come from the command instead. `blend` is the raw
      // `EmitterState.blend_type` — 0 = Mix, 1 = Add — and **not** a `BlendType`,
      // whose Add is 2; passing it straight through would render every additive
      // emitter as Mul.
      desc.textureHash = static_cast<int32_t>(cellmapHash);
      desc.blendType = static_cast<int32_t>(blend == 1 ? ss::runtime::BlendType_Add
                                                       : ss::runtime::BlendType_Mix);
      // Narrowed to the one part this descriptor covers. The source batch's own
      // range spans every effect part in it, and repeating that on each of the
      // several descriptors it produces would make the ranges overlap.
      desc.startRank = static_cast<int32_t>(rank);
      desc.count = 1;
      desc.vertexOffset = static_cast<int32_t>(positions_.size() / 2);
      desc.indexOffset = static_cast<int32_t>(indices_.size());
      desc.partOffset = static_cast<int32_t>(parts_.size());

      SsPartDraw info;
      info.partIndex = partIndex;
      info.drawRank = static_cast<int32_t>(rank);
      info.vertexOffset = desc.vertexOffset;
      info.indexOffset = desc.indexOffset;
      // A cloud of particle quads, not one sprite quad: nothing downstream may
      // invert its UV to place a gradient or a coverage sample.
      info.quadShaped = false;

      if (appendEffectRun(plan, i, j - i, quads, m, partAlpha, size.width, size.height)) {
        info.vertexCount = static_cast<int32_t>(positions_.size() / 2) - info.vertexOffset;
        info.indexCount = static_cast<int32_t>(indices_.size()) - info.indexOffset;
        parts_.push_back(info);

        desc.vertexCount = static_cast<int32_t>(positions_.size() / 2) - desc.vertexOffset;
        desc.indexCount = static_cast<int32_t>(indices_.size()) - desc.indexOffset;
        desc.partCount = 1;
        batches_.push_back(desc);
      }
      i = j;
    }
  }
}

/// Floats per part in the shape SoA: 12 vertices, interleaved x/y.
static constexpr uint32_t kShapeStride = 24;
/// ...and therefore the most vertices one shape part can have.
static constexpr int32_t kShapeMaxVertices = 12;

void SsBaker::bakeShapeBatch(const ss::runtime::FrameData* fd, const SsSoAPointers& soa,
                             const ss::runtime::DrawBatch* batch, const SsBatchDesc& desc,
                             uint32_t partStateCount,
                             const ::flatbuffers::Vector<uint16_t>* drawOrder,
                             uint32_t drawOrderCount, float alphaScale) {
  if (soa.shapeVertices == nullptr || soa.shapeVertexCounts == nullptr) return;
  const auto* parts = fd->parts();

  for (uint32_t k = 0; k < batch->count(); ++k) {
    const uint32_t rank = static_cast<uint32_t>(batch->start_rank()) + k;
    if (rank >= drawOrderCount) break;
    const uint32_t partIndex = drawOrder->Get(rank);
    if (partIndex >= soa.partCount) continue;
    if (partIndex >= soa.shapeVertexCountCount) continue;

    const int32_t count = soa.shapeVertexCounts[partIndex];
    // Zero is how every non-shape part appears here, and how a shape whose size
    // collapsed does — not an error. A fan needs three.
    if (count < 3 || count > kShapeMaxVertices) continue;
    const size_t base = static_cast<size_t>(partIndex) * kShapeStride;
    if (base + static_cast<size_t>(count) * 2 > soa.shapeVertexCount) continue;
    const bool haveBox = soa.shapeBoxCoords != nullptr &&
                         base + static_cast<size_t>(count) * 2 <= soa.shapeBoxCoordCount;

    const float* m = soa.worldMatrices + static_cast<size_t>(partIndex) * 16;
    const ss::runtime::PartState* state =
        (parts != nullptr && partIndex < partStateCount) ? parts->Get(partIndex) : nullptr;

    SsPartDraw info;
    info.partIndex = partIndex;
    info.drawRank = static_cast<int32_t>(rank);
    info.vertexOffset = static_cast<int32_t>(positions_.size() / 2);
    info.indexOffset = static_cast<int32_t>(indices_.size());
    // A polygon, not four corners in lt/rt/lb/rb order — so nothing downstream
    // may invert its UV, of which it has none anyway. That missing UV is also
    // an opportunity: see `SsPartDraw::untextured`.
    info.quadShaped = false;
    info.untextured = true;
    // A Shape **bypasses the composite formula** outright. Its PartColor
    // is the colour, at forced Mix with the rate pinned to 1, so it never
    // reaches the shader the Normal path peels a tint out for.
    info.needsPartColorShader = false;

    const bool hasPartColor = SsReadPartColor(fd, state, &info.partColor);
    // Without a PartColor a shape is white at the part's alpha. With one, the
    // corner alphas already carry the hierarchical alpha — the converter even
    // forces `a = 255` on a Mix shape so the product lands exactly on it — so
    // `PartState.alpha` must NOT be applied again. Only the instance chain's
    // scale is still owed either way.
    const float partAlpha = (state != nullptr ? state->alpha() : 1.0f) * alphaScale;
    const SsPartColorCorner& lt = info.partColor.lt;
    const SsPartColorCorner& rt = info.partColor.rt;
    const SsPartColorCorner& lb = info.partColor.lb;
    const SsPartColorCorner& rb = info.partColor.rb;

    const uint16_t vertexBase =
        static_cast<uint16_t>(positions_.size() / 2 - desc.vertexOffset);
    for (int32_t v = 0; v < count; ++v) {
      const float lx = soa.shapeVertices[base + static_cast<size_t>(v) * 2];
      const float ly = soa.shapeVertices[base + static_cast<size_t>(v) * 2 + 1];
      positions_.push_back(m[0] * lx + m[4] * ly + m[12]);
      positions_.push_back(m[1] * lx + m[5] * ly + m[13]);
      // A shape samples nothing. The texcoords are pushed anyway so every
      // vertex array stays the same length — the draw path slices them all by
      // one offset — and the Shape pass simply passes none to Skia.
      texCoords_.push_back(0.0f);
      texCoords_.push_back(0.0f);

      if (!hasPartColor) {
        colors_.push_back(WhiteWithAlpha(partAlpha));
        continue;
      }
      // Bilinear over the Brain's box coords, which is the whole reason it
      // emits them. The fan's centre sits at (0.5, 0.5) and so gets the average
      // of the four corners, which is what makes a corner-coloured shape
      // gradient smoothly instead of creasing along a diagonal.
      const float fx = haveBox ? soa.shapeBoxCoords[base + static_cast<size_t>(v) * 2] : 0.5f;
      const float fy =
          haveBox ? soa.shapeBoxCoords[base + static_cast<size_t>(v) * 2 + 1] : 0.5f;
      const float wLt = (1.0f - fx) * (1.0f - fy);
      const float wRt = fx * (1.0f - fy);
      const float wLb = (1.0f - fx) * fy;
      const float wRb = fx * fy;
      colors_.push_back(
          Argb(lt.a * wLt + rt.a * wRt + lb.a * wLb + rb.a * wRb, alphaScale,
               lt.r * wLt + rt.r * wRt + lb.r * wLb + rb.r * wRb,
               lt.g * wLt + rt.g * wRt + lb.g * wLb + rb.g * wRb,
               lt.b * wLt + rt.b * wRt + lb.b * wLb + rb.b * wRb));
    }

    // Centre-first fan: vertex 0 is the middle, the rest walk the perimeter.
    for (int32_t t = 0; t < count - 2; ++t) {
      indices_.push_back(vertexBase);
      indices_.push_back(static_cast<uint16_t>(vertexBase + t + 1));
      indices_.push_back(static_cast<uint16_t>(vertexBase + t + 2));
    }

    info.vertexCount = count;
    info.indexCount = (count - 2) * 3;
    parts_.push_back(info);
  }
}

void SsBaker::bakeInstanceBatch(const ss::runtime::FrameData* fd, const SsSoAPointers& soa,
                                const ss::runtime::DrawBatch* batch, uint32_t partStateCount,
                                const ::flatbuffers::Vector<uint16_t>* drawOrder,
                                uint32_t drawOrderCount, float alphaScale) {
  const auto* parts = fd->parts();

  for (uint32_t k = 0; k < batch->count(); ++k) {
    const uint32_t rank = static_cast<uint32_t>(batch->start_rank()) + k;
    if (rank >= drawOrderCount) break;
    const uint32_t partIndex = drawOrder->Get(rank);
    if (partIndex >= soa.partCount) continue;

    const float* m = soa.worldMatrices + static_cast<size_t>(partIndex) * 16;
    const ss::runtime::PartState* state =
        (parts != nullptr && partIndex < partStateCount) ? parts->Get(partIndex) : nullptr;

    SsInstanceDraw draw;
    draw.partIndex = partIndex;
    draw.drawRank = static_cast<int32_t>(rank);
    // The 2D affine slice of the column-major 4x4, in the order Skia's
    // `SkMatrix::setAffine` reads: a, b, c, d, tx, ty.
    draw.m[0] = m[0];
    draw.m[1] = m[1];
    draw.m[2] = m[4];
    draw.m[3] = m[5];
    draw.m[4] = m[12];
    draw.m[5] = m[13];
    // Compounds down the chain: a child three instances deep is dimmed by all
    // three. Not read from a PartColor: an instance part can carry one, but what
    // that should mean for the child is unspecified.
    draw.alpha = (state != nullptr ? state->alpha() : 1.0f) * alphaScale;
    instances_.push_back(draw);
  }
}

bool SsBaker::appendEffectRun(const ss::runtime::EffectDrawPlan* plan, uint32_t first,
                              uint32_t commandCount, uint32_t quadBudget,
                              const float* worldMatrix, float partAlpha, float texWidth,
                              float texHeight) {
  const auto* commands = plan->commands();
  const auto* verts = plan->verts();
  const auto* uvs = plan->uvs();
  const auto* colors = plan->colors();
  const auto* planIndices = plan->indices();
  if (commands == nullptr || verts == nullptr || uvs == nullptr || colors == nullptr ||
      planIndices == nullptr) {
    return false;
  }
  // Read back rather than assumed: `step` asks for 2, and the plan reports what
  // it actually packed.
  const uint32_t stride = plan->vert_stride() == 3 ? 3u : 2u;

  const float m0 = worldMatrix[0], m1 = worldMatrix[1];
  const float m4 = worldMatrix[4], m5 = worldMatrix[5];
  const float m12 = worldMatrix[12], m13 = worldMatrix[13];

  // Relative to this batch, which is the space the index values downstream are
  // read in — and it is also the running rebase across merged commands, whose
  // own indices are 0-based within each command.
  uint32_t base = 0;

  for (uint32_t c = 0; c < commandCount && quadBudget > 0; ++c) {
    const ss::runtime::EffectDrawCommand* cmd = commands->Get(first + c);
    const uint32_t quads = cmd->quad_count() < quadBudget ? cmd->quad_count() : quadBudget;
    if (quads == 0) continue;

    const uint32_t vertexCount = quads * 4;
    const uint32_t indexCount = quads * 6;
    // In `size_t`, not `uint32_t`: `particle_offset` is a 32-bit count of quads
    // and the strides multiply it, so a nonsense offset would wrap to a *small*
    // number and sail through the bounds test below — which is the one test
    // standing between a malformed plan and a read past the end of the buffer.
    const size_t off = static_cast<size_t>(cmd->particle_offset()) * 4;
    const size_t vOff = off * stride;
    const size_t uOff = off * 2;
    const size_t cOff = off * 4;
    const size_t iOff = static_cast<size_t>(cmd->particle_offset()) * 6;

    // A short buffer means the command and the arrays disagree; skip this one
    // and keep the rest of the run rather than losing the whole effect.
    if (vOff + static_cast<size_t>(vertexCount) * stride > verts->size() ||
        uOff + static_cast<size_t>(vertexCount) * 2 > uvs->size() ||
        cOff + static_cast<size_t>(vertexCount) * 4 > colors->size() ||
        iOff + indexCount > planIndices->size()) {
      continue;
    }

    // Read straight out of the vectors' payload rather than through `Get`, one
    // accessor call per float: the payload is little-endian scalars in exactly
    // the layout the loops below walk. The bounds test above is what makes each
    // pointer's run real.
    static_assert(FLATBUFFERS_LITTLEENDIAN,
                  "the plan's vectors are read in place, which assumes host order is theirs");
    const float* planVerts = verts->data() + vOff;
    const float* planUvs = uvs->data() + uOff;
    const float* planColors = colors->data() + cOff;
    const int32_t* planIdx = planIndices->data() + iOff;

    // Validated whole *before* anything is written, so a corrupt command cannot
    // leave a half-built quad behind in the shared arrays.
    bool valid = true;
    for (uint32_t n = 0; n < indexCount; ++n) {
      const int32_t v = planIdx[n];
      if (v < 0 || static_cast<uint32_t>(v) >= vertexCount) {
        valid = false;
        break;
      }
    }
    if (!valid) continue;

    // Sized once and written through pointers, for the reason `bakeMeshBatch`
    // gives.
    const size_t vertexAt = positions_.size();
    const size_t colorAt = colors_.size();
    const size_t indexAt = indices_.size();
    positions_.resize(vertexAt + static_cast<size_t>(vertexCount) * 2);
    texCoords_.resize(vertexAt + static_cast<size_t>(vertexCount) * 2);
    colors_.resize(colorAt + vertexCount);
    indices_.resize(indexAt + indexCount);
    float* outPositions = positions_.data() + vertexAt;
    float* outTexCoords = texCoords_.data() + vertexAt;
    uint32_t* outColors = colors_.data() + colorAt;
    uint16_t* outIndices = indices_.data() + indexAt;

    for (uint32_t v = 0; v < vertexCount; ++v) {
      const float x = planVerts[v * stride];
      const float y = planVerts[v * stride + 1];
      outPositions[v * 2] = m0 * x + m4 * y + m12;
      outPositions[v * 2 + 1] = m1 * x + m5 * y + m13;

      // Normalised 0..1 in the plan — the runtime divided by the cellmap's
      // `size_original` — whereas `local_uvs` and `mesh_uvs` are already texture
      // pixels. Scaling back up is what puts all three in one space.
      outTexCoords[v * 2] = planUvs[v * 2] * texWidth;
      outTexCoords[v * 2 + 1] = planUvs[v * 2 + 1] * texHeight;

      const float* rgba = planColors + static_cast<size_t>(v) * 4;
      const uint32_t a = Channel(rgba[3] * partAlpha);
      outColors[v] =
          (a << 24) | (Channel(rgba[0]) << 16) | (Channel(rgba[1]) << 8) | Channel(rgba[2]);
    }
    for (uint32_t n = 0; n < indexCount; ++n) {
      outIndices[n] = static_cast<uint16_t>(base + planIdx[n]);
    }

    base += vertexCount;
    quadBudget -= quads;
  }

  return base > 0;
}

}  // namespace sscore
