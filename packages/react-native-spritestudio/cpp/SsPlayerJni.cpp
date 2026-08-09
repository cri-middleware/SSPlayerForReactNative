// Android's entry point into this library.
//
// Nitrogen generates the registration (`registerAllNatives`, which hands each
// Hybrid Object's constructor to Nitro's registry) but deliberately not the
// `JNI_OnLoad` that calls it — see the instructions on `registerAllNatives` in
// `nitrogen/generated/android/SsPlayerOnLoad.hpp`. Without this file the library
// loads happily and then every `createHybridObject('SsRuntime')` throws, because
// nothing ever registered the constructor.
//
// iOS needs no equivalent: there the generated autolinking registers at static
// initialisation time.

// Guarded rather than excluded in the podspec, which globs `cpp/**/*.cpp` — a
// glob is the kind of thing that quietly starts matching again after an edit,
// and `fbjni/fbjni.h` does not exist on iOS.
#ifdef __ANDROID__

#include <android/asset_manager_jni.h>
#include <fbjni/fbjni.h>
#include <jni.h>

#include "SsAssets.hpp"
#include "SsPlayerOnLoad.hpp"

JNIEXPORT jint JNICALL JNI_OnLoad(JavaVM* vm, void*) {
  return facebook::jni::initialize(vm, []() { margelo::nitro::ssplayer::registerAllNatives(); });
}

// The other half of `SsPlayerAssets.kt`: hands over the app's `AssetManager` so
// C++ can open the pack directories the config plugin packed into the APK.
//
// Bound by name rather than registered through fbjni: one method, and nothing
// in its signature fbjni would help with. The `jobject` in second position is
// the Kotlin `object` singleton — an ordinary (non-`@JvmStatic`) member of an
// `object` compiles to an instance method — and is unused.
//
// `AAssetManager_fromJava` does not retain the Java object; keeping it alive is
// the caller's job, which is why the Kotlin side holds it in a field for the
// process's lifetime. Drop that field and this pointer dangles.
extern "C" JNIEXPORT void JNICALL
Java_com_margelo_nitro_ssplayer_SsPlayerAssets_nativeSetAssetManager(JNIEnv* env, jobject,
                                                                    jobject assetManager) {
  ssplayer::SsAssets::setAssetManager(AAssetManager_fromJava(env, assetManager));
}

#endif  // __ANDROID__
