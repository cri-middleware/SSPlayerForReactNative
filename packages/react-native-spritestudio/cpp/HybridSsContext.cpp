#include "HybridSsContext.hpp"

#include <NitroModules/ArrayBuffer.hpp>

#include <atomic>
#include <stdexcept>

#include "ssruntime.h"
#include "SsSkiaDraw.hpp"

namespace margelo::nitro::ssplayer {

namespace {

/// Live instances, for `SsRuntime.liveHandles`. Relaxed for the same reason as
/// the resource counter: a diagnostic compared against a baseline, never a
/// decision about whether a pointer is safe to follow.
std::atomic<int32_t> gLiveContexts{0};

/// Wraps native memory in an ArrayBuffer **without copying and without taking
/// ownership** — the borrow semantics of ch.9 F, made explicit.
///
/// The no-op deleter is the whole point: the memory belongs to the Brain (or to
/// a vector on the context) and outlives this ArrayBuffer, which is a per-frame
/// throwaway. Handing Nitro a real deleter here would free memory the Brain is
/// still using the moment JS dropped its reference.
std::shared_ptr<ArrayBuffer> Borrow(const void* data, size_t byteLength) {
  if (data == nullptr || byteLength == 0) {
    // `wrap` requires a non-null pointer, and a zero-length ArrayBuffer is the
    // honest representation of "this frame has none of these".
    return ArrayBuffer::allocate(0);
  }
  return ArrayBuffer::wrap(
      static_cast<uint8_t*>(const_cast<void*>(data)), byteLength, []() {
        // Intentionally empty — see above.
      });
}

}  // namespace

HybridSsContext::HybridSsContext(const std::shared_ptr<HybridSsResource>& resource)
    : HybridObject(TAG), resource_(resource) {
  if (resource_ == nullptr || resource_->handle() == nullptr) {
    throw std::runtime_error("SsContext: resource is null or already disposed");
  }
  ctx_ = ss_runtime_create();
  if (ctx_ == nullptr) {
    throw std::runtime_error("SsContext: ss_runtime_create failed");
  }
  if (!ss_runtime_bind_resource(ctx_, resource_->handle())) {
    ss_runtime_destroy(ctx_);
    ctx_ = nullptr;
    throw std::runtime_error("SsContext: ss_runtime_bind_resource failed");
  }
  // Direct is the mode the SoA + DrawBatch contract is defined against; it also
  // stops the Brain serializing vertices/cells/deforms we never read.
  ss_runtime_set_render_mode(ctx_, 0);
  // Read once: these are PartData, so they are fixed for the life of the
  // resource. Re-reading them per frame would be the mistake the mask spec opens
  // by warning against — the animated `mask` / `hide` come from FrameData.
  maskFlags_ = ssab().maskFlags();
  // Last, after everything that can throw — a constructor that throws runs no
  // destructor, so an earlier increment would never be balanced.
  gLiveContexts.fetch_add(1, std::memory_order_relaxed);
}

int32_t HybridSsContext::liveCount() noexcept {
  return gLiveContexts.load(std::memory_order_relaxed);
}

void HybridSsContext::release() noexcept {
  if (ctx_ == nullptr) {
    // Nothing of ours to give back, but a constructor that threw after taking
    // the resource can still leave the shared_ptr held. Dropping it here keeps
    // "released" meaning the same thing on every path.
    resource_.reset();
    return;
  }

  ss_runtime_destroy(ctx_);
  ctx_ = nullptr;

  // Every one of these is a borrow reached *through* the context — the Brain's
  // FrameData and its SoA arrays — so they are dangling the instant it is gone.
  // Cleared rather than left, because the guards below test the pointer.
  frame_ = nullptr;
  soa_ = {};
  partCount_ = 0;
  frameNo_ = 0.0f;
  // Same signal an `update()` gives: anything JS is still holding from an
  // earlier frame is stale now. JS has one rule to follow, not a special case
  // for teardown.
  ++generation_;

  gLiveContexts.fetch_sub(1, std::memory_order_relaxed);

  // Dropped last, and deliberately after `ss_runtime_destroy`: the context is
  // bound to this resource, so the `.ssab` has to still be there while the
  // Brain unwinds it. This is also the release that makes the resource's own
  // refcount reach zero when the player owned the only reference.
  resource_.reset();
}

void HybridSsContext::dispose() { release(); }

HybridSsContext::~HybridSsContext() { release(); }

bool HybridSsContext::setupAnimation(const std::string& name) {
  if (ctx_ == nullptr) return false;
  if (!ss_runtime_setup_animation(ctx_, name.c_str())) return false;
  // setup_animation resets playback, so anything JS is still holding from the
  // previous animation is stale for the same reason a frame advance makes it
  // stale. Bump the generation and republish.
  ++generation_;
  frameNo_ = 0.0f;
  refreshFrame();
  return true;
}

double HybridSsContext::update(double dtMilliseconds) {
  if (ctx_ == nullptr) return 0.0;
  // Passed through unconverted: the C-API's delta is milliseconds, and so is
  // this spec's, deliberately — see the spec comment.
  frameNo_ = ss_runtime_update(ctx_, static_cast<float>(dtMilliseconds));
  ++generation_;
  refreshFrame();
  return static_cast<double>(frameNo_);
}

void HybridSsContext::resync() {
  if (ctx_ == nullptr) return;
  frameNo_ = ss_runtime_get_frame_no(ctx_);
  ++generation_;
  refreshFrame();
}

// --- transport -------------------------------------------------------------
//
// Read straight through rather than mirrored into members: the Brain is the
// only writer of the playback state, and a cached copy here would be a second
// answer to questions like "is this finished" that could disagree after any
// call that moves the playhead.

bool HybridSsContext::getIsPlaying() { return ctx_ != nullptr && ss_runtime_is_playing(ctx_); }
bool HybridSsContext::getIsPausing() { return ctx_ != nullptr && ss_runtime_is_pausing(ctx_); }
bool HybridSsContext::getIsFinished() { return ctx_ != nullptr && ss_runtime_is_finished(ctx_); }
bool HybridSsContext::getIsLooped() { return ctx_ != nullptr && ss_runtime_is_looped(ctx_); }
bool HybridSsContext::getSkipFrames() {
  return ctx_ != nullptr && ss_runtime_get_skip_frames(ctx_);
}

double HybridSsContext::getFps() {
  return ctx_ == nullptr ? 0.0 : static_cast<double>(ss_runtime_get_fps(ctx_));
}
double HybridSsContext::getStartFrame() {
  return ctx_ == nullptr ? 0.0 : static_cast<double>(ss_runtime_get_start_frame(ctx_));
}
double HybridSsContext::getEndFrame() {
  return ctx_ == nullptr ? 0.0 : static_cast<double>(ss_runtime_get_end_frame(ctx_));
}
double HybridSsContext::getLoops() {
  return ctx_ == nullptr ? 0.0 : static_cast<double>(ss_runtime_get_loops(ctx_));
}
double HybridSsContext::getRemainLoops() {
  return ctx_ == nullptr ? 0.0 : static_cast<double>(ss_runtime_get_remain_loops(ctx_));
}
double HybridSsContext::getPlaybackDirection() {
  return ctx_ == nullptr ? 0.0 : static_cast<double>(ss_runtime_get_playback_direction(ctx_));
}
double HybridSsContext::getPlaybackStyle() {
  return ctx_ == nullptr ? 0.0 : static_cast<double>(ss_runtime_get_playback_style(ctx_));
}

void HybridSsContext::play() {
  if (ctx_ == nullptr) return;
  ss_runtime_play(ctx_);
  resync();
}

void HybridSsContext::playFrom(double frameNo) {
  if (ctx_ == nullptr) return;
  ss_runtime_play_with_start_frame(ctx_, static_cast<float>(frameNo));
  resync();
}

void HybridSsContext::pause() {
  if (ctx_ == nullptr) return;
  // `ss_runtime_pause` is a *toggle* — `playback_controller.rs` is literally
  // `is_pausing = !is_pausing` — so calling it while already paused resumes.
  // Guarded, because a `pause()` that resumes on the second call is the wrong
  // shape for a declarative `playing` prop to drive.
  if (ss_runtime_is_pausing(ctx_)) return;
  ss_runtime_pause(ctx_);
  // Neither pause nor resume moves the playhead, so the published frame stands.
}

void HybridSsContext::resume() {
  if (ctx_ == nullptr) return;
  if (!ss_runtime_is_pausing(ctx_)) return;
  ss_runtime_pause(ctx_);
}

void HybridSsContext::stop() {
  if (ctx_ == nullptr) return;
  // Halts where it stands: `controller.stop()` only clears `is_playing`. No
  // rewind, so no resync either.
  ss_runtime_stop(ctx_);
}

void HybridSsContext::setFrameNo(double frameNo) {
  if (ctx_ == nullptr) return;
  ss_runtime_set_frame_no(ctx_, static_cast<float>(frameNo));
  resync();
}

void HybridSsContext::setLoop(double loops) {
  if (ctx_ == nullptr) return;
  ss_runtime_set_loop(ctx_, static_cast<int>(loops));
}

void HybridSsContext::setSpeed(double rate) {
  if (ctx_ == nullptr) return;
  ss_runtime_set_animation_speed(ctx_, static_cast<float>(rate));
}

void HybridSsContext::setPlaybackDirection(double direction, double style) {
  if (ctx_ == nullptr) return;
  ss_runtime_set_playback_direction(ctx_, static_cast<int>(direction), static_cast<int>(style));
}

void HybridSsContext::setSkipFrames(bool skip) {
  if (ctx_ == nullptr) return;
  ss_runtime_set_skip_frames(ctx_, skip);
}

void HybridSsContext::setSection(double startFrame, double endFrame) {
  if (ctx_ == nullptr) return;
  ss_runtime_set_animation_section(ctx_, static_cast<int>(startFrame),
                                   static_cast<int>(endFrame));
  // The section can clamp the playhead, so re-read rather than assume.
  resync();
}

double HybridSsContext::findPartIndex(const std::string& partName) {
  if (ctx_ == nullptr) return -1.0;
  return static_cast<double>(ss_runtime_find_part_index(ctx_, partName.c_str()));
}

sscore::SsAnimeBinaryView HybridSsContext::ssab() const {
  if (ctx_ == nullptr) return {};
  // Read straight out of the Brain's own copy. Nothing is copied here and
  // nothing is retained: the view is a pair of pointers into a buffer the bound
  // resource owns, built fresh for each of these load-time queries.
  return sscore::SsAnimeBinaryView(ss_runtime_get_ssab_buf(ctx_),
                                   ss_runtime_get_ssab_len(ctx_));
}

std::vector<SsTextureInfo> HybridSsContext::getTextures() {
  const sscore::SsAnimeBinaryView view = ssab();
  std::vector<SsTextureInfo> out;
  if (!view.valid()) return out;

  const uint32_t count = view.textureCount();
  out.reserve(count);
  for (uint32_t i = 0; i < count; ++i) {
    const sscore::SsTextureEntry entry = view.textureAt(i);
    out.emplace_back(static_cast<double>(entry.textureHash), std::string(entry.name),
                     std::string(entry.imagePath), static_cast<double>(entry.wrapMode),
                     static_cast<double>(entry.filterMode),
                     // Borrowed: the encoded bytes stay inside the Brain's
                     // buffer, which outlives this call.
                     Borrow(entry.embedded, entry.embeddedLength));
  }
  return out;
}

std::vector<std::string> HybridSsContext::getAnimationNames() {
  const sscore::SsAnimeBinaryView view = ssab();
  std::vector<std::string> out;
  if (!view.valid()) return out;

  const uint32_t count = view.animationCount();
  out.reserve(count);
  for (uint32_t i = 0; i < count; ++i) out.emplace_back(view.animationName(i));
  return out;
}

void HybridSsContext::refreshFrame() {
  // Every caller guards already, but `release()` can now run at any time JS
  // chooses rather than only at destruction, so the invariant is stated here
  // too instead of resting on all of them staying correct.
  if (ctx_ == nullptr) return;

  unsigned char* fdPtr = nullptr;
  size_t fdLen = 0;
  ss_runtime_get_frame_data(ctx_, frameNo_, &fdPtr, &fdLen);
  // No `flatbuffers::Verifier` here: it walks the whole buffer, and this runs
  // once per player per frame. The producer is the Brain, not untrusted input,
  // and `tools/ssbake_check.cpp` verifies every frame on the host under ASan —
  // which is where a malformed buffer should be caught, not on a device.
  frame_ = (fdPtr != nullptr && fdLen >= sizeof(flatbuffers::uoffset_t))
               ? ss::runtime::GetFrameData(fdPtr)
               : nullptr;

  size_t len = 0;
  ss_runtime_get_world_matrices(ctx_, &soa_.worldMatrices, &len);
  // 16 floats per part — the only SoA getter whose length divides cleanly into
  // a part count, so it is the one that defines it.
  partCount_ = len / 16;
  soa_.partCount = partCount_;
  ss_runtime_get_local_vertices(ctx_, &soa_.localVertices, &len);
  ss_runtime_get_local_uvs(ctx_, &soa_.localUvs, &len);
  ss_runtime_get_cell_meta(ctx_, &soa_.cellMeta, &len);

}

double HybridSsContext::drawInto(SkCanvasHandle canvas,
                                 const std::vector<SsTextureBinding>& textures) {
  if (!::ssplayer::SkiaDirectAvailable()) {
    throw std::runtime_error(
        "SsContext.drawInto: this build has no direct Skia drawing "
        "(SSPLAYER_ENABLE_SKIA_DIRECT=0) — there is no other way to draw.");
  }
  // After the build check, so a misconfigured build still says so rather than
  // being masked by a disposed player. Drawing nothing matches every other
  // method here; the alternative is baking from `frame_`/`soa_` pointers that
  // `release()` has already invalidated.
  if (ctx_ == nullptr) return 0.0;
  if (textures.empty()) return 0.0;

  // Repack rather than pass the Nitro structs through: SsSkiaDraw is shared with
  // the host harness and must not see Nitro's types. A pack has a handful of
  // cellmaps, so the copy is a few words on a member vector that is reused every
  // frame.
  paintBindings_.clear();
  paintBindings_.reserve(textures.size());
  for (const SsTextureBinding& binding : textures) {
    paintBindings_.push_back({static_cast<uint32_t>(binding.textureHash), binding.paint.paint});
  }

  // Same bake as variant (b) — the difference measured here is purely what
  // happens to the result, not how it is produced.
  baker_.bake(frame_, soa_);

  // Built off the baked quads, so a writer's coverage geometry is the very
  // geometry it would have drawn with. `build` returning false is the ordinary
  // case — most frames of most packs have no writer — and leaves the input
  // inactive, which skips the coverage pass entirely.
  ::ssplayer::SsMaskInput mask;
  if (!maskFlags_.empty() &&
      maskPlan_.build(frame_, baker_, maskFlags_.data(), maskFlags_.size())) {
    mask.plan = &maskPlan_;
    mask.flags = maskFlags_.data();
    mask.flagCount = maskFlags_.size();
  }

  return static_cast<double>(::ssplayer::DrawBakedFrame(
      canvas.canvas, paintBindings_.data(), paintBindings_.size(), baker_, mask));
}

}  // namespace margelo::nitro::ssplayer
