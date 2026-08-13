#pragma once

// Variant (b) of the Phase 0 spike: the per-vertex geometry bake, in C++.
//
// Deliberately free of Nitro and of JSI so `tools/ssbake_check.cpp` can link it
// on the host and drive it under ASan, where an out-of-bounds walk shows up as a
// report rather than as a wrong pixel on a device. The Nitro hybrid
// (`HybridSsContext`) only wraps the buffers this produces in ArrayBuffers.
//
// SCOPE: Normal, Mask, Mesh, Effect and Shape batches. Normal and Mask are one textured
// quad per part, so they bake identically — a Mask part differs only in what the
// *draw* path does with the result, which is to write coverage instead of
// colour. Instance contributes no geometry of its own — it records a mount and
// the child's bake supplies the rest. Nines and the SHDR shaders are still
// Later work, once the kinds beyond Normal landed.

#include <cstddef>
#include <cstdint>
#include <vector>

#include "SsBatchDesc.hpp"
#include "SsEffect.hpp"
#include "SsPartColor.hpp"
#include "SsPartShader.hpp"
#include "format/effect_draw_plan.h"
#include "format/framedata.h"

namespace sscore {

/// What the draw path needs to know about one baked part, beyond its geometry.
///
/// One entry per part actually baked, in bake order. The **ranges are carried
/// rather than derived**: a Normal or Mask part is always four vertices and six
/// indices, but a Mesh part is however many the Brain skinned, so multiplying by
/// four stopped being an answer the moment Mesh arrived.
struct SsPartDraw {
  /// Which part this is, and where it sits in `draw_order`.
  ///
  /// The rank is carried rather than recomputed because it is the pivot the mask
  /// scope turns on (`SsMask.hpp` §2-1), and bake order only *happens* to equal
  /// draw order — it is the batch walk that makes it so, and a kind this bake
  /// skips would silently shift it.
  uint32_t partIndex = 0;
  int32_t drawRank = -1;

  /// Global ranges into `positions()`/`texCoords()`/`colors()` and `indices()`.
  /// The index *values* stay relative to the owning batch's `vertexOffset`, as
  /// they have always been.
  int32_t vertexOffset = 0;
  int32_t vertexCount = 0;
  int32_t indexOffset = 0;
  int32_t indexCount = 0;

  /// Whether the four vertices are a sprite quad in `lt, rt, lb, rb` order.
  ///
  /// False for Mesh and for Effect, and everything that reconstructs a corner
  /// gradient from the UV depends on it: the PartColor shader and the mask replay
  /// both invert an affine quad, which neither a triangle soup nor a cloud of
  /// particle quads is. A Mesh's PartColor is whole-only (§1-2), which is why it
  /// can still use that shader — with four equal corners the reconstruction
  /// collapses to a constant and the inverse stops mattering.
  bool quadShaped = true;

  /// Whether this part samples no texture at all — a Shape, whose colour is
  /// entirely its vertex colours.
  ///
  /// It earns the part two things the textured kinds cannot have. Its batch
  /// draws with a plain white paint instead of an atlas, and — because the
  /// texcoord channel is therefore free — it can be a **mask target** despite
  /// not being quad-shaped: the coverage UV is written straight into that
  /// channel per vertex rather than reconstructed by inverting a quad's UV. A
  /// Mesh needs that channel for its atlas, which is exactly why a Mesh target
  /// still draws unmasked.
  bool untextured = false;

  /// True when this part has to leave its batch and go through the PartColor
  /// shader: a PartColor that actually tints RGB. Alpha alone never sets this —
  /// a vertex colour carries that exactly (§1-2-4).
  bool needsPartColorShader = false;
  /// Meaningful when `needsPartColorShader` **or** `needsShader`: twelve of the
  /// thirteen built-ins fold the PartColor composite as their own output tail,
  /// so the `SHDR` path needs the corners too. Default-constructed it is a
  /// passthrough (every rate 0), which is what a part with no PartColor wants.
  SsPartColor partColor;

