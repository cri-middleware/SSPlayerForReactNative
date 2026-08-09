#pragma once

// A read-only view over the Brain's FrameData FlatBuffer.
//
// Hand-rolled rather than flatc-generated on purpose:
//
//  1. `30_core/30_render_loop.md` §2 tells Players to read the fixed-size struct
//     vectors (`parts`, `draw_batches`) straight off the pointer instead of
//     going through per-element accessors — so the generated accessors would be
//     bypassed on the hot path anyway.
//  2. Generating them would drag the flatbuffers headers into every consumer's
//     iOS/Android build for two vector lookups and a handful of field reads.
//
// The cost of hand-rolling is that the offsets below must track framedata.fbs.
// `tools/ssbake_check.cpp` is the guard: it diffs this reader against the
// flatc-generated accessors over a real `.ssab`, which is the roundtrip
// self-check §2 recommends (a size check alone would miss a same-size field
// reordering).
//
// Schema: SpriteStudio-SDK/libs/ssruntime/fbs/framedata.fbs

#include <cstddef>
#include <cstdint>
#include <cstring>

namespace sscore {

// --- framedata.fbs mirror -------------------------------------------------
// Sizes and offsets taken from flatc's own C++ output (`FLATBUFFERS_STRUCT_END`
// and the private field order). Little-endian only, which every target we
// support is.

/// `table FrameData` vtable slots. Slot = 4 + fieldId * 2.
enum FrameDataSlot : uint16_t {
  kSlotParts = 4,
  kSlotDrawOrder = 16,
  kSlotDrawBatches = 18,
};

/// `struct PartState` — 144 bytes.
struct PartStateLayout {
  static constexpr size_t kSize = 144;
  static constexpr size_t kAlpha = 48;   // float
  static constexpr size_t kHide = 138;   // uint8
};

/// `struct DrawBatch` — 16 bytes.
struct DrawBatchLayout {
  static constexpr size_t kSize = 16;
  static constexpr size_t kStartRank = 0;    // uint16
  static constexpr size_t kCount = 2;        // uint16
  static constexpr size_t kTextureHash = 4;  // uint32
  static constexpr size_t kVertexCount = 8;  // uint16
  static constexpr size_t kIndexCount = 10;  // uint16
  static constexpr size_t kBlendType = 12;   // uint8
  static constexpr size_t kKind = 13;        // uint8
  static constexpr size_t kFlags = 14;       // uint8
};

/// `enum DrawBatchKind`.
enum class DrawBatchKind : uint8_t {
  Normal = 0,
  Shape = 1,
  Instance = 2,
  Effect = 3,
  Mesh = 4,
  Text = 5,
  Nines = 6,
  Mask = 7,
};

// --- unaligned little-endian reads ----------------------------------------
// FlatBuffers guarantees natural alignment for its own scalars, but a `uint32`
// read through a cast is still UB if the compiler cannot prove the alignment,
// and it faults outright on the stricter ARM configurations. memcpy compiles
// away to a single load.

template <typename T>
inline T ReadAt(const uint8_t* base, size_t offset) noexcept {
  T value;
  std::memcpy(&value, base + offset, sizeof(T));
  return value;
}

/// One `DrawBatch`, decoded.
struct DrawBatchView {
  uint16_t startRank;
  uint16_t count;
  uint32_t textureHash;
  uint16_t vertexCount;
  uint16_t indexCount;
  uint8_t blendType;
  DrawBatchKind kind;
  uint8_t flags;
};

/// Non-owning view over a `FrameData` buffer. Valid only as long as the buffer
/// is — which, for the Brain's frame data, means until the next `update()`.
class FrameDataView {
 public:
  FrameDataView() = default;

  /// `buf` / `len` come from `ss_runtime_get_frame_data`. Returns a view whose
  /// `valid()` is false if the buffer is too small to hold a root table.
  FrameDataView(const uint8_t* buf, size_t len) noexcept : buf_(buf), len_(len) {
    if (buf == nullptr || len < 8) {
      buf_ = nullptr;
      return;
    }
    // Root: uoffset32 from the start of the buffer to the table.
    const uint32_t rootOffset = ReadAt<uint32_t>(buf_, 0);
    if (rootOffset + 4 > len_) {
      buf_ = nullptr;
      return;
    }
    table_ = buf_ + rootOffset;
    // A table starts with a *signed* offset backwards to its vtable.
    const int32_t vtableDelta = ReadAt<int32_t>(table_, 0);
    vtable_ = table_ - vtableDelta;
    if (vtable_ < buf_ || vtable_ + 4 > buf_ + len_) {
      buf_ = nullptr;
      return;
    }
    vtableSize_ = ReadAt<uint16_t>(vtable_, 0);
  }

