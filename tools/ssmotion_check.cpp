// Pins when a root player keeps ticking: `ssplayer::SsAdvances`, the rule
// `HybridSsContext::advances()` answers with and Layer 3 gates `update()` on.
//
// A wrong answer fails one of two ways, and nothing on a device says which.
// Too narrow, and a pose that should move freezes: a source laid on track 0
// with `ss_runtime_add_track_source` runs on after track 0's own animation
// finishes, but a rule that reads only each track's main source stops ticking
// the player the moment track 0 ends. Too wide, and a player whose pose cannot
// change redraws every frame: a cleared track, a silenced one, or one weighted
// to nothing.
//
// Each case lays a stack, plays it until track 0 has finished, then compares
// the rule against what the Brain itself does on the next ticks: whether a
// source other than track 0's main one still moves its playhead.
//
// Usage: ssmotion_check [ssab] [once-animation] [loop-animation]
//   ssab            default: example/assets/ss/Ringo/Ringo.ssab
//   once-animation  default: attack1 — track 0's, played once; the shorter the faster
//   loop-animation  default: wait1 — laid on top, looping forever

#include <cstdint>
#include <cstdio>
#include <cstring>
#include <string>
#include <vector>

#include "SsAnimeBinary.hpp"
#include "ssruntime.h"
// After `ssruntime.h`, which it needs and does not include.
#include "SsTick.hpp"

namespace {

constexpr float kDeltaMs = 33.0f;
/// Long enough for any fixture animation to play once at 33 ms a tick.
constexpr int kMaxTicks = 10000;

int gFailures = 0;

void Fail(const std::string& message) {
  ++gFailures;
  std::fflush(stdout);
  std::fprintf(stderr, "FAIL: %s\n", message.c_str());
}

void Expect(bool actual, bool expected, const std::string& what) {
  std::printf("    %-58s %s\n", what.c_str(), actual ? "true" : "false");
  if (actual != expected) Fail(what + ": expected " + (expected ? "true" : "false"));
}

std::vector<uint8_t> ReadFile(const std::string& path) {
  std::FILE* file = std::fopen(path.c_str(), "rb");
  if (file == nullptr) return {};
  std::fseek(file, 0, SEEK_END);
  const long size = std::ftell(file);
  std::fseek(file, 0, SEEK_SET);
  std::vector<uint8_t> bytes(size > 0 ? static_cast<size_t>(size) : 0);
  const size_t read = bytes.empty() ? 0 : std::fread(bytes.data(), 1, bytes.size(), file);
  std::fclose(file);
  if (read != bytes.size()) return {};
  return bytes;
}

struct Fixture {
  void* resource = nullptr;
  const char* once = nullptr;
  const char* loop = nullptr;
};

/// A context with `once` on track 0, set to play a single time.
void* Begin(const Fixture& fx) {
  void* ctx = ss_runtime_create();
  if (ctx == nullptr || !ss_runtime_bind_resource(ctx, fx.resource) ||
      !ss_runtime_setup_animation(ctx, fx.once) || !ss_runtime_set_track_loop_count(ctx, 0, 1)) {
    Fail(std::string("cannot set up '") + fx.once + "'");
    if (ctx != nullptr) ss_runtime_destroy(ctx);
    return nullptr;
  }
  return ctx;
}

/// Plays until track 0 has finished. False if it never does.
bool PlayOut(void* ctx) {
  ss_runtime_play(ctx);
  for (int tick = 0; tick < kMaxTicks; ++tick) {
    if (ss_runtime_is_finished(ctx)) return true;
    ss_runtime_update(ctx, kDeltaMs);
  }
  Fail("track 0 never finished");
  return false;
}

/// Whether `source`'s playhead moves over the next few ticks.
bool SourceMoves(void* ctx, uint32_t source) {
  const float before = ss_runtime_get_source_frame(ctx, source);
  for (int tick = 0; tick < 3; ++tick) ss_runtime_update(ctx, kDeltaMs);
  return ss_runtime_get_source_frame(ctx, source) != before;
}

void CaseTrack0Source(const Fixture& fx) {
  std::printf("  a source added to track 0 runs on after track 0 finishes\n");
  void* ctx = Begin(fx);
  if (ctx == nullptr) return;
  const uint32_t source = ss_runtime_add_track_source(ctx, 0, fx.loop, 0.5f);
  if (source == SS_RUNTIME_INVALID_HANDLE) {
    Fail(std::string("cannot add '") + fx.loop + "' to track 0");
  } else if (PlayOut(ctx)) {
    Expect(ss_runtime_is_stack_in_motion(ctx), true, "the Brain: stack in motion");
    Expect(ssplayer::SsAdvances(ctx, false), true, "advances");
    Expect(SourceMoves(ctx, source), true, "the Brain: the added source moves");
  }
  ss_runtime_destroy(ctx);
}

/// `still` lays `loop` on track 1 and then silences it some way.
void CaseStill(const Fixture& fx, const char* what, bool (*still)(void* ctx, uint32_t main)) {
  std::printf("  %s\n", what);
  void* ctx = Begin(fx);
  if (ctx == nullptr) return;
  if (!ss_runtime_set_track_animation(ctx, 1, fx.loop)) {
    Fail(std::string("cannot lay '") + fx.loop + "' on track 1");
  } else if (!still(ctx, ss_runtime_get_track_main_source(ctx, 1))) {
    Fail(std::string(what) + ": the call failed");
  } else if (PlayOut(ctx)) {
    Expect(ssplayer::SsAdvances(ctx, false), false, "advances");
  }
  ss_runtime_destroy(ctx);
}

void CaseHeard(const Fixture& fx) {
  std::printf("  a heard overlay runs on after track 0 finishes, and a pause holds it\n");
  void* ctx = Begin(fx);
  if (ctx == nullptr) return;
  if (!ss_runtime_set_track_animation(ctx, 1, fx.loop)) {
    Fail(std::string("cannot lay '") + fx.loop + "' on track 1");
  } else if (PlayOut(ctx)) {
    Expect(ssplayer::SsAdvances(ctx, false), true, "advances");
    ss_runtime_pause(ctx);
    Expect(ssplayer::SsAdvances(ctx, false), false, "advances, paused");
    // A pause holds the stack, not an independent effect or instance: those
    // keep their own clock, here as on a track 0 that is still playing.
    Expect(ssplayer::SsAdvances(ctx, true), true, "advances, paused, with effect/instance parts");
    ss_runtime_resume(ctx);
    Expect(ssplayer::SsAdvances(ctx, false), true, "advances, resumed");
    ss_runtime_stop(ctx);
    Expect(ssplayer::SsAdvances(ctx, true), false, "advances, stopped");
  }
  ss_runtime_destroy(ctx);
}

void CaseFadeOut(const Fixture& fx) {
  std::printf("  an overlay faded out after track 0 finishes stops on the fade's last tick\n");
  void* ctx = Begin(fx);
  if (ctx == nullptr) return;
  if (!ss_runtime_set_track_animation(ctx, 1, fx.loop)) {
    Fail(std::string("cannot lay '") + fx.loop + "' on track 1");
  } else if (PlayOut(ctx) && ss_runtime_fade_track(ctx, 1, 0.0f, 4 * kDeltaMs)) {
    // Read before each update, as Layer 3 does: the tick that completes the
    // fade is still sent, and is the one that draws the track at alpha 0.
    int ticked = 0;
    while (ticked < 100 && ssplayer::SsAdvances(ctx, false)) {
      ss_runtime_update(ctx, kDeltaMs);
      ++ticked;
    }
    Expect(ticked == 4, true, "ticked exactly the fade's 4 ticks");
    Expect(ss_runtime_get_track_alpha(ctx, 1) == 0.0f, true, "the last tick reached alpha 0");
  }
  ss_runtime_destroy(ctx);
}

void CasePlaying(const Fixture& fx) {
  std::printf("  track 0 still playing: a pause holds it unless a part keeps its own clock\n");
  void* ctx = Begin(fx);
  if (ctx == nullptr) return;
  ss_runtime_play(ctx);
  Expect(ssplayer::SsAdvances(ctx, false), true, "advances");
  ss_runtime_pause(ctx);
  Expect(ssplayer::SsAdvances(ctx, false), false, "advances, paused");
  Expect(ssplayer::SsAdvances(ctx, true), true, "advances, paused, with effect/instance parts");
  ss_runtime_stop(ctx);
  Expect(ssplayer::SsAdvances(ctx, true), false, "advances, stopped");
  ss_runtime_destroy(ctx);
}

}  // namespace