  /// True when this part carries an `SHDR` attribute naming a built-in this
  /// port implements. Like a tint it forces the part out of its batch, and for
  /// the same reason: the effect's parameters speak for one part.
  ///
  /// Independent of `needsPartColorShader`, and the two are **not** additive —
  /// when both are set the `SHDR` shader is the one that runs, because it
  /// already applies the PartColor tail. Running both would tint twice.
  bool needsShader = false;
  /// Only meaningful when `needsShader`.
  SsPartShader partShader;
};

/// Where one instance part mounts its child, recorded during the bake.
///
/// The draw path has no SoA — it walks baked arrays — so the world matrix an
/// Instance batch needs has to be carried out of the bake like everything else.
/// Two floats' worth of it are dropped: an instance transform is the 2D affine
/// slice of the column-major 4x4, exactly as a Normal part's vertices use it.
struct SsInstanceDraw {
  uint32_t partIndex = 0;
  int32_t drawRank = -1;
  /// `a, b, c, d, tx, ty` — `x' = a*x + c*y + tx`, `y' = b*x + d*y + ty`.
  float m[6] = {1.0f, 0.0f, 0.0f, 1.0f, 0.0f, 0.0f};
  /// The instance part's own alpha, already multiplied by the chain scale it was
  /// baked under. It folds into the child's bake rather than becoming a layer:
  /// SpriteStudio modulates a sub-animation **per part**, so a group alpha would
  /// disagree wherever the child's own parts overlap.
  float alpha = 1.0f;
};

/// The Brain's SoA buffers for the current frame, as lent by the
/// `ss_runtime_get_*` getters. Every pointer is a borrow that dies at the next
/// `ss_runtime_update` — AGENTS.md's borrow rule.
struct SsSoAPointers {
  const float* worldMatrices = nullptr;  ///< 16 floats per part, column-major 4x4
  const float* localVertices = nullptr;  ///< 10 floats per part: lt, rt, lb, rb, center
  const float* localUvs = nullptr;       ///< 10 floats per part, texture pixel space
  const float* cellMeta = nullptr;       ///< 6 floats per part
  size_t partCount = 0;

  /// Mesh, in the CSR layout `40_components/30_mesh.md` describes: the vertex
  /// and index arrays are concatenated across every part, and the two `offsets`
  /// arrays (length `partCount + 1`) slice them. A non-Mesh part contributes an
  /// empty range, so the offsets double as the "is this a mesh" test.
  ///
  /// **These vertices are already world-space** — skinning happens in the Brain —
  /// so the world matrix must NOT be applied again. UVs are static (resolved
  /// once from frame 0's cell) and indices are **part-local 0-based**.
  /// Shape, in a fixed-stride layout rather than CSR: **24 floats per part**
  /// (12 vertices x, y), indexed `partIndex * 24`, with only the first
  /// `shapeVertexCounts[partIndex]` valid and the rest zero-filled. A non-shape
  /// part carries a zero count.
  ///
  /// These are **local** and post-pivot, so the world matrix applies — the
  /// Normal rule, not the Mesh one. `shapeBoxCoords` pairs with them: `(0,0)` at
  /// the LT of the pre-pivot bounding box and `(1,1)` at the RB, whatever the
  /// pivot or coordinate system, which is what lets a PartColor's four corners
  /// be interpolated without re-deriving that box.
  const float* shapeVertices = nullptr;
  const float* shapeBoxCoords = nullptr;
  const int32_t* shapeVertexCounts = nullptr;
  size_t shapeVertexCount = 0;
  size_t shapeBoxCoordCount = 0;
  size_t shapeVertexCountCount = 0;

  const float* meshVerticesX = nullptr;
  const float* meshVerticesY = nullptr;
  const uint32_t* meshVertexOffsets = nullptr;
  const float* meshUvs = nullptr;   ///< interleaved u,v per vertex
  const int32_t* meshIndices = nullptr;
  const uint32_t* meshIndexOffsets = nullptr;
  size_t meshVertexCount = 0;
  size_t meshVertexOffsetCount = 0;
  size_t meshUvCount = 0;
  size_t meshIndexCount = 0;
  size_t meshIndexOffsetCount = 0;
};

/// Bakes one frame into flat vertex/index/batch arrays.
///
/// Buffers are members and are only ever `resize`d down to the frame's needs, so
/// after the first few frames the bake allocates nothing — the zero-allocation
/// shape `30_core/30_render_loop.md` §3 asks for.
class SsBaker {
 public:
  /// Rebuilds every output array from `fd` + `soa`, plus `effects` for the one
  /// kind whose geometry does not ride the SoA. Safe to call with a null `fd`,
  /// null SoA pointers or an inactive `effects`: it just produces less output.
  ///
  /// `alphaScale` multiplies every vertex alpha this frame. It is 1 for a root
  /// player and the product of the instance parts above it for a child, which is
  /// how a sub-animation inherits its mount point's opacity — per part, which is
  /// what SpriteStudio does, rather than as one layer over the finished subtree.
  void bake(const ss::runtime::FrameData* fd, const SsSoAPointers& soa,
            const SsEffectFrame& effects = {}, float alphaScale = 1.0f);

  /// Batch descriptors for *every* batch in the frame, in draw order — including
  /// the kinds this spike does not draw, which come back with zero
  /// vertex/index counts so a JS-side walk sees the real batch structure.
  const std::vector<SsBatchDesc>& batches() const noexcept { return batches_; }

