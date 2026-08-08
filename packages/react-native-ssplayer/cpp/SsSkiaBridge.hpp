#pragma once

// Nitro `CustomType` bridge for RN Skia's `SkCanvas` / `SkPaint` host objects.
//
// This header is included by nitrogen-generated code, so it deliberately pulls
// in **no Skia headers at all** — the pointers are opaque here and the actual
// unwrapping lives in SsSkiaBridge.cpp. That keeps the generated specs
// compilable on any target, including one where the Skia headers are not on the
// include path, and confines the RN Skia coupling to a single translation unit.
//
// Why this exists: Phase 0 measured that neither candidate boundary from the
// design doc helps, because `Skia.MakeVertices` takes arrays of JSI *host
// objects* and unmarshals them one vertex at a time (docs/phase0-spike.md).
// Handing C++ the canvas is the only way to keep vertices out of JS entirely.

#include <NitroModules/JSIConverter.hpp>

#include <jsi/jsi.h>

namespace margelo::nitro::ssplayer {

/// A borrowed `SkCanvas*`. Valid only for the duration of the call it was
/// passed to — RN Skia owns the canvas and may recycle it afterwards.
struct SkCanvasHandle final {
  void* canvas = nullptr;
};

/// A borrowed `SkPaint*`, same lifetime rule.
struct SkPaintHandle final {
  void* paint = nullptr;
};

}  // namespace margelo::nitro::ssplayer

namespace margelo::nitro {

template <>
struct JSIConverter<ssplayer::SkCanvasHandle> final {
  static ssplayer::SkCanvasHandle fromJSI(jsi::Runtime& runtime, const jsi::Value& value);
  static jsi::Value toJSI(jsi::Runtime& runtime, const ssplayer::SkCanvasHandle& handle);
  static bool canConvert(jsi::Runtime& runtime, const jsi::Value& value);
};

template <>
struct JSIConverter<ssplayer::SkPaintHandle> final {
  static ssplayer::SkPaintHandle fromJSI(jsi::Runtime& runtime, const jsi::Value& value);
  static jsi::Value toJSI(jsi::Runtime& runtime, const ssplayer::SkPaintHandle& handle);
  static bool canConvert(jsi::Runtime& runtime, const jsi::Value& value);
};

}  // namespace margelo::nitro
