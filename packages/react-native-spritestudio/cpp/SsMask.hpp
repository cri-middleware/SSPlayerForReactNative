#pragma once

// Mask and clipping (`40_components/40_mask.md`) — **two different features on
// one mechanism**, and the doc opens by warning against conflating them: a mask
// part draws no colour and hides the parts drawn *before* it; a clipping part
// draws itself and confines the parts drawn *after* it.
//
// Skia exposes no stencil, so this is §3-2's coverage-bitmap approach: rasterise
// each writer into an offscreen bitmap, one bit per writer, and have each masked
// target replay the writers that reach it. Ported from **SSPlayerForFlutter**'s
// `render/mask.dart`, which faced the same primitives.
//
// Scope resolution stays on the CPU exactly as it does there, so the shader
// never sees the flagship's `mask_meta[]` array — only the two 24-bit sets in
// `SsMaskBits`. Splitting them by OP is not an optimisation but §3-1-4: `Invert`
// and `Increment` do not commute, so each accumulates on its own plane and the
// replay takes the union.
//
// Skia-free, like `SsPartColor.hpp` and for the same reason: the plan is
// arithmetic over the frame, so `tools/ssbake_check.cpp` can drive it on the
// host. `SsMaskShader.hpp` holds the SkSL half.

#include <cstddef>
#include <cstdint>
#include <vector>

#include "format/framedata.h"

namespace sscore {

class SsBaker;

/// §3-2: one bit per writer, in three 8-bit planes of the coverage bitmap.
/// Writers past the cap are dropped.
///
/// The flagships pack the three planes into RGB and leave alpha to the
/// premultiplied blend; this port puts each in the **alpha** of its own plane
/// instead, because RGB is colour and Skia gamut-maps it into a Display P3
/// destination — `SsMaskShader.hpp` has the whole story.
constexpr int kSsMaxMaskWriters = 24;

/// The number of 8-bit planes `kSsMaxMaskWriters` needs. Also the width of the
/// per-plane split `SsMaskBits` does, which is why both are byte-shaped.
constexpr int kSsMaskPlaneCount = (kSsMaxMaskWriters + 7) / 8;

/// `SsMaskWriter::threshold` for a writer with no texel to cut out (§2-5's shape
/// special case). Below every possible alpha, so nothing is thresholded away.
constexpr float kSsNoCutoutThreshold = -1.0f;

/// The static, per-part mask flags — read **once** from the `.ssab` `PartData`.
///
/// The split matters and the doc leads with it: these four are PartData and
/// never change, while `mask` / `priority` / `hide` are FrameData and are re-read
/// every frame. The three canonical role expressions (§1-2) are methods here; do
/// not re-derive them at call sites.
struct SsMaskPartFlags {
  /// `PartTypeMask || draw_as_mask` — writes coverage and draws NO colour.
  bool pureMask = false;
  /// Writes coverage; when not `pureMask` it also draws normally (clipping).
  bool maskWrite = false;
  /// **Deliberately overloaded** (§1-2), never normalise it away: on a writer it
  /// is the OP (false = increment, true = invert); on a target it is the opt-in
  /// flag. A clipping writer is both at once, from this one value.
  bool maskInfluence = false;
  /// §2-4's polarity, and it lives on the *target*, not on the writer.
  bool visibleInsideMask = false;
  /// Whether the coverage pass can rasterise this part's shape — true for every
  /// kind `SsBaker` emits geometry for.
  ///
  /// It used to be `quadGeometry`, and the rename is the point: coverage is no
  /// longer a quad. A Mesh can be a clipping writer and a Shape a pure mask, and
  /// their coverage is a deformed mesh and a polygon; rasterising a bounding
  /// quad instead would clip to a rectangle, which is wrong in a way that looks
  /// deliberate. Both are baked now, so both write their real shape.
  ///
  /// Instance and Effect stay out: an instance part has no geometry of its own
  /// (its child's is a whole subtree) and an effect's is a cloud of particles.
  bool bakedGeometry = false;

