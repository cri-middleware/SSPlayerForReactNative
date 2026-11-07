#pragma once

#include <cstdint>
#include <optional>
#include <string>
#include <vector>

namespace ssplayer {

/// The app's **native asset directory** — the one place a `.ssab` keeps the
/// layout it was converted in, so what it names can be found.
///
/// This exists because Metro cannot host a converter output directory. Metro
/// ships a dependency *graph*: `require()` names one file, and on an Android
/// release build the packager then flattens and lowercases what it named into
/// `res/`, so `dirname()` of a bundled asset points at nothing. Every reference
/// inside a pack — a cellmap's `image_path`, an `external_textures` entry, an
/// `external_instances` SSAB, a `.ssqb`'s `ref_anime_pack` — is a *name relative
/// to the pack*, so a Player that cannot open a directory cannot resolve any of them.
///
/// The build therefore copies the pack directories in out-of-band (the Expo
/// config plugin in `plugin/`), and this class is the read side:
///
///  * **Apple** — a folder inside the `.app`, so the assets are ordinary files
///    and `filePath()` answers. `createResourceFromAsset` then takes the
///    `fopen` route and the `.ssab` never enters the JS heap.
///  * **Android** — inside the APK, reachable only through `AAssetManager`.
///    `filePath()` returns nothing and everything goes through `read()`.
///
/// Paths are relative to the asset root, forward-slashed, and carry the pack
/// directory: `ss/overall/Basic.ssab`.
class SsAssets {
 public:
  /// A filesystem path for `path`, when the platform stores assets as files.
  /// `std::nullopt` on Android — see the class comment.
  ///
  /// Does **not** check that the file exists: the caller opens it next and its
  /// error message is the better one.
  static std::optional<std::string> filePath(const std::string& path);

  /// The asset's bytes. Throws `std::runtime_error` naming `path`.
  static std::vector<uint8_t> read(const std::string& path);

  /// Whether asset reads can work at all in this process.
  ///
  /// Always true on Apple. On Android it is false until the `AssetManager`
  /// arrives from Kotlin, which is what makes "the bootstrap did not run" a
  /// distinguishable failure from "the file is not there".
  static bool isAvailable();

#ifdef __ANDROID__
  /// Adopts the app's `AAssetManager`, called once from
  /// `SsPlayerAssets.nativeSetAssetManager`.
  ///
  /// The pointer stays valid only while the Java `AssetManager` it came from is
  /// alive, which is why the Kotlin side holds a strong reference to it for the
  /// process's lifetime rather than letting it be collected.
  static void setAssetManager(void* assetManager);
#endif
};

}  // namespace ssplayer
