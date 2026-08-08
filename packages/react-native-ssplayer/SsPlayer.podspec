require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

# Written next to the binaries by whichever of scripts/download-sdk.sh (the
# release tag) or scripts/build-runtime.sh ("<tag>+submodule-<sha>") installed
# them — so the version can never disagree with the libssruntime actually
# sitting in native/.
version_file = File.join(__dir__, "native", "VERSION")
sdk_version = File.exist?(version_file) ? File.read(version_file).strip : "unknown"

# Variant (c) needs RN Skia's own C++ (JsiSkCanvas) *and* the Skia headers it
# includes as "include/core/...". A `s.dependency` only gets us CocoaPods'
# flattened Public dir, which cannot satisfy those nested includes — so resolve
# the package directory and put its real roots on the search path. Walk upwards
# rather than assuming a path: npm may hoist it to the workspace root or keep it
# next to the consuming app.
skia_dir = nil
probe = __dir__
while probe != "/" && skia_dir.nil?
  candidate = File.join(probe, "node_modules", "@shopify", "react-native-skia")
  skia_dir = candidate if File.directory?(File.join(candidate, "cpp", "skia", "include"))
  probe = File.dirname(probe)
end

skia_direct = !skia_dir.nil?
unless skia_direct
  Pod::UI.warn "[react-native-ssplayer] @shopify/react-native-skia not found — " \
               "building without drawInto() (bake() still works)."
end

xcframework = File.join(__dir__, "native", "libs", "ios", "libssruntime.xcframework")
unless File.directory?(xcframework)
  raise <<~MSG
    [react-native-ssplayer] libssruntime.xcframework is missing.

    The Brain is never committed (design doc ch.7). Install it before
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

  s.platforms    = { :ios => "14.0" }
  s.source       = { :git => "https://github.com/cri-middleware/SSPlayerForReactNative.git", :tag => "#{s.version}" }

  s.source_files = ["cpp/**/*.{h,hpp,c,cpp}"]

  # Static libssruntime, matching the Unity and Godot Players (design doc ch.7).
  # A static archive means no embedded framework to sign and nothing extra to
  # ship in the app bundle beyond the code actually referenced.
  s.vendored_frameworks = "native/libs/ios/libssruntime.xcframework"

  header_search_paths = ["\"$(PODS_TARGET_SRCROOT)/native/include\""]
  if skia_direct
    header_search_paths += [
      "\"#{skia_dir}/cpp\"",       # JsiSkCanvas.h, JsiSkPaint.h
      "\"#{skia_dir}/cpp/api\"",   # their siblings, included unqualified
      "\"#{skia_dir}/cpp/skia\"",  # satisfies RN Skia's "include/core/..." includes
    ]
    s.dependency "react-native-skia"
  end

  s.pod_target_xcconfig = {
    # cbindgen's ssruntime.h. cpp/SsRuntimeApi.h redeclares what it needs, so
    # this is here for anything that wants the full header rather than being
    # load-bearing.
    "HEADER_SEARCH_PATHS" => header_search_paths.join(" "),
    "GCC_PREPROCESSOR_DEFINITIONS" =>
      "$(inherited) SSPLAYER_SDK_VERSION=\\\"#{sdk_version}\\\" " \
      "SSPLAYER_ENABLE_SKIA_DIRECT=#{skia_direct ? 1 : 0}",
    # RN Skia's headers are C++17; Nitro's are C++20. C++20 compiles both.
    "CLANG_CXX_LANGUAGE_STANDARD" => "c++20",
  }

  load File.join(__dir__, "nitrogen/generated/ios/SsPlayer+autolinking.rb")
  add_nitrogen_files(s)

  s.dependency "React-jsi"
  s.dependency "React-callinvoker"
  install_modules_dependencies(s)
end
