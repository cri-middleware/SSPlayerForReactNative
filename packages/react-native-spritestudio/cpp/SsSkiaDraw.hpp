#pragma once

// Variant (c)'s drawing step: turn a baked frame into Skia draw calls, in C++.
//
// Declared with opaque pointers so `HybridSsContext` — which is compiled on
// every target — never needs the Skia headers. Only SsSkiaDraw.cpp does.

#include <cstddef>
#include <cstdint>

#include "SsMask.hpp"

namespace sscore {
class SsBaker;
}

namespace ssplayer {

struct SsMaskCoverage;

/// The frame's masking.
///
/// The plan is built by the caller because it needs the *static* half of the
/// mask flags, which come from the `.ssab` and are read once at load, and
/// because it spans the whole instance tree, which this file does not walk.
/// Passing them in also keeps this file free of the `.ssab` reader.
struct SsMaskInput {
  /// The tree's writers, or null when the tree has none this frame. Owned by the
  /// root and borrowed by every sub-animation below it.
  const sscore::SsMaskPlan* plan = nullptr;
  /// Indexed by part index, as `SsAnimeBinaryView::maskFlags()` returns them.
  /// Always this frame's own: part indices do not cross an instance boundary.
  const sscore::SsMaskPartFlags* flags = nullptr;
  size_t flagCount = 0;

  /// This frame's ranks on the tree sequence the plan's intervals are stated
  /// in, indexed by rank. Null: the rank is the number, which is right for a
  /// frame that is its own whole tree.
  const float* seq = nullptr;
  size_t seqCount = 0;

  /// The instance part's own `mask_influence` / `visible_inside_mask`, composed
  /// with every part of this frame — one level, and the identity for a root.
  sscore::SsMaskContext context;

  /// True when this frame is a sub-animation mounted on a caller's instance
  /// part, rather than a root.
  bool mounted = false;
  /// This frame's local space → the coverage's (the root's):
  /// `M_child = M_parent · slot_xf`. The identity for a root.
  float slotXf[6] = {1.0f, 0.0f, 0.0f, 1.0f, 0.0f, 0.0f};
  /// **The root's rasterised coverage**, borrowed for the duration of its draw
  /// call. Null in a root, which rasterises the plan itself.
  ///
  /// Handed over rather than rebuilt, because it cannot be rebuilt here: the
  /// writers in the plan belong to the whole tree, and this frame's baker holds
  /// only its own geometry.
  const SsMaskCoverage* coverage = nullptr;

  bool active() const { return flags != nullptr && flagCount > 0; }
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
  /// `mask` is what the caller composed for this mount: the tree's plan and
  /// coverage, the instance part's own flags as the context, and the matrix
  /// into the coverage's space. Its `flags` and `seq` are left for the child to
  /// fill in with its own.
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
