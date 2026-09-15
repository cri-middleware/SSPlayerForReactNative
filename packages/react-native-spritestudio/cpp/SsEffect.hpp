#pragma once

// The Effect kind's clock: one persistent `EffectSlot` per effect part, stepped
// once per frame.
//
// Effects are the only kind whose geometry does **not** come from the Brain's
// per-frame SoA. Each slot simulates on its own and hands back an
// `EffectDrawPlan` FlatBuffer, so stepping needs a delta time and therefore
// happens in `update()` rather than in the draw — which is also the gap the plan
// stays valid for: it is the slot's own buffer and dies at that slot's next step.
//
// Skia-free and Nitro-free, like `SsBaker`, so the host harness can link it.
// It does need the C-API, unlike the baker: the slot is `libssruntime`'s.

#include <cstddef>
#include <cstdint>
#include <vector>

namespace sscore {

class SsAnimeBinaryView;

/// One part that hosts a particle effect, as declared in the static `.ssab`.
///
/// The binding never changes per frame, so this is read once at load — like the
/// mask flags and for the same reason. The *playback* parameters (start time,
/// speed, independent) are deliberately absent: they live on the animation's
/// `EventEffect` keys and are consumed inside the Brain by `ss_effect_slot_step`.
struct SsEffectPart {
  /// Doubles as the **slot index** for `ss_runtime_get_active_effect_event`,
  /// because the ssab keys `EventEffect` by part index.
  uint32_t partIndex = 0;
  /// `PartTypeEffect.ref_effect_name_hash` — what `ss_effect_slot_create` binds.
  uint32_t effectNameHash = 0;
};

/// A cellmap's authored pixel size, keyed the way a draw command names it.
///
/// An `EffectDrawCommand` carries `cellmap_hash` and the plan's UVs are
/// **normalised**, the runtime having divided by exactly this. Multiplying back
/// by it is the inverse, and it is what puts effect UVs in the same texture-pixel
/// space `local_uvs` already speaks — which is what Skia's image shader samples in.
struct SsCellMapSize {
  uint32_t textureHash = 0;
  float width = 0.0f;
  float height = 0.0f;
};

/// The plans this frame, indexed by part index — the shape `SsBaker` reads.
///
/// A part with no effect, a slot that failed to bind, or an effect that is not
/// visible this frame all come back as a null `plan`, and the baker skips them.
struct SsEffectFrame {
  /// One entry per part in the pack, so a part index is a direct lookup. Empty
  /// when the pack hosts no effects at all, which switches the whole path off.
  const uint8_t* const* planByPart = nullptr;
  size_t partCount = 0;

  /// `cellmap.name_hash` → authored pixel size, for un-normalising the plan's
  /// UVs. Small (a pack has a handful of cellmaps), so it is scanned linearly.
  const SsCellMapSize* cellMapSizes = nullptr;
  size_t cellMapSizeCount = 0;

  bool active() const noexcept { return planByPart != nullptr && partCount > 0; }
};

/// Owns one `ss_effect_slot` per effect part in the pack.
///
/// The registry is built from the **pack's metadata**, never from `draw_order`.
/// The Brain drops a hidden Effect part from the draw order, so a registry built
/// by walking batches would stop stepping an independent effect the moment it
/// was hidden: its clock would freeze and the particles would resume where they
/// stopped instead of where they belong (`40_components/20_effect.md`). Which
/// slots get *drawn* is a separate question, answered by the batch walk.
class SsEffectSlots {
 public:
  SsEffectSlots() = default;
  ~SsEffectSlots();

  SsEffectSlots(const SsEffectSlots&) = delete;
  SsEffectSlots& operator=(const SsEffectSlots&) = delete;

  /// Binds every effect part in `view` against `resource`. Idempotent-safe: any
  /// slots already held are destroyed first.
  ///
  /// `partCount` is the pack's part count and sizes the by-part lookup; it comes
  /// from the `.ssab` rather than from the world-matrix length because this is
  /// built at load, before there is a frame.
  void bind(void* resource, const SsAnimeBinaryView& view);

  /// True when the pack hosts no effect parts — the caller then skips the path.
  bool empty() const noexcept { return parts_.empty(); }

  /// Advances every slot one tick.
  ///
  /// `parentFrame` must stay a **raw float**: rounding it back into slot state
  /// freezes an effect whose per-tick progress is under one frame. `deltaSeconds`
  /// and `fps` matter only to independent slots (they run on their own clock and
  /// ignore `parentFrame`); synced slots are the reverse. `parentLooped` is the
  /// parent's loop **edge** for this update — `ss_runtime_just_looped` is cleared
  /// at the top of each one — which re-arms a synced effect so it fires again
  /// next cycle.
  void step(void* context, float parentFrame, float deltaSeconds, float fps, bool parentLooped);

  /// Rewinds each slot's "last started key" memory.
  ///
  /// Must run on an explicit head-out — `play()`, or a new `setupAnimation` — or
  /// the slot debounces the first key as the one it last started and a replayed
  /// animation never re-fires its effect. Emitter caches and the binding survive.
  void reset();

  /// Destroys every slot. Runs before the resource they borrow is released.
  void release() noexcept;

  /// This frame's plans, in the shape `SsBaker::bake` takes.
  SsEffectFrame frame() const noexcept;

 private:
  /// Parts that host an effect, in part-index order.
  std::vector<SsEffectPart> parts_;
  /// One slot per entry of `parts_`. A null entry is a slot that failed to
  /// create and is **cached as null** — retrying per frame would mean a failed
  /// bind costs a call every tick forever.
  std::vector<void*> slots_;

  /// `partCount` entries, null except where an effect part is visible this
  /// frame. Sized once at bind so `step` allocates nothing.
  std::vector<const uint8_t*> planByPart_;
  std::vector<SsCellMapSize> cellMapSizes_;
};

}  // namespace sscore
