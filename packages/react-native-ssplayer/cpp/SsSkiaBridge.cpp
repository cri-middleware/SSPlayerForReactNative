#include "SsSkiaBridge.hpp"

#include <stdexcept>

// The only translation unit that knows RN Skia exists. Guarded so a target that
// has not wired the Skia include paths still builds: the module keeps working,
// and only `drawInto()` reports that it is unavailable.
#if SSPLAYER_ENABLE_SKIA_DIRECT
#include "JsiSkCanvas.h"
#include "JsiSkPaint.h"
#endif

namespace margelo::nitro {

namespace {

[[noreturn]] void ThrowUnavailable(jsi::Runtime& runtime) {
  throw jsi::JSError(
      runtime,
      "react-native-ssplayer was built without direct Skia drawing "
      "(SSPLAYER_ENABLE_SKIA_DIRECT=0). Use bake() instead of drawInto().");
}

}  // namespace

ssplayer::SkCanvasHandle JSIConverter<ssplayer::SkCanvasHandle>::fromJSI(
    jsi::Runtime& runtime, const jsi::Value& value) {
#if SSPLAYER_ENABLE_SKIA_DIRECT
  // RN Skia's SkCanvas is a JSI HostObject wrapping the raw pointer. Going
  // through asHostObject means a wrong object type throws a JS error here
  // rather than handing C++ a bad pointer to dereference.
  auto host = value.asObject(runtime).asHostObject<RNSkia::JsiSkCanvas>(runtime);
  return ssplayer::SkCanvasHandle{host->getCanvas()};
#else
  ThrowUnavailable(runtime);
#endif
}

jsi::Value JSIConverter<ssplayer::SkCanvasHandle>::toJSI(jsi::Runtime& runtime,
                                                         const ssplayer::SkCanvasHandle&) {
  // Nothing in the spec returns a canvas, and manufacturing a JS wrapper around
  // a borrowed pointer would hand JS an object that outlives what it points at.
  throw jsi::JSError(runtime, "SkCanvasHandle cannot be returned to JS");
}

bool JSIConverter<ssplayer::SkCanvasHandle>::canConvert(jsi::Runtime& runtime,
                                                        const jsi::Value& value) {
#if SSPLAYER_ENABLE_SKIA_DIRECT
  if (!value.isObject()) return false;
  return value.getObject(runtime).isHostObject<RNSkia::JsiSkCanvas>(runtime);
#else
  (void)runtime;
  (void)value;
  return false;
#endif
}

ssplayer::SkPaintHandle JSIConverter<ssplayer::SkPaintHandle>::fromJSI(jsi::Runtime& runtime,
                                                                      const jsi::Value& value) {
#if SSPLAYER_ENABLE_SKIA_DIRECT
  // JsiSkPaint wraps a shared_ptr; the raw pointer is borrowed for the call and
  // the JS-side paint keeps owning it.
  auto paint = RNSkia::JsiSkPaint::fromValue(runtime, value);
  return ssplayer::SkPaintHandle{paint.get()};
#else
  ThrowUnavailable(runtime);
#endif
}

jsi::Value JSIConverter<ssplayer::SkPaintHandle>::toJSI(jsi::Runtime& runtime,
                                                        const ssplayer::SkPaintHandle&) {
  throw jsi::JSError(runtime, "SkPaintHandle cannot be returned to JS");
}

bool JSIConverter<ssplayer::SkPaintHandle>::canConvert(jsi::Runtime& runtime,
                                                       const jsi::Value& value) {
#if SSPLAYER_ENABLE_SKIA_DIRECT
  if (!value.isObject()) return false;
  return value.getObject(runtime).isHostObject<RNSkia::JsiSkPaint>(runtime);
#else
  (void)runtime;
  (void)value;
  return false;
#endif
}

}  // namespace margelo::nitro
