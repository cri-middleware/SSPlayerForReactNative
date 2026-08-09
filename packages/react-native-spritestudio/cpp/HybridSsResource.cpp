#include "HybridSsResource.hpp"

#include <cstdio>
#include <stdexcept>
#include <vector>

#include "ssruntime.h"

namespace margelo::nitro::ssplayer {

namespace {

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

void HybridSsResource::adopt(const uint8_t* bytes, size_t byteLength,
                             const std::string& origin) {
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
}

HybridSsResource::~HybridSsResource() {
  if (resource_ != nullptr) {
    // Safe even while contexts are still bound: the Brain refcounts internally
    // (see ss_runtime_bind_resource's "Lifetime Safety" note).
    ss_resource_destroy(resource_);
    resource_ = nullptr;
  }
}

}  // namespace margelo::nitro::ssplayer
