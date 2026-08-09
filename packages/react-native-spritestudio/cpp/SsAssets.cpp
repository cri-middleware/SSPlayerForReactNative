#include "SsAssets.hpp"

#include <cstdio>
#include <stdexcept>

#if defined(__APPLE__)
#include <CoreFoundation/CoreFoundation.h>
#include <climits>
#elif defined(__ANDROID__)
#include <android/asset_manager.h>

#include <atomic>
#endif

namespace ssplayer {

namespace {

/// Collapses `.` and `..` and rejects anything that escapes the asset root.
///
/// `image_path` is authored relative to the `.ssae`, so `../images/common.png`
/// is an ordinary thing for a pack to contain and the joined path arrives here
/// with the `..` still in it. `AAssetManager_open` does not resolve one, and a
/// path that walks out of the root is a bug worth naming rather than an
/// `.app`-relative read of whatever is up there.
std::string Normalize(const std::string& path) {
  if (!path.empty() && path.front() == '/') {
    throw std::runtime_error("SsAssets: '" + path + "' is absolute, not asset-relative");
  }

  std::vector<std::string> parts;
  size_t at = 0;
  while (at <= path.size()) {
    const size_t slash = path.find('/', at);
    const size_t end = slash == std::string::npos ? path.size() : slash;
    const std::string part = path.substr(at, end - at);
    if (part == "..") {
      if (parts.empty()) {
        throw std::runtime_error("SsAssets: '" + path + "' escapes the asset root");
      }
      parts.pop_back();
    } else if (!part.empty() && part != ".") {
      parts.push_back(part);
    }
    if (slash == std::string::npos) break;
    at = slash + 1;
  }

  if (parts.empty()) {
    throw std::runtime_error("SsAssets: '" + path + "' names no file");
  }

  std::string normalized = parts.front();
  for (size_t i = 1; i < parts.size(); i++) normalized += "/" + parts[i];
  return normalized;
}

#if defined(__APPLE__)

/// The `.app`'s resources directory, which on iOS is the bundle itself.
///
/// Resolved once: `CFBundleGetMainBundle` is cheap but this is on the load path
/// of every texture, and the answer cannot change within a process.
const std::string& BundleResourceRoot() {
  static const std::string root = [] {
    CFBundleRef bundle = CFBundleGetMainBundle();
    if (bundle == nullptr) return std::string();
    CFURLRef url = CFBundleCopyResourcesDirectoryURL(bundle);
    if (url == nullptr) return std::string();

    char buffer[PATH_MAX];
    // `true` resolves against the base URL — the resources directory comes back
    // relative to the bundle on some platforms and absolute on others.
    const bool ok = CFURLGetFileSystemRepresentation(
        url, true, reinterpret_cast<UInt8*>(buffer), sizeof(buffer));
    CFRelease(url);
    return ok ? std::string(buffer) : std::string();
  }();
  return root;
}

#elif defined(__ANDROID__)

/// Set once from the JNI bootstrap, read from whatever thread loads a pack.
std::atomic<AAssetManager*> g_assetManager{nullptr};

#endif

}  // namespace

bool SsAssets::isAvailable() {
#if defined(__APPLE__)
  return !BundleResourceRoot().empty();
#elif defined(__ANDROID__)
  return g_assetManager.load(std::memory_order_acquire) != nullptr;
#else
  return false;
#endif
}

std::optional<std::string> SsAssets::filePath(const std::string& path) {
#if defined(__APPLE__)
  const std::string& root = BundleResourceRoot();
  if (root.empty()) return std::nullopt;
  return root + "/" + Normalize(path);
#else
  // Android keeps assets compressed inside the APK, and a platform with no
  // asset directory at all has nothing to offer either.
  (void)path;
  return std::nullopt;
#endif
}

#ifdef __ANDROID__

void SsAssets::setAssetManager(void* assetManager) {
  g_assetManager.store(static_cast<AAssetManager*>(assetManager), std::memory_order_release);
}

std::vector<uint8_t> SsAssets::read(const std::string& path) {
  AAssetManager* manager = g_assetManager.load(std::memory_order_acquire);
  if (manager == nullptr) {
    throw std::runtime_error(
        "SsAssets: no AssetManager yet, so '" + path +
        "' cannot be read. SsPlayerAssetBootstrap should have installed one at "
        "process start — is the library's AndroidManifest.xml being merged?");
  }

  const std::string normalized = Normalize(path);
  AAsset* asset = AAssetManager_open(manager, normalized.c_str(), AASSET_MODE_STREAMING);
  if (asset == nullptr) {
    throw std::runtime_error("SsAssets: no asset '" + normalized +
                             "' in the APK. Is the pack directory listed in the "
                             "config plugin's `assets`?");
  }

  const off64_t length = AAsset_getLength64(asset);
  if (length <= 0) {
    AAsset_close(asset);
    throw std::runtime_error("SsAssets: asset '" + normalized + "' is empty");
  }

  std::vector<uint8_t> bytes(static_cast<size_t>(length));
  // One read: AASSET_MODE_STREAMING keeps a compressed asset from being mapped
  // twice, and the whole file is wanted either way.
  size_t filled = 0;
  while (filled < bytes.size()) {
    const int read = AAsset_read(asset, bytes.data() + filled, bytes.size() - filled);
    if (read <= 0) break;
    filled += static_cast<size_t>(read);
  }
  AAsset_close(asset);

  if (filled != bytes.size()) {
    throw std::runtime_error("SsAssets: short read on asset '" + normalized + "'");
  }
  return bytes;
}

#else

std::vector<uint8_t> SsAssets::read(const std::string& path) {
  const std::optional<std::string> resolved = filePath(path);
  if (!resolved.has_value()) {
    throw std::runtime_error("SsAssets: this platform ships no asset directory, so '" +
                             path + "' cannot be read");
  }

  std::FILE* file = std::fopen(resolved->c_str(), "rb");
  if (file == nullptr) {
    throw std::runtime_error("SsAssets: cannot open '" + *resolved +
                             "'. Is the pack directory listed in the config "
                             "plugin's `assets`?");
  }
  std::fseek(file, 0, SEEK_END);
  const long size = std::ftell(file);
  if (size <= 0) {
    std::fclose(file);
    throw std::runtime_error("SsAssets: '" + *resolved + "' is empty");
  }
  std::fseek(file, 0, SEEK_SET);

  std::vector<uint8_t> bytes(static_cast<size_t>(size));
  const size_t read = std::fread(bytes.data(), 1, bytes.size(), file);
  std::fclose(file);
  if (read != bytes.size()) {
    throw std::runtime_error("SsAssets: short read on '" + *resolved + "'");
  }
  return bytes;
}

#endif

}  // namespace ssplayer
