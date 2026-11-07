#pragma once

// A read-only view over a `.ssab` — the *asset* file, as opposed to the Brain's
// per-frame `FrameData`, which the hot path reads straight through
// `format/framedata.h` with no wrapper.
//
// The Brain deliberately returns none of the metadata rendering needs — cellmap
// names, texture paths, animation names — and tells Players to read it out of
// the ssab themselves. This is that reader, and
// it lives in C++ so the layers above ask typed questions ("what textures does
// this pack need?") instead of being handed a buffer to parse. No FlatBuffer
// ever crosses into JS.
//
// It goes through **flatc's generated accessors** (`cpp/format/ssab.h`,
// committed; regenerate with `pnpm run generate-fbs-code`), as does the frame path.
// This wrapper exists for a
// reason that does not apply there: the `.ssab`'s metadata needs real decoding
// (two texture lists presented as one, hash-keyed embedded assets), whereas
// `FrameData` is read field-for-field.
//
// FlatBuffers is header-only here. The reachable set out of
// `flatbuffers/flatbuffers.h` is all inline, so nothing links against flatc's
// own translation units and `flatbuffers/src` is not on the include path.
//
// Schema: SpriteStudio-SDK/libs/ssab/fbs/ssab.fbs

#include <algorithm>
#include <array>
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
};

/// One `SoundFile` out of a pack's `SoundList`, resolved against
/// `embedded_assets` — what an authored audio key points at.
///
/// The views point into the `.ssab` buffer like everything else here, so they
/// are only valid while the resource is.
struct SsSoundEntry {
  /// False when the pack has no such list, or no such file inside it. Every
  /// other field is then untouched — an authored key naming a sound the pack
  /// does not carry is garbage, not a state with a sensible default.
  bool found = false;
  /// The alias, i.e. the name the key addresses it by — not the file name.
  std::string_view name;
  /// Path to the audio file, relative to the `.ssab`, exactly like a cellmap's
  /// `image_path`.
  std::string_view filePath;
  /// Authored duration in milliseconds.
  uint32_t totalMs = 0;
  /// Whether the pack carries the bytes (`--embedded`), in which case
  /// `filePath` names a file that is not on disk.
  bool embedded = false;
};

struct SsLabelEntry {
  std::string_view name;
  int32_t frame = 0;
};

/// Non-owning view over a `.ssab`. Valid only while the buffer is.
class SsAnimeBinaryView {
 public:
  SsAnimeBinaryView() = default;

