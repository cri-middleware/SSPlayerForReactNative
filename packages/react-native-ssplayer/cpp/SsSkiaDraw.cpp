#include "SsSkiaDraw.hpp"

#include "SsBaker.hpp"

#if SSPLAYER_ENABLE_SKIA_DIRECT
#include "include/core/SkCanvas.h"
#include "include/core/SkPaint.h"
#include "include/core/SkVertices.h"
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

}  // namespace

size_t DrawBakedFrame(void* canvasPtr, const SsPaintBinding* textures, size_t textureCount,
                      const sscore::SsBaker& baker) {
  auto* canvas = static_cast<SkCanvas*>(canvasPtr);
  if (canvas == nullptr || textures == nullptr || textureCount == 0) return 0;

  const std::vector<float>& positions = baker.positions();
  const std::vector<float>& texCoords = baker.texCoords();
  const std::vector<uint16_t>& indices = baker.indices();

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

    // MakeCopy rather than a builder: Skia needs the vertex data to outlive the
    // call (the draw is deferred until raster), and the baker's vectors are
    // rewritten on the next frame. The copy is a memcpy of packed floats, not a
    // per-vertex marshal.
    sk_sp<SkVertices> vertices = SkVertices::MakeCopy(
        SkVertices::kTriangles_VertexMode, batch.vertexCount, pos, uv,
        /*colors=*/nullptr, batch.indexCount, idx);
    if (vertices == nullptr) continue;

    // SrcOver for now. The full blend table (including the multi-pass Sub /
    // Invert reconstruction) is Phase 2 — design doc ch.3 B.
    canvas->drawVertices(vertices, SkBlendMode::kSrcOver, *paint);
    drawn += static_cast<size_t>(batch.vertexCount);
  }
  return drawn;
}

#else

size_t DrawBakedFrame(void*, const SsPaintBinding*, size_t, const sscore::SsBaker&) { return 0; }

#endif

}  // namespace ssplayer
