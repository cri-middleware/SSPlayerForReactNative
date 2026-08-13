#include "SsSkiaDraw.hpp"

#include <algorithm>
#include <cmath>

#include "SsBaker.hpp"

#if SSPLAYER_ENABLE_SKIA_DIRECT
#include "include/core/SkCanvas.h"
#include "include/core/SkColorSpace.h"
#include "include/core/SkImage.h"
#include "include/core/SkMatrix.h"
#include "include/core/SkPaint.h"
// SkPictureRecorder.h only forward-declares SkPicture, and `finishRecordingAsPicture`
// hands back an `sk_sp<SkPicture>` whose destructor needs the complete type.
#include "include/core/SkPicture.h"
#include "include/core/SkPictureRecorder.h"
#include "include/core/SkShader.h"
#include "include/core/SkVertices.h"

#include "SsBlend.hpp"
#include "SsMask.hpp"
#include "SsMaskShader.hpp"
#include "SsPartColorShader.hpp"
#include "SsPartShaderSkSL.hpp"
#endif

namespace ssplayer {

bool SkiaDirectAvailable() {
#if SSPLAYER_ENABLE_SKIA_DIRECT
  return true;
#else
  return false;
#endif
}

#if SSPLAYER_ENABLE_SKIA_DIRECT

namespace {

/// The paint for a batch, or null when the table has nothing for it.
///
/// Linear: a pack has a handful of cellmaps, so a map would cost more to build
/// each frame than the scan saves.
const SkPaint* PaintFor(const SsPaintBinding* textures, size_t count, int32_t textureHash) {
  if (count == 0) return nullptr;
  // Single-entry tables match anything — see the header for why.
  if (count == 1) return static_cast<const SkPaint*>(textures[0].paint);

  const auto hash = static_cast<uint32_t>(textureHash);
  for (size_t i = 0; i < count; ++i) {
    if (textures[i].textureHash == hash) return static_cast<const SkPaint*>(textures[i].paint);
  }
  return nullptr;
}

/// Indices per quad. `SsBaker` emits exactly one quad per Normal part, which is
/// what makes peeling a single part out of a batch arithmetic rather than a
/// second bake — the kinds that are not quads carry their own ranges instead.
constexpr int kIndicesPerQuad = 6;

/// `drawVertices`'s own mode blends the shader against *vertex colours*, and
/// Skia ignores it when there are none — which is always, here. `kModulate` is
/// what it will have to be once PartColor bakes them.
constexpr SkBlendMode kVertexColorBlend = SkBlendMode::kModulate;

/// The paint one pass draws with. Copied, never mutated in place: the caller's
/// `SkPaint`s are JS-owned, so C++ must leave neither a colour filter nor a
/// blend mode on one.
SkPaint PaintForPass(const SkPaint& base, const BlendPass& pass) {
  SkPaint paint = base;
  // The framebuffer blend lives here, not in drawVertices — see above.
  paint.setBlendMode(pass.mode);
  switch (pass.source) {
    case BlendPassSource::kPart:
      break;
    case BlendPassSource::kCoverage:
      paint.setColorFilter(CoverageFilter());
      break;
    case BlendPassSource::kBlack:
      paint.setColorFilter(BlackFilter());
      break;
  }
  return paint;
}

/// A quad's six indices, rebased onto its own four vertices.
///
/// Read back from the baker rather than assumed: the winding is `{0,1,2,1,3,2}`
/// today, and reading it keeps this correct if that ever changes.
/// `quadIndices` points at the quad's own six entries; `vertexBase` is its first
/// vertex relative to the batch, which is what the baker's values are relative to.
void RebaseQuadIndices(const uint16_t* quadIndices, int vertexBase, uint16_t* out) {
  for (int i = 0; i < kIndicesPerQuad; ++i) {
    out[i] = static_cast<uint16_t>(quadIndices[i] - vertexBase);
  }
}

// --- the coverage pass -----------------------------------------------------

/// §3-2's "normalise the long edge to an upper bound": enough for pixel parity
/// on a Full HD-class screen, and 4 MiB of RGBA8 at the limit.
constexpr float kMaxCoverageEdge = 1024.0f;

/// The batch a baked part belongs to, or null.
///
/// Linear over a handful of batches, run once per writer (at most 24), so it
/// costs less than carrying the batch identity on every part in the frame would.
const sscore::SsBatchDesc* BatchOfPart(const sscore::SsBaker& baker, int32_t partDrawIndex) {
  for (const sscore::SsBatchDesc& batch : baker.batches()) {
    if (partDrawIndex >= batch.partOffset && partDrawIndex < batch.partOffset + batch.partCount) {
      return &batch;
    }
  }
  return nullptr;
}

/// Rasterises every writer's shape into the frame's coverage bitmap (§3-2-1).
///
/// One bit per writer, drawn with `kPlus` so the disjoint bits OR together. The
/// canvas is set up so its coordinate space *is* player-local, which is what
/// makes the local → UV map resolution-independent and independent of the root
/// transform (§3-2-2).
///
/// Writers past the first eight go into further **planes**, stacked vertically
/// in the same image and each carrying its byte in alpha — see
/// `SsMaskShader.hpp` for why the bits are not in RGB. Only the planes the
/// frame actually reaches are built, so the usual pack pays for exactly one.
SsMaskCoverage BuildCoverage(const sscore::SsMaskPlan& plan, const sscore::SsBaker& baker,
                             const SsPaintBinding* textures, size_t textureCount) {
  SsMaskCoverage out;
  const float w = plan.width();
  const float h = plan.height();
  if (!(w > 0.0f) || !(h > 0.0f)) return out;

  int planeCount = 1;
  for (const sscore::SsMaskWriter& writer : plan.writers()) {
    planeCount = std::max(planeCount, SsMaskBitPlane(writer.bit) + 1);
  }
  planeCount = std::min(planeCount, sscore::kSsMaskPlaneCount);

  const float longEdge = w > h ? w : h;
  const float scale = longEdge > kMaxCoverageEdge ? kMaxCoverageEdge / longEdge : 1.0f;
  const int pw = std::max(1, static_cast<int>(std::ceil(w * scale)));
  const int ph = std::max(1, static_cast<int>(std::ceil(h * scale)));

  SkPictureRecorder recorder;
  SkCanvas* canvas = recorder.beginRecording(SkRect::MakeIWH(pw, ph * planeCount));
  if (canvas == nullptr) return out;

  const auto* positions = reinterpret_cast<const SkPoint*>(baker.positions().data());
  const auto* texCoords = reinterpret_cast<const SkPoint*>(baker.texCoords().data());
  const std::vector<uint16_t>& indices = baker.indices();

  const std::vector<sscore::SsPartDraw>& parts = baker.parts();

  for (const sscore::SsMaskWriter& writer : plan.writers()) {
    if (writer.partDrawIndex < 0 ||
        static_cast<size_t>(writer.partDrawIndex) >= parts.size()) {
      continue;
    }
    const sscore::SsPartDraw& part = parts[writer.partDrawIndex];
    const sscore::SsBatchDesc* batch = BatchOfPart(baker, writer.partDrawIndex);
    if (batch == nullptr) continue;
    if (part.vertexCount < 3 || part.indexCount < 3) continue;

    // A Shape writes coverage but samples nothing, so there is no atlas to
    // threshold and the whole polygon is covered. `mask`'s texel threshold
    // (§2-5) is meaningless without a texel, so the bit goes down flat.
    const bool untextured = batch->kind == ss::runtime::DrawBatchKind_Shape;
    const SkPaint* paint =
        untextured ? nullptr : PaintFor(textures, textureCount, batch->textureHash);
    if (!untextured && paint == nullptr) continue;

    sk_sp<SkShader> bitShader;
    if (!untextured) {
      bitShader = MakeMaskWriteShader(writer, paint->refShader());
      if (bitShader == nullptr) continue;
    }

    // Rebased onto this writer's own vertices, whatever their number: a quad's
    // six, a polygon's fan, a mesh's triangles. The subtraction is the same one
    // the peel path makes, and it is the general form rather than a quad case.
    const int vertexBase = part.vertexOffset - batch->vertexOffset;
    std::vector<uint16_t> localIdx(static_cast<size_t>(part.indexCount));
    for (int32_t i = 0; i < part.indexCount; ++i) {
      localIdx[static_cast<size_t>(i)] =
          static_cast<uint16_t>(indices[static_cast<size_t>(part.indexOffset) + i] - vertexBase);
    }

    const int base = part.vertexOffset;
    // No vertex colours: the bit must reach the bitmap unscaled, and `kPlus` is
    // premultiplied, so a colour carrying the part's alpha would dim it into a
    // value that decodes as a different writer's bit — or as none.
    sk_sp<SkVertices> vertices = SkVertices::MakeCopy(
        SkVertices::kTriangles_VertexMode, part.vertexCount, positions + base,
        untextured ? nullptr : texCoords + base, nullptr, part.indexCount, localIdx.data());
    if (vertices == nullptr) continue;

    SkPaint cover;
    if (untextured) {
      // The bit as a flat colour, black with the bit in alpha. Same encoding the
      // shader would have returned where a texel passed — `kPlus` then ORs it in
      // exactly as it does for every other writer. No colour space has to be
      // stated: RGB is 0 in every space, and alpha is not colour-managed at all.
      cover.setColor4f({0.0f, 0.0f, 0.0f, SsMaskBitAlpha(writer.bit)}, nullptr);
    } else {
      cover.setShader(std::move(bitShader));
    }
    cover.setBlendMode(SkBlendMode::kPlus);
    // Antialiasing is the same trap in geometric form: a partial edge coverage
    // scales the bit, and the replay would read a writer that never covered the
    // pixel. The sampler is nearest for the matching reason.
    cover.setAntiAlias(false);
    // The plane's band first, then the player-local frame inside it, so the
    // vertices below go in unchanged whichever plane they land in.
    canvas->save();
    canvas->translate(0.0f, static_cast<float>(SsMaskBitPlane(writer.bit) * ph));
    canvas->scale(static_cast<float>(pw) / w, static_cast<float>(ph) / h);
    canvas->translate(-plan.left(), -plan.top());
    canvas->drawVertices(vertices, kVertexColorBlend, cover);
    canvas->restore();
  }

  // A deferred picture image rather than a render target, because `drawInto`
  // runs on a **recording** canvas — Layer 4 records one `SkPicture` per frame —
  // so there is no `GrDirectContext` here to make a surface from. Skia
  // rasterises this when the outer picture is played back, in the same frame,
  // which is also why §3-2-3's size classes and its one-frame-delay
  // countermeasures have nothing to do here: there is no delay to cover for.
  //
  // sRGB, and it no longer matters which: the bits ride in alpha, which Skia
  // passes through untouched whatever the destination turns out to be. What
  // does still matter is that it is **not null** — `DeferredFromPicture`
  // returns null outright for a null colour space, whatever its doc comment
  // says, and the whole mask then silently does nothing.
  out.image = SkImages::DeferredFromPicture(recorder.finishRecordingAsPicture(),
                                            SkISize::Make(pw, ph * planeCount), nullptr, nullptr,
                                            SkImages::BitDepth::kU8, SkColorSpace::MakeSRGB());
  out.width = pw;
  out.height = ph;
  out.planeCount = planeCount;
  return out;
}

}  // namespace

size_t DrawBakedFrame(void* canvasPtr, const SsPaintBinding* textures, size_t textureCount,
                      const sscore::SsBaker& baker, const SsMaskInput& mask,
                      SsInstanceRenderer* instances) {
  auto* canvas = static_cast<SkCanvas*>(canvasPtr);
  if (canvas == nullptr || textures == nullptr || textureCount == 0) return 0;

  const std::vector<float>& positions = baker.positions();
  const std::vector<float>& texCoords = baker.texCoords();
  const std::vector<uint32_t>& colors = baker.colors();
  const std::vector<uint16_t>& indices = baker.indices();
  const std::vector<sscore::SsPartDraw>& parts = baker.parts();

  // Built up front, not lazily at the first masked part: a pure mask reaches the
  // parts drawn *before* it, so the very first target can already need the
  // coverage of a writer that has not been walked yet.
  SsMaskCoverage coverage;
  if (mask.active() && !mask.plan->empty()) {
    coverage = BuildCoverage(*mask.plan, baker, textures, textureCount);
  }
  const bool masking = coverage.valid();

  /// This part's mask test, or false when it draws unmasked.
  ///
  /// A mesh is excluded outright: the replay reconstructs its coverage UV by
  /// inverting an affine quad, which a triangle soup is not. Better an unmasked
  /// mesh than one clipped against a shape nobody authored.
  const auto maskBitsOf = [&](const sscore::SsPartDraw& info,
                              sscore::SsMaskBits* bits) -> bool {
    if (!mask.active() || !masking || info.partIndex >= mask.flagCount) return false;
    // A quad reconstructs its coverage position by inverting its UV, so a part
    // that is not one needs another route. A **Shape** has one: it samples
    // nothing, so its texcoord channel is free and the coverage UV goes in
    // there directly (see the peel below). A **Mesh** does not — it needs that
    // channel for its atlas, and there is only one — so it still draws
    // unmasked, which beats clipping it against a shape nobody authored.
    if (!info.quadShaped && !info.untextured) return false;
    return mask.plan->bitsFor(info.drawRank, mask.flags[info.partIndex], bits);
  };

  /// §3-3: this part writes coverage and draws **no colour**.
  ///
  /// Per part, not per batch, and that is the whole point. A `PartTypeMask` gets
  /// a `Mask` batch and is caught by kind below, but a Shape (or Text, or
  /// Nines) turned into a pure mask by `draw_as_mask` keeps its own kind — so a
  /// masking Shape sails past a kind test and paints itself over the animation
  /// it was supposed to cut a hole in. Independent of the plan: a writer that
  /// opted out with `mask == 0` still must not draw.
  const auto pureMaskOf = [&](const sscore::SsPartDraw& info) {
    return mask.flags != nullptr && info.partIndex < mask.flagCount &&
           mask.flags[info.partIndex].pureMask;
  };

  size_t drawn = 0;

  // Instance parts, walked alongside the batches below and matched by rank.
  //
  // They are not batches: `SsBaker` emits no descriptor for an Instance batch,
  // because it has no geometry of its own. Keeping them in one rank-ordered list
  // and draining it in step with the batch walk is what puts a sub-animation at
  // the right depth without inventing a batch to hold it.
  const std::vector<sscore::SsInstanceDraw>& mounts = baker.instances();
  size_t nextMount = 0;

  /// Draws every mount whose rank comes before `rank` (or all of them).
  const auto drawMountsBefore = [&](int32_t rank) {
    if (instances == nullptr) return;
    while (nextMount < mounts.size() &&
           (rank < 0 || mounts[nextMount].drawRank < rank)) {
      const sscore::SsInstanceDraw& mount = mounts[nextMount++];
      SkMatrix m;
      m.setAffine(mount.m);
      // `save`/`restore` rather than a layer: the child draws into the same
      // canvas at the mount point, and its alpha has already been folded into
      // its own bake, so there is nothing a layer would be needed to composite.
      //
      // Through the guard rather than by hand: `drawInstance` recurses into a
      // whole subtree and allocates several vectors and a picture recorder on
      // the way, so a `bad_alloc` from any of it would otherwise skip the
      // `restore()` and leave the save level standing. Layer 2 unwinds one
      // level, so everything drawn into that picture afterwards would be under
      // a transform nobody asked for — a failure that looks like a geometry bug
      // and is not.
      SkAutoCanvasRestore restore(canvas, true);
      canvas->concat(m);
      drawn += instances->drawInstance(canvas, mount.partIndex, mount.alpha);
    }
  };

  for (const sscore::SsBatchDesc& batch : baker.batches()) {
    drawMountsBefore(batch.startRank);
    if (batch.vertexCount == 0 || batch.indexCount == 0) continue;
    // §3-3: a pure mask writes coverage and draws no colour. Its geometry was
    // baked for the pass above and must not reach the framebuffer.
    if (batch.kind == ss::runtime::DrawBatchKind_Mask) continue;

    // A Shape samples nothing: its colour is entirely in the baked vertex
    // colours (§1-2-3 bypasses the composite formula), and its `texture_hash` is
    // 0 because it resolves no cell. So it must **not** go through `PaintFor` —
    // the single-entry rule matches unconditionally and would hand it the
    // atlas, texturing a polygon that was never meant to sample one.
    const bool untextured = batch.kind == ss::runtime::DrawBatchKind_Shape;
    SkPaint plain;
    // **White, explicitly.** With no shader, `drawVertices` uses the paint's
    // *colour* as the thing the vertex colours are blended against, and
    // `SkPaint`'s default is opaque black — so `kModulate` multiplies every
    // shape by zero and the whole kind renders black. It draws, it is the right
    // shape, and it is the right alpha; only the colour is gone.
    plain.setColor(SK_ColorWHITE);
    const SkPaint* paint =
        untextured ? &plain : PaintFor(textures, textureCount, batch.textureHash);
    if (paint == nullptr) continue;

    // `SkPoint` is two floats with no padding, so the baker's flat float arrays
    // are already the layout MakeCopy wants — no per-vertex conversion, which is
    // the entire point of this path.
    static_assert(sizeof(SkPoint) == 2 * sizeof(float),
                  "SkPoint must be two packed floats for the reinterpret below");

    const auto* pos = reinterpret_cast<const SkPoint*>(positions.data()) + batch.vertexOffset;
    const auto* uv = reinterpret_cast<const SkPoint*>(texCoords.data()) + batch.vertexOffset;
    const uint16_t* idx = indices.data() + batch.indexOffset;

    const uint32_t* col = colors.data() + batch.vertexOffset;

    const BlendPlan plan = BlendPlanFor(batch.blendType);

    // A batch survives as one draw only if nothing in it needs peeling. The
    // three reasons peel to the same shape — one part at a time — but they are
    // independent: the blend plan is a property of the batch, while a PartColor
    // tint and a mask test are each a property of one part inside it.
    bool anyPeel = false;
    for (int p = 0; p < batch.partCount && !anyPeel; ++p) {
      const sscore::SsPartDraw& info = parts[batch.partOffset + p];
      sscore::SsMaskBits bits;
      // A pure mask forces the peel too — the batched draw has no way to leave
      // one part out, and leaving it in is the bug this exists to prevent.
      anyPeel = info.needsPartColorShader || info.needsShader || pureMaskOf(info) ||
                maskBitsOf(info, &bits);
    }

    if (!plan.multiPass() && !anyPeel) {
      // MakeCopy rather than `SkVertices::Builder`, and the reason is layering,
      // not lifetime: a Builder's `detach()` hands back an SkVertices that owns
      // its storage just as MakeCopy's does, so either would survive the
      // deferred draw. What a Builder would buy is writing the bake straight
      // into Skia's allocation instead of into the baker's vectors and
      // memcpy'ing after — one copy per batch. It would also drag Skia into
      // `SsBaker`, which is deliberately Skia-free, Nitro-free and JSI-free so
      // `ssbake_check` can link it on the host. The copy is a memcpy of packed
      // floats, not a per-vertex marshal, and the measurement puts this whole
      // path at 10 ms for 512 players — so the layering is worth more than the
      // memcpy.
      sk_sp<SkVertices> vertices = SkVertices::MakeCopy(
          SkVertices::kTriangles_VertexMode, batch.vertexCount, pos,
          untextured ? nullptr : uv, reinterpret_cast<const SkColor*>(col),
          batch.indexCount, idx);
      if (vertices == nullptr) continue;

      const SkPaint passPaint = PaintForPass(*paint, plan.passes[0]);
      canvas->drawVertices(vertices, kVertexColorBlend, passPaint);
      drawn += static_cast<size_t>(batch.vertexCount);
      continue;
    }

    // Peeled, for any of the three reasons. Sub / Invert need it because the
    // inversion passes have to cover each pixel exactly once (`SsBlend.hpp`
    // spells out why two overlapping Sub parts would otherwise cancel their
    // overlap); a PartColor tint and a mask test each need it because their
    // uniforms speak for one part. One part per draw, and the *same* geometry
    // through every pass.
    for (int pi = 0; pi < batch.partCount; ++pi) {
      const sscore::SsPartDraw& info = parts[batch.partOffset + pi];
      if (info.vertexCount == 0 || info.indexCount == 0) continue;
      // Coverage only. Its geometry was baked for the pass above and must not
      // reach the framebuffer.
      if (pureMaskOf(info)) continue;

      // Relative to the batch, which is the space the baker's index values and
      // the `pos`/`uv`/`col` bases are all in.
      const int base = info.vertexOffset - batch.vertexOffset;
      const int indexBase = info.indexOffset - batch.indexOffset;
      const float* partUv = texCoords.data() + static_cast<size_t>(info.vertexOffset) * 2;

      // A quad's six indices are rebased onto its own four vertices; a mesh's
      // are already part-local plus the batch base, so the same subtraction
      // serves both — it is the general form, not a quad special case.
      uint16_t localIdx[kIndicesPerQuad];
      const uint16_t* useIdx = idx + indexBase;
      std::vector<uint16_t> meshIdx;
      if (info.indexCount == kIndicesPerQuad && info.quadShaped) {
        RebaseQuadIndices(idx + indexBase, base, localIdx);
        useIdx = localIdx;
      } else {
        meshIdx.resize(static_cast<size_t>(info.indexCount));
        for (int i = 0; i < info.indexCount; ++i) {
          meshIdx[static_cast<size_t>(i)] = static_cast<uint16_t>(idx[indexBase + i] - base);
        }
        useIdx = meshIdx.data();
      }

      // The PartColor shader carries alpha itself (`a = texel.a * col.a`), so
      // the part must go through with NO vertex colours or `kModulate` would
      // apply it a second time. Without the shader the vertex colours are the
      // only thing carrying the part's opacity, so they must go through. The
      // mask wraps whichever of the two it turns out to be and changes neither.
      sk_sp<SkShader> tint;
      if (info.needsShader) {
        // Twelve of the thirteen built-ins fold the PartColor composite as their
        // own output tail, so the effect takes the corners and
        // `MakePartColorShader` is deliberately **not** also run — that would
        // apply the tint twice. A built-in with no body yet returns null here
        // and falls through to the tint below, which is the same degradation an
        // unrecognised `id_hash` takes.
        tint = MakePartShaderShader(info.partShader, info.partColor, partUv,
                                    paint->refShader());
      }
      if (tint == nullptr && info.needsPartColorShader) {
        // A mesh reaches this with its four corners already equalised to `lt`
        // (§1-2, whole-only), so the shader's gradient collapses to a constant
        // and the UV inverse it is handed never has to be meaningful.
        tint = MakePartColorShader(info.partColor, partUv, paint->refShader());
      }

      sscore::SsMaskBits bits;
      const bool partMasked = maskBitsOf(info, &bits);

      // The shader the part's own pass draws with, or null to keep the paint's.
      sk_sp<SkShader> partShader = tint;
      // Only set for an untextured target, whose coverage UVs are written per
      // vertex rather than reconstructed. Declared out here so it outlives the
      // `MakeCopy` that reads it.
      std::vector<SkPoint> covTex;
      if (partMasked) {
        // The unit square, twice over. `SsMakeUvInverse` turns the first into
        // the identity, so the shader's `(s, t)` *is* the interpolated
        // texcoord, and bilinear-ing the second by it gives back `(s, t)`
        // again. Net effect: the coverage is sampled exactly where the texcoord
        // says — which is what the branch below writes there.
        static constexpr float kUnitSquare[8] = {0.0f, 0.0f, 1.0f, 0.0f,
                                                 0.0f, 1.0f, 1.0f, 1.0f};
        const float* replayUv = partUv;
        float covUv[8];
        if (info.untextured) {
          // `coverageUv` is affine in the world position — a translate and a
          // scale — so writing it per vertex and letting `drawVertices`
          // interpolate is exact, not an approximation. This is the whole
          // reason a Shape can be masked at all where a Mesh cannot: it has a
          // texcoord channel going spare.
          covTex.resize(static_cast<size_t>(info.vertexCount));
          for (int c = 0; c < info.vertexCount; ++c) {
            const SkPoint& p = pos[base + c];
            mask.plan->coverageUv(p.fX, p.fY, &covTex[c].fX, &covTex[c].fY);
          }
          replayUv = kUnitSquare;
          for (int i = 0; i < 8; ++i) covUv[i] = kUnitSquare[i];
        } else {
          for (int c = 0; c < 4; ++c) {
            const SkPoint& corner = pos[base + c];
            mask.plan->coverageUv(corner.fX, corner.fY, &covUv[c * 2], &covUv[c * 2 + 1]);
          }
        }
        // An untextured part has no atlas for the replay to gate, so it gates
        // opaque white and `kModulate` against the vertex colours keeps the
        // shape's own gradient — SSPlayerForFlutter's trick, and the reason its
        // masked-shape path reuses the PartColor program as a no-op.
        sk_sp<SkShader> inner = tint;
        if (inner == nullptr) {
          inner = info.untextured ? SkShaders::Color(SK_ColorWHITE) : paint->refShader();
        }
        sk_sp<SkShader> replay =
            MakeMaskReplayShader(std::move(inner), coverage, bits, replayUv, covUv);
        // A replay that would not build degrades to the unmasked draw — a part
        // that ignores its mask beats a part that is not there.
        if (replay != nullptr) partShader = std::move(replay);
      }

      // A masked untextured part carries the coverage UV in the texcoord slot;
      // an unmasked one carries nothing at all.
      const SkPoint* useUv = untextured ? nullptr : uv + base;
      if (!covTex.empty()) useUv = covTex.data();
      sk_sp<SkVertices> vertices = SkVertices::MakeCopy(
          SkVertices::kTriangles_VertexMode, info.vertexCount, pos + base, useUv,
          tint != nullptr ? nullptr : reinterpret_cast<const SkColor*>(col + base),
          info.indexCount, useIdx);
      if (vertices == nullptr) continue;

      // A masked part drops the multi-pass Sub / Invert reconstruction. Those
      // plans work by inverting the destination and inverting it back, and the
      // cancellation only holds where the middle pass drew — which is exactly
      // what a mask is there to prevent, so the leftover inversion would stain
      // everything the part's quad covers outside the mask. `BlendModeFor`'s
      // one-pass approximation is the defined answer for a caller that cannot
      // run the plan, and it is the honest trade: an approximate blend inside
      // the right shape beats an exact one in the wrong shape.
      const BlendPlan partPlan =
          partMasked ? BlendPlan{{{BlendModeFor(batch.blendType), BlendPassSource::kPart}}, 1}
                     : plan;

      for (int p = 0; p < partPlan.count; ++p) {
        SkPaint passPaint = PaintForPass(*paint, partPlan.passes[p]);
        // Only the pass that draws the part itself gets the replacement shader.
        // A coverage or black pass is a stencil over the same geometry, and
        // swapping its shader for a textured one would break the inversion it
        // exists to perform.
        if (partShader != nullptr && partPlan.passes[p].source == BlendPassSource::kPart) {
          passPaint.setShader(partShader);
        }
        canvas->drawVertices(vertices, kVertexColorBlend, passPaint);
      }
      // Geometry drawn, not draw calls issued — a multi-pass part covers the
      // same vertices three times and should not read as three times the scene.
      drawn += static_cast<size_t>(info.vertexCount);
    }
  }
  // Anything mounted after the last batch — an instance part at the very front
  // of the draw order has no batch behind it to trigger the drain.
  drawMountsBefore(-1);
  return drawn;
}

#else

// Must match the declaration parameter-for-parameter, including the instance
// renderer — an arity mismatch here is a link error in exactly the build this
// branch exists to keep linking.
size_t DrawBakedFrame(void*, const SsPaintBinding*, size_t, const sscore::SsBaker&,
                      const SsMaskInput&, SsInstanceRenderer*) {
  return 0;
}

#endif

}  // namespace ssplayer
