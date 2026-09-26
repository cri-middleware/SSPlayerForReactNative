#pragma once

// The Instance kind: one `InstanceSlot` per instance part, and the child player
// each one drives.
//
// The division of labour is unusually lopsided and worth stating up front.
// **Every** playback attribute — start/end labels, loop count, speed, reverse,
// pingpong, independent — is resolved inside `ss_instance_slot_step`, against
// the child's own Context. Nothing here reads `PartAttributeInstance` and
// nothing branches on `ev.is_synthetic_default`; the SDK calls that out
// explicitly. The Body's whole job is to hand the slot a child Context, react to
// the transition edge, and draw the child at the frame it reports.
//
// Skia-free and Nitro-free like `SsEffect`, and for the same reason. The child
// itself is reached through `SsInstanceChild` rather than named, so this file
// does not have to know that the thing implementing it is the Nitro hybrid.

#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

namespace sscore {

class SsAnimeBinaryView;

/// One part that mounts another animation, as declared in the static `.ssab`.
///
/// Read once at load — the binding never changes per frame.
struct SsInstancePart {
  /// Doubles as the **slot index** for `ss_runtime_get_active_event_instance`,
  /// because the ssab keys `EventInstance` by part index.
  uint32_t partIndex = 0;
  /// `PartTypeInstance.ref_anime_pack` — the pack holding the child animation.
  /// May name this player's own pack (a same-file sub-animation, the common
  /// case) or an external sibling listed in `external_instances`. **0 means the
  /// author left it pack-less**, which resolves to the own pack.
  uint32_t packNameHash = 0;
  /// `PartTypeInstance.ref_anime_name` — the animation to select on the child.
  std::string animeName;
};

/// A pack an instance part reaches into that is **not** this one.
///
/// From the `.ssab`'s own `external_instances` manifest rather than a scan of
/// the parts: the converter emits one entry per referenced external pack, so a
/// same-file sub-animation is (correctly) absent.
struct SsExternalPack {
  std::string name;
  uint32_t nameHash = 0;
};

/// The child player a slot drives.
///
/// Implemented by `HybridSsContext`, which is both a root player and — one level
/// down — somebody's instance child, exactly as `SpriteStudioInternalPlayer` is
/// in SSPlayerForFlutter. The interface exists so the slot logic sits *below*
/// the hybrid rather than inside it.
struct SsInstanceChild {
  virtual ~SsInstanceChild() = default;

  /// The child's runtime Context. `ss_instance_slot_step` steps **this**, while
  /// the `EventInstance` is resolved against the *parent's*.
  virtual void* instanceContext() const = 0;

  /// Starts the child from its just-configured start frame.
  ///
  /// Not a courtesy. The two reference ports disagree about whether `step`
  /// leaves the child playing — SSPlayerForGodot says it does and calls `play()`
  /// only for the host-side event, SSPlayerForFlutter says it does not and that
  /// an independent child otherwise freezes forever on a stopped controller.
  /// Calling it is correct under both readings: a transition *is* "start this
  /// instance from its start", so a rewind is the intended effect and not a
  /// side effect.
  virtual void instancePlay() = 0;

  /// Halts the child's own clock. Called once at setup, because a child must not
  /// self-advance before its `EventInstance` has ever fired.
  virtual void instanceStop() = 0;

  /// Re-arms the child's own slot debounces, recursively — the head-out half of
  /// `instancePlay`, without touching playback.
  virtual void instanceResetSlots() = 0;