  /// 2 floats per vertex, world space.
  const std::vector<float>& positions() const noexcept { return positions_; }
  /// 2 floats per vertex, texture pixel space (Skia's image shader wants pixels).
  const std::vector<float>& texCoords() const noexcept { return texCoords_; }
  /// One unpremultiplied `SkColor`-shaped `0xAARRGGBB` per vertex.
  ///
  /// White with the part's alpha in most cases — the whole of what a part's
  /// opacity is, and the §1-2-4 passthrough for a PartColor that only sets
  /// alpha. A quad flagged `needsPartColorShader` gets its colour from the
  /// shader instead, and the draw path passes no colours for it at all, so its
  /// entries here are never read.
  const std::vector<uint32_t>& colors() const noexcept { return colors_; }
  /// Triangle list; entries are relative to their own batch's `vertexOffset`.
  const std::vector<uint16_t>& indices() const noexcept { return indices_; }
  /// One per baked part, in bake order. A batch's run is
  /// `parts()[partOffset .. + partCount]`.
  const std::vector<SsPartDraw>& parts() const noexcept { return parts_; }
  /// One per instance part that is live this frame, in draw order. Carries no
  /// geometry of its own — the child's bake is that — only where to put it.
  const std::vector<SsInstanceDraw>& instances() const noexcept { return instances_; }

  size_t vertexCount() const noexcept { return positions_.size() / 2; }
  size_t indexCount() const noexcept { return indices_.size(); }

 private:
  /// The Mesh half of `bake`, split out because its geometry comes from a
  /// different set of buffers in a different space — already world, so no world
  /// matrix — and its vertex count is per part rather than always four.
  void bakeMeshBatch(const ss::runtime::FrameData* fd, const SsSoAPointers& soa,
                     const ss::runtime::DrawBatch* batch, const SsBatchDesc& desc,
                     uint32_t partStateCount,
                     const ::flatbuffers::Vector<uint16_t>* drawOrder, uint32_t drawOrderCount,
                     float alphaScale);

  /// The Effect half, and the one that **pushes its own batch descriptors**.
  ///
  /// Every other kind fills one `SsBatchDesc` because the Brain already decided
  /// its texture and blend. An effect's do not exist at that level: the Brain
  /// leaves an Effect batch's `texture_hash` at 0 and each emitter inside the
  /// plan names its own `cellmap_hash` and its own Mix/Add. So one Effect batch
  /// becomes as many descs as the plan has (cellmap, blend) runs — inserted in
  /// place, which is what keeps the Brain's depth order intact.
  void bakeEffectBatch(const ss::runtime::FrameData* fd, const SsSoAPointers& soa,
                       const ss::runtime::DrawBatch* batch, const SsEffectFrame& effects,
                       uint32_t partStateCount,
                       const ::flatbuffers::Vector<uint16_t>* drawOrder,
                       uint32_t drawOrderCount, float alphaScale);

  /// The Shape half. Local verts like Normal, several parts to a draw like
  /// Mesh, and a colour rule of its own — see the implementation.
  void bakeShapeBatch(const ss::runtime::FrameData* fd, const SsSoAPointers& soa,
                      const ss::runtime::DrawBatch* batch, const SsBatchDesc& desc,
                      uint32_t partStateCount,
                      const ::flatbuffers::Vector<uint16_t>* drawOrder, uint32_t drawOrderCount,
                      float alphaScale);

  /// The Instance half, and the only one that emits **no geometry and no
  /// descriptor** — an instance part is a mount point, and the thing mounted is
  /// a whole other player's bake. All this records is where to put it.
  void bakeInstanceBatch(const ss::runtime::FrameData* fd, const SsSoAPointers& soa,
                         const ss::runtime::DrawBatch* batch, uint32_t partStateCount,
                         const ::flatbuffers::Vector<uint16_t>* drawOrder,
                         uint32_t drawOrderCount, float alphaScale);

  /// Appends one (cellmap, blend) run of `plan`'s commands as a single batch.
  ///
  /// `commandCount` commands starting at `first`, capped at `quadBudget` quads
  /// so the batch's 16-bit indices stay in range. Returns false when nothing was
  /// emitted, in which case no descriptor is pushed.
  bool appendEffectRun(const ss::runtime::EffectDrawPlan* plan, uint32_t first,
                       uint32_t commandCount, uint32_t quadBudget, const float* worldMatrix,
                       float partAlpha, float texWidth, float texHeight);

  std::vector<SsBatchDesc> batches_;
  std::vector<float> positions_;
  std::vector<float> texCoords_;
  std::vector<uint32_t> colors_;
  std::vector<uint16_t> indices_;
  std::vector<SsPartDraw> parts_;
  std::vector<SsInstanceDraw> instances_;
};

}  // namespace sscore
