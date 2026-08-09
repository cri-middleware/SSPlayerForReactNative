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

  /// Releases the Brain-side resource **now**, instead of whenever JS gets round
  /// to collecting this object.
  ///
  /// Overriding is not optional. Nitro's `HybridObject::dispose()` is a virtual
  /// **no-op** (`HybridObject.hpp`) — the base class only strips the JS object's
  /// NativeState and leaves the C++ object to the collector. Without this
  /// override every `dispose()` the layers above make a point of calling would
  /// release nothing at that moment, and the `.ssab`'s bytes would sit in the
  /// Brain until a GC that JS never promises to run. Idempotent; the destructor
  /// runs the same release.
  void dispose() override;

  /// The Brain-side handle, for `HybridSsContext` to bind. Null once released.
  void* handle() const noexcept { return resource_; }

  /// Instances currently holding a Brain handle. Backs `SsRuntime.liveHandles`.
  static int32_t liveCount() noexcept;

 private:
  /// Hands `bytes` to the Brain and stores the handle, or throws naming
  /// `origin`. Both constructors funnel through here.
  void adopt(const uint8_t* bytes, size_t byteLength, const std::string& origin);

  /// The one place the handle is given back. Guarded on the handle so the
  /// dispose-then-destruct path releases once and decrements once.
  void release() noexcept;

  size_t byteLength_ = 0;
  void* resource_ = nullptr;
};

}  // namespace margelo::nitro::ssplayer