  /// Drives the child's *own* per-frame slots (its effects and its nested
  /// instances) at the frame the Brain just stepped it to.
  ///
  /// The child's animation clock belongs to `ss_instance_slot_step`, so this
  /// must **not** run `ss_runtime_update` on the child.
  virtual void instanceStepSlots(float childFrame, float dtMilliseconds,
                                 bool childLooped) = 0;
};

/// One instance part's live state.
struct SsInstanceState {
  /// From `ss_instance_slot_create()`. Unlike an effect slot it binds no
  /// resource — `step` takes the child context per call.
  void* slot = nullptr;
  /// Owned. Null when the part's pack could not be resolved, in which case the
  /// part simply never draws — the same fail-safe as an invisible slot.
  SsInstanceChild* child = nullptr;
  uint32_t partIndex = 0;
  /// The frame the last `step` left the child on; what the draw uses.
  float childFrame = 0.0f;
  /// Whether the Brain says this child is live this frame. **Invisible is the
  /// fail-safe**: every path that does not explicitly draw leaves it hidden.
  bool visible = false;
};

/// Owns one slot + child per instance part.
///
/// Slots are stepped from the player's `update`, where the delta is, and never
/// from `draw_order` — the same rule as `SsEffect`, and for the same reason: the
/// Brain drops a hidden Instance part from the draw order, and a child whose
/// clock stopped with it would resume in the wrong place.
class SsInstanceSlots {
 public:
  SsInstanceSlots() = default;
  ~SsInstanceSlots();

  SsInstanceSlots(const SsInstanceSlots&) = delete;
  SsInstanceSlots& operator=(const SsInstanceSlots&) = delete;

  /// Spawns one slot + child per instance part in `view`.
  ///
  /// `childFor` returns the child mounted on a part, or null when its pack
  /// cannot be resolved. Ownership passes to this object. Idempotent-safe: what
  /// is already held is released first.
  template <typename ChildFor>
  void build(const SsAnimeBinaryView& view, ChildFor childFor) {
    release();
    buildFrom(instancePartsOf(view), childFor);
  }

  bool empty() const noexcept { return states_.empty(); }

  /// Advances every slot one tick.
  ///
  /// `parentContext` is the **parent's** — the `EventInstance` is resolved
  /// against it, while `step` receives the child's. `parentLooped` is the
  /// parent's loop **edge** for this update; without it a loop boundary is
  /// invisible to the Brain, since the `EventInstance` identity has not changed,
  /// and a finite-loop independent child freezes at its end frame.
  void step(void* parentContext, float parentFrame, float dtMilliseconds, bool parentLooped);

  /// Rewinds every slot's "last started key" memory and its child's clock,
  /// recursing into the child's own slots.
  ///
  /// Must run on an explicit head-out — `play()`, or a new `setupAnimation` — or
  /// the debounce swallows the first key and a replayed animation never
  /// re-fires its instance. Memory only: the child is *stopped* rather than
  /// replayed, and the next `step` sees the re-armed slot, reports a transition
  /// and starts it in the right place.
  void reset();

  /// Destroys every child and slot. Children first, then the slots that drove
  /// them, mirroring the reference ports.
  void release() noexcept;

  /// The live state for `partIndex`, or null when that part has no child.
  const SsInstanceState* stateFor(uint32_t partIndex) const noexcept;

  const std::vector<SsInstanceState>& states() const noexcept { return states_; }

 private:
  /// Split out so the template above does not need the `.ssab` reader.
  static std::vector<SsInstancePart> instancePartsOf(const SsAnimeBinaryView& view);

  template <typename ChildFor>
  void buildFrom(const std::vector<SsInstancePart>& parts, ChildFor childFor) {
    states_.reserve(parts.size());
    for (const SsInstancePart& part : parts) {
      SsInstanceChild* child = childFor(part);
      if (child == nullptr) continue;
      SsInstanceState state;
      state.partIndex = part.partIndex;
      state.child = child;
      state.slot = createSlot();
      if (state.slot == nullptr) {
        destroyChild(child);
        continue;
      }
      // A child must not run on its own clock before its EventInstance fires.
      child->instanceStop();
      states_.push_back(state);
    }
  }

  /// Thin wrappers so the header stays free of `ssruntime.h`.
  static void* createSlot();
  static void destroyChild(SsInstanceChild* child);

  std::vector<SsInstanceState> states_;
};

}  // namespace sscore