  /// The only way to a non-empty view, and it verifies — so a view that reads
  /// `valid()` is a verified one, everywhere, with no second path to audit.
  ///
  /// This is the gate `HybridSsResource::adopt()` puts in front of the Brain,
  /// which parses unchecked and calls invalid input undefined behaviour.
  SsAnimeBinaryView(const uint8_t* buf, size_t len) noexcept {
    if (buf == nullptr || len < 8) return;
    // Verify before reading: a `.ssab` can be truncated by a bad download or a
    // half-written cache, and every accessor below trusts its offsets.
    //
    // The cost is a table walk, not a byte walk — 470 us for Ringo's 28k tables
    // against 1 us for a 1.5 MB pack that is mostly embedded bytes. That is a
    // load-time price, so build one of these per load and keep it; the frame
    // path must never construct one.
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

  /// Animation `index`'s authored canvas — its size, placed against the origin
  /// by its pivot — as `{x, y, width, height}` in the Brain's Y-down
  /// player-local space. The pivot is normalised from the canvas centre in the
  /// editor's Y-up terms, which is the one flip. All zero out of range.
  std::array<float, 4> canvasBox(int32_t index) const noexcept {
    const auto* animations = root_ != nullptr ? root_->animations() : nullptr;
    if (animations == nullptr || index < 0 || static_cast<uint32_t>(index) >= animations->size()) {
      return {};
    }
    const auto* animation = animations->Get(static_cast<uint32_t>(index));
    const auto* size = animation->canvas_size();
    const auto* pivot = animation->pivot();
    if (size == nullptr || pivot == nullptr) return {};
    const float width = size->v1();
    const float height = size->v2();
    return {-pivot->v1() * width - width / 2.0f, pivot->v2() * height - height / 2.0f, width, height};
  }

  /// Animation `index`'s labels in frame order. The pack keeps them in name-hash
  /// order, which a section running to the next label cannot use.
  std::vector<SsLabelEntry> labels(int32_t index) const {
    std::vector<SsLabelEntry> out;
    const auto* animations = root_ != nullptr ? root_->animations() : nullptr;
    if (animations == nullptr || index < 0 || static_cast<uint32_t>(index) >= animations->size()) {
      return out;
    }
    const auto* labels = animations->Get(static_cast<uint32_t>(index))->labels();
    if (labels == nullptr) return out;
    out.reserve(labels->size());
    for (uint32_t i = 0; i < labels->size(); ++i) {
      const auto* label = labels->Get(i);
      out.push_back({toView(label->name()), label->time()});
    }
    std::stable_sort(out.begin(), out.end(),
                     [](const SsLabelEntry& a, const SsLabelEntry& b) { return a.frame < b.frame; });
    return out;
  }

  /// Animation `index`'s own first and last frame. All zero out of range.
  std::array<int32_t, 2> frameRange(int32_t index) const noexcept {
    const auto* animations = root_ != nullptr ? root_->animations() : nullptr;
    if (animations == nullptr || index < 0 || static_cast<uint32_t>(index) >= animations->size()) {
      return {};
    }
    const auto* animation = animations->Get(static_cast<uint32_t>(index));
    return {animation->start_frame(), animation->end_frame()};
  }

  // --- cellmaps -----------------------------------------------------------
  //
  // Deliberately separate from the texture list below. That one is cellmaps
  // *and* external textures, keyed by whatever `DrawBatch.texture_hash` carries,
  // because to a renderer they are one question. This one is the namespace a
  // cell override hashes against, and an external texture is not in it.

  /// Cellmap names, without the `.ssce` extension.
  std::vector<std::string_view> cellmapNames() const noexcept {
    std::vector<std::string_view> out;
    const auto* v = root_ != nullptr ? root_->cellmaps() : nullptr;
    if (v == nullptr) return out;
    out.reserve(v->size());
    for (uint32_t i = 0; i < v->size(); ++i) out.emplace_back(toView(v->Get(i)->name()));
    return out;
  }

  /// The cell names inside one cellmap, empty when the name is not in this pack.
  std::vector<std::string_view> cellNames(std::string_view cellmapName) const noexcept {
    std::vector<std::string_view> out;
    const auto* v = root_ != nullptr ? root_->cellmaps() : nullptr;
    if (v == nullptr) return out;
    for (uint32_t i = 0; i < v->size(); ++i) {
      const auto* cellmap = v->Get(i);
      if (toView(cellmap->name()) != cellmapName) continue;
      const auto* cells = cellmap->cells();
      if (cells == nullptr) return out;
      out.reserve(cells->size());
      for (uint32_t c = 0; c < cells->size(); ++c) out.emplace_back(toView(cells->Get(c)->name()));
      return out;
    }
    return out;
  }

  // --- textures -----------------------------------------------------------

  /// Cellmaps and external textures, in that order.
  ///
  /// Both have to be walked:
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
  /// than where they should be.
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

  // --- parts, events, sounds -----------------------------------------------

  uint32_t partCount() const noexcept {
    const auto* v = root_ != nullptr ? root_->parts() : nullptr;
    return v == nullptr ? 0 : v->size();
  }

  /// Authored name of part `index`, or empty when out of range.
  ///
  /// Points into the `.ssab` buffer like everything else here, so it is only
  /// valid while the resource is.
  std::string_view partName(uint32_t index) const noexcept {
    const auto* v = root_ != nullptr ? root_->parts() : nullptr;
    if (v == nullptr || index >= v->size()) return {};
    return toView(v->Get(index)->name());
  }

  /// Whether part `index` is a **skinned** mesh — a mesh part bound to bones.
  ///
  /// The distinction a part *tracker* has to make. A skinned mesh's vertices are
  /// drawn from its bound bones' matrices, while the part's own node transform
  /// stays at its setup position (usually near the character root) — so a
  /// follower reading that transform snaps near the root rather than onto the
  /// deformed art. A rigid (deform-only) mesh, and every non-mesh part, places
  /// the art at its own node and follows correctly, so those are false.
  ///
  /// The judgement is the one every sibling Player shares, keyed off the same
  /// `.ssab` field so the answers agree: a `mesh_binding` is present and its `influence_bone`
  /// list is non-empty. False out of range.
  bool isPartSkinnedMesh(uint32_t index) const noexcept {
    const auto* v = root_ != nullptr ? root_->parts() : nullptr;
    if (v == nullptr || index >= v->size()) return false;
    const ss::format::PartMeshBinding* binding = v->Get(index)->mesh_binding();
    if (binding == nullptr) return false;
    const auto* bones = binding->influence_bone();
    return bones != nullptr && bones->size() > 0;
  }

  /// Index of the animation called `name`, or -1.
  ///
  /// The `.ssab` is the only thing that knows the order, and the Brain reports
  /// passed events as indices into *that* animation's `events` table — so
  /// resolving a name to an index is what connects the two.
  int32_t animationIndex(std::string_view name) const noexcept {
    const uint32_t count = animationCount();
    for (uint32_t i = 0; i < count; ++i) {
      if (animationName(i) == name) return static_cast<int32_t>(i);
    }
    return -1;
  }

  /// The `EventsPerFrame` at `eventIndex` of animation `animationIndex`, or null.
  ///
  /// Indexed rather than searched by frame: `ss_runtime_get_passed_event_index`
  /// hands back a position in this very vector, so looking the frame up again
  /// would be re-deriving what the Brain already resolved.
  const ss::format::EventsPerFrame* eventsAt(int32_t animationIndex,
                                             int32_t eventIndex) const noexcept {
    const auto* animations = root_ != nullptr ? root_->animations() : nullptr;
    if (animations == nullptr || animationIndex < 0 ||
        static_cast<uint32_t>(animationIndex) >= animations->size()) {
      return nullptr;
    }
    const auto* events = animations->Get(static_cast<uint32_t>(animationIndex))->events();
    if (events == nullptr || eventIndex < 0 ||
        static_cast<uint32_t>(eventIndex) >= events->size()) {
      return nullptr;
    }
    return events->Get(static_cast<uint32_t>(eventIndex));
  }

  /// The `SoundFile` an authored audio key addresses, or a `found == false`
  /// entry.
  ///
  /// **Two hashes and not one**, because `SoundFile.name_hash` is unique only
  /// *within* its `SoundList` — the list has to be found first, and a lookup
  /// that searched every list for the file hash would resolve to whichever
  /// list happened to come first. `PartAttributeAudio` carries both for
  /// exactly this reason.
  ///
  /// Linear on both levels, for the same reason `findEmbedded` is: a pack holds
  /// a handful of lists of a handful of files, and this runs only on a frame
  /// that actually crossed an audio key — not per frame, and not per part.
  SsSoundEntry soundFile(uint32_t soundListNameHash, uint32_t soundNameHash) const noexcept {
    SsSoundEntry out;
    const auto* lists = root_ != nullptr ? root_->sound_lists() : nullptr;
    if (lists == nullptr) return out;

    for (uint32_t l = 0; l < lists->size(); ++l) {
      const auto* list = lists->Get(l);
      if (list->name_hash() != soundListNameHash) continue;

      const auto* files = list->table_data();
      if (files == nullptr) return out;
      for (uint32_t f = 0; f < files->size(); ++f) {
        const auto* file = files->Get(f);
        if (file->name_hash() != soundNameHash) continue;

        out.found = true;
        out.name = toView(file->name());
        out.filePath = toView(file->file_path());
        out.totalMs = file->time_total();
        // Embedded assets are keyed by the hash of the *file path*, which the
        // `SoundFile` carries ready-made — the same rule the cellmap path
        // follows with `image_path_hash`, and for the same reason: the alias
        // and the file name are different strings.
        size_t length = 0;
        out.embedded = findEmbedded(file->file_path_hash(), &length) != nullptr && length > 0;
        return out;
      }
      // The list resolved and the file is not in it. No other list can hold it,
      // since the key named this one.
      return out;
    }
    return out;
  }

  /// The mask flags of part `index`, or an all-false set when out of range.
  ///
  /// These are the **static** half of masking:
  /// they are read once at load and never re-read, while `mask` / `priority` /
  /// `hide` come from `FrameData` every frame. Reading either from the wrong
  /// table is the mistake the split exists to prevent.
  SsMaskPartFlags maskFlagsAt(uint32_t index) const noexcept {
    SsMaskPartFlags out;
    const auto* v = root_ != nullptr ? root_->parts() : nullptr;
    if (v == nullptr || index >= v->size()) return out;

    const ss::format::PartData* part = v->Get(index);
    const ss::format::PartType type = part->part_type_type();
    // `draw_as_mask` is the ssab's single consolidated flag for the
    // per-type authoring settings on Shape / Text / Nines.
    out.pureMask = type == ss::format::PartType_PartTypeMask || part->draw_as_mask();
    out.maskWrite = part->mask_write();
    out.maskInfluence = part->mask_influence();
    out.visibleInsideMask = part->visible_inside_mask();
    // Every kind `SsBaker` emits geometry for: coverage is rasterised from the real
    // shape (a Shape's polygon, a Mesh's deformed triangles), not a bounding quad.
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
    // Embedded assets are keyed by the hash of the *file name*, not of the
    // cellmap name — the two differ, so the lookup goes through
    // `image_path_hash`.
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
    // name.
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
