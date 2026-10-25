#pragma once

#include <cstddef>
#include <cstdint>
#include <limits>

#include "SsBaker.hpp"
#include "format/framedata.h"

namespace sscore {

/// Part `part`'s outline on the frame `soa` was read from, as left top, right
/// top, left bottom and right bottom `(x, y)` pairs in player-local units.
/// False for a hidden part and one that draws nothing of its own.
inline bool SsPartQuadOf(const SsSoAPointers& soa, size_t part,
                         const ss::runtime::PartState& state, float out[8]) {
  if (state.hide() || soa.worldMatrices == nullptr || part >= soa.partCount) return false;

  if (soa.meshVertexOffsets != nullptr && part + 1 < soa.meshVertexOffsetCount) {
    const uint32_t from = soa.meshVertexOffsets[part];
    const uint32_t to = soa.meshVertexOffsets[part + 1];
    if (to > from) {
      if (to > soa.meshVertexCount || soa.meshVerticesX == nullptr ||
          soa.meshVerticesY == nullptr) {
        return false;
      }
      // World space already: a skinned mesh's own matrix sits near the root.
      float l = std::numeric_limits<float>::infinity();
      float t = l;
      float r = -l;
      float b = -l;
      for (uint32_t v = from; v < to; ++v) {
        const float x = soa.meshVerticesX[v];
        const float y = soa.meshVerticesY[v];
        if (x < l) l = x;
        if (x > r) r = x;
        if (y < t) t = y;
        if (y > b) b = y;
      }
      const float box[8] = {l, t, r, t, l, b, r, b};
      for (int i = 0; i < 8; ++i) out[i] = box[i];
      return true;
    }
  }

  const float* m = soa.worldMatrices + part * 16;
  const auto place = [m, out](int corner, float x, float y) {
    out[corner * 2] = m[0] * x + m[4] * y + m[12];
    out[corner * 2 + 1] = m[1] * x + m[5] * y + m[13];
  };

  if (state.cell() >= 0) {
    if (soa.localVertices == nullptr) return false;
    const float* v = soa.localVertices + part * 10;
    for (int corner = 0; corner < 4; ++corner) place(corner, v[corner * 2], v[corner * 2 + 1]);
    return true;
  }

  const float width = state.size_x();
  const float height = state.size_y();
  if (!(width > 0.0f) || !(height > 0.0f)) return false;
  const float left = -(0.5f + state.pivot_x()) * width;
  const float top = -(0.5f + state.pivot_y()) * height;
  place(0, left, top);
  place(1, left + width, top);
  place(2, left, top + height);
  place(3, left + width, top + height);
  return true;
}

/// Whether `(x, y)` lies inside the outline left top → right top → right
/// bottom → left bottom, by the even-odd rule, so a quad a deform folded over
/// itself still answers.
inline bool SsPartQuadContains(const float quad[8], float x, float y) {
  static constexpr int kRing[4] = {0, 1, 3, 2};
  bool inside = false;
  for (int i = 0, j = 3; i < 4; j = i++) {
    const float ax = quad[kRing[i] * 2];
    const float ay = quad[kRing[i] * 2 + 1];
    const float bx = quad[kRing[j] * 2];
    const float by = quad[kRing[j] * 2 + 1];
    if ((ay > y) != (by > y) && x < (bx - ax) * (y - ay) / (by - ay) + ax) inside = !inside;
  }
  return inside;
}

/// The front-most part whose outline holds `(x, y)` among those `accepts`
/// takes, or -1. `draw_order` leaves hidden parts out, so the first hit from
/// the back of it is the one on top.
template <typename Accepts>
int32_t SsHitTestPart(const ss::runtime::FrameData* frame, const SsSoAPointers& soa, float x,
                      float y, Accepts accepts) {
  const auto* order = frame != nullptr ? frame->draw_order() : nullptr;
  const auto* parts = frame != nullptr ? frame->parts() : nullptr;
  if (order == nullptr || parts == nullptr) return -1;
  float quad[8];
  for (uint32_t rank = order->size(); rank-- > 0;) {
    const uint32_t slot = order->Get(rank);
    if (slot >= parts->size()) continue;
    const ss::runtime::PartState* state = parts->Get(slot);
    const int32_t part = state->part_index();
    if (part < 0 || !accepts(part)) continue;
    if (SsPartQuadOf(soa, static_cast<size_t>(part), *state, quad) &&
        SsPartQuadContains(quad, x, y)) {
      return part;
    }
  }
  return -1;
}

}  // namespace sscore