int main(int argc, char** argv) {
  const char* ssabPath = argc > 1 ? argv[1] : "example/assets/ss/Ringo/Ringo.ssab";
  Fixture fx;
  fx.once = argc > 2 ? argv[2] : "attack1";
  fx.loop = argc > 3 ? argv[3] : "wait1";

  const std::vector<uint8_t> ssab = ReadFile(ssabPath);
  if (ssab.empty()) {
    std::fprintf(stderr, "cannot read %s\n", ssabPath);
    return 1;
  }
  const sscore::SsAnimeBinaryView view(ssab.data(), ssab.size());
  if (!view.valid()) {
    std::fprintf(stderr, "%s failed .ssab verification\n", ssabPath);
    return 1;
  }
  bool haveOnce = false;
  bool haveLoop = false;
  for (uint32_t i = 0; i < view.animationCount(); ++i) {
    haveOnce = haveOnce || view.animationName(i) == fx.once;
    haveLoop = haveLoop || view.animationName(i) == fx.loop;
  }
  if (!haveOnce || !haveLoop) {
    std::fprintf(stderr, "%s has no '%s' or '%s'; it has:\n", ssabPath, fx.once, fx.loop);
    for (uint32_t i = 0; i < view.animationCount(); ++i) {
      const std::string_view name = view.animationName(i);
      std::fprintf(stderr, "  %.*s\n", static_cast<int>(name.size()), name.data());
    }
    return 1;
  }

  fx.resource = ss_resource_create_copy(ssab.data(), ssab.size());
  if (fx.resource == nullptr) {
    std::fprintf(stderr, "ss_resource_create_copy failed for %s\n", ssabPath);
    return 1;
  }

  std::printf("%s: '%s' once on track 0, '%s' looping on top\n", ssabPath, fx.once, fx.loop);
  CasePlaying(fx);
  CaseTrack0Source(fx);
  CaseHeard(fx);
  CaseFadeOut(fx);
  CaseStill(fx, "a cleared overlay does not keep the player ticking",
            [](void* ctx, uint32_t) { return ss_runtime_clear_track(ctx, 1); });
  CaseStill(fx, "a silenced overlay (alpha 0) does not keep the player ticking",
            [](void* ctx, uint32_t) { return ss_runtime_set_track_alpha(ctx, 1, 0.0f); });
  CaseStill(fx, "an overlay weighted to 0 does not keep the player ticking",
            [](void* ctx, uint32_t main) { return ss_runtime_set_source_weight(ctx, main, 0.0f); });

  ss_resource_destroy(fx.resource);
  if (gFailures > 0) {
    std::fprintf(stderr, "ssmotion_check: %d failure(s)\n", gFailures);
    return 1;
  }
  std::printf("ssmotion_check: ok\n");
  return 0;
}
