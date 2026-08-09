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
    // than clipping its targets with a wrong-shaped stand-in.
    if (!f.quadGeometry) continue;

    if (info.partIndex >= partStateCount) continue;
    const ss::runtime::PartState* state = parts->Get(info.partIndex);

    // §2-2, and both halves are needed. `mask == 0` opts the writer out — a rule
    // of its own, so it applies even to a writer that has no cutout to threshold.
    // `hide` has to be tested here because the Brain only drops *mask parts* from
    // `draw_order`: a drawn part turned into a mask still gets its batch when
    // hidden, with only its colour suppressed.
    const float mask = state->mask();
    if (!(mask > 0.0f)) continue;
    if (state->hide()) continue;

    const size_t base = static_cast<size_t>(info.vertexOffset) * 2;
    if (info.vertexCount != 4 || base + 8 > positions.size()) continue;

    SsMaskWriter writer;
    writer.partIndex = info.partIndex;
    writer.drawRank = info.drawRank;
    writer.bit = static_cast<int32_t>(writers_.size());
    writer.partDrawIndex = static_cast<int32_t>(q);
    // §2-3, shared by pure masks and clipping — the same field, read as the OP.
    writer.opInvert = f.maskInfluence;
    writer.isClipping = f.isClipping();
    // §2-5: the threshold narrows which texels contribute. `mask == 255` writes
    // every non-transparent texel; `mask == 0` writes nothing, which is why the
    // opt-out above and this formula agree.
    const float t = (255.0f - mask) / 255.0f;
    writer.threshold = t < 0.0f ? 0.0f : (t > 1.0f ? 1.0f : t);

    for (int c = 0; c < 4; ++c) {
      const float x = positions[base + c * 2];
      const float y = positions[base + c * 2 + 1];
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

bool SsMaskPlan::bitsFor(int32_t rank, const SsMaskPartFlags& flags, SsMaskBits* out) const {
  if (out == nullptr || writers_.empty()) return false;
  if (!flags.isTarget()) return false;

  const bool visibleInside = flags.visibleInsideMask;
  if (!inScope(rank) && !visibleInside) return false;

  *out = SsMaskBits{};
  out->visibleInside = visibleInside;
  for (const SsMaskWriter& w : writers_) {
    // §2-1: a pure mask reaches the parts drawn *before* it, a clipping writer
    // the ones drawn after.
    const bool active = w.isClipping ? rank > w.drawRank : rank < w.drawRank;
    if (!active) continue;
    const uint32_t bit = 1u << w.bit;
    // §3-1-4: never fold the two OPs into one accumulator — they do not commute,
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
