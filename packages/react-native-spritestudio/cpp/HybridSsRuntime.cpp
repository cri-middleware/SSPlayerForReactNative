#include "HybridSsRuntime.hpp"

#include <optional>
#include <stdexcept>
#include <vector>

#include "HybridSsContext.hpp"
#include "HybridSsResource.hpp"
#include "SsAssets.hpp"
#include "ssruntime.h"

namespace margelo::nitro::ssplayer {

std::string HybridSsRuntime::getVersion() {
  // Baked at compile time from the pinned SDK the package was built against.
  // The C-API has no version query, and the `.ssab` format is tied to the SDK
  // release, so this is what the README's
  // compatibility table has to agree with.
  return SSPLAYER_SDK_VERSION;
}

std::shared_ptr<HybridSsResourceSpec> HybridSsRuntime::createResourceFromPath(
    const std::string& path) {
  return std::make_shared<HybridSsResource>(path);
}

std::shared_ptr<HybridSsResourceSpec> HybridSsRuntime::createResourceFromBytes(
    const std::shared_ptr<ArrayBuffer>& bytes) {
  if (bytes == nullptr) {
    throw std::runtime_error("SsRuntime.createResourceFromBytes: bytes is null");
  }
  // The ArrayBuffer is only borrowed for this call — `HybridSsResource` hands
  // the bytes to the Brain with `_copy`, so nothing outlives the return.
  return std::make_shared<HybridSsResource>(bytes->data(), bytes->size(), "<bytes>");
}

std::shared_ptr<HybridSsResourceSpec> HybridSsRuntime::createResourceFromAsset(
    const std::string& path) {
  // Prefer the file route where the platform has one (Apple): the `.ssab` then
  // goes disk → Brain without an intermediate buffer, which is the whole point
  // of `createResourceFromPath`. Android's assets live
  // inside the APK, so there the bytes have to be materialised first — still
  // never touching the JS heap, which is what this method exists for.
  if (const std::optional<std::string> file = ::ssplayer::SsAssets::filePath(path)) {
    return std::make_shared<HybridSsResource>(*file);
  }
  const std::vector<uint8_t> bytes = ::ssplayer::SsAssets::read(path);
  return std::make_shared<HybridSsResource>(bytes.data(), bytes.size(), path);
}

std::shared_ptr<ArrayBuffer> HybridSsRuntime::readAsset(const std::string& path) {
  // Owning, not borrowed: unlike the per-frame buffers this is a one-off read
  // whose bytes JS holds onto (a texture, decoded by Skia after the call), so
  // there is nothing native for it to alias.
  return ArrayBuffer::move(::ssplayer::SsAssets::read(path));
}

bool HybridSsRuntime::getHasAssetDirectory() {
  return ::ssplayer::SsAssets::isAvailable();
}

SsLiveHandles HybridSsRuntime::getLiveHandles() {
  // Read from the two classes that own the handles rather than tracked here:
  // this object is a stateless factory, and a count it maintained itself would
  // be a second answer that could disagree with the destructors.
  return SsLiveHandles(static_cast<double>(HybridSsResource::liveCount()),
                       static_cast<double>(HybridSsContext::liveCount()));
}

std::shared_ptr<HybridSsContextSpec> HybridSsRuntime::createContext(
    const std::shared_ptr<HybridSsResourceSpec>& resource) {
  // The spec types the parameter as the *interface*, but only our own concrete
  // resource carries a Brain handle. A cross-module Hybrid Object of the right
  // shape would sail through the type check and then be useless, so reject it
  // here with a message rather than dereferencing a null handle later.
  auto concrete = std::dynamic_pointer_cast<HybridSsResource>(resource);
  if (concrete == nullptr) {
    throw std::runtime_error("SsRuntime.createContext: not an SsResource from this module");
  }
  return std::make_shared<HybridSsContext>(concrete);
}

double HybridSsRuntime::hashString(const std::string& value) {
  // uint32 → double is exact, so the hash survives the trip through a JS number
  // and can be compared against `DrawBatch.texture_hash` without masking.
  return static_cast<double>(ss_runtime_hash_string(value.c_str()));
}

}  // namespace margelo::nitro::ssplayer
