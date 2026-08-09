package com.margelo.nitro.ssplayer

import android.content.Context
import android.content.res.AssetManager

/**
 * Hands the app's `AssetManager` down to C++, which is the only way the APK's
 * `assets/` can be read.
 *
 * A pack is a *directory* — a `.ssab` plus the textures, the child `.ssab`s an
 * Instance part reaches and the `.ssqb` that sequences them, all named relative
 * to each other. The build copies those directories into the APK (see
 * `plugin/`), and inside an APK they are compressed entries rather than files,
 * so `fopen` cannot see them and only `AAssetManager` can.
 *
 * Two halves, deliberately kept apart:
 *
 *  * [remember] runs from [SsPlayerAssetBootstrap] before `Application.onCreate`,
 *    and touches no native code. Loading `libSsPlayer.so` that early would mean
 *    pulling React Native's own libraries up before SoLoader has run.
 *  * [installNative] runs once the library is loaded, from `SsPlayerPackage`.
 *
 * Whichever happens last does the handover, so neither has to know about the
 * other's timing.
 *
 * The [assetManager] field is not a convenience: `AAssetManager_fromJava` hands
 * back a pointer that stays valid only while the Java object lives, and nothing
 * else in the process holds this one.
 */
internal object SsPlayerAssets {
  private var assetManager: AssetManager? = null
  private var libraryLoaded = false
  private var handedOver = false

  /** Captures the `AssetManager`. Safe before the native library exists. */
  @Synchronized
  fun remember(context: Context) {
    if (assetManager == null) assetManager = context.applicationContext.assets
    handOver()
  }

  /** Announces that `libSsPlayer.so` is loaded and the JNI entry point resolves. */
  @Synchronized
  fun installNative() {
    libraryLoaded = true
    handOver()
  }

  private fun handOver() {
    val assets = assetManager
    if (handedOver || !libraryLoaded || assets == null) return
    nativeSetAssetManager(assets)
    handedOver = true
  }

  /**
   * Implemented in `cpp/SsPlayerJni.cpp`.
   *
   * Not `@JvmStatic`: an ordinary member of a Kotlin `object` binds to a JNI
   * symbol taking the singleton in second position, which is the signature the
   * C++ side declares.
   */
  private external fun nativeSetAssetManager(assetManager: AssetManager)
}
