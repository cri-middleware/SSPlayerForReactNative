#pragma once

// Mask and clipping — **two different features on
// one mechanism**: a mask
// part draws no colour and hides the parts drawn *before* it; a clipping part
// draws itself and confines the parts drawn *after* it.
//
// Skia exposes no stencil, so this is the coverage-bitmap approach: rasterise
// each writer into an offscreen bitmap, one bit per writer, and have each masked
// target replay the writers that reach it.
//
// Scope resolution stays on the CPU, so the shader sees only the two writer sets
// in `SsMaskBits`. Splitting them by OP is not an optimisation: `Invert`
// and `Increment` do not commute, so each accumulates on its own plane and the
// replay takes the union.
//
// **One plan for the whole instance tree.** The root player numbers every part
// of the tree in draw order — a sub-animation is numbered in its instance
// part's place — and gathers every writer of the tree into its one coverage.
// Each writer then holds its bit over an open interval of that numbering: a
// pure mask from the start of its own animation up to itself, a clipping writer
// from itself to the end of the tree. That one rule is the whole of what makes
// a mask inside an instance cut its own sub-animation, keeps a pure mask from
// leaking out of it, and carries a clipping writer on to the caller's later
// parts, however deep it sits.
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

/// One bit per writer, in 8-bit planes of the coverage bitmap. Writers past the
/// cap are dropped, with a warning.
///
/// 96 and not 24, because the writers of the whole instance tree share this one
/// budget and an instance's writers count again every time it is placed.
/// A budget sized for one animation masks
/// the first blocks of such a tree and leaves the rest with no writer at all.
///
/// Each plane's bits are in the **alpha** of that plane, because RGB is colour and Skia
/// gamut-maps it into a Display P3 destination — `SsMaskShader.hpp` has the
/// whole story.
constexpr int kSsMaxMaskWriters = 96;

/// The number of 8-bit planes `kSsMaxMaskWriters` needs.
constexpr int kSsMaskPlaneCount = (kSsMaxMaskWriters + 7) / 8;

/// The number of 32-bit words one writer set in `SsMaskBits` needs.
constexpr int kSsMaskWordCount = (kSsMaxMaskWriters + 31) / 32;

/// Past every number of the tree sequence: where a clipping writer's interval
/// ends. Exact in a float, like every sequence number below it.
constexpr float kSsMaskSeqEnd = 16777216.0f;

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
  /// Coverage is not a quad: a Mesh can be a clipping writer and a Shape a pure
  /// mask, and rasterising a bounding quad instead would clip to a rectangle,
  /// which is wrong in a way that looks deliberate.
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
  /// unconditionally. ORing `mask_write` in here would force a
  /// clipping part with `mask_influence == 0` and `visible_inside == 1` to be
  /// tested, and with nothing covering it the `masked == visible_inside` test
  /// would discard it.
  bool isTarget() const { return maskInfluence; }
};

/// One coverage-bitmap writer for the current frame.
struct SsMaskWriter {
  uint32_t partIndex = 0;
  /// Its position in its **own** animation's `draw_order`.
  int32_t drawRank = -1;
  /// Coverage bit, `0..kSsMaxMaskWriters-1`.
  int32_t bit = 0;
  /// This writer's entry in `SsBaker::parts()` of the baker it was collected
  /// from, so the coverage pass finds the geometry without a second bake.
  int32_t partDrawIndex = -1;
  /// The OP: false = increment, true = invert. Composed one level, like the
  /// target decision: the writer's own `mask_influence` AND its instance
  /// part's — never an ancestor's further up.
  bool opInvert = false;
  /// Masks the parts drawn *after* it, rather than before.
  bool isClipping = false;
  /// The cutout: texels at or below this alpha contribute no coverage.
  /// `kSsNoCutoutThreshold` means "never cut out".
  float threshold = 0.0f;
  /// The open interval of the tree sequence over which this writer holds its
  /// bit: a target numbered `seq` is reached when `open < seq < close`. A pure
  /// mask runs from the start of its own animation to itself; a clipping writer
  /// from itself to `kSsMaskSeqEnd`.
  float open = -1.0f;
  float close = kSsMaskSeqEnd;

  /// The baker holding this writer's geometry when it belongs to an instance
  /// child rather than the root — it is then carried into the root's space by
  /// `foreignXf` before it is rasterised. Null for the root's own writer, in
  /// which case `partDrawIndex` indexes the root's `SsBaker::parts()`.
  const SsBaker* foreignBaker = nullptr;
  /// The chain of instance matrices, `a,b,c,d,tx,ty` — the child's local space
  /// -> the root's. Only meaningful when `foreignBaker != nullptr`.
  float foreignXf[6] = {1.0f, 0.0f, 0.0f, 1.0f, 0.0f, 0.0f};
};

