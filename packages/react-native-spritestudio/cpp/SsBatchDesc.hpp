#pragma once

#include <cstdint>

namespace sscore {

/// One draw batch: the Brain's `DrawBatch` fields plus the geometry ranges
/// `SsBaker` fills in as it bakes.
///
/// The flat `int32` layout is a leftover from the Phase 0 spike, when JS walked
/// this array through an `Int32Array` view. Nothing in JS reads it now — the
/// batch walk is entirely in `SsSkiaDraw` — so the packing is no longer
/// load-bearing and the fields could take their natural types whenever that
/// becomes worth doing.
///
/// `startRank` / `count` are the batch's slice of `draw_order`. `SsSkiaDraw`
/// does not need them (it draws the baked ranges), but they are the batch's
/// identity in the Brain's terms and the mask and blend passes want
/// them, so they are kept rather than dropped.
struct SsBatchDesc {
  int32_t kind;          // DrawBatchKind
  int32_t blendType;     // BlendType
  int32_t textureHash;   // uint32 reinterpreted
  int32_t flags;
  int32_t startRank;     // first rank in drawOrder
  int32_t count;         // number of parts
  int32_t vertexOffset;  // first vertex (not float) in positions/texCoords
  int32_t vertexCount;
  int32_t indexOffset;   // first entry in indices
  int32_t indexCount;
  int32_t partOffset;    // first entry in SsBaker::parts()
  int32_t partCount;     // number of parts this batch actually baked
};

constexpr int kSsBatchDescInts = 12;
static_assert(sizeof(SsBatchDesc) == kSsBatchDescInts * sizeof(int32_t),
              "SsBatchDesc must stay tightly packed");

}  // namespace sscore
