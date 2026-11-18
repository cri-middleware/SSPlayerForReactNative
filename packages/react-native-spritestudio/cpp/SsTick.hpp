#pragma once

// Whether a root player's `update()` can change what it draws.
//
// Header-only and free of Nitro so `tools/ssmotion_check.cpp` can run it
// against the host Brain: what it decides is when a player stops ticking, and a
// wrong answer either freezes a pose that should move or redraws one that
// cannot.
//
// Include `ssruntime.h` before this header: it uses the C-API and does not
// include it itself.

namespace ssplayer {

/// Whether `ss_runtime_update` can change what the player draws, read **before**
/// it: the tick that completes a fade or plays an overlay out is still sent,
/// and is the one that draws where it ended.
///
/// The character's clock, not `ss_runtime_is_playing`, which is track 0's and
/// goes false when track 0 finishes while the clock runs on for the rest of the
/// stack. After that only the stack moves the pose, and the Brain is what says
/// whether it does: a copy kept here would miss a source laid on track 0, which
/// would freeze the moment track 0 ended, and count a silenced or zero-weight
/// overlay, which would redraw a pose that could not change.
///
/// `hasSlots`: the player has an effect or instance part. A pause holds the
/// stack but not those, which keep their own clock.
inline bool SsAdvances(void* ctx, bool hasSlots) {
  if (ctx == nullptr || !ss_runtime_is_clock_playing(ctx)) return false;
  if (!ss_runtime_is_playing(ctx) && !ss_runtime_is_stack_in_motion(ctx)) return false;
  return !ss_runtime_is_clock_pausing(ctx) || hasSlots;
}

/// Whether this tick moves the pose for a reason other than track 0's frame
/// changing. Read before `ss_runtime_update`, for the reason `SsAdvances` is.
inline bool SsStackMovesPose(void* ctx) {
  return ss_runtime_is_stack_in_motion(ctx) && !ss_runtime_is_clock_pausing(ctx);
}

}  // namespace ssplayer
