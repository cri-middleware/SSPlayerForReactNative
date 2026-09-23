#include "SsMask.hpp"

#include "SsBaker.hpp"

namespace sscore {

void SsMaskPlan::clear() {
  writers_.clear();
  left_ = top_ = right_ = bottom_ = 0.0f;
  maxMaskRank_ = -1;
  minClipRank_ = -1;
}

bool SsMaskPlan::build(const ss::runtime::FrameData* fd, const SsBaker& baker,
                       const SsMaskPartFlags* flags, size_t flagCount) {
  clear();
  if (fd == nullptr || flags == nullptr || flagCount == 0) return false;

  const auto* parts = fd->parts();
  if (parts == nullptr) return false;
  const uint32_t partStateCount = parts->size();

  const std::vector<SsPartDraw>& parts_ = baker.parts();
  const std::vector<float>& positions = baker.positions();

  float left = 0.0f, top = 0.0f, right = 0.0f, bottom = 0.0f;
  bool haveBounds = false;

  for (size_t q = 0; q < parts_.size(); ++q) {
    if (writers_.size() >= static_cast<size_t>(kSsMaxMaskWriters)) break;

    const SsPartDraw& info = parts_[q];
    if (info.partIndex >= flagCount) continue;
    const SsMaskPartFlags& f = flags[info.partIndex];
    if (!f.isWriter()) continue;
    // A writer whose shape the coverage pass cannot rasterise is dropped rather
    // than clipping its targets with a wrong-shaped stand-in. Only the part type
    // decides now: `quadShaped` is about inverting a UV, which the *target* side
    // needs and a writer never does.
    if (!f.bakedGeometry) continue;

    if (info.partIndex >= partStateCount) continue;
    const ss::runtime::PartState* state = parts->Get(info.partIndex);

    // Both halves are needed. `mask == 0` opts the writer out — a rule
    // of its own, so it applies even to a writer that has no cutout to threshold.
    // `hide` has to be tested here because the Brain only drops *mask parts* from
    // `draw_order`: a drawn part turned into a mask still gets its batch when
    // hidden, with only its colour suppressed.
    const float mask = state->mask();
    if (!(mask > 0.0f)) continue;
    if (state->hide()) continue;

    const size_t base = static_cast<size_t>(info.vertexOffset) * 2;
    const size_t floats = static_cast<size_t>(info.vertexCount) * 2;
    // Any vertex count now, not four: a polygon and a deformed mesh both write
    // coverage. Three is the fewest that encloses anything.
    if (info.vertexCount < 3 || base + floats > positions.size()) continue;

    SsMaskWriter writer;
    writer.partIndex = info.partIndex;
    writer.drawRank = info.drawRank;
    writer.bit = static_cast<int32_t>(writers_.size());
    writer.partDrawIndex = static_cast<int32_t>(q);
    // Shared by pure masks and clipping — the same field, read as the OP.
    writer.opInvert = f.maskInfluence;
    writer.isClipping = f.isClipping();
    // The threshold narrows which texels contribute. `mask == 255` writes
    // every non-transparent texel; `mask == 0` writes nothing, which is why the
    // opt-out above and this formula agree.
    const float t = (255.0f - mask) / 255.0f;
    writer.threshold = t < 0.0f ? 0.0f : (t > 1.0f ? 1.0f : t);

    // Over every vertex, not four corners — the union box has to contain the
    // whole writer or its own coverage is clipped by the bitmap's edge.
    for (int32_t c = 0; c < info.vertexCount; ++c) {
      const float x = positions[base + static_cast<size_t>(c) * 2];
      const float y = positions[base + static_cast<size_t>(c) * 2 + 1];
      if (!haveBounds) {
        left = right = x;
        top = bottom = y;
        haveBounds = true;
        continue;
      }
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }

    writers_.push_back(writer);
  }

  if (writers_.empty()) return false;
  // A zero-area box has no coverage to stretch over and would divide by zero in
  // `coverageUv`. Dropping the plan draws every target unmasked, which is the
  // same thing a writer that covers no pixel would have produced.
  if (!(right > left) || !(bottom > top)) {
    clear();
    return false;
  }

  left_ = left;
  top_ = top;
  right_ = right;
  bottom_ = bottom;

  for (const SsMaskWriter& w : writers_) {
    if (w.isClipping) {
      if (minClipRank_ < 0 || w.drawRank < minClipRank_) minClipRank_ = w.drawRank;
    } else if (w.drawRank > maxMaskRank_) {
      maxMaskRank_ = w.drawRank;
    }
  }
  return true;
}

void SsMaskPlan::bubbleChildClipWriters(const SsBaker& childBaker, const SsMaskPlan& childPlan,
                                        const float* mountXf, int32_t ownerRank,
                                        bool inheritedInfluence) {
  if (mountXf == nullptr) return;

  const std::vector<SsPartDraw>& childParts = childBaker.parts();
  const std::vector<float>& childPos = childBaker.positions();

  const float a = mountXf[0], b = mountXf[1], c = mountXf[2], d = mountXf[3];
  const float tx = mountXf[4], ty = mountXf[5];

  // build() already set the box when this player had own writers; otherwise the
  // first bubbled vertex seeds it (a player whose only mask is a child's).
  bool haveBounds = !writers_.empty();
  float left = left_, top = top_, right = right_, bottom = bottom_;

  for (const SsMaskWriter& cw : childPlan.writers()) {
    if (writers_.size() >= static_cast<size_t>(kSsMaxMaskWriters)) break;
    // Only clipping writers carry out of the sub-animation. A pure mask
    // closes within the child. A writer the child itself bubbled up does not
    // bubble a second level here — this port runs a single carry-over track.
    if (!cw.isClipping || cw.foreignBaker != nullptr) continue;
    if (cw.partDrawIndex < 0 ||
        static_cast<size_t>(cw.partDrawIndex) >= childParts.size()) {
      continue;
    }
    const SsPartDraw& part = childParts[static_cast<size_t>(cw.partDrawIndex)];
    if (part.vertexCount < 3) continue;
    const size_t vbase = static_cast<size_t>(part.vertexOffset) * 2;
    if (vbase + static_cast<size_t>(part.vertexCount) * 2 > childPos.size()) continue;

    // The union box has to contain the writer in *this* player's space, so its
    // vertices go through the mount matrix before they extend it.
    for (int32_t v = 0; v < part.vertexCount; ++v) {
      const float cx = childPos[vbase + static_cast<size_t>(v) * 2];
      const float cy = childPos[vbase + static_cast<size_t>(v) * 2 + 1];
      const float x = a * cx + c * cy + tx;
      const float y = b * cx + d * cy + ty;
      if (!haveBounds) {
        left = right = x;
        top = bottom = y;
        haveBounds = true;
        continue;
      }
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }

    SsMaskWriter w;
    w.partIndex = cw.partIndex;
    // Scoped at the instance's rank: it clips this player's parts drawn *after*
    // the mount, exactly as a native clipping writer at that rank would.
    w.drawRank = ownerRank;
    w.bit = static_cast<int32_t>(writers_.size());
    w.partDrawIndex = cw.partDrawIndex;
    // The child writer's OP composed with the influence reaching the mount —
    // a `mask_influence == 0` instance drops it to the increment (union) plane.
    w.opInvert = cw.opInvert && inheritedInfluence;
    w.isClipping = true;
    w.threshold = cw.threshold;
    w.foreignBaker = &childBaker;
    for (int i = 0; i < 6; ++i) w.foreignXf[i] = mountXf[i];
    writers_.push_back(w);

    if (minClipRank_ < 0 || ownerRank < minClipRank_) minClipRank_ = ownerRank;
  }

  if (haveBounds) {
    left_ = left;
    top_ = top;
    right_ = right;
    bottom_ = bottom;
  }
}

bool SsMaskPlan::bitsFor(int32_t rank, const SsMaskPartFlags& flags, SsMaskBits* out) const {
  if (out == nullptr || writers_.empty()) return false;
  if (!flags.isTarget()) return false;

  const bool visibleInside = flags.visibleInsideMask;
  if (!inScope(rank) && !visibleInside) return false;

  *out = SsMaskBits{};
  out->visibleInside = visibleInside;
  for (const SsMaskWriter& w : writers_) {
    // A pure mask reaches the parts drawn *before* it, a clipping writer
    // the ones drawn after.
    const bool active = w.isClipping ? rank > w.drawRank : rank < w.drawRank;
    if (!active) continue;
    const uint32_t bit = 1u << w.bit;
    // Never fold the two OPs into one accumulator — they do not commute,
    // so a shared plane would make coverage depend on the order the writers were
    // listed in.
    if (w.opInvert) {
      out->invert |= bit;
    } else {
      out->increment |= bit;
    }
  }
  return true;
}

}  // namespace sscore