  bool valid() const noexcept { return buf_ != nullptr; }

  /// Number of `PartState` entries — i.e. the part count for this animation.
  uint32_t partCount() const noexcept { return vectorLength(kSlotParts); }

  /// `alpha` of one part. Returns 1.0f for an out-of-range index so a caller
  /// that trusts a stale part count degrades to "opaque" instead of reading
  /// past the vector.
  float partAlpha(uint32_t partIndex) const noexcept {
    const uint8_t* v = vectorData(kSlotParts);
    if (v == nullptr || partIndex >= vectorLength(kSlotParts)) return 1.0f;
    return ReadAt<float>(v, partIndex * PartStateLayout::kSize + PartStateLayout::kAlpha);
  }

  bool partHidden(uint32_t partIndex) const noexcept {
    const uint8_t* v = vectorData(kSlotParts);
    if (v == nullptr || partIndex >= vectorLength(kSlotParts)) return true;
    return ReadAt<uint8_t>(v, partIndex * PartStateLayout::kSize + PartStateLayout::kHide) != 0;
  }

  uint32_t drawOrderCount() const noexcept { return vectorLength(kSlotDrawOrder); }

  /// First element of the `draw_order` vector, for lending it to JS as a
  /// `Uint16Array` without a copy. Null when the frame has no draw order.
  /// The elements are contiguous `uint16` in buffer order, so a typed-array
  /// view over them needs no reinterpretation.
  const uint16_t* drawOrderPtr() const noexcept {
    return reinterpret_cast<const uint16_t*>(vectorData(kSlotDrawOrder));
  }

  /// Part index at `rank` in draw order.
  uint16_t drawOrderAt(uint32_t rank) const noexcept {
    const uint8_t* v = vectorData(kSlotDrawOrder);
    if (v == nullptr || rank >= vectorLength(kSlotDrawOrder)) return 0;
    return ReadAt<uint16_t>(v, rank * sizeof(uint16_t));
  }

  uint32_t drawBatchCount() const noexcept { return vectorLength(kSlotDrawBatches); }

  DrawBatchView drawBatchAt(uint32_t index) const noexcept {
    DrawBatchView out{};
    const uint8_t* v = vectorData(kSlotDrawBatches);
    if (v == nullptr || index >= vectorLength(kSlotDrawBatches)) return out;
    const size_t base = index * DrawBatchLayout::kSize;
    out.startRank = ReadAt<uint16_t>(v, base + DrawBatchLayout::kStartRank);
    out.count = ReadAt<uint16_t>(v, base + DrawBatchLayout::kCount);
    out.textureHash = ReadAt<uint32_t>(v, base + DrawBatchLayout::kTextureHash);
    out.vertexCount = ReadAt<uint16_t>(v, base + DrawBatchLayout::kVertexCount);
    out.indexCount = ReadAt<uint16_t>(v, base + DrawBatchLayout::kIndexCount);
    out.blendType = ReadAt<uint8_t>(v, base + DrawBatchLayout::kBlendType);
    out.kind = static_cast<DrawBatchKind>(ReadAt<uint8_t>(v, base + DrawBatchLayout::kKind));
    out.flags = ReadAt<uint8_t>(v, base + DrawBatchLayout::kFlags);
    return out;
  }

 private:
  /// Byte offset of a field within the table, or 0 when the field is absent.
  /// FlatBuffers writes 0 for "not present", and a vtable shorter than the slot
  /// means the same thing (the schema grew after this buffer was written).
  uint16_t fieldOffset(uint16_t slot) const noexcept {
    if (!valid() || slot + 2 > vtableSize_) return 0;
    return ReadAt<uint16_t>(vtable_, slot);
  }

  /// Start of a vector's elements (past its length prefix), or null.
  const uint8_t* vectorData(uint16_t slot) const noexcept {
    const uint16_t field = fieldOffset(slot);
    if (field == 0) return nullptr;
    const uint8_t* fieldPtr = table_ + field;
    // Vector fields hold a uoffset32 relative to the field's own position.
    const uint32_t rel = ReadAt<uint32_t>(fieldPtr, 0);
    return fieldPtr + rel + 4;  // +4 skips the length prefix
  }

  uint32_t vectorLength(uint16_t slot) const noexcept {
    const uint16_t field = fieldOffset(slot);
    if (field == 0) return 0;
    const uint8_t* fieldPtr = table_ + field;
    const uint32_t rel = ReadAt<uint32_t>(fieldPtr, 0);
    return ReadAt<uint32_t>(fieldPtr, rel);
  }

  const uint8_t* buf_ = nullptr;
  size_t len_ = 0;
  const uint8_t* table_ = nullptr;
  const uint8_t* vtable_ = nullptr;
  uint16_t vtableSize_ = 0;
};

}  // namespace sscore
