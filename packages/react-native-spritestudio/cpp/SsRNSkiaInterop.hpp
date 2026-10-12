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
// Why this exists: handing C++ the canvas is what keeps vertices out of JS
// entirely.

#include <NitroModules/JSIConverter.hpp>

#include <jsi/jsi.h>

#include <memory>

namespace margelo::nitro::ssplayer {

/// A borrowed `SkCanvas*`. Valid only for the duration of the call it was
/// passed to — RN Skia owns the canvas and may recycle it afterwards.
struct SkCanvasHandle final {
  void* canvas = nullptr;
};

/// An `SkPaint*`, kept alive by `owner` for as long as the handle is held — the
/// texture table outlives the call that set it.
struct SkPaintHandle final {
  void* paint = nullptr;
  std::shared_ptr<void> owner;
};

/// An `SkImage` wrapper — RN Skia's `JsiSkImage` — kept alive by `owner`.
struct SkImageHandle final {
  void* image = nullptr;
  std::shared_ptr<void> owner;
};

/// Decodes the image `handle` wraps, if it is lazily decoded, and puts the
/// decoded pixels in its place. Blocking: run it off the JS thread.
void DecodeImageInPlace(const SkImageHandle& handle);

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
using SkImageHandle = ssplayer::SkImageHandle;

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

template <>
struct JSIConverter<ssplayer::SkImageHandle> final {
  static ssplayer::SkImageHandle fromJSI(jsi::Runtime& runtime, const jsi::Value& value);
  static jsi::Value toJSI(jsi::Runtime& runtime, const ssplayer::SkImageHandle& handle);
  static bool canConvert(jsi::Runtime& runtime, const jsi::Value& value);
};

}  // namespace margelo::nitro
