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

#include <fbjni/fbjni.h>
#include <jni.h>

#include "SsPlayerOnLoad.hpp"

JNIEXPORT jint JNICALL JNI_OnLoad(JavaVM* vm, void*) {
  return facebook::jni::initialize(vm, []() { margelo::nitro::ssplayer::registerAllNatives(); });
}

#endif  // __ANDROID__
