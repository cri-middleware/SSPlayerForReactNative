#pragma once

// The `SHDR` attribute: SpriteStudio's 13 built-in **integration shaders**
// (`ss-*`), selected per part and parameterised by `param0..3`.
//
// Skia-free, like `SsPartColor.hpp` — the id table and the attribute read are
// checkable on the host; the SkSL lives in `SsPartShaderSkSL.hpp`.

#include <cstdint>

#include "format/framedata.h"

namespace sscore {

/// Which built-in an `SHDR` attribute names.
///
/// The order is the wire order of nothing in particular — it is this port's
/// own — but it must stay in step with `SsPartShaderSkSL.hpp`'s body table.
enum class SsShaderId : int32_t {
  Sepia = 0,
  Hsb,
  Step,
  Pix,
  Noise,
  Bmask,
  Outline,
  Blur,
  Wave,
  Move,
  Scatter,
  Circle,
  Spot,
};

/// How many built-ins there are, for the body table's static assert.
constexpr int kSsShaderCount = 13;

/// `PartAttributeShader.id_hash` → the built-in it names.
///
/// The hashes are **pre-baked**, exactly as the texture key is: the converter
/// bakes FNV-1a of the shader's id string and the runtime then drops the name,
/// so there is nothing here to re-hash. The same table appears verbatim in the
/// sibling ports (Flutter's `SsShaderId`, Web's `SSShaderLib.ts`, Godot's
/// `EMBEDDED_SHADERS`) — these are stable SDK built-ins, so the id ↔ hash
/// pairing cannot drift.
struct SsShaderHashEntry {
  uint32_t hash;
  SsShaderId id;
};

inline const SsShaderHashEntry* SsShaderTable(int* outCount) {
  static constexpr SsShaderHashEntry kTable[] = {
      {0x36629dfcu, SsShaderId::Sepia},   {0x8a5c3037u, SsShaderId::Hsb},
      {0x1b721788u, SsShaderId::Step},    {0xc488a527u, SsShaderId::Pix},
      {0x80d6d514u, SsShaderId::Noise},   {0x64e07450u, SsShaderId::Bmask},
      {0x8f8307d4u, SsShaderId::Outline}, {0xb59c8d1bu, SsShaderId::Blur},
      {0xe1df9a2bu, SsShaderId::Wave},    {0xe1c1ee07u, SsShaderId::Move},
      {0x45e35578u, SsShaderId::Scatter}, {0x9b90e282u, SsShaderId::Circle},
      {0x7140896au, SsShaderId::Spot},
  };
  *outCount = static_cast<int>(sizeof(kTable) / sizeof(kTable[0]));
  return kTable;
}

/// The built-in `hash` names, or false when the pack references one this player
/// does not implement — a custom material, or SpriteStudio's `Default`
/// passthrough. The caller then keeps the plain textured/PartColor path, which
/// is the fallback every sibling port takes.
inline bool SsShaderFromHash(uint32_t hash, SsShaderId* out) {
  int count = 0;
  const SsShaderHashEntry* table = SsShaderTable(&count);
  for (int i = 0; i < count; ++i) {
    if (table[i].hash == hash) {
      *out = table[i].id;
      return true;
    }
  }
  return false;
}

/// A part's resolved `SHDR`: which built-in to run and what to run it with.
struct SsPartShader {
  SsShaderId id = SsShaderId::Sepia;

  /// `param0..param3`, in that order.
  ///
  /// The FlatBuffers struct carries **eight**, but no built-in reads past
  /// `param2` — `param3` is here only because it rounds the uniform out to one
  /// `vec4`. Surfacing `param4..7` would put four dead floats in every shader
  /// draw's uniform block, so they are deliberately not read. Add them here and
  /// to the SkSL preamble together if a built-in ever needs them.
  float params[4] = {0.0f, 0.0f, 0.0f, 0.0f};

  /// Whether this built-in folds the PartColor composite as its own output tail.
  ///
  /// Twelve of the thirteen do (`ssFinish`), which is why a part carrying both
  /// `SHDR` and PartColor must **not** also go through `MakePartColorShader` —
  /// the tint would be applied twice. `Blur` is the exception: it has its own
  /// tail (`Pixel x colour`) and never sees the coefficient row.
  bool foldsPartColor() const { return id != SsShaderId::Blur; }

  /// Whether this built-in samples the cell's UV rect (`ss_cell_rect`).
  ///
  /// Only the two that unwrap the cell polar-wise need it, and both cut
  /// fragments outside the disc. The other eleven leave the uniform unread.
  bool needsCellRect() const { return id == SsShaderId::Circle || id == SsShaderId::Spot; }
};

/// Resolves `part`'s shader attribute against `FrameData.shaders`.
///
/// Guarded on `PartState.shader >= 0` rather than the `AttributeShader` bit of
/// `update_flag`: the index alone is an equivalent and simpler signal, and it is
/// exactly how this port already tests PartColor.
inline bool SsReadPartShader(const ss::runtime::FrameData* fd,
                             const ss::runtime::PartState* part, SsPartShader* out) {
  if (fd == nullptr || part == nullptr) return false;
  const int16_t idx = part->shader();
  if (idx < 0) return false;
  const auto* shaders = fd->shaders();
  if (shaders == nullptr || static_cast<uint32_t>(idx) >= shaders->size()) return false;
  const ss::runtime::PartAttributeShader* attr = shaders->Get(static_cast<uint32_t>(idx));
  if (attr == nullptr) return false;

  SsShaderId id;
  if (!SsShaderFromHash(attr->id_hash(), &id)) return false;

  out->id = id;
  out->params[0] = attr->param0();
  out->params[1] = attr->param1();
  out->params[2] = attr->param2();
  out->params[3] = attr->param3();
  return true;
}

}  // namespace sscore
