require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

# Written next to the binaries by scripts/download-sdk.sh, so it cannot disagree
# with the libssruntime actually in native/. "unknown" means a local build.
version_file = File.join(__dir__, "native", "VERSION")
sdk_version = File.exist?(version_file) ? File.read(version_file).strip : "unknown"

# Drawing straight into RN Skia's SkCanvas needs RN Skia's own C++ (JsiSkCanvas) *and* the Skia headers it
# includes as "include/core/...". A `s.dependency` only gets us CocoaPods'
# flattened Public dir, which cannot satisfy those nested includes — so resolve
# the package directory and put its real roots on the search path. Walk upwards
# rather than assuming a path: npm may hoist it to the workspace root or keep it
# next to the consuming app, and pnpm links it into this package's own
# node_modules.
skia_dir = nil
probe = __dir__
while probe != "/" && skia_dir.nil?
  candidate = File.join(probe, "node_modules", "react-native-skia")
  skia_dir = candidate if File.directory?(File.join(candidate, "cpp", "skia", "include"))
  probe = File.dirname(probe)
end

skia_direct = !skia_dir.nil?
unless skia_direct
  Pod::UI.warn "[react-native-spritestudio] react-native-skia not found — " \
               "building without drawInto(), which is the only way to draw."
end

xcframework = File.join(__dir__, "native", "libs", "ios", "libssruntime.xcframework")
unless File.directory?(xcframework)
  raise <<~MSG
    [react-native-spritestudio] libssruntime.xcframework is missing.

    The Brain is never committed. Install it before
    `pod install` with either:

        scripts/download-sdk.sh                          # pinned release, no Rust needed
        scripts/build-runtime.sh platform=ios build=debug # from the submodule

    Expected at: #{xcframework}
  MSG
end

Pod::Spec.new do |s|
  s.name         = "SsPlayer"
  s.version      = package["version"]
  s.summary      = package["description"]
  s.homepage     = "https://github.com/cri-middleware/SSPlayerForReactNative"
  s.license      = { :type => package["license"], :file => "LICENSE.md" }
  s.authors      = "CRI Middleware"

  # React Native's own floor (scripts/cocoapods/helpers.rb): nothing that cannot
  # run RN can consume this pod.
  s.platforms    = { :ios => "15.1" }
  s.source       = { :git => "https://github.com/cri-middleware/SSPlayerForReactNative.git", :tag => "#{s.version}" }

  s.source_files = ["cpp/**/*.{h,hpp,c,cpp}"]

  # Static libssruntime.
  # A static archive means no embedded framework to sign and nothing extra to
  # ship in the app bundle beyond the code actually referenced.
  s.vendored_frameworks = "native/libs/ios/libssruntime.xcframework"

  # cbindgen's ssruntime.h, which cpp/ includes directly and so is load-bearing:
  # without a `download-sdk` / `build-runtime` run this fails at compile, naming
  # the missing header, instead of at link with an undefined symbol.
  header_search_paths = [
    "\"$(PODS_TARGET_SRCROOT)/native/include\"",
    # FlatBuffers, header-only: cpp/format/{ssab,framedata}.h (flatc output,
    # committed) pull in flatbuffers/flatbuffers.h and their reachable set is all
    # inline, so nothing links against flatc's own translation units and
    # flatbuffers/src stays off the path. The vendored version must match the
    # flatc that generated them — the headers static_assert on it.
    "\"$(PODS_TARGET_SRCROOT)/third_party/flatbuffers/include\"",
  ]
  if skia_direct
    header_search_paths += [
      "\"#{skia_dir}/cpp\"",       # JsiSkCanvas.h, JsiSkPaint.h
      "\"#{skia_dir}/cpp/api\"",   # their siblings, included unqualified
      "\"#{skia_dir}/cpp/skia\"",  # satisfies RN Skia's "include/core/..." includes
      "\"#{skia_dir}/cpp/dawn/include\"",  # webgpu_cpp.h, which JsiSkImage.h reaches through RNDawnContext.h
    ]
    s.dependency "react-native-skia"
  end

  # The defines react-native-skia compiles its own sources with. Skia's headers
  # declare the Graphite API only under SK_GRAPHITE, and the RN Skia headers
  # above include it, so every unit here sees Skia the way RN Skia does.
  skia_defines = skia_direct ?
    " SK_GRAPHITE=1 SK_IMAGE_READ_PIXELS_DISABLE_LEGACY_API=1 SK_DISABLE_LEGACY_SHAPER_FACTORY=1" : ""

  s.pod_target_xcconfig = {
    "HEADER_SEARCH_PATHS" => header_search_paths.join(" "),
    "GCC_PREPROCESSOR_DEFINITIONS" =>
      "$(inherited) SSPLAYER_SDK_VERSION=\\\"#{sdk_version}\\\" " \
      "SSPLAYER_ENABLE_SKIA_DIRECT=#{skia_direct ? 1 : 0}#{skia_defines}",
    # RN Skia's headers are C++17; Nitro's are C++20. C++20 compiles both.
    "CLANG_CXX_LANGUAGE_STANDARD" => "c++20",
    # Xcode's Release default is -Os, which leaves the bake's copy loops
    # unvectorised: half the speed of the -O2 Android builds with.
    "GCC_OPTIMIZATION_LEVEL[config=Release]" => "2",
  }

  load File.join(__dir__, "nitrogen/generated/ios/SsPlayer+autolinking.rb")
  add_nitrogen_files(s)

  s.dependency "React-jsi"
  s.dependency "React-callinvoker"
  install_modules_dependencies(s)
end
