#include "SsSkiaDraw.hpp"

#include "SsBaker.hpp"

#if SSPLAYER_ENABLE_SKIA_DIRECT
#include "include/core/SkCanvas.h"
#include "include/core/SkPaint.h"
#include "include/core/SkVertices.h"

#include "SsBlend.hpp"
#include "SsPartColorShader.hpp"
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

/// Vertices per baked part, and indices per baked part. `SsBaker` emits exactly
/// one quad per Normal part, which is what makes peeling a single part out of a
/// batch a matter of arithmetic rather than a second bake.
constexpr int kVertsPerQuad = 4;
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

}  // namespace

size_t DrawBakedFrame(void* canvasPtr, const SsPaintBinding* textures, size_t textureCount,
                      const sscore::SsBaker& baker) {
  auto* canvas = static_cast<SkCanvas*>(canvasPtr);
  if (canvas == nullptr || textures == nullptr || textureCount == 0) return 0;

  const std::vector<float>& positions = baker.positions();
  const std::vector<float>& texCoords = baker.texCoords();
  const std::vector<uint32_t>& colors = baker.colors();
  const std::vector<uint16_t>& indices = baker.indices();
  const std::vector<sscore::SsQuadInfo>& quadInfo = baker.quads();

  size_t drawn = 0;

  for (const sscore::SsBatchDesc& batch : baker.batches()) {
    if (batch.vertexCount == 0 || batch.indexCount == 0) continue;

    const SkPaint* paint = PaintFor(textures, textureCount, batch.textureHash);
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
    const int quads = batch.vertexCount / kVertsPerQuad;
    const int firstQuad = batch.vertexOffset / kVertsPerQuad;

    const BlendPlan plan = BlendPlanFor(batch.blendType);

    // A batch survives as one draw only if nothing in it needs peeling. Both
    // reasons peel to the same shape — one quad at a time — but they are
    // independent: the blend plan is a property of the batch, a PartColor tint
    // is a property of one part inside it.
    bool anyPartColor = false;
    for (int q = 0; q < quads && !anyPartColor; ++q) {
      const size_t qi = static_cast<size_t>(firstQuad + q);
      anyPartColor = qi < quadInfo.size() && quadInfo[qi].needsPartColorShader;
    }

    if (!plan.multiPass() && !anyPartColor) {
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
          SkVertices::kTriangles_VertexMode, batch.vertexCount, pos, uv,
          reinterpret_cast<const SkColor*>(col), batch.indexCount, idx);
      if (vertices == nullptr) continue;

      const SkPaint passPaint = PaintForPass(*paint, plan.passes[0]);
      canvas->drawVertices(vertices, kVertexColorBlend, passPaint);
      drawn += static_cast<size_t>(batch.vertexCount);
      continue;
    }

    // Peeled, for either reason. Sub / Invert need it because the inversion
    // passes have to cover each pixel exactly once (`SsBlend.hpp` spells out why
    // two overlapping Sub parts would otherwise cancel their overlap); a
    // PartColor tint needs it because its four corner colours are shader
    // uniforms, so one shader can only speak for one quad. One quad per part,
    // and the *same* quad through every pass.
    for (int q = 0; q < quads; ++q) {
      // Rebase the quad's indices onto its own four vertices rather than
      // assuming the baker's winding — it is `{0,1,2,1,3,2}` today, and reading
      // it back keeps this correct if that ever changes.
      const int base = q * kVertsPerQuad;
      uint16_t quadIdx[kIndicesPerQuad];
      for (int i = 0; i < kIndicesPerQuad; ++i) {
        quadIdx[i] = static_cast<uint16_t>(idx[q * kIndicesPerQuad + i] - base);
      }

      // The PartColor shader carries alpha itself (`a = texel.a * col.a`), so
      // the quad must go through with NO vertex colours or `kModulate` would
      // apply it a second time. Without the shader the vertex colours are the
      // only thing carrying the part's opacity, so they must go through.
      const size_t qi = static_cast<size_t>(firstQuad + q);
      const sscore::SsQuadInfo* info = qi < quadInfo.size() ? &quadInfo[qi] : nullptr;
      sk_sp<SkShader> tint;
      if (info != nullptr && info->needsPartColorShader) {
        const float* quadUv = texCoords.data() + (batch.vertexOffset + base) * 2;
        tint = MakePartColorShader(info->partColor, quadUv, paint->refShader());
      }

      sk_sp<SkVertices> vertices = SkVertices::MakeCopy(
          SkVertices::kTriangles_VertexMode, kVertsPerQuad, pos + base, uv + base,
          tint != nullptr ? nullptr : reinterpret_cast<const SkColor*>(col + base),
          kIndicesPerQuad, quadIdx);
      if (vertices == nullptr) continue;

      for (int p = 0; p < plan.count; ++p) {
        SkPaint passPaint = PaintForPass(*paint, plan.passes[p]);
        // Only the pass that draws the part itself is tinted. A coverage or
        // black pass is a mask over the same geometry, and swapping its shader
        // for a textured one would break the inversion it exists to perform.
        if (tint != nullptr && plan.passes[p].source == BlendPassSource::kPart) {
          passPaint.setShader(tint);
        }
        canvas->drawVertices(vertices, kVertexColorBlend, passPaint);
      }
      // Geometry drawn, not draw calls issued — a multi-pass part covers the
      // same vertices three times and should not read as three times the scene.
      drawn += kVertsPerQuad;
    }
  }
  return drawn;
}

#else

size_t DrawBakedFrame(void*, const SsPaintBinding*, size_t, const sscore::SsBaker&) { return 0; }

#endif

}  // namespace ssplayer
