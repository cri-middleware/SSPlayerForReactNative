#pragma once

// Variant (c)'s drawing step: turn a baked frame into Skia draw calls, in C++.
//
// Declared with opaque pointers so `HybridSsContext` — which is compiled on
// every target — never needs the Skia headers. Only SsSkiaDraw.cpp does.

#include <cstddef>
#include <cstdint>

namespace sscore {
class SsBaker;
}

namespace ssplayer {

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
size_t DrawBakedFrame(void* canvas, const SsPaintBinding* textures, size_t textureCount,
                      const sscore::SsBaker& baker);

/// Whether this build can draw natively at all.
bool SkiaDirectAvailable();

}  // namespace ssplayer
