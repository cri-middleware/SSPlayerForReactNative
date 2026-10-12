#pragma once

#include <memory>
#include <string>

#include "HybridSsRuntimeSpec.hpp"

namespace margelo::nitro::ssplayer {

/// The module root — the one autolinked Hybrid Object, and the factory for
/// everything else. Stateless: the Brain keeps no global state that needs
/// initialising or tearing down.
class HybridSsRuntime final : public HybridSsRuntimeSpec {
 public:
  HybridSsRuntime() : HybridObject(TAG) {}

  std::string getVersion() override;

  std::shared_ptr<HybridSsResourceSpec> createResourceFromPath(const std::string& path) override;
  std::shared_ptr<HybridSsResourceSpec> createResourceFromBytes(
      const std::shared_ptr<ArrayBuffer>& bytes) override;
  std::shared_ptr<HybridSsResourceSpec> createResourceFromAsset(const std::string& path) override;
  std::shared_ptr<HybridSsContextSpec> createContext(
      const std::shared_ptr<HybridSsResourceSpec>& resource) override;

  std::shared_ptr<ArrayBuffer> readAsset(const std::string& path) override;
  bool getHasAssetDirectory() override;
  SsLiveHandles getLiveHandles() override;

  double hashString(const std::string& value) override;
  std::shared_ptr<Promise<void>> decodeImage(SkImageHandle image) override;
};

}  // namespace margelo::nitro::ssplayer
