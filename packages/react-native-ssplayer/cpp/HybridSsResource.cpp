#include "HybridSsResource.hpp"

#include <cstdio>
#include <stdexcept>

#include "SsRuntimeApi.h"

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

HybridSsResource::HybridSsResource(const std::string& path)
    : HybridObject(TAG), bytes_(ReadWholeFile(path)) {
  // `_copy` rather than `_borrow`: the Brain then owns its own copy and the
  // lifetime coupling to `bytes_` stops mattering. The extra copy happens once
  // per load, never per frame. (`bytes_` is still kept so `byteLength` can
  // report the on-disk size, which the README's app-size numbers want.)
  resource_ = ss_resource_create_copy(bytes_.data(), bytes_.size());
  if (resource_ == nullptr) {
    throw std::runtime_error("SsResource: libssruntime rejected '" + path +
                             "' — is it a .ssab from a matching SDK version?");
  }
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
