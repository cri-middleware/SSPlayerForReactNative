#pragma once

#include <cstddef>
#include <string>
#include <vector>

#include "HybridSsResourceSpec.hpp"

namespace margelo::nitro::ssplayer {

/// A loaded `.ssab`.
///
/// Owns two things: the file bytes (the Brain borrows or copies from them) and
/// the Brain-side resource handle. The bytes are kept alive for the handle's
/// whole life, which is the ch.9 F rule stated for `.ssab` data.
class HybridSsResource final : public HybridSsResourceSpec {
 public:
  /// Reads `path` and hands the bytes to the Brain. Throws `std::runtime_error`
  /// if the file cannot be read or the Brain rejects it — a Nitro method that
  /// throws surfaces in JS as an exception, which is what an unreadable asset
  /// path should be.
  explicit HybridSsResource(const std::string& path);
  ~HybridSsResource() override;

  double getByteLength() override { return static_cast<double>(bytes_.size()); }

  /// The Brain-side handle, for `HybridSsContext` to bind. Null after dispose.
  void* handle() const noexcept { return resource_; }

 private:
  std::vector<uint8_t> bytes_;
  void* resource_ = nullptr;
};

}  // namespace margelo::nitro::ssplayer
