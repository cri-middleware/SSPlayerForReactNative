#pragma once

// A read-only view over a `.ssab` — the *asset* file, as opposed to the Brain's
// per-frame `FrameData`, which the hot path reads straight through
// `format/framedata.h` with no wrapper.
//
// The Brain deliberately returns none of the metadata rendering needs — cellmap
// names, texture paths, animation names — and tells Players to read it out of
// the ssab themselves (`20_design/20_architecture.md`). This is that reader, and
// it lives in C++ so the layers above ask typed questions ("what textures does
// this pack need?") instead of being handed a buffer to parse. No FlatBuffer
// ever crosses into JS.
//
// It goes through **flatc's generated accessors** (`cpp/format/ssab.h`,
// committed; regenerate with `npm run generate-fbs-code`), the same arrangement
// as SSPlayerForGodot — as does the frame path now. This wrapper exists for a
// reason that does not apply there: the `.ssab`'s metadata needs real decoding
// (two texture lists presented as one, hash-keyed embedded assets), whereas
// `FrameData` is read field-for-field.
//
// FlatBuffers is header-only here. The reachable set out of
// `flatbuffers/flatbuffers.h` is all inline, so nothing links against flatc's
// own translation units and `flatbuffers/src` is not on the include path.
//
// Schema: SpriteStudio-SDK/libs/ssab/fbs/ssab.fbs

#include <cstddef>
#include <cstdint>
#include <string_view>
#include <vector>

