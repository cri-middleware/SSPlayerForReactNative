#include "HybridSsContext.hpp"

#include <NitroModules/ArrayBuffer.hpp>

#include <stdexcept>

#include "ssruntime.h"
#include "SsSkiaDraw.hpp"

namespace margelo::nitro::ssplayer {

namespace {

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

template <typename T>
std::shared_ptr<ArrayBuffer> BorrowVector(const std::vector<T>& v) {
  return Borrow(v.data(), v.size() * sizeof(T));
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
}

HybridSsContext::~HybridSsContext() {
  if (ctx_ != nullptr) {
    ss_runtime_destroy(ctx_);
    ctx_ = nullptr;
  }
}

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
  unsigned char* fdPtr = nullptr;
  size_t fdLen = 0;
  ss_runtime_get_frame_data(ctx_, frameNo_, &fdPtr, &fdLen);
  frame_ = sscore::FrameDataView(fdPtr, fdLen);

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

SsFramePlan HybridSsContext::getPlan() {
  sscore::BuildBatchPlan(frame_, plan_);

  partAlpha_.resize(partCount_);
  for (size_t i = 0; i < partCount_; ++i) {
    partAlpha_[i] = frame_.partAlpha(static_cast<uint32_t>(i));
  }

  // `drawOrder` is a `uint16` vector inside the FlatBuffer, contiguous and
  // already in the layout JS wants — lend it in place rather than copying.
  const uint32_t drawOrderCount = frame_.drawOrderCount();
  const void* drawOrderData = nullptr;
  if (drawOrderCount > 0) {
    // FrameDataView deliberately exposes elements rather than the raw vector
    // pointer; take the address of element 0 the same way, so there is exactly
    // one place that knows the buffer layout.
    drawOrderData = frame_.drawOrderPtr();
  }

  return SsFramePlan(generation_, Borrow(drawOrderData, drawOrderCount * sizeof(uint16_t)),
                     BorrowVector(plan_), static_cast<double>(plan_.size()),
                     BorrowVector(partAlpha_));
}

SsSoAFrame HybridSsContext::getSoA() {
  const size_t n = partCount_;
  return SsSoAFrame(generation_, Borrow(soa_.worldMatrices, n * 16 * sizeof(float)),
                    Borrow(soa_.localVertices, n * 10 * sizeof(float)),
                    Borrow(soa_.localUvs, n * 10 * sizeof(float)),
                    Borrow(soa_.cellMeta, n * 6 * sizeof(float)));
}

SsBakedFrame HybridSsContext::bake() {
  baker_.bake(frame_, soa_);
  return SsBakedFrame(generation_, BorrowVector(baker_.positions()),
                      BorrowVector(baker_.texCoords()), BorrowVector(baker_.indices()),
                      BorrowVector(baker_.batches()),
                      static_cast<double>(baker_.vertexCount()),
                      static_cast<double>(baker_.indexCount()),
                      static_cast<double>(baker_.batches().size()));
}

double HybridSsContext::drawInto(SkCanvasHandle canvas,
                                 const std::vector<SsTextureBinding>& textures) {
  if (!::ssplayer::SkiaDirectAvailable()) {
    throw std::runtime_error(
        "SsContext.drawInto: this build has no direct Skia drawing "
        "(SSPLAYER_ENABLE_SKIA_DIRECT=0). Use bake() instead.");
  }
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
  return static_cast<double>(::ssplayer::DrawBakedFrame(
      canvas.canvas, paintBindings_.data(), paintBindings_.size(), baker_));
}

}  // namespace margelo::nitro::ssplayer
