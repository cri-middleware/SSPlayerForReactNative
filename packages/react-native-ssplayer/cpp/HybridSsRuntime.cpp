#include "HybridSsRuntime.hpp"

#include <stdexcept>

#include "HybridSsContext.hpp"
#include "HybridSsResource.hpp"
#include "ssruntime.h"

namespace margelo::nitro::ssplayer {

std::string HybridSsRuntime::getVersion() {
  // Baked at compile time from the pinned SDK the package was built against.
  // The C-API has no version query, and the `.ssab` format is tied to the SDK
  // release (design doc ch.7 "version alignment"), so this is what the README's
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
