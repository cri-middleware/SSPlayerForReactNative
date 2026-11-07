#include "SsInstance.hpp"

#include <cmath>

#include "SsAnimeBinary.hpp"
#include "ssruntime.h"

namespace sscore {

SsInstanceSlots::~SsInstanceSlots() { release(); }

std::vector<SsInstancePart> SsInstanceSlots::instancePartsOf(const SsAnimeBinaryView& view) {
  return view.instanceParts();
}

void* SsInstanceSlots::createSlot() { return ss_instance_slot_create(); }

void SsInstanceSlots::destroyChild(SsInstanceChild* child) { delete child; }

void SsInstanceSlots::step(void* parentContext, float parentFrame, float dtMilliseconds,
                           bool parentLooped) {
  if (parentContext == nullptr || states_.empty()) return;
  const float deltaSeconds = dtMilliseconds / 1000.0f;

  for (SsInstanceState& state : states_) {
    if (state.slot == nullptr || state.child == nullptr) continue;

    // Slot index == part index: the ssab keys `EventInstance` by part index. The
    // event is resolved against the **parent**, the step runs against the child.
    const ss_event_instance_info ev =
        ss_runtime_get_active_event_instance(parentContext, state.partIndex);
    const ss_instance_step_result r = ss_instance_slot_step(
        state.slot, ev, state.child->instanceContext(), parentFrame, deltaSeconds, parentLooped);

    // A new `EventInstance` edge. See `SsInstanceChild::instancePlay` for why
    // this is required rather than a notification.
    if (r.transitioned) {
      state.child->instancePlay();
      // The child restarts from its section start, so its own grandchildren and
      // effects restart with it. Left alone they carry on from where they were,
      // and a finite independent one inside never shows again. Before the step
      // below, which is what lets them see their first key afresh. This slot is
      // not reset: it is the one that just started the child.
      state.child->instanceResetSlots();
    }

    state.visible = r.visible;
    if (!r.visible) continue;

    // The step's frame, the transition tick included. The section change has
    // already put an independent child on its first frame for the direction —
    // where `play()` snaps it — and a synced child's frame follows the parent.
    // Reading the clock back after `play()` would put a synced child at its
    // section start for that tick instead.
    state.childFrame = r.child_frame_no;

    // The child's *animation* clock is the Brain's, but its effects and its own
    // nested instances still need a tick, at the frame it was just moved to.
    // `child_looped` rather than `parentLooped`: an independent child runs on
    // its own elapsed time, so "the parent looped" for a grandchild is this
    // pulse and not the root animation's.
    //
    // The delta is scaled by the speed the slot just stepped the child at, read
    // *after* the step. The child itself moved at that speed inside the step, so
    // an unscaled delta runs its independent grandchildren and effects at 1x
    // under a key of any other speed. Not `ev.speed`: before the first real key
    // the Brain reports an implicit 1x key that the slot ignores once it has
    // started an independent one, and the subtree would drop to 1x there.
    const float childDtMilliseconds =
        dtMilliseconds * std::fabs(ss_instance_slot_get_speed(state.slot));
    state.child->instanceStepSlots(state.childFrame, childDtMilliseconds, r.child_looped);
  }
}

void SsInstanceSlots::reset() {
  for (SsInstanceState& state : states_) {
    if (state.slot != nullptr) ss_instance_slot_reset(state.slot);
    state.childFrame = 0.0f;
    state.visible = false;
    if (state.child != nullptr) {
      state.child->instanceStop();
      state.child->instanceResetSlots();
    }
  }
}

void SsInstanceSlots::release() noexcept {
  for (SsInstanceState& state : states_) {
    // Child first, then the slot that drove it. The child borrows nothing from
    // the slot today, and one that did would break silently under the other order.
    delete state.child;
    state.child = nullptr;
    if (state.slot != nullptr) {
      ss_instance_slot_destroy(state.slot);
      state.slot = nullptr;
    }
  }
  states_.clear();
}

const SsInstanceState* SsInstanceSlots::stateFor(uint32_t partIndex) const noexcept {
  for (const SsInstanceState& state : states_) {
    if (state.partIndex == partIndex) return &state;
  }
  return nullptr;
}

}  // namespace sscore
