#pragma once

// A read-only view over a `.ssab` — the *asset* file, as opposed to the Brain's
// per-frame output that `SsFrameData.hpp` reads.
//
// The Brain deliberately returns none of the metadata rendering needs — cellmap
// names, texture paths, animation names — and tells Players to read it out of
// the ssab themselves (`20_design/20_architecture.md`). This is that reader, and
// it lives in C++ so the layers above ask typed questions ("what textures does
// this pack need?") instead of being handed a buffer to parse. No FlatBuffer
// ever crosses into JS.
//
// Unlike `SsFrameData.hpp`, this one goes through **flatc's generated
// accessors** (`cpp/format/ssab.h`, committed; regenerate with
// `npm run generate-fbs-code`), the same arrangement as SSPlayerForGodot. The
// hot-path argument for hand-rolling does not apply here: the `.ssab` is read
// once per load, not once per frame, and generated code cannot drift from the
// schema — which a hand-written offset table can, silently.
//
// FlatBuffers is header-only here. The reachable set out of
// `flatbuffers/flatbuffers.h` is all inline, so nothing links against flatc's
// own translation units and `flatbuffers/src` is not on the include path.
//
// Schema: SpriteStudio-SDK/libs/ssab/fbs/ssab.fbs

#include <cstddef>
#include <cstdint>
#include <string_view>

#include "format/ssab.h"

namespace sscore {

/// One texture a pack needs, already resolved against `embedded_assets`.
///
/// Everything points into the `.ssab` buffer and is only valid while it is.
struct SsTextureEntry {
  /// What `DrawBatch.texture_hash` carries for this texture. For a cellmap that
  /// is the hash of the *cellmap name*; for an external texture, of its *file
  /// name*. Both go in the same list — see `SsAnimeBinaryView::textureAt`.
  uint32_t textureHash = 0;
  /// Cellmap name, or the external texture's file name.
  std::string_view name;
  /// Path to the image, relative to the `.ssab`. Empty when there is none.
  std::string_view imagePath;
  /// Encoded image bytes when the pack is embedded, else null.
  const uint8_t* embedded = nullptr;
  size_t embeddedLength = 0;
  ss::format::TexWrapMode wrapMode = ss::format::TexWrapMode_Clamp;
  ss::format::TexFilterMode filterMode = ss::format::TexFilterMode_Linear;
};

/// Non-owning view over a `.ssab`. Valid only while the buffer is.
class SsAnimeBinaryView {
 public:
  SsAnimeBinaryView() = default;

  SsAnimeBinaryView(const uint8_t* buf, size_t len) noexcept {
    if (buf == nullptr || len < 8) return;
    // Verify before reading: a `.ssab` can be truncated by a bad download or a
    // half-written cache, and every accessor below trusts its offsets. This runs
    // once per load, not per frame.
    ::flatbuffers::Verifier verifier(buf, len);
    if (!ss::format::VerifySsAnimeBinaryBuffer(verifier)) return;
    root_ = ss::format::GetSsAnimeBinary(buf);
  }

  bool valid() const noexcept { return root_ != nullptr; }

  // --- animations ---------------------------------------------------------

  uint32_t animationCount() const noexcept {
    const auto* animations = root_ != nullptr ? root_->animations() : nullptr;
    return animations == nullptr ? 0 : animations->size();
  }

  /// Name of animation `index`, for feeding back to `setupAnimation`.
  std::string_view animationName(uint32_t index) const noexcept {
    const auto* animations = root_ != nullptr ? root_->animations() : nullptr;
    if (animations == nullptr || index >= animations->size()) return {};
    return toView(animations->Get(index)->name());
  }

  // --- textures -----------------------------------------------------------

  /// Cellmaps and external textures, in that order.
  ///
  /// Both have to be walked (`30_core/10_initialization.md` §3):
  /// `DrawBatch.texture_hash` is the cellmap name's hash normally, but a part
  /// under an authored texture change (`TCHG`) carries the hash of a texture
  /// *file* name out of `external_textures` instead. Miss those and exactly
  /// those parts silently stop drawing — so they are presented as one list,
  /// because to a caller they are one question.
  uint32_t textureCount() const noexcept { return cellmapCount() + externalTextureCount(); }

  SsTextureEntry textureAt(uint32_t index) const noexcept {
    const uint32_t cellmaps = cellmapCount();
    return index < cellmaps ? cellmapAt(index) : externalTextureAt(index - cellmaps);
  }

 private:
  uint32_t cellmapCount() const noexcept {
    const auto* v = root_ != nullptr ? root_->cellmaps() : nullptr;
    return v == nullptr ? 0 : v->size();
  }

  uint32_t externalTextureCount() const noexcept {
    const auto* v = root_ != nullptr ? root_->external_textures() : nullptr;
    return v == nullptr ? 0 : v->size();
  }

  SsTextureEntry cellmapAt(uint32_t index) const noexcept {
    SsTextureEntry out;
    const auto* cellmap = root_->cellmaps()->Get(index);
    out.textureHash = cellmap->name_hash();
    out.name = toView(cellmap->name());
    out.imagePath = toView(cellmap->image_path());
    out.wrapMode = cellmap->wrap_mode();
    out.filterMode = cellmap->filter_mode();
    // Embedded assets are keyed by the hash of the *file name*, not of the
    // cellmap name — the two differ, so the lookup goes through
    // `image_path_hash` (§3 "For Embedded type").
    out.embedded = findEmbedded(cellmap->image_path_hash(), &out.embeddedLength);
    return out;
  }

  SsTextureEntry externalTextureAt(uint32_t index) const noexcept {
    SsTextureEntry out;
    const auto* texture = root_->external_textures()->Get(index);
    out.textureHash = texture->name_hash();
    out.name = toView(texture->name());
    // An external texture's name *is* its file path; there is no separate one.
    out.imagePath = out.name;
    // ...and its own name hash is the embedded key, since the name is the file
    // name (§3 note: "External textures are embedded too").
    out.embedded = findEmbedded(out.textureHash, &out.embeddedLength);
    return out;
  }

  /// Linear rather than through the schema's `(key)` binary search: a pack
  /// embeds a handful of assets, this runs once per load, and `LookupByKey`
  /// would quietly return nothing if the writer ever emitted them unsorted.
  const uint8_t* findEmbedded(uint32_t fileNameHash, size_t* outLength) const noexcept {
    *outLength = 0;
    const auto* assets = root_->embedded_assets();
    if (assets == nullptr || fileNameHash == 0) return nullptr;
    for (uint32_t i = 0; i < assets->size(); ++i) {
      const auto* asset = assets->Get(i);
      if (asset->name_hash() != fileNameHash) continue;
      const auto* data = asset->data();
      if (data == nullptr) return nullptr;
      *outLength = data->size();
      return data->data();
    }
    return nullptr;
  }

  static std::string_view toView(const ::flatbuffers::String* s) noexcept {
    return s == nullptr ? std::string_view{} : std::string_view(s->c_str(), s->size());
  }

  const ss::format::SsAnimeBinary* root_ = nullptr;
};

}  // namespace sscore
