#pragma once

// Nitro `CustomType` interop for RN Skia's `SkCanvas` / `SkPaint` JS objects.
//
// Named for **RN Skia**, not Skia: the coupling here is to
// `@shopify/react-native-skia`'s JSI object model, which carries no
// compatibility promise and has already broken once. `SsSkiaDraw` is the other
// half and depends only on Skia's public API, which is stable — grep `RNSkia`
// to find what an RN Skia bump can break.
//
// This header is included by nitrogen-generated code, so it deliberately pulls
// in **no Skia headers at all** — the pointers are opaque here and the actual
// unwrapping lives in SsRNSkiaInterop.cpp. That keeps the generated specs
// compilable on any target, including one where the Skia headers are not on the
// include path, and confines the RN Skia coupling to a single translation unit.
//
// Why this exists: the Phase 0 spike measured that neither candidate boundary
// helps, because `Skia.MakeVertices` takes arrays of JSI *host objects* and
// unmarshals them one vertex at a time (docs/phase0-spike.md).
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

/// Aliases so the *enclosing* namespace can name these unqualified.
///
/// Nitrogen emits a struct's `JSIConverter` specialization into
/// `margelo::nitro`, but refers to a `CustomType` member's type by its bare
/// name — `JSIConverter<SkPaintHandle>`, not
/// `JSIConverter<ssplayer::SkPaintHandle>`. That compiles for every type
/// nitrogen itself declares (they live here) and fails for ours, which the
/// `cxxNamespace` puts one level down. `SsTextureBinding.hpp` includes this
/// header, so these aliases are in scope by the time it needs them.
///
/// Harmless inside `margelo::nitro::ssplayer`, where the inner declaration
/// still wins, and they name the same type either way — so the specializations
/// below are the ones found.
using SkCanvasHandle = ssplayer::SkCanvasHandle;
using SkPaintHandle = ssplayer::SkPaintHandle;

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
