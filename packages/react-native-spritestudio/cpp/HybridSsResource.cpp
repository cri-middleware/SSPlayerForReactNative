#include "HybridSsResource.hpp"

#include "SsAnimeBinary.hpp"

#include <atomic>
#include <cstdio>
#include <stdexcept>
#include <vector>

#include "ssruntime.h"

namespace margelo::nitro::ssplayer {

namespace {

/// Live instances, for `SsRuntime.liveHandles`.
///
/// Relaxed ordering: this is a diagnostic counter, not a synchronisation point.
/// Nothing reads it to decide whether a handle is safe to touch — it is read to
/// compare against a baseline taken on the same thread — so the only guarantee
/// it needs is that the increments and decrements do not tear.
std::atomic<int32_t> gLiveResources{0};

std::vector<uint8_t> ReadWholeFile(const std::string& path) {
  std::FILE* file = std::fopen(path.c_str(), "rb");
  if (file == nullptr) {
    throw std::runtime_error("SsResource: cannot open '" + path + "'");
  }
  std::fseek(file, 0, SEEK_END);
  const long size = std::ftell(file);
  if (size <= 0) {
    std::fclose(file);
    throw std::runtime_error("SsResource: '" + path + "' is empty");
  }
  std::fseek(file, 0, SEEK_SET);

  std::vector<uint8_t> bytes(static_cast<size_t>(size));
  const size_t read = std::fread(bytes.data(), 1, bytes.size(), file);
  std::fclose(file);
  if (read != bytes.size()) {
    throw std::runtime_error("SsResource: short read on '" + path + "'");
  }
  return bytes;
}

}  // namespace

HybridSsResource::HybridSsResource(const std::string& path) : HybridObject(TAG) {
  const std::vector<uint8_t> bytes = ReadWholeFile(path);
  adopt(bytes.data(), bytes.size(), path);
}

HybridSsResource::HybridSsResource(const uint8_t* bytes, size_t byteLength,
                                   const std::string& origin)
    : HybridObject(TAG) {
  if (bytes == nullptr || byteLength == 0) {
    throw std::runtime_error("SsResource: '" + origin + "' is empty");
  }
  adopt(bytes, byteLength, origin);
}

int32_t HybridSsResource::liveCount() noexcept {
  return gLiveResources.load(std::memory_order_relaxed);
}

void HybridSsResource::adopt(const uint8_t* bytes, size_t byteLength,
                             const std::string& origin) {
  // Verified before the Brain sees the bytes, not after. libssruntime parses
  // with `root_as_..._unchecked` and its header states that invalid input is
  // undefined behaviour, so this is the boundary — and a `source` can be an
  // http(s) URL, which makes these bytes untrusted. The view is needed below
  // anyway, so the walk costs nothing extra.
  const sscore::SsAnimeBinaryView view(bytes, byteLength);
  if (!view.valid()) {
    throw std::runtime_error("SsResource: '" + origin +
                             "' is not a valid .ssab (failed verification)");
  }

  // `_copy` rather than `_borrow`: the Brain then owns the only copy that has
  // to survive this call, so neither the local buffer above nor a JS-owned
  // ArrayBuffer has to be kept alive alongside it. The copy happens once per
  // load, never per frame.
  resource_ = ss_resource_create_copy(bytes, byteLength);
  if (resource_ == nullptr) {
    throw std::runtime_error("SsResource: libssruntime rejected '" + origin +
                             "' — is it a .ssab from a matching SDK version?");
  }
  byteLength_ = byteLength;

  // The `.ssab`'s own identity and its instance manifest, read here because
  // this is the last moment the bytes are reachable: the Brain has taken its
  // copy and the C-API will not give one back. Both are tiny and both are
  // needed before any context exists — the pack walk that loads siblings runs
  // in JS, before `createContext`.
  packNameHash_ = view.packNameHash();
  for (const sscore::SsExternalPack& pack : view.externalInstancePacks()) {
    externalPackNames_.push_back(pack.name);
  }

  // Counted here rather than on entry to the constructor: everything above can
  // throw, and a constructor that throws never runs a destructor, so an earlier
  // increment would strand a count that no release ever balances — a leak check
  // that reports leaks of its own.
  gLiveResources.fetch_add(1, std::memory_order_relaxed);
}

void HybridSsResource::release() noexcept {
  if (resource_ == nullptr) return;
  // Safe even while contexts are still bound: the Brain refcounts internally
  // (see ss_runtime_bind_resource's "Lifetime Safety" note). That is what makes
  // an eager `dispose()` safe to expose at all — releasing here cannot pull the
  // `.ssab` out from under a context that is still playing it.
  ss_resource_destroy(resource_);
  resource_ = nullptr;
  // Handle gone means nothing is loaded, and `byteLength` describes what is
  // loaded. Keeping the old size would leave the only two observable properties
  // disagreeing about whether this resource still exists.
  byteLength_ = 0;
  gLiveResources.fetch_sub(1, std::memory_order_relaxed);
}

void HybridSsResource::dispose() { release(); }

HybridSsResource::~HybridSsResource() { release(); }

}  // namespace margelo::nitro::ssplayer
