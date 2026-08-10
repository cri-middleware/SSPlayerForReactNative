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

/// One 0..1 channel as a byte, clamped.
uint32_t Channel(float value) {
  const float clamped = value < 0.0f ? 0.0f : (value > 1.0f ? 1.0f : value);
  return static_cast<uint32_t>(clamped * 255.0f + 0.5f);
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
  // Guarded separately below rather than trusted against either — see the
  // `partCount` trap in AGENTS.md.
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
          colors_.push_back(
              WhiteWithAlpha((hasPartColor ? corners[c]->a : partAlpha) * alphaScale));
        }
        for (int i = 0; i < 6; ++i) {
          indices_.push_back(static_cast<uint16_t>(base + kQuadIndices[i]));
        }
        info.vertexCount = 4;
        info.indexCount = 6;
        parts_.push_back(info);
      }
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
    const uint32_t color =
        WhiteWithAlpha((hasPartColor ? info.partColor.lt.a : partAlpha) * alphaScale);

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
    // PartColor here — the SDK's non-goal list keeps shader parts off the
    // Effect kind, and there is no quad to reconstruct a gradient across.
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

      // §"Effect コマンドの動的バッチング": merge the maximal run of adjacent
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
    // three. Not read from a PartColor — an instance part can carry one, and
    // both reference ports treat that as a whole-subtree *tint*, which is a
    // group filter this port does not do yet (see AGENTS.md).
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

    // Validated whole *before* anything is written, so a corrupt command cannot
    // leave a half-built quad behind in the shared arrays.
    const auto iAt = static_cast<uint32_t>(iOff);
    bool valid = true;
    for (uint32_t n = 0; n < indexCount; ++n) {
      const int32_t v = planIndices->Get(iAt + n);
      if (v < 0 || static_cast<uint32_t>(v) >= vertexCount) {
        valid = false;
        break;
      }
    }
    if (!valid) continue;

    // Narrowed only now: the bounds test above proved each offset addresses a
    // real element, and a FlatBuffers vector index is 32-bit.
    const auto vAt = static_cast<uint32_t>(vOff);
    const auto uAt = static_cast<uint32_t>(uOff);
    const auto cAt = static_cast<uint32_t>(cOff);

    for (uint32_t v = 0; v < vertexCount; ++v) {
      const float x = verts->Get(vAt + v * stride);
      const float y = verts->Get(vAt + v * stride + 1);
      positions_.push_back(m0 * x + m4 * y + m12);
      positions_.push_back(m1 * x + m5 * y + m13);

      // Normalised 0..1 in the plan — the runtime divided by the cellmap's
      // `size_original` — whereas `local_uvs` and `mesh_uvs` are already texture
      // pixels. Scaling back up is what puts all three in one space.
      texCoords_.push_back(uvs->Get(uAt + v * 2) * texWidth);
      texCoords_.push_back(uvs->Get(uAt + v * 2 + 1) * texHeight);

      const uint32_t o = cAt + v * 4;
      const uint32_t a = Channel(colors->Get(o + 3) * partAlpha);
      colors_.push_back((a << 24) | (Channel(colors->Get(o)) << 16) |
                        (Channel(colors->Get(o + 1)) << 8) | Channel(colors->Get(o + 2)));
    }
    for (uint32_t n = 0; n < indexCount; ++n) {
      indices_.push_back(static_cast<uint16_t>(base + planIndices->Get(iAt + n)));
    }

    base += vertexCount;
    quadBudget -= quads;
  }

  return base > 0;
}

}  // namespace sscore
