#pragma once

// Variant (c)'s drawing step: turn a baked frame into Skia draw calls, in C++.
//
// Declared with opaque pointers so `HybridSsContext` — which is compiled on
// every target — never needs the Skia headers. Only SsSkiaDraw.cpp does.

#include <cstddef>
#include <cstdint>

namespace sscore {
class SsBaker;
class SsMaskPlan;
struct SsMaskPartFlags;
}

namespace ssplayer {

struct SsMaskCoverage;

/// The frame's masking, or all-null when nothing writes coverage.
///
/// The plan is built by the caller because it needs the *static* half of the
/// mask flags, which come from the `.ssab` and are read once at load — the split
/// §1-2 opens by insisting on. Passing them in also keeps this file free of the
/// `.ssab` reader.
struct SsMaskInput {
  const sscore::SsMaskPlan* plan = nullptr;
  /// Indexed by part index, as `SsAnimeBinaryView::maskFlags()` returns them.
  const sscore::SsMaskPartFlags* flags = nullptr;
  size_t flagCount = 0;

  /// §2-6: the coverage belongs to a **caller** and this frame is the
  /// sub-animation mounted on one of its instance parts.
  ///
  /// The fields below are the caller's composed state, and they are identity
  /// values for a root — so a top-level animation evaluates every part by its
  /// own settings, which is what the spec asks for.
  ///
  /// §2-6's `mask_influence` AND-chain, composed down the instance hierarchy. The
  /// identity is `true` (a root evaluates each part by its own settings). Once it
  /// reaches `false` it never returns, and the **whole subtree is then unmasked —
  /// its own masks included**, not only the caller's. A mounted sub-animation
  /// therefore applies its OWN masking only while this stays true; a
  /// `mask_influence == 0` instance part turns it off for everything below, so the
  /// child draws its parts unclipped even though it has writers of its own. This
  /// has to ride down even on a frame with no coverage to pass — which is why it
  /// is a field of its own rather than "carried by whether a `plan` arrives".
  bool influence = true;

  /// True when a caller's coverage actually reaches this frame — its `plan` /
  /// `coverage` below are then borrowed from the caller. Only set when `influence`
  /// survived the AND above **and** the caller had a mask to pass.
  bool inherited = false;
  /// The instance part's own rank in the **caller's** draw order. Scope does not
  /// compose (§2-6): the sub-animation sits where the instance part sits, so
  /// every part inside it asks "which writers reach *that* rank".
  int32_t callerRank = -1;
  /// `caller's visible_inside || own` — OR, so once any level asks for "inside",
  /// everything below draws inside.
  bool visibleInside = false;
  /// Child-local → the coverage's space: `M_child = M_parent · slot_xf`. The
  /// coverage and its metadata are the caller's alone, so a child's vertices have
  /// to be mapped into that space before they can be looked up in it.
  float slotXf[6] = {1.0f, 0.0f, 0.0f, 1.0f, 0.0f, 0.0f};
  /// §3-2-2 step 1: **the caller's rasterised coverage**, borrowed for the
  /// duration of its draw call.
  ///
  /// Handed over rather than rebuilt, because it cannot be rebuilt here: the
  /// writers in the plan are the *caller's* parts, and this frame's baker holds
  /// the child's geometry. Rasterising one against the other yields an empty
  /// bitmap — which reads as "no mask" and is exactly the bug this field fixes.
  const SsMaskCoverage* coverage = nullptr;

  bool active() const { return plan != nullptr && flags != nullptr && flagCount > 0; }
};

/// Draws the sub-animation mounted on an instance part.
///
/// An Instance batch carries no geometry: the thing to draw is another player's
/// whole bake. Rather than teach this file about the player tree, the batch walk
/// sets up the canvas — save, concat the mount matrix — and calls back through
/// here, which lands in the child's own `DrawBakedFrame` and recurses naturally.
struct SsInstanceRenderer {
  virtual ~SsInstanceRenderer() = default;

  /// `canvas` is already transformed into the child's space. `alphaScale` is the
  /// mount point's opacity, folded into the child's *bake* rather than applied
  /// as a layer, because SpriteStudio modulates a sub-animation per part.
  /// `mask` is what the caller composed for this mount (§2-6) — inactive when
  /// the frame has no mask, or when the instance part is not a mask target and
  /// the AND has therefore settled "unmasked" for everything below it.
  ///
  /// Returns the vertices drawn; 0 when there is nothing mounted there.
  virtual size_t drawInstance(void* canvas, uint32_t partIndex, float alphaScale,
                              const SsMaskInput& mask) = 0;
};

/// One `cellmap.name_hash` → `SkPaint*` entry of the texture table.
///
/// Deliberately not the Nitro struct: this header is included by
/// `HybridSsContext`, which must stay free of both Skia and (for the host test
/// harness) Nitro.
struct SsPaintBinding {
  uint32_t textureHash;
  void* paint;
};

/// Draws every batch the baker produced into `canvas`, picking each batch's
/// paint out of `textures` by its `texture_hash`.
///
/// Walking the batches in the Brain's order — rather than once per texture — is
/// what keeps the depth sorting intact when a pack has more than one cellmap.
/// A batch whose hash matches nothing is skipped, so a mis-keyed texture shows
/// up as a missing part rather than a part wearing the wrong atlas. The one
/// exception is a single-entry table, which matches unconditionally: a
/// one-cellmap pack is then drawable without knowing the cellmap's name.
///
/// `canvas` is an `SkCanvas*` and each `paint` an `SkPaint*`, all borrowed for
/// the duration of the call. Returns the number of vertices drawn, or 0 when the
/// build has no Skia support (`SSPLAYER_ENABLE_SKIA_DIRECT=0`).
///
/// When `mask` is active the coverage bitmap is rasterised first, before any
/// colour, and every target it reaches is peeled out and drawn through the
/// replay shader.
///
/// `instances` is called for each live instance part, or may be null in a pack
/// that has none — in which case an Instance batch simply draws nothing.
size_t DrawBakedFrame(void* canvas, const SsPaintBinding* textures, size_t textureCount,
                      const sscore::SsBaker& baker, const SsMaskInput& mask,
                      SsInstanceRenderer* instances = nullptr);

/// Whether this build can draw natively at all.
bool SkiaDirectAvailable();

}  // namespace ssplayer
