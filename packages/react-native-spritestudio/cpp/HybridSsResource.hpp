#pragma once

#include <cstddef>
#include <cstdint>
#include <string>

#include "HybridSsResourceSpec.hpp"

namespace margelo::nitro::ssplayer {

/// A loaded `.ssab`.
///
/// Owns the Brain-side resource handle and nothing else: the bytes go in via
/// `ss_resource_create_copy`, so the Brain holds the only copy that has to
/// outlive this call and the ch.9 F lifetime coupling never arises.
class HybridSsResource final : public HybridSsResourceSpec {
 public:
  /// Reads `path` and hands the bytes to the Brain. Throws `std::runtime_error`
  /// if the file cannot be read or the Brain rejects it — a Nitro method that
  /// throws surfaces in JS as an exception, which is what an unreadable asset
  /// path should be.
  explicit HybridSsResource(const std::string& path);

  /// Same, from bytes JS already has. `origin` only names the source in error
  /// messages.
  HybridSsResource(const uint8_t* bytes, size_t byteLength, const std::string& origin);

  ~HybridSsResource() override;

  double getByteLength() override { return static_cast<double>(byteLength_); }

  /// The Brain-side handle, for `HybridSsContext` to bind. Null after dispose.
  void* handle() const noexcept { return resource_; }

 private:
  /// Hands `bytes` to the Brain and stores the handle, or throws naming
  /// `origin`. Both constructors funnel through here.
  void adopt(const uint8_t* bytes, size_t byteLength, const std::string& origin);

  size_t byteLength_ = 0;
  void* resource_ = nullptr;
};

}  // namespace margelo::nitro::ssplayer