/// One target's resolved mask test: which writers reach it, and with what
/// polarity.
///
/// The two sets are disjoint by construction — a writer's OP puts it in exactly
/// one — so the replay is independent of the order the bits are walked in.
struct SsMaskBits {
  uint32_t increment[kSsMaskWordCount] = {};
  uint32_t invert[kSsMaskWordCount] = {};
  bool visibleInside = false;

  void set(int32_t bit, bool opInvert) {
    uint32_t* set = opInvert ? invert : increment;
    set[bit / 32] |= 1u << (bit % 32);
  }

  /// Byte `index` of a writer set — plane `index` of the coverage.
  static uint32_t byteOf(const uint32_t* set, int index) {
    return (set[index / 4] >> ((index % 4) * 8)) & 0xffu;
  }

  /// No writer reaches this target. With `visibleInside` the part then draws
  /// nowhere; otherwise it draws everywhere.
  bool isEmpty() const {
    for (int i = 0; i < kSsMaskWordCount; ++i) {
      if (increment[i] != 0 || invert[i] != 0) return false;
    }
    return true;
  }
};

/// What an animation's parts are composed with: the `mask_influence` and
/// `visible_inside_mask` of the instance part that places it.
///
/// **One level only.** A sub-animation gets its own instance part's values,
/// never what that instance part itself received from further up — and it gets
/// them whether or not anything above masks. A root is composed with the
/// identity, so each of its parts is judged on its own settings.
struct SsMaskContext {
  bool influence = true;
  bool visibleInside = false;
};

/// The frame's mask plan for one whole instance tree: who writes coverage, the
/// root-local box the bitmap spans, and the per-target scope resolution.
class SsMaskPlan {
 public:
  /// Rebuilds from one animation with no instance tree, its ranks standing in
  /// for the sequence. False when nothing writes coverage.
  ///
  /// `flags` is indexed by part index, as `SsAnimeBinaryView` reads it.
  bool build(const ss::runtime::FrameData* fd, const SsBaker& baker,
             const SsMaskPartFlags* flags, size_t flagCount);

  /// Adds one animation's active writers, in draw order.
  ///
  /// `seq` maps this animation's ranks onto the tree sequence (null: the rank
  /// is the number). `startSeq` is its instance part's number, `-1` for the
  /// root, and `context` its instance part's flags. `foreignBaker` and `toRoot`
  /// are null for the root, whose baker is the one the coverage is drawn with.
  void collect(const ss::runtime::FrameData* fd, const SsBaker& baker,
               const SsMaskPartFlags* flags, size_t flagCount, const float* seq,
               size_t seqCount, float startSeq, const SsMaskContext& context,
               const SsBaker* foreignBaker, const float* toRoot);

  /// Closes a plan `collect` filled. False when it holds no writer, or when
  /// their box has no area — the caller then has no coverage to draw.
  bool finish();

  void clear();

  bool empty() const { return writers_.empty(); }
  const std::vector<SsMaskWriter>& writers() const { return writers_; }
  /// Whether `collect` met more active writers than `kSsMaxMaskWriters`.
  bool dropped() const { return dropped_; }

  /// Union of the writers' shapes in **root-local** space. The coverage bitmap
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

  /// The mask test for the target numbered `seq`, or false when the part is not
  /// masked and keeps the plain batched path.
  ///
  /// A part is tested when it opts in — its own `mask_influence` AND its
  /// context's — **and** either a writer's interval reaches it or it draws
  /// inside (`visible_inside_mask`, its own OR its context's). The latter draws
  /// only where a mask covers it, so it is tested even when no writer reaches
  /// it, and even with no writer in the tree at all: the empty set then hides
  /// it, as SpriteStudio does. Valid on an empty plan for exactly that reason.
  bool bitsFor(float seq, const SsMaskPartFlags& flags, const SsMaskContext& context,
               SsMaskBits* out) const;

 private:
  void extend(float x, float y);

  std::vector<SsMaskWriter> writers_;
  float left_ = 0.0f;
  float top_ = 0.0f;
  float right_ = 0.0f;
  float bottom_ = 0.0f;
  bool haveBounds_ = false;
  bool dropped_ = false;
};

}  // namespace sscore
