#pragma once

#include <cstdarg>
#include <cstdio>

#if defined(__ANDROID__)
#include <android/log.h>
#endif

namespace ssplayer {

/// A warning for the developer, written where the platform's log is.
///
/// Not `stderr` on Android: an app's stderr goes to /dev/null there. Every
/// caller is reporting a fault the draw survives by drawing less than was
/// authored — a shader that would not compile, mask writers past the limit — so
/// on Android the part would simply look wrong, with nothing in logcat to say why.
/// Elsewhere stderr is where it is read: the Xcode console and the host checks.
///
/// One line per call; `format` carries no trailing newline.
#if defined(__GNUC__) || defined(__clang__)
__attribute__((format(printf, 1, 2)))
#endif
inline void SsWarn(const char* format, ...) {
  va_list args;
  va_start(args, format);
#if defined(__ANDROID__)
  __android_log_vprint(ANDROID_LOG_WARN, "SsPlayer", format, args);
#else
  std::fputs("[SsPlayer] ", stderr);
  std::vfprintf(stderr, format, args);
  std::fputc('\n', stderr);
#endif
  va_end(args);
}

}  // namespace ssplayer
