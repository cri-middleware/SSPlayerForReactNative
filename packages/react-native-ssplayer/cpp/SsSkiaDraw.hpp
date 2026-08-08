#pragma once

// Variant (c)'s drawing step: turn a baked frame into Skia draw calls, in C++.
//
// Declared with opaque pointers so `HybridSsContext` — which is compiled on
// every target — never needs the Skia headers. Only SsSkiaDraw.cpp does.

#include <cstddef>

namespace sscore {
class SsBaker;
}

namespace ssplayer {

/// Draws every batch the baker produced into `canvas` with `paint`.
///
/// `canvas` is an `SkCanvas*` and `paint` an `SkPaint*`, both borrowed for the
/// duration of the call. Returns the number of vertices drawn, or 0 when the
/// build has no Skia support (`SSPLAYER_ENABLE_SKIA_DIRECT=0`) or either
/// pointer is null.
size_t DrawBakedFrame(void* canvas, void* paint, const sscore::SsBaker& baker);

/// Whether this build can draw natively at all.
bool SkiaDirectAvailable();

}  // namespace ssplayer
