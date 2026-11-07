#include "SsMask.hpp"

#include "SsBaker.hpp"

namespace sscore {

void SsMaskPlan::clear() {
  writers_.clear();
  left_ = top_ = right_ = bottom_ = 0.0f;
  haveBounds_ = false;
  dropped_ = false;
}

void SsMaskPlan::extend(float x, float y) {
  if (!haveBounds_) {
    left_ = right_ = x;
    top_ = bottom_ = y;
    haveBounds_ = true;
    return;
  }
  if (x < left_) left_ = x;
  if (x > right_) right_ = x;
  if (y < top_) top_ = y;
  if (y > bottom_) bottom_ = y;
}

bool SsMaskPlan::build(const ss::runtime::FrameData* fd, const SsBaker& baker,
                       const SsMaskPartFlags* flags, size_t flagCount) {
  clear();
  collect(fd, baker, flags, flagCount, nullptr, 0, -1.0f, SsMaskContext{}, nullptr, nullptr);
  return finish();
}

void SsMaskPlan::collect(const ss::runtime::FrameData* fd, const SsBaker& baker,
                         const SsMaskPartFlags* flags, size_t flagCount, const float* seq,
                         size_t seqCount, float startSeq, const SsMaskContext& context,
                         const SsBaker* foreignBaker, const float* toRoot) {
  if (fd == nullptr || flags == nullptr || flagCount == 0) return;

  const auto* parts = fd->parts();
  if (parts == nullptr) return;
  const uint32_t partStateCount = parts->size();

  const std::vector<SsPartDraw>& parts_ = baker.parts();
  const std::vector<float>& positions = baker.positions();

  for (size_t q = 0; q < parts_.size(); ++q) {
    const SsPartDraw& info = parts_[q];
    if (info.partIndex >= flagCount) continue;
    const SsMaskPartFlags& f = flags[info.partIndex];
    if (!f.isWriter()) continue;
    // A writer whose shape the coverage pass cannot rasterise is dropped rather
    // than clipping its targets with a wrong-shaped stand-in. Only the part type
    // decides: `quadShaped` is about inverting a UV, which the *target* side
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
    // Any vertex count: a polygon and a deformed mesh both write
    // coverage. Three is the fewest that encloses anything.
    if (info.vertexCount < 3 || base + floats > positions.size()) continue;

    // Past the budget only after the per-frame opt-outs, so a switched-off
    // writer costs no bit.
    if (writers_.size() >= static_cast<size_t>(kSsMaxMaskWriters)) {
      dropped_ = true;
      return;
    }

    const float at = (seq != nullptr && info.drawRank >= 0 &&
                      static_cast<size_t>(info.drawRank) < seqCount)
                         ? seq[info.drawRank]
                         : static_cast<float>(info.drawRank);

    SsMaskWriter writer;
    writer.partIndex = info.partIndex;
    writer.drawRank = info.drawRank;
    writer.bit = static_cast<int32_t>(writers_.size());
    writer.partDrawIndex = static_cast<int32_t>(q);
    // Shared by pure masks and clipping — the same field, read as the OP, and
    // composed with the instance part's one level up: a `mask_influence == 0`
    // instance drops its writers to the increment (union) plane.
    writer.opInvert = f.maskInfluence && context.influence;
    writer.isClipping = f.isClipping();
    // The threshold narrows which texels contribute. `mask == 255` writes
    // every non-transparent texel; `mask == 0` writes nothing, which is why the
    // opt-out above and this formula agree.
    const float t = (255.0f - mask) / 255.0f;
    writer.threshold = t < 0.0f ? 0.0f : (t > 1.0f ? 1.0f : t);
    // A pure mask closes at itself and never reaches past the start of its own
    // animation; a clipping writer runs on to the end of the whole tree, which
    // is what carries one written inside an instance to the caller's later parts.
    writer.open = writer.isClipping ? at : startSeq;
    writer.close = writer.isClipping ? kSsMaskSeqEnd : at;
    writer.foreignBaker = foreignBaker;
    if (toRoot != nullptr) {
      for (int i = 0; i < 6; ++i) writer.foreignXf[i] = toRoot[i];
    }

    // Over every vertex, not four corners — the union box has to contain the
    // whole writer or its own coverage is clipped by the bitmap's edge — and in
    // the root's space, which is the space the box is drawn in.
    const float* m = writer.foreignXf;
    for (int32_t c = 0; c < info.vertexCount; ++c) {
      const float x = positions[base + static_cast<size_t>(c) * 2];
      const float y = positions[base + static_cast<size_t>(c) * 2 + 1];
      extend(m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]);
    }

    writers_.push_back(writer);
  }
}

bool SsMaskPlan::finish() {
  if (writers_.empty()) return false;
  // A zero-area box has no coverage to stretch over and would divide by zero in
  // `coverageUv`. Dropping the writers leaves only the parts that draw inside a
  // mask to hide, which is the same thing a writer that covers no pixel would
  // have produced.
  if (!(right_ > left_) || !(bottom_ > top_)) {
    const bool dropped = dropped_;
    clear();
    dropped_ = dropped;
    return false;
  }
  return true;
}

bool SsMaskPlan::bitsFor(float seq, const SsMaskPartFlags& flags, const SsMaskContext& context,
                         SsMaskBits* out) const {
  if (out == nullptr) return false;
  // The AND, one level: the part's own opt-in and its instance part's.
  if (!(flags.isTarget() && context.influence)) return false;

  *out = SsMaskBits{};
  out->visibleInside = flags.visibleInsideMask || context.visibleInside;
  for (const SsMaskWriter& w : writers_) {
    if (!(seq > w.open && seq < w.close)) continue;
    // Never fold the two OPs into one accumulator — they do not commute,
    // so a shared plane would make coverage depend on the order the writers were
    // listed in.
    out->set(w.bit, w.opInvert);
  }
  return out->visibleInside || !out->isEmpty();
}

}  // namespace sscore
