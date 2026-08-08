#include "SsSkiaBridge.hpp"

#include <stdexcept>

// The only translation unit that knows RN Skia exists. Guarded so a target that
// has not wired the Skia include paths still builds: the module keeps working,
// and only `drawInto()` reports that it is unavailable.
//
// Targets RN Skia **2.11+**, which moved its API objects off `jsi::HostObject`
// onto the `jsi::NativeState` pattern (`JsiSkNativeObject`): methods now live on
// a shared prototype and the C++ instance hangs off the JS object as native
// state. `asHostObject<JsiSkCanvas>` no longer compiles at all — the classes are
// not `HostObject`s any more — so the unwrapping goes through the
// `tryGetJsiObject` / `getJsiObject` helpers instead. That is the peer range the
// package declares.
#if SSPLAYER_ENABLE_SKIA_DIRECT
#include "JsiSkCanvas.h"
#include "JsiSkNativeObjects.h"
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
  // `getJsiObject` throws a JS error when the value is not actually a Skia
  // canvas, rather than handing C++ a bad pointer to dereference.
  auto wrapper = RNSkia::getJsiObject<RNSkia::JsiSkCanvas>(runtime, value);
  return ssplayer::SkCanvasHandle{wrapper->getCanvas()};
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
  return RNSkia::tryGetJsiObject<RNSkia::JsiSkCanvas>(runtime, value) != nullptr;
#else
  (void)runtime;
  (void)value;
  return false;
#endif
}

ssplayer::SkPaintHandle JSIConverter<ssplayer::SkPaintHandle>::fromJSI(jsi::Runtime& runtime,
                                                                      const jsi::Value& value) {
#if SSPLAYER_ENABLE_SKIA_DIRECT
  // JsiSkPaint wraps a `shared_ptr<SkPaint>`; the raw pointer is borrowed for
  // the call and the JS-side paint keeps owning it. `objectFromValue` hands back
  // a copy of that shared_ptr, so the SkPaint outlives this temporary.
  std::shared_ptr<SkPaint> paint = RNSkia::JsiSkPaint::objectFromValue(runtime, value);
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
  return RNSkia::tryGetJsiObject<RNSkia::JsiSkPaint>(runtime, value) != nullptr;
#else
  (void)runtime;
  (void)value;
  return false;
#endif
}

}  // namespace margelo::nitro