  /// §1-2: `is_writer = pure_mask || mask_write`.
  bool isWriter() const { return pureMask || maskWrite; }
  /// §1-2: `is_clipping = mask_write && !pure_mask`.
  bool isClipping() const { return maskWrite && !pureMask; }
  /// §2-2: subject to the mask test at all. A clipping writer always is — its
  /// `mask_influence` encodes the OP, not an opt-out.
  bool isTarget() const { return maskInfluence || maskWrite; }
};

/// One coverage-bitmap writer for the current frame (§3-2-1).
struct SsMaskWriter {
  uint32_t partIndex = 0;
  /// Its position in `draw_order` — the scope pivot (§2-1).
  int32_t drawRank = -1;
  /// Coverage bit, `0..kSsMaxMaskWriters-1`.
  int32_t bit = 0;
  /// This writer's entry in `SsBaker::parts()`, so the coverage pass finds the
  /// geometry without a second bake.
  int32_t partDrawIndex = -1;
  /// §2-3's OP: false = increment, true = invert.
  bool opInvert = false;
  /// Masks the parts drawn *after* it, rather than before (§2-1).
  bool isClipping = false;
  /// §2-5's cutout: texels at or below this alpha contribute no coverage.
  /// `kSsNoCutoutThreshold` means "never cut out".
  float threshold = 0.0f;
};

/// One target's resolved mask test: which writers reach it, and with what
/// polarity.
///
/// The two sets are disjoint by construction — a writer's OP puts it in exactly
/// one — so the replay is independent of the order the bits are walked in.
struct SsMaskBits {
  uint32_t increment = 0;
  uint32_t invert = 0;
  bool visibleInside = false;

  /// No writer reaches this target. With `visibleInside` the part then draws
  /// nowhere; otherwise it draws everywhere.
  bool isEmpty() const { return increment == 0 && invert == 0; }
};

/// The frame's mask plan: who writes coverage, the player-local box the bitmap
/// spans, and the per-target scope resolution (§3-2).
class SsMaskPlan {
 public:
  /// Rebuilds from the frame. False when nothing writes coverage — the caller
  /// then skips the whole mask machinery, which is the overwhelmingly common
  /// case and the reason this returns a bool rather than an empty plan.
  ///
  /// `flags` is indexed by part index, as `SsAnimeBinaryView` reads it.
  bool build(const ss::runtime::FrameData* fd, const SsBaker& baker,
             const SsMaskPartFlags* flags, size_t flagCount);

  void clear();

  bool empty() const { return writers_.empty(); }
  const std::vector<SsMaskWriter>& writers() const { return writers_; }

  /// Union of the writers' quads in **player-local** space. The coverage bitmap
  /// is stretched over exactly this box, so the local -> UV map is
  /// resolution-independent (§3-2-2).
  float left() const { return left_; }
  float top() const { return top_; }
  float right() const { return right_; }
  float bottom() const { return bottom_; }
  float width() const { return right_ - left_; }
  float height() const { return bottom_ - top_; }

  /// The coverage UV of a player-local point. Outside `[0,1]` means "outside the
  /// box", which the replay treats as having no writer (§3-3) rather than
  /// letting texture clamping invent coverage at the edges.
  void coverageUv(float x, float y, float* u, float* v) const {
    *u = (x - left_) / (right_ - left_);
    *v = (y - top_) / (bottom_ - top_);
  }

  /// The mask test for the target at `rank`, or false when the part is not
  /// masked and keeps the plain batched path.
  ///
  /// A part is tested when it opts in (§2-2) **and** either a writer's scope
  /// reaches it or it is `visible_inside_mask` — the latter draws only inside a
  /// mask, so it must run the test even out of scope, where the empty writer set
  /// then correctly discards it.
  bool bitsFor(int32_t rank, const SsMaskPartFlags& flags, SsMaskBits* out) const;

 private:
  /// §2-1's cheap early-out: does any writer's scope reach `rank`?
  bool inScope(int32_t rank) const {
    return (maxMaskRank_ >= 0 && rank < maxMaskRank_) ||
           (minClipRank_ >= 0 && rank > minClipRank_);
  }

  std::vector<SsMaskWriter> writers_;
  float left_ = 0.0f;
  float top_ = 0.0f;
  float right_ = 0.0f;
  float bottom_ = 0.0f;
  /// Highest rank among pure-mask writers (-1 when none): every part below it is
  /// potentially masked.
  int32_t maxMaskRank_ = -1;
  /// Lowest rank among clipping writers (-1 when none): every part above it is.
  int32_t minClipRank_ = -1;
};

}  // namespace sscore
