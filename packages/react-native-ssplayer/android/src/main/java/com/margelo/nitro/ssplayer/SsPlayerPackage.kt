package com.margelo.nitro.ssplayer

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider

/**
 * Registers nothing, and that is the point.
 *
 * Every Hybrid Object here is C++ (`{ ios: 'c++', android: 'c++' }`), so there is
 * no TurboModule for React Native to instantiate — `libSsPlayer.so` registers
 * them with Nitro from `JNI_OnLoad` the moment it is loaded. This class exists
 * for two reasons, neither of them module registration:
 *
 *  1. **It is what makes the package autolink at all.** Android autolinking
 *     resolves a dependency by looking for a `ReactPackage` implementation
 *     (`expo-modules-autolinking`'s `parseNativePackageClassNameAsync`, and the
 *     community CLI does the same). Without one there is no Gradle subproject
 *     and no native build — the module is silently skipped, which is exactly
 *     what was happening here before.
 *
 *     Mind the prose in this file. That lookup is a regex over the whole
 *     source rather than a parse, and it takes the *first* match — so an
 *     ordinary English sentence can hijack it and leave the generated
 *     `PackageList.java` instantiating a word lifted out of a comment. This
 *     comment has already done exactly that once.
 *  2. It gives `System.loadLibrary` somewhere to happen. Autolinking constructs
 *     this package at startup, so the `init` block below is the earliest hook
 *     that does not depend on JS touching the module first.
 */
class SsPlayerPackage : BaseReactPackage() {
  init {
    // Idempotent — `SsPlayerOnLoad` guards against a second load itself.
    SsPlayerOnLoad.initializeNative()
  }

  override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? = null

  override fun getReactModuleInfoProvider(): ReactModuleInfoProvider =
    ReactModuleInfoProvider { HashMap<String, ReactModuleInfo>() }
}