#include "SsEffect.hpp"
#include "SsInstance.hpp"
#include "SsMask.hpp"
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

  /// Every cellmap's authored size, for un-normalising effect UVs.
  ///
  /// Cellmaps only, unlike `textureAt` above: an `EffectDrawCommand` names a
  /// *cellmap*, and an Effect part carries no cell, so the `TCHG` hash space
  /// that forces the two lists together elsewhere cannot arise here.
  std::vector<SsCellMapSize> cellMapSizes() const {
    std::vector<SsCellMapSize> out;
    const auto* v = root_ != nullptr ? root_->cellmaps() : nullptr;
    if (v == nullptr) return out;
    out.reserve(v->size());
    for (uint32_t i = 0; i < v->size(); ++i) {
      const ss::format::CellMap* cellmap = v->Get(i);
      const ss::format::Vec2* size = cellmap->size_original();
      if (size == nullptr) continue;
      out.push_back({cellmap->name_hash(), size->v1(), size->v2()});
    }
    return out;
  }

  /// How many Shape parts the pack has. Enough for a check that wants to say
  /// "enumerated but never drawn"; the geometry itself is per frame.
  uint32_t shapePartCount() const noexcept {
    const auto* v = root_ != nullptr ? root_->parts() : nullptr;
    if (v == nullptr) return 0;
    uint32_t n = 0;
    for (uint32_t i = 0; i < v->size(); ++i) {
      if (v->Get(i)->part_type_type() == ss::format::PartType_PartTypeShape) ++n;
    }
    return n;
  }

  // --- effect -------------------------------------------------------------

  // --- instance -----------------------------------------------------------

  /// This pack's own `name_hash` — the identity a reference is compared against
  /// to spot a same-file sub-animation.
  uint32_t packNameHash() const noexcept {
    return root_ != nullptr ? root_->name_hash() : 0;
  }

  /// Every instance-hosting part, in part-index order.
  ///
  /// A binding with no target animation is authored garbage and is skipped
  /// rather than spawning a child that can never resolve.
  std::vector<SsInstancePart> instanceParts() const {
    std::vector<SsInstancePart> out;
    const auto* v = root_ != nullptr ? root_->parts() : nullptr;
    if (v == nullptr) return out;
    for (uint32_t i = 0; i < v->size(); ++i) {
      const ss::format::PartData* part = v->Get(i);
      if (part->part_type_type() != ss::format::PartType_PartTypeInstance) continue;
      const auto* type = part->part_type_as_PartTypeInstance();
      if (type == nullptr) continue;
      const ::flatbuffers::String* anime = type->ref_anime_name();
      if (anime == nullptr || anime->size() == 0) continue;
      out.push_back({i, type->ref_anime_pack_hash(), std::string(anime->c_str(), anime->size())});
    }
    return out;
  }

  /// The packs this one reaches into through instance parts, deduplicated.
  ///
  /// Read from the `.ssab`'s own `external_instances` manifest, so a same-file
  /// sub-animation is correctly absent and the caller only has to fetch what is
  /// genuinely elsewhere. Resolution is **transitive** — an external pack can
  /// reach further still — which is the caller's walk, not this one's.
  std::vector<SsExternalPack> externalInstancePacks() const {
    std::vector<SsExternalPack> out;
    const auto* v = root_ != nullptr ? root_->external_instances() : nullptr;
    if (v == nullptr) return out;
    for (uint32_t i = 0; i < v->size(); ++i) {
      const auto* entry = v->Get(i);
      const ::flatbuffers::String* name = entry->anime_pack_name();
      if (name == nullptr || name->size() == 0) continue;
      const uint32_t hash = entry->anime_pack_name_hash();
      bool seen = false;
      for (const SsExternalPack& had : out) {
        if (had.nameHash == hash) { seen = true; break; }
      }
      if (!seen) out.push_back({std::string(name->c_str(), name->size()), hash});
    }
    return out;
  }

  // --- effect -------------------------------------------------------------

  /// Every effect-hosting part, in part-index order.
  ///
  /// Read from the pack's **metadata**, never from `draw_order`: the Brain drops
  /// a hidden Effect part from the draw order entirely, and a slot registry
  /// built from that would stop stepping an independent effect the moment it
  /// went off screen — its particles would then resume where they froze rather
  /// than where they should be (`40_components/20_effect.md`).
  std::vector<SsEffectPart> effectParts() const {
    std::vector<SsEffectPart> out;
    const auto* v = root_ != nullptr ? root_->parts() : nullptr;
    if (v == nullptr) return out;
    for (uint32_t i = 0; i < v->size(); ++i) {
      const ss::format::PartData* part = v->Get(i);
      if (part->part_type_type() != ss::format::PartType_PartTypeEffect) continue;
      const auto* type = part->part_type_as_PartTypeEffect();
      if (type == nullptr) continue;
      out.push_back({i, type->ref_effect_name_hash()});
    }
    return out;
  }

  // --- mask ---------------------------------------------------------------

  uint32_t partCount() const noexcept {
    const auto* v = root_ != nullptr ? root_->parts() : nullptr;
    return v == nullptr ? 0 : v->size();
  }

  /// The mask flags of part `index`, or an all-false set when out of range.
  ///
  /// These are the **static** half of masking and the doc leads with the split:
  /// they are read once at load and never re-read, while `mask` / `priority` /
  /// `hide` come from `FrameData` every frame. Reading either from the wrong
  /// table is the mistake §1-2 exists to prevent.
  SsMaskPartFlags maskFlagsAt(uint32_t index) const noexcept {
    SsMaskPartFlags out;
    const auto* v = root_ != nullptr ? root_->parts() : nullptr;
    if (v == nullptr || index >= v->size()) return out;

    const ss::format::PartData* part = v->Get(index);
    const ss::format::PartType type = part->part_type_type();
    // §1-2: `draw_as_mask` is the ssab's single consolidated flag for the
    // per-type authoring settings on Shape / Text / Nines.
    out.pureMask = type == ss::format::PartType_PartTypeMask || part->draw_as_mask();
    out.maskWrite = part->mask_write();
    out.maskInfluence = part->mask_influence();
    out.visibleInsideMask = part->visible_inside_mask();
    // Every kind `SsBaker` emits geometry for. Shape and Mesh joined when they
    // were baked — a Shape turned into a pure mask by `draw_as_mask` covers with
    // its polygon and a Mesh clipping writer with its deformed triangles, which
    // is what the coverage pass now rasterises rather than a bounding quad.
    out.bakedGeometry = type == ss::format::PartType_PartTypeNormal ||
                        type == ss::format::PartType_PartTypeMask ||
                        type == ss::format::PartType_PartTypeShape ||
                        type == ss::format::PartType_PartTypeMesh;
    return out;
  }

  /// Every part's mask flags, in part-index order — the shape `SsMaskPlan` wants.
  std::vector<SsMaskPartFlags> maskFlags() const {
    const uint32_t count = partCount();
    std::vector<SsMaskPartFlags> out;
    out.reserve(count);
    for (uint32_t i = 0; i < count; ++i) out.push_back(maskFlagsAt(i));
    return out;
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
