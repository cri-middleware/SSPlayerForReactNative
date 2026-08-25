#include "SsEffect.hpp"

#include "SsAnimeBinary.hpp"
#include "ssruntime.h"

namespace sscore {

namespace {

/// The seed for one part's slot: deterministic, yet different per part.
///
/// SSPlayerForFlutter's and the flagship's formula. Two parts playing the *same*
/// effect would otherwise emit in visual lockstep, and a clock- or RNG-derived
/// seed would make the same frame render differently on a second run. The
/// runtime overrides it outright for effects authored `is_lock_rand_seed`.
uint32_t SeedFor(const SsEffectPart& part) {
  return part.partIndex ^ part.effectNameHash;
}

}  // namespace

SsEffectSlots::~SsEffectSlots() { release(); }

void SsEffectSlots::bind(void* resource, const SsAnimeBinaryView& view) {
  release();
  if (resource == nullptr || !view.valid()) return;

  parts_ = view.effectParts();
  if (parts_.empty()) return;

  cellMapSizes_ = view.cellMapSizes();
  planByPart_.assign(view.partCount(), nullptr);

  slots_.reserve(parts_.size());
  for (const SsEffectPart& part : parts_) {
    // A null return is bad or missing effect data. Kept in the vector so the
    // indices stay parallel with `parts_`, and never retried.
    slots_.push_back(ss_effect_slot_create(resource, part.effectNameHash, SeedFor(part)));
  }
}

void SsEffectSlots::step(void* context, float parentFrame, float deltaSeconds, float fps,
                         bool parentLooped) {
  if (context == nullptr || parts_.empty()) return;

  for (size_t i = 0; i < parts_.size(); ++i) {
    void* slot = slots_[i];
    const uint32_t partIndex = parts_[i].partIndex;
    if (partIndex >= planByPart_.size()) continue;
    if (slot == nullptr) {
      planByPart_[partIndex] = nullptr;
      continue;
    }

    const ss_effect_event_info ev = ss_runtime_get_active_effect_event(context, partIndex);
    const ss_effect_step_result result =
        ss_effect_slot_step(slot, ev, parentFrame, deltaSeconds, fps, parentLooped,
                            // `y_flip = true`: the context runs Y-down (see
                            // `HybridSsContext`'s constructor), so the particles
                            // are mirrored here with everything else. Passing
                            // false would leave every effect mirrored about its
                            // emitter relative to the parts around it. Same value
                            // ForWeb, ForFlutter and ForGodot pass.
                            /*y_flip=*/true,
                            // (x, y) pairs. The plan reports it back and the
                            // baker reads it there rather than assuming.
                            /*vert_stride=*/2);

    planByPart_[partIndex] =
        result.visible && result.draw_plan_buf != nullptr && result.draw_plan_len > 0
            ? result.draw_plan_buf
            : nullptr;
  }
}

void SsEffectSlots::reset() {
  for (void* slot : slots_) {
    if (slot != nullptr) ss_effect_slot_reset(slot);
  }
  // The plans belong to the slots that just rewound, so they are stale here for
  // the same reason a `release()` makes the SoA stale.
  for (const uint8_t*& plan : planByPart_) plan = nullptr;
}

void SsEffectSlots::release() noexcept {
  for (void* slot : slots_) {
    if (slot != nullptr) ss_effect_slot_destroy(slot);
  }
  slots_.clear();
  parts_.clear();
  planByPart_.clear();
  cellMapSizes_.clear();
}

SsEffectFrame SsEffectSlots::frame() const noexcept {
  SsEffectFrame out;
  if (parts_.empty() || planByPart_.empty()) return out;
  out.planByPart = planByPart_.data();
  out.partCount = planByPart_.size();
  out.cellMapSizes = cellMapSizes_.empty() ? nullptr : cellMapSizes_.data();
  out.cellMapSizeCount = cellMapSizes_.size();
  return out;
}

}  // namespace sscore
