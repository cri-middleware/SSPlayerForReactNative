#pragma once

// Mask and clipping — **two different features on
// one mechanism**: a mask
// part draws no colour and hides the parts drawn *before* it; a clipping part
// draws itself and confines the parts drawn *after* it.
//
// Skia exposes no stencil, so this is the coverage-bitmap approach: rasterise
// each writer into an offscreen bitmap, one bit per writer, and have each masked
// target replay the writers that reach it. Ported from **SSPlayerForFlutter**'s
// `render/mask.dart`, which faced the same primitives.
//
// Scope resolution stays on the CPU exactly as it does there, so the shader
// never sees the flagship's `mask_meta[]` array — only the two 24-bit sets in
// `SsMaskBits`. Splitting them by OP is not an optimisation: `Invert`
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

/// One bit per writer, in three 8-bit planes of the coverage bitmap.
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

/// `SsMaskWriter::threshold` for a writer with no texel to cut out (the shape
/// special case). Below every possible alpha, so nothing is thresholded away.
constexpr float kSsNoCutoutThreshold = -1.0f;

/// The static, per-part mask flags — read **once** from the `.ssab` `PartData`.
///
/// The split matters: these four are PartData and
/// never change, while `mask` / `priority` / `hide` are FrameData and are re-read
/// every frame. The three canonical role expressions are methods here; do
/// not re-derive them at call sites.
struct SsMaskPartFlags {
  /// `PartTypeMask || draw_as_mask` — writes coverage and draws NO colour.
  bool pureMask = false;
  /// Writes coverage; when not `pureMask` it also draws normally (clipping).
  bool maskWrite = false;
  /// **Deliberately overloaded**, never normalise it away: on a writer it
  /// is the OP (false = increment, true = invert); on a target it is the opt-in
  /// flag. A clipping writer is both at once, from this one value.
  bool maskInfluence = false;
  /// The polarity, and it lives on the *target*, not on the writer.
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

  /// `is_writer = pure_mask || mask_write`.
  bool isWriter() const { return pureMask || maskWrite; }
  /// `is_clipping = mask_write && !pure_mask`.
  bool isClipping() const { return maskWrite && !pureMask; }
  /// Subject to the mask test at all — true only when the part opted in
  /// with `mask_influence == 1`.
  ///
  /// This is `mask_influence` alone, clipping parts included. `mask_influence` is
  /// deliberately overloaded: on a clipping part it is BOTH the OP and the
  /// target flag, so `mask_influence == 0` opts the clipping part out of being a
  /// target exactly as it does any drawn part — it still writes its own
  /// coverage as a writer, but its own colour is no longer masked and draws
  /// unconditionally. ORing `mask_write` in here was the bug: it forced a
  /// clipping part with `mask_influence == 0` and `visible_inside == 1` to be
  /// tested, and with nothing covering it the `masked == visible_inside` test
  /// discarded it. SSPlayerForGodot and the wgpu coverage backend both gate the
  /// target purely on `mask_influence`.
  bool isTarget() const { return maskInfluence; }
};

/// One coverage-bitmap writer for the current frame.
struct SsMaskWriter {
  uint32_t partIndex = 0;
  /// Its position in `draw_order` — the scope pivot.
  int32_t drawRank = -1;
  /// Coverage bit, `0..kSsMaxMaskWriters-1`.
  int32_t bit = 0;
  /// This writer's entry in `SsBaker::parts()`, so the coverage pass finds the
  /// geometry without a second bake.
  int32_t partDrawIndex = -1;
  /// The OP: false = increment, true = invert.
  bool opInvert = false;
  /// Masks the parts drawn *after* it, rather than before.
  bool isClipping = false;
  /// The cutout: texels at or below this alpha contribute no coverage.
  /// `kSsNoCutoutThreshold` means "never cut out".
  float threshold = 0.0f;

  /// **Carry-over (ForGodot's `_bubble_child_clip_writers`)**: when a
  /// mounted instance child holds a clipping writer, it "bubbles up" to clip this
  /// player's own parts drawn after the instance. Its geometry then lives in the
  /// child's baker, not this player's, and has to be carried into this player's
  /// space before it is rasterised. Null for an ordinary own writer, in which
  /// case `partDrawIndex` indexes `SsBaker::parts()` of the player that owns the
  /// plan as usual.
  const SsBaker* foreignBaker = nullptr;
  /// The instance mount matrix, `a,b,c,d,tx,ty` — child-world -> this player's
  /// space. Only meaningful when `foreignBaker != nullptr`.
  float foreignXf[6] = {1.0f, 0.0f, 0.0f, 1.0f, 0.0f, 0.0f};
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
/// spans, and the per-target scope resolution.
class SsMaskPlan {
 public:
  /// Rebuilds from the frame. False when nothing writes coverage — the caller
  /// then skips the whole mask machinery, which is the overwhelmingly common
  /// case and the reason this returns a bool rather than an empty plan.
  ///
  /// `flags` is indexed by part index, as `SsAnimeBinaryView` reads it.
  bool build(const ss::runtime::FrameData* fd, const SsBaker& baker,
             const SsMaskPartFlags* flags, size_t flagCount);

  /// Carry-over: fold a mounted instance child's **clipping** writers into
  /// this plan as foreign writers, so they clip this player's own parts drawn
  /// after the instance. Called after `build`, once per visible+influenced mount.
  ///
  /// `childBaker` / `childPlan` are the child's, freshly baked; `mountXf` is the
  /// instance matrix (child-world -> this player's space); `ownerRank` is the
  /// instance part's rank in this player's draw order; `inheritedInfluence` is the
  /// AND-chain reaching the instance (a `false` drops the writer's OP to the
  /// union plane). Pure-mask writers do NOT bubble — they close within the child.
  /// A plan can end up non-empty from bubbling alone (a player whose only mask is
  /// a child's), so this also seeds the coverage box when `build` found nothing.
  void bubbleChildClipWriters(const SsBaker& childBaker, const SsMaskPlan& childPlan,
                              const float* mountXf, int32_t ownerRank,
                              bool inheritedInfluence);

  void clear();

  bool empty() const { return writers_.empty(); }
  const std::vector<SsMaskWriter>& writers() const { return writers_; }

  /// Union of the writers' quads in **player-local** space. The coverage bitmap
  /// is stretched over exactly this box, so the local -> UV map is
  /// resolution-independent.
  float left() const { return left_; }
  float top() const { return top_; }
  float right() const { return right_; }
  float bottom() const { return bottom_; }
  float width() const { return right_ - left_; }
  float height() const { return bottom_ - top_; }

  /// The coverage UV of a player-local point. Outside `[0,1]` means "outside the
  /// box", which the replay treats as having no writer rather than
  /// letting texture clamping invent coverage at the edges.
  void coverageUv(float x, float y, float* u, float* v) const {
    *u = (x - left_) / (right_ - left_);
    *v = (y - top_) / (bottom_ - top_);
  }

  /// The mask test for the target at `rank`, or false when the part is not
  /// masked and keeps the plain batched path.
  ///
  /// A part is tested when it opts in **and** either a writer's scope
  /// reaches it or it is `visible_inside_mask` — the latter draws only inside a
  /// mask, so it must run the test even out of scope, where the empty writer set
  /// then correctly discards it.
  bool bitsFor(int32_t rank, const SsMaskPartFlags& flags, SsMaskBits* out) const;

 private:
  /// The cheap early-out: does any writer's scope reach `rank`?
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
