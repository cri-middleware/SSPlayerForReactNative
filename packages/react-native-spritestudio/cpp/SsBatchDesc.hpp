#pragma once

#include <cstdint>

namespace sscore {

/// One draw batch, in the shape JS reads it: ten `int32`s, no padding, so the
/// whole array is walkable from a single `Int32Array` view with no per-batch
/// object allocation.
///
/// It carries the fields for *both* spike variants:
///   - `startRank` / `count` drive variant (a), where JS walks `drawOrder`
///     itself and bakes the geometry.
///   - `vertexOffset` / `vertexCount` / `indexOffset` / `indexCount` drive
///     variant (b) and are zero in `getPlan()`'s copy, which is emitted before
///     any baking has happened.
///
/// Keep this a plain layout of `int32_t` — JS indexes it by
/// `batchIndex * kSsBatchDescInts + field`.
struct SsBatchDesc {
  int32_t kind;          // DrawBatchKind
  int32_t blendType;     // BlendType
  int32_t textureHash;   // uint32 reinterpreted; JS reads it via a Uint32Array view
  int32_t flags;
  int32_t startRank;     // variant (a): first rank in drawOrder
  int32_t count;         // variant (a): number of parts
  int32_t vertexOffset;  // variant (b): first vertex (not float) in positions/texCoords
  int32_t vertexCount;
  int32_t indexOffset;   // variant (b): first entry in indices
  int32_t indexCount;
};

constexpr int kSsBatchDescInts = 10;
static_assert(sizeof(SsBatchDesc) == kSsBatchDescInts * sizeof(int32_t),
              "SsBatchDesc must stay tightly packed — JS reads it as a flat Int32Array");

}  // namespace sscore
