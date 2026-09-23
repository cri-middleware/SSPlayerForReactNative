#include "HybridSsContext.hpp"

#include <NitroModules/ArrayBuffer.hpp>

#include <atomic>
#include <cmath>
#include <limits>
#include <stdexcept>

#include "ssruntime.h"
#include "SsSkiaDraw.hpp"

namespace margelo::nitro::ssplayer {

namespace {

/// Live instances, for `SsRuntime.liveHandles`. Relaxed for the same reason as
/// the resource counter: a diagnostic compared against a baseline, never a
/// decision about whether a pointer is safe to follow.
std::atomic<int32_t> gLiveContexts{0};

}  // namespace

HybridSsContext::HybridSsContext(const std::shared_ptr<HybridSsResource>& resource)
    : HybridSsContext(resource, {}) {}

HybridSsContext::HybridSsContext(const std::shared_ptr<HybridSsResource>& resource,
                                 std::vector<SsInstancePackEntry> packs)
    : HybridObject(TAG), resource_(resource), instancePacks_(std::move(packs)) {
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
  // Y-down, because Skia's canvas is. The Brain owns the flip — it mirrors the
  // whole hierarchy once, at the source (position_y, rotation_z and pivot_y) —
  // so everything downstream reads one consistent space: the baked geometry, the
  // world matrices `getPartTransform` decomposes, and the box `measureContentBox`
  // accumulates. Doing it in the root transform instead, as this used to, left
  // those three disagreeing: the draw came out right way up while every matrix
  // handed to a caller was still Y-up. ForWeb, ForFlutter, ForGodot and ForRenPy
  // all set it here for the same reason.
  ss_runtime_set_coordinate_system(ctx_, 1);
  // Read once: these are PartData, so they are fixed for the life of the
  // resource. Re-reading them per frame would be the mistake the mask spec opens
  // by warning against — the animated `mask` / `hide` come from FrameData.
  // The one view this context ever builds — see `ssab_`. Verified here, on the
  // Brain's copy of a pack `adopt()` already gated, because a view that skipped
  // the verifier would be a second path for every reader below to trust.
  ssab_ = sscore::SsAnimeBinaryView(ss_runtime_get_ssab_buf(ctx_),
                                    ss_runtime_get_ssab_len(ctx_));
  maskFlags_ = ssab_.maskFlags();
  // Same reasoning as the flags, one kind further: the effect bindings are
  // PartData too. The slots borrow `resource_`, which is why `release()`
  // destroys them before it lets go of it.
  effects_.bind(resource_->handle(), ssab_);
  // Last, after everything that can throw — a constructor that throws runs no
  // destructor, so an earlier increment would never be balanced.
  gLiveContexts.fetch_add(1, std::memory_order_relaxed);
}

int32_t HybridSsContext::liveCount() noexcept {
  return gLiveContexts.load(std::memory_order_relaxed);
}

// --- instance children -------------------------------------------------------

std::shared_ptr<HybridSsResource> HybridSsContext::resolvePack(uint32_t packNameHash) const {
  for (const SsInstancePackEntry& entry : instancePacks_) {
    if (entry.nameHash == packNameHash) return entry.resource;
  }
  if (packNameHash == 0 || packNameHash == ssab().packNameHash()) return resource_;
  return nullptr;
}

bool HybridSsContext::bindInstancePack(const std::shared_ptr<HybridSsResourceSpec>& spec) {
  const auto pack = std::dynamic_pointer_cast<HybridSsResource>(spec);
  if (pack == nullptr || pack->handle() == nullptr) return false;
  // After the children exist the binding can no longer reach them, and silently
  // accepting it would leave the parts that wanted this pack undrawn with
  // nothing to say why.
  if (instancesBuilt_) return false;
  const uint32_t hash = pack->packNameHash();
  for (const SsInstancePackEntry& entry : instancePacks_) {
    // Not an error: one pack can satisfy references from several places, and a
    // caller walking the manifest transitively will meet it more than once.
    if (entry.nameHash == hash) return true;
  }
  instancePacks_.push_back({hash, pack});
  return true;
}

void HybridSsContext::buildInstanceChildren() {
  if (instancesBuilt_ || ctx_ == nullptr) return;
  instancesBuilt_ = true;

  const sscore::SsAnimeBinaryView view = ssab();
  if (!view.valid()) return;

  instances_.build(view, [&](const sscore::SsInstancePart& part) -> sscore::SsInstanceChild* {
    const std::shared_ptr<HybridSsResource> resource = resolvePack(part.packNameHash);
    // An unresolved pack means the child is simply never drawn — the same
    // fail-safe as an invisible slot, and the shape an unbound external pack
    // takes before Stage B's `bindInstancePack` has run.
    if (resource == nullptr || resource->handle() == nullptr) return nullptr;

    HybridSsContext* child = nullptr;
    try {
      child = new HybridSsContext(resource, instancePacks_);
    } catch (const std::exception&) {
      // The Brain refused a context for this resource. One dead mount is better
      // than a load that throws and takes the whole animation with it.
      return nullptr;
    }
    if (!child->setupAnimation(part.animeName)) {
      delete child;
      return nullptr;
    }
    return child;
  });
}

void HybridSsContext::release() noexcept {
  if (ctx_ == nullptr) {
    // Nothing of ours to give back, but a constructor that threw after taking
    // the resource can still leave the shared_ptr held. Dropping it here keeps
    // "released" meaning the same thing on every path.
    resource_.reset();
    return;
  }

  // Before the context and before the resource: a slot was created against the
  // resource and its plan buffer is the slot's own, so both are dangling the
  // moment either goes. The children go first of all — each is a whole player
  // holding its own context, and one of them may be holding *this* resource.
  instances_.release();
  effects_.release();

  ss_runtime_destroy(ctx_);
  ctx_ = nullptr;

  // Every one of these is a borrow reached *through* the context — the Brain's
  // FrameData and its SoA arrays, and the `.ssab` view — so they are dangling
  // the instant it is gone. Cleared rather than left, because the guards below
  // test the pointer.
  ssab_ = {};
  frame_ = nullptr;
  soa_ = {};
  partCount_ = 0;
  frameNo_ = 0.0f;
  animationIndex_ = -1;
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

std::string HybridSsContext::lastErrorMessage() {
  if (ctx_ == nullptr) return {};
  const int32_t code = ss_runtime_get_last_error(ctx_);
  if (code == 0) return {};
  // A static string in the runtime — nothing to free, and nothing to outlive,
  // unlike the frame buffers this ABI lends out until the next call.
  const char* text = ss_runtime_error_message(code);
  return text == nullptr ? std::string{} : std::string{text};
}

bool HybridSsContext::setupAnimation(const std::string& name) {
  if (ctx_ == nullptr) return false;
  if (!ss_runtime_setup_animation(ctx_, name.c_str())) return false;
  // setup_animation resets playback, so anything JS is still holding from the
  // previous animation is stale for the same reason a frame advance makes it
  // stale. Bump the generation and republish.
  ++generation_;
  frameNo_ = 0.0f;
  animationIndex_ = ssab().animationIndex(name);
  // A different animation has different `EventEffect` keys, so each slot's
  // memory of the last key it started is about a timeline that no longer
  // exists — without this the first key of the new animation is debounced as
  // one already played and the effect never fires.
  effects_.reset();
  // Built on the first `setupAnimation` and reset on every later one, for the
  // same reason the effect slots are: a new animation has different
  // `EventInstance` keys, so each slot's memory of the last key it started is
  // about a timeline that no longer exists.
  buildInstanceChildren();
  instances_.reset();
  refreshFrame();
  stepEffects(0.0f, false);
  instances_.step(ctx_, frameNo_, 0.0f, false);
  return true;
}

double HybridSsContext::update(double dtMilliseconds) {
  if (ctx_ == nullptr) return 0.0;
  // Passed through unconverted: the C-API's delta is milliseconds, and so is
  // this spec's, deliberately — see the spec comment.
  frameNo_ = ss_runtime_update(ctx_, static_cast<float>(dtMilliseconds));
  ++generation_;
  refreshFrame();
  // Read *after* the update: `is_looped` is cleared at the top of each one, so
  // what it reports here is this tick's loop **edge**, which is what re-arms a
  // synced effect. Read before, it would be the previous tick's.
  const bool looped = ss_runtime_just_looped(ctx_);
  stepEffects(static_cast<float>(dtMilliseconds), looped);
  instances_.step(ctx_, frameNo_, static_cast<float>(dtMilliseconds), looped);
  return static_cast<double>(frameNo_);
}

void HybridSsContext::resync() {
  if (ctx_ == nullptr) return;
  frameNo_ = ss_runtime_get_frame_no(ctx_);
  ++generation_;
  refreshFrame();
  // A seek moves the playhead with no time passing, so the slots are stepped
  // with a zero delta: a synced effect re-derives its frame from the parent's
  // and lands on the new pose, while an independent one ignores the parent
  // frame and a zero delta leaves its own clock exactly where it was — which is
  // what "independent" means. Not a loop edge, whatever the playhead did.
  stepEffects(0.0f, false);
  instances_.step(ctx_, frameNo_, 0.0f, false);
}

void HybridSsContext::stepEffects(float dtMilliseconds, bool looped) {
  if (ctx_ == nullptr || effects_.empty()) return;
  // The *animation's* authored fps, which is what converts an independent
  // slot's delta into frames — not the display's refresh rate.
  const int32_t fps = ss_runtime_get_frame_rate(ctx_);
  effects_.step(ctx_, frameNo_, dtMilliseconds / 1000.0f,
                fps > 0 ? static_cast<float>(fps) : 60.0f, looped);
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
bool HybridSsContext::getJustLooped() { return ctx_ != nullptr && ss_runtime_just_looped(ctx_); }
// True with no context: forward is the resting state, and reporting backward for
// a player that is not playing would gate audio off on its very first frame.
bool HybridSsContext::getIsPlayingForward() { return ctx_ == nullptr || ss_runtime_is_playing_forward(ctx_); }
bool HybridSsContext::getSkipFrames() {
  return ctx_ != nullptr && ss_runtime_get_skip_frames(ctx_);
}

double HybridSsContext::getFrameRate() {
  return ctx_ == nullptr ? 0.0 : static_cast<double>(ss_runtime_get_frame_rate(ctx_));
}
double HybridSsContext::getStartFrame() {
  return ctx_ == nullptr ? 0.0 : static_cast<double>(ss_runtime_get_start_frame(ctx_));
}
double HybridSsContext::getEndFrame() {
  return ctx_ == nullptr ? 0.0 : static_cast<double>(ss_runtime_get_end_frame(ctx_));
}
double HybridSsContext::getSpeedScale() {
  // The STORED rate, not the requested one: the Brain clamps 0 and negatives to
  // a stop, and reading back the request would tell a host it got reverse
  // playback when the playhead is frozen.
  return ctx_ == nullptr ? 1.0 : static_cast<double>(ss_runtime_get_speed_scale(ctx_));
}
double HybridSsContext::getLoopCount() {
  return ctx_ == nullptr ? 0.0 : static_cast<double>(ss_runtime_get_loop_count(ctx_));
}
double HybridSsContext::getRemainingLoops() {
  return ctx_ == nullptr ? 0.0 : static_cast<double>(ss_runtime_get_remaining_loops(ctx_));
}
double HybridSsContext::getPlaybackDirection() {
  return ctx_ == nullptr ? 0.0 : static_cast<double>(ss_runtime_get_playback_direction(ctx_));
}
double HybridSsContext::getPlaybackStyle() {
  return ctx_ == nullptr ? 0.0 : static_cast<double>(ss_runtime_get_playback_style(ctx_));
}

// Both of these are an explicit head-out — `play()` rewinds — so each slot's
// "last key I started" memory has to go with it. Without the rewind the slot
// debounces the animation's first `EventEffect` as the one it is already
// playing, and a replayed animation never re-fires its effect.

void HybridSsContext::play() {
  if (ctx_ == nullptr) return;
  ss_runtime_play(ctx_);
  effects_.reset();
  instances_.reset();
  resync();
}

void HybridSsContext::playFrom(double frameNo) {
  if (ctx_ == nullptr) return;
  ss_runtime_play_with_start_frame(ctx_, static_cast<float>(frameNo));
  effects_.reset();
  instances_.reset();
  resync();
}

void HybridSsContext::pause() {
  if (ctx_ == nullptr) return;
  // One-way and idempotent on the C-API side, and ignored while nothing is
  // playing, so this needs no guard: the runtime used to publish a *toggle*
  // (`is_pausing = !is_pausing`), which is the wrong shape for a declarative
  // `playing` prop to drive, and it was split into pause / resume.
  ss_runtime_pause(ctx_);
  // Neither pause nor resume moves the playhead, so the published frame stands.
}

void HybridSsContext::resume() {
  if (ctx_ == nullptr) return;
  ss_runtime_resume(ctx_);
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

void HybridSsContext::setLoopCount(double loops) {
  if (ctx_ == nullptr) return;
  ss_runtime_set_loop_count(ctx_, static_cast<int>(loops));
}

void HybridSsContext::setSpeedScale(double rate) {
  if (ctx_ == nullptr) return;
  ss_runtime_set_speed_scale(ctx_, static_cast<float>(rate));
}

void HybridSsContext::setPlaybackDirection(double direction, double style) {
  if (ctx_ == nullptr) return;
  ss_runtime_set_playback_direction(ctx_, static_cast<int>(direction), static_cast<int>(style));
}

void HybridSsContext::setSkipFrames(bool skip) {
  if (ctx_ == nullptr) return;
  ss_runtime_set_skip_frames(ctx_, skip);
}

void HybridSsContext::setFrameRate(double fps) {
  if (ctx_ == nullptr) return;
  ss_runtime_set_frame_rate(ctx_, static_cast<int>(fps));
}

void HybridSsContext::setSubFrame(bool enabled) {
  subFrame_ = enabled;
  // Down the whole tree. An instance child is drawn at its own playhead by its
  // own `refreshFrame`, so leaving it out would draw the children between
  // authored frames while the root sat on them.
  for (const sscore::SsInstanceState& state : instances_.states()) {
    if (state.child != nullptr) {
      static_cast<HybridSsContext*>(state.child)->setSubFrame(enabled);
    }
  }
  // What is already on screen was resolved under the old setting.
  refreshFrame();
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

void HybridSsContext::accumulateSubtreeBox(float box[4], const float m[6]) {
  if (ctx_ == nullptr) return;

  // The same bake the draw does, minus the drawing. `alphaScale` is 1 because
  // opacity does not move a vertex, and a fully transparent part still occupies
  // the box it would occupy if it were visible — hiding is a per-frame state and
  // this is measuring the extent over every frame.
  baker_.bake(frame_, soa_, effects_.frame(), 1.0f);

  const std::vector<float>& p = baker_.positions();
  for (size_t i = 0; i + 1 < p.size(); i += 2) {
    const float x = m[0] * p[i] + m[2] * p[i + 1] + m[4];
    const float y = m[1] * p[i] + m[3] * p[i + 1] + m[5];
    if (x < box[0]) box[0] = x;
    if (y < box[1]) box[1] = y;
    if (x > box[2]) box[2] = x;
    if (y > box[3]) box[3] = y;
  }

  for (const sscore::SsInstanceDraw& mount : baker_.instances()) {
    const sscore::SsInstanceState* state = instances_.stateFor(mount.partIndex);
    if (state == nullptr || state->child == nullptr) continue;
    // `m ∘ mount.m`, so a grandchild composes the same way — which is what makes
    // this the measuring twin of `drawInstance`'s `canvas.concat`.
    const float c[6] = {
        m[0] * mount.m[0] + m[2] * mount.m[1], m[1] * mount.m[0] + m[3] * mount.m[1],
        m[0] * mount.m[2] + m[2] * mount.m[3], m[1] * mount.m[2] + m[3] * mount.m[3],
        m[0] * mount.m[4] + m[2] * mount.m[5] + m[4],
        m[1] * mount.m[4] + m[3] * mount.m[5] + m[5],
    };
    // Not gated on `state->visible`: an instance hidden on this frame is drawn
    // on another, and the box is the union over all of them.
    static_cast<HybridSsContext*>(state->child)->accumulateSubtreeBox(box, c);
  }
}

SsBox HybridSsContext::measureContentBox(const std::vector<std::string>& animations,
                                         double maxFrames) {
  float box[4] = {std::numeric_limits<float>::infinity(), std::numeric_limits<float>::infinity(),
                  -std::numeric_limits<float>::infinity(),
                  -std::numeric_limits<float>::infinity()};
  if (ctx_ == nullptr) return SsBox(0.0, 0.0, 0.0, 0.0);

  static constexpr float kIdentity[6] = {1.0f, 0.0f, 0.0f, 1.0f, 0.0f, 0.0f};

  for (const std::string& name : animations) {
    if (!setupAnimation(name)) continue;

    // Looping and playing, because `setup_animation` leaves the transport
    // stopped and a walk that forgets this measures frame 0 N times — the trap
    // CONTRIBUTING.md warns about, and which `ssbake_check` itself shipped with
    // for a whole phase.
    ss_runtime_set_loop_count(ctx_, -1);
    ss_runtime_play(ctx_);

    const int32_t fps = ss_runtime_get_frame_rate(ctx_);
    const float stepMs = 1000.0f / (fps > 0 ? static_cast<float>(fps) : 60.0f);
    int32_t frames = static_cast<int32_t>(maxFrames);
    if (frames <= 0) {
      // One authored cycle. Inclusive of both ends, and at least one frame so a
      // single-frame animation still gets measured.
      frames = ss_runtime_get_end_frame(ctx_) - ss_runtime_get_start_frame(ctx_) + 1;
      if (frames <= 0) frames = 1;
    }

    // Frame 0 before any advance: `play()` rewound to the start frame, and that
    // pose is part of the animation even for a one-frame one.
    accumulateSubtreeBox(box, kIdentity);
    for (int32_t f = 1; f < frames; ++f) {
      update(stepMs);
      accumulateSubtreeBox(box, kIdentity);
    }
  }

  if (box[0] > box[2] || box[1] > box[3]) return SsBox(0.0, 0.0, 0.0, 0.0);
  return SsBox(static_cast<double>(box[0]), static_cast<double>(box[1]),
               static_cast<double>(box[2] - box[0]), static_cast<double>(box[3] - box[1]));
}

SsPartTransform HybridSsContext::getPartTransform(double partIndex) {
  const auto index = static_cast<size_t>(partIndex);
  if (ctx_ == nullptr || soa_.worldMatrices == nullptr || partIndex < 0 ||
      index >= partCount_) {
    return SsPartTransform(false, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0);
  }

  // Column-major 4x4, of which a 2D placement needs six: `x' = m0*x + m4*y + m12`.
  const float* m = soa_.worldMatrices + index * 16;
  const float a = m[0], b = m[1], c = m[4], d = m[5];

  // Length of each mapped basis vector. `scaleY` carries the sign of the
  // determinant so that a mirrored part reads as a negative scale on one axis
  // rather than as a 180-degree rotation, which is the decomposition every
  // caller placing a view expects.
  const float determinant = a * d - b * c;
  const float scaleX = std::sqrt(a * a + b * b);
  const float scaleYMagnitude = std::sqrt(c * c + d * d);
  const float scaleY = determinant < 0.0f ? -scaleYMagnitude : scaleYMagnitude;

  return SsPartTransform(true, static_cast<double>(m[12]), static_cast<double>(m[13]),
                         static_cast<double>(std::atan2(b, a)),
                         static_cast<double>(scaleX), static_cast<double>(scaleY),
                         static_cast<double>(determinant));
}

bool HybridSsContext::isPartHidden(double partIndex) {
  // The DISPLAY frame, which `refreshFrame()` already floored when sub-frame is
  // off — so this reads the same frame the baker drew and cannot disagree with
  // what is on screen. `frame_` is null before the first update, which is the
  // one case where "not hidden" is a guess rather than a reading; a caller that
  // needs to tell the two apart has `findPartIndex` for existence, and the
  // frame itself only starts existing once something has played.
  if (ctx_ == nullptr || frame_ == nullptr || partIndex < 0) return false;
  const auto* parts = frame_->parts();
  if (parts == nullptr) return false;
  const auto index = static_cast<size_t>(partIndex);
  if (index >= parts->size()) return false;
  // The parts vector is `num_parts` long and ordered by part index — the same
  // indexing the SoA getters use — so `index` addresses this part directly.
  return parts->Get(static_cast<::flatbuffers::uoffset_t>(index))->hide();
}

bool HybridSsContext::isPartSkinnedMesh(double partIndex) {
  // A static `.ssab` property, so it reads the binary view rather than the
  // Brain's per-frame SoA — the same split `partNames` follows, and it answers
  // before the first `update()` for the same reason. Out of range is false.
  if (partIndex < 0) return false;
  const sscore::SsAnimeBinaryView view = ssab();
  return view.valid() && view.isPartSkinnedMesh(static_cast<uint32_t>(partIndex));
}

double HybridSsContext::getPassedEventCount() {
  if (ctx_ == nullptr) return 0.0;
  return static_cast<double>(ss_runtime_get_passed_event_count(ctx_));
}

std::vector<SsUserDataEvent> HybridSsContext::getUserDataEvents() {
  std::vector<SsUserDataEvent> out;
  if (ctx_ == nullptr || animationIndex_ < 0) return out;

  const int32_t count = ss_runtime_get_passed_event_count(ctx_);
  if (count <= 0) return out;

  const sscore::SsAnimeBinaryView view = ssab();
  if (!view.valid()) return out;

  for (int32_t i = 0; i < count; ++i) {
    const ss::format::EventsPerFrame* frame =
        view.eventsAt(animationIndex_, ss_runtime_get_passed_event_index(ctx_, i));
    if (frame == nullptr) continue;
    const auto* users = frame->users();
    if (users == nullptr) continue;

    for (uint32_t u = 0; u < users->size(); ++u) {
      const ss::format::EventUserData* entry = users->Get(u);
      const ss::format::PartAttributeUserData* value = entry->value();
      if (value == nullptr) continue;

      // Four independent payloads, each optional — a flatbuffers table field
      // that was never written reads back as null, which is exactly the
      // distinction the `has*` flags carry up. `integer: 0` is a value an
      // author can mean, so absence cannot be encoded as a zero.
      const auto* integer = value->integer();
      const ss::format::Vec2* point = value->point();
      const ss::format::Bounds* rect = value->rect();
      const auto* text = value->str();

      out.push_back(SsUserDataEvent(
          static_cast<double>(entry->part_index()),
          std::string(view.partName(entry->part_index())),
          static_cast<double>(frame->frame_index()), integer != nullptr,
          integer != nullptr ? static_cast<double>(integer->value()) : 0.0, point != nullptr,
          point != nullptr ? static_cast<double>(point->v1()) : 0.0,
          point != nullptr ? static_cast<double>(point->v2()) : 0.0, rect != nullptr,
          rect != nullptr ? SsBox(static_cast<double>(rect->left()),
                                  static_cast<double>(rect->top()),
                                  static_cast<double>(rect->right() - rect->left()),
                                  static_cast<double>(rect->bottom() - rect->top()))
                          : SsBox(0.0, 0.0, 0.0, 0.0),
          text != nullptr, text != nullptr ? text->str() : std::string()));
    }
  }
  return out;
}

std::vector<SsAudioEvent> HybridSsContext::getAudioEvents() {
  std::vector<SsAudioEvent> out;
  if (ctx_ == nullptr || animationIndex_ < 0) return out;

  const int32_t count = ss_runtime_get_passed_event_count(ctx_);
  if (count <= 0) return out;

  const sscore::SsAnimeBinaryView view = ssab();
  if (!view.valid()) return out;

  for (int32_t i = 0; i < count; ++i) {
    const ss::format::EventsPerFrame* frame =
        view.eventsAt(animationIndex_, ss_runtime_get_passed_event_index(ctx_, i));
    if (frame == nullptr) continue;
    // A frame carries whichever event tables were authored on it, so the count
    // that gated this call says "some event", not "an audio event" — every
    // frame here can legitimately have no `audios` at all.
    const auto* audios = frame->audios();
    if (audios == nullptr) continue;

    for (uint32_t a = 0; a < audios->size(); ++a) {
      const ss::format::EventAudio* entry = audios->Get(a);
      const ss::format::PartAttributeAudio* value = entry->value();
      if (value == nullptr) continue;

      // Resolved here rather than handed up as two hashes, because the table
      // that answers it is in the `.ssab` and the `.ssab` never reaches JS.
      // A miss leaves the resolved fields empty and keeps the key itself, so a
      // host that names its own audio is unaffected by the pack's list being
      // incomplete.
      const sscore::SsSoundEntry sound =
          view.soundFile(value->sound_list_name_hash(), value->sound_name_hash());
      const auto* alias = value->sound_name();

      out.push_back(SsAudioEvent(
          static_cast<double>(entry->part_index()),
          std::string(view.partName(entry->part_index())),
          static_cast<double>(frame->frame_index()),
          alias != nullptr ? alias->str() : std::string(),
          static_cast<double>(value->sound_list_name_hash()),
          static_cast<double>(value->sound_name_hash()),
          static_cast<double>(value->loop_num()),
          std::string(sound.filePath), static_cast<double>(sound.totalMs),
          sound.embedded));
    }
  }
  return out;
}

std::vector<SsSignalEvent> HybridSsContext::getSignalEvents() {
  std::vector<SsSignalEvent> out;
  if (ctx_ == nullptr || animationIndex_ < 0) return out;

  const int32_t count = ss_runtime_get_passed_event_count(ctx_);
  if (count <= 0) return out;

  const sscore::SsAnimeBinaryView view = ssab();
  if (!view.valid()) return out;

  for (int32_t i = 0; i < count; ++i) {
    const ss::format::EventsPerFrame* frame =
        view.eventsAt(animationIndex_, ss_runtime_get_passed_event_index(ctx_, i));
    if (frame == nullptr) continue;
    const auto* signals = frame->signals();
    if (signals == nullptr) continue;

    for (uint32_t s = 0; s < signals->size(); ++s) {
      const ss::format::EventSignal* entry = signals->Get(s);
      const ss::format::PartAttributeSignal* value = entry->value();
      if (value == nullptr) continue;
      // A disabled signal is a command left in the timeline, not one that
      // fired. Every sibling Player drops these, and reporting them would make
      // "the animator switched it off" indistinguishable from "it ran".
      if (!value->active()) continue;

      std::vector<SsSignalParam> params;
      const auto* authored = value->params();
      if (authored != nullptr) {
        params.reserve(authored->size());
        for (uint32_t p = 0; p < authored->size(); ++p) {
          const ss::format::SignalCommandParam* param = authored->Get(p);
          const auto* id = param->param_id();

          bool boolValue = false;
          int32_t intValue = 0;
          float floatValue = 0.0f;
          std::string textValue;

          // **Read by the union tag, report the authored type**, because the two
          // enums are not the same numbering: FlatBuffers prepends an implicit
          // `NONE = 0` to a union, so `SignalCommandParamValue` runs one ahead
          // of `SignalCommandParamType` all the way along. The tag is the only
          // thing that says which member is actually stored, and `type()` is
          // what an author picked — switching on the wrong one reads a `Bool`
          // as an `Index` and still compiles.
          switch (param->value_type()) {
            case ss::format::SignalCommandParamValue_Bool:
              if (const auto* e = param->value_as_Bool()) boolValue = e->value();
              break;
            case ss::format::SignalCommandParamValue_Index:
              if (const auto* e = param->value_as_Index()) intValue = e->value();
              break;
            case ss::format::SignalCommandParamValue_Integer:
              if (const auto* e = param->value_as_Integer()) intValue = e->value();
              break;
            case ss::format::SignalCommandParamValue_Floating:
              if (const auto* e = param->value_as_Floating()) floatValue = e->value();
              break;
            case ss::format::SignalCommandParamValue_Text:
              if (const auto* e = param->value_as_Text()) {
                const auto* text = e->value();
                if (text != nullptr) textValue = text->str();
              }
              break;
            // `None` is an authored "left unset", and the union's own `NONE` is
            // a member that was never written. Neither carries a value, and the
            // reported `type` already tells them apart.
            default:
              break;
          }

          params.push_back(SsSignalParam(id != nullptr ? id->str() : std::string(),
                                         static_cast<double>(param->type()), boolValue,
                                         static_cast<double>(intValue),
                                         static_cast<double>(floatValue), textValue));
        }
      }

      const auto* command = value->command_id();
      out.push_back(SsSignalEvent(static_cast<double>(entry->part_index()),
                                  std::string(view.partName(entry->part_index())),
                                  static_cast<double>(frame->frame_index()),
                                  command != nullptr ? command->str() : std::string(),
                                  std::move(params)));
    }
  }
  return out;
}

// --- the override layer ------------------------------------------------------
//
// Straight through to the Brain's own override layer. Nothing is mirrored here:
// the Brain applies these while it evaluates the frame, so a copy up here would
// be a second answer to "what colour is this part" that the next keyframe could
// disagree with.

bool HybridSsContext::setPartVisibility(double partIndex, double force, bool cascade) {
  if (ctx_ == nullptr || partIndex < 0) return false;
  return ss_runtime_set_part_visibility_override(
      ctx_, static_cast<uint32_t>(partIndex), static_cast<unsigned char>(force),
      cascade ? 1 : 0);
}

bool HybridSsContext::clearPartVisibility(double partIndex) {
  if (ctx_ == nullptr || partIndex < 0) return false;
  return ss_runtime_clear_part_visibility_override(ctx_, static_cast<uint32_t>(partIndex));
}

bool HybridSsContext::setPartColor(double partIndex, double blendOp, double rgba,
                                   double priority) {
  if (ctx_ == nullptr || partIndex < 0) return false;
  return ss_runtime_set_part_color_override(
      ctx_, static_cast<uint32_t>(partIndex), static_cast<unsigned char>(blendOp),
      static_cast<uint32_t>(rgba), static_cast<unsigned char>(priority));
}

bool HybridSsContext::clearPartColor(double partIndex) {
  if (ctx_ == nullptr || partIndex < 0) return false;
  return ss_runtime_clear_part_color_override(ctx_, static_cast<uint32_t>(partIndex));
}

bool HybridSsContext::setPartCell(double partIndex, double cellmapNameHash,
                                  double cellNameHash, double priority) {
  if (ctx_ == nullptr || partIndex < 0) return false;
  return ss_runtime_set_part_cell_override(
      ctx_, static_cast<uint32_t>(partIndex), static_cast<uint32_t>(cellmapNameHash),
      static_cast<uint32_t>(cellNameHash), static_cast<unsigned char>(priority));
}

bool HybridSsContext::clearPartCell(double partIndex) {
  if (ctx_ == nullptr || partIndex < 0) return false;
  return ss_runtime_clear_part_cell_override(ctx_, static_cast<uint32_t>(partIndex));
}

bool HybridSsContext::clearPartOverrides() {
  if (ctx_ == nullptr) return false;
  return ss_runtime_clear_all_part_overrides(ctx_);
}

sscore::SsAnimeBinaryView HybridSsContext::ssab() const {
  // Guarded on the context rather than on the view: `release()` clears both, and
  // testing the one that owns the buffer keeps a stale view from ever being
  // handed out if a future path forgets the other.
  return ctx_ == nullptr ? sscore::SsAnimeBinaryView{} : ssab_;
}

std::vector<SsTextureInfo> HybridSsContext::getTextures() {
  std::vector<SsTextureInfo> out;
  collectTextures(out);
  return out;
}

void HybridSsContext::collectTextures(std::vector<SsTextureInfo>& out) {
  const sscore::SsAnimeBinaryView view = ssab();
  if (!view.valid()) return;

  const uint32_t count = view.textureCount();
  out.reserve(out.size() + count);
  for (uint32_t i = 0; i < count; ++i) {
    const sscore::SsTextureEntry entry = view.textureAt(i);
    // Deduplicated by hash: the table is one flat lookup space for the whole
    // tree, and two packs naming the same cellmap must not produce two entries
    // for JS to load twice.
    bool seen = false;
    for (const SsTextureInfo& had : out) {
      if (static_cast<uint32_t>(had.textureHash) == entry.textureHash) { seen = true; break; }
    }
    if (seen) continue;
    out.emplace_back(static_cast<double>(entry.textureHash), std::string(entry.name),
                     std::string(entry.imagePath), static_cast<double>(entry.wrapMode),
                     static_cast<double>(entry.filterMode),
                     // Copied, not borrowed. The only consumer decodes these
                     // across an `await` per texture, so a borrow would outlive
                     // the resource whenever a load is superseded or the view
                     // unmounts mid-decode. Paid once per load, never per frame,
                     // and JS drops it after decoding.
                     entry.embedded != nullptr && entry.embeddedLength > 0
                         ? ArrayBuffer::copy(entry.embedded, entry.embeddedLength)
                         : ArrayBuffer::allocate(0));
  }

  // The children's, so one call answers for the whole tree. They exist only
  // after `setupAnimation`, which is why the spec says to ask afterwards.
  for (const sscore::SsInstanceState& state : instances_.states()) {
    if (state.child == nullptr) continue;
    static_cast<HybridSsContext*>(state.child)->collectTextures(out);
  }
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

std::vector<std::string> HybridSsContext::partNames() {
  const sscore::SsAnimeBinaryView view = ssab();
  std::vector<std::string> out;
  if (!view.valid()) return out;
  // Walk the `.ssab` parts table rather than `partCount_`: that one is derived
  // from the Brain's world-matrix SoA and is zero until the first update, while
  // the names are static for the resource and wanted before a frame has run.
  const uint32_t count = view.partCount();
  out.reserve(count);
  // An unnamed part holds its slot as an empty string so the vector stays
  // index-aligned with the `partIndex` every event carries.
  for (uint32_t i = 0; i < count; ++i) out.emplace_back(view.partName(i));
  return out;
}

std::vector<std::string> HybridSsContext::cellmapNames() {
  const sscore::SsAnimeBinaryView view = ssab();
  std::vector<std::string> out;
  if (!view.valid()) return out;
  for (const std::string_view name : view.cellmapNames()) out.emplace_back(name);
  return out;
}

std::vector<std::string> HybridSsContext::cellNames(const std::string& cellmapName) {
  const sscore::SsAnimeBinaryView view = ssab();
  std::vector<std::string> out;
  if (!view.valid()) return out;
  for (const std::string_view name : view.cellNames(cellmapName)) out.emplace_back(name);
  return out;
}

void HybridSsContext::refreshFrame() {
  // Every caller guards already, but `release()` can now run at any time JS
  // chooses rather than only at destruction, so the invariant is stated here
  // too instead of resting on all of them staying correct.
  if (ctx_ == nullptr) return;

  const unsigned char* fdPtr = nullptr;
  size_t fdLen = 0;
  // The DISPLAY frame. `frameNo_` keeps its fraction whatever `subFrame_` is
  // set to -- it is what the instance and effect slots are stepped from, and
  // truncating it there would freeze a child on any tick worth less than a
  // frame. Flooring it here is the whole of what turning sub-frame off does.
  const float drawFrame = subFrame_ ? frameNo_ : std::floor(frameNo_);
  ss_runtime_get_frame_data(ctx_, drawFrame, &fdPtr, &fdLen);
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

  // Shape. Fixed stride rather than CSR, but the same rule: keep the lengths,
  // because the count array indexes the vertex array and the guards in
  // `SsBaker::bakeShapeBatch` are all that stands between a stale count and a
  // read past the end.
  ss_runtime_get_shape_vertices(ctx_, &soa_.shapeVertices, &soa_.shapeVertexCount);
  ss_runtime_get_shape_vertex_box_coords(ctx_, &soa_.shapeBoxCoords, &soa_.shapeBoxCoordCount);
  ss_runtime_get_shape_vertex_counts(ctx_, &soa_.shapeVertexCounts,
                                     &soa_.shapeVertexCountCount);

  // Mesh. Every length is kept, not discarded like the ones above: these are CSR
  // arrays that index each other, so the guards in `SsBaker::bakeMeshBatch` are
  // the only thing between a malformed offset pair and a read past the end.
  ss_runtime_get_mesh_vertices_x(ctx_, &soa_.meshVerticesX, &soa_.meshVertexCount);
  ss_runtime_get_mesh_vertices_y(ctx_, &soa_.meshVerticesY, &len);
  ss_runtime_get_mesh_vertex_offsets(ctx_, &soa_.meshVertexOffsets, &soa_.meshVertexOffsetCount);
  ss_runtime_get_mesh_uvs(ctx_, &soa_.meshUvs, &soa_.meshUvCount);
  ss_runtime_get_mesh_indices(ctx_, &soa_.meshIndices, &soa_.meshIndexCount);
  ss_runtime_get_mesh_index_offsets(ctx_, &soa_.meshIndexOffsets, &soa_.meshIndexOffsetCount);
}

// --- this player, driven as somebody else's instance child -------------------

float HybridSsContext::instanceFrameNo() const {
  return ctx_ == nullptr ? 0.0f : ss_runtime_get_frame_no(ctx_);
}

void HybridSsContext::instancePlay() {
  if (ctx_ == nullptr) return;
  // Deliberately *not* this class's `play()`: that one also rewinds the slots,
  // and the slot that just reported the transition is the caller. What is wanted
  // here is only the Brain-side head-out that `ss_instance_slot_step` has
  // configured and left un-started.
  ss_runtime_play(ctx_);
}

void HybridSsContext::instanceStop() {
  if (ctx_ == nullptr) return;
  ss_runtime_stop(ctx_);
}

void HybridSsContext::instanceResetSlots() {
  effects_.reset();
  instances_.reset();
}

void HybridSsContext::instanceStepSlots(float childFrame, float dtMilliseconds,
                                        bool childLooped) {
  if (ctx_ == nullptr) return;
  // The playhead is **not** advanced here: `ss_instance_slot_step` already
  // seeked this context, and running `ss_runtime_update` on top would advance it
  // twice. All that is left is to publish the frame it was moved to and give
  // this player's own slots their tick at it.
  frameNo_ = childFrame;
  ++generation_;
  refreshFrame();
  stepEffects(dtMilliseconds, childLooped);
  instances_.step(ctx_, frameNo_, dtMilliseconds, childLooped);
}

size_t HybridSsContext::drawInstance(void* canvas, uint32_t partIndex, float alphaScale,
                                     const ::ssplayer::SsMaskInput& mask) {
  const sscore::SsInstanceState* state = instances_.stateFor(partIndex);
  if (state == nullptr || !state->visible || state->child == nullptr) return 0;
  // The canvas already carries the mount transform; the child draws its whole
  // subtree into it, and its own instance parts recurse from there. The table is
  // handed straight down rather than copied per child: it is the root's, keyed
  // by `cellmap.name_hash`, and one lookup space covers the whole tree — a
  // same-pack child needs no entries of its own at all.
  return static_cast<HybridSsContext*>(state->child)
      ->drawSubtree(canvas, drawTextures_, drawTextureCount_, alphaScale, mask);
}

size_t HybridSsContext::drawSubtree(void* canvas, const ::ssplayer::SsPaintBinding* textures,
                                    size_t textureCount, float alphaScale,
                                    const ::ssplayer::SsMaskInput& inherited) {
  if (ctx_ == nullptr || textures == nullptr || textureCount == 0) return 0;

  // Borrowed for the duration of this call only, so `drawInstance` — which
  // `DrawBakedFrame` calls back into from inside it — can pass the same table
  // one level down without a copy per child per frame.
  drawTextures_ = textures;
  drawTextureCount_ = textureCount;

  baker_.bake(frame_, soa_, effects_.frame(), alphaScale);

  ::ssplayer::SsMaskInput mask;
  // §2-6's AND-chain: whether this player, mounted, may mask at all. The identity
  // is `true` for a root (`drawInto` hands in a default `inherited`), and a
  // `mask_influence == 0` instance part above has already turned it off for this
  // whole subtree.
  mask.influence = inherited.influence;
  // The flags go in **whether or not a plan builds**. They are static PartData,
  // and the draw path needs one of them — `pureMask` — even on a frame with no
  // coverage at all: a pure mask writes coverage and never colour, and that is
  // true of a writer that opted out with `mask == 0` just as much as of one that
  // is cutting holes. Only `plan` is conditional.
  if (!maskFlags_.empty()) {
    mask.flags = maskFlags_.data();
    mask.flagCount = maskFlags_.size();
    if (inherited.plan != nullptr) {
      // §3-2-2: "the coverage and metadata are owned solely by the parent; the
      // child only references the parent's coverage and never builds its own".
      // So the caller's plan comes in whole and `maskPlan_.build` is skipped —
      // not an optimisation, the rule. `flags` stays this player's, because part
      // indices do not cross an instance boundary and §2-6 wants each of these
      // parts judged on its own settings composed with what came down.
      //
      // The carry-over track — a child's own clipping writers lifted up to clip a
      // caller's parts — runs in the `else` below, where this player builds its
      // own plan. It does **not** run *here*: when a caller's mask reaches in, this
      // port still uses only the caller's coverage, and the child's own writers
      // write nothing for that frame. Both coverages sampled by one part at once
      // is the remaining "separate track" (§3-2-2, ROADMAP.md).
      mask.plan = inherited.plan;
      mask.coverage = inherited.coverage;
      mask.inherited = true;
      mask.visibleInside = inherited.visibleInside;
      mask.callerRank = inherited.callerRank;
      for (int i = 0; i < 6; ++i) mask.slotXf[i] = inherited.slotXf[i];
    } else if (inherited.influence) {
      // Own masking is allowed by the AND-chain (a `mask_influence == 0` instance
      // above would have turned it off). Build this player's own writers, then
      // carry each visible instance child's clipping writers up (§2-6): they clip
      // this player's parts drawn after the mount. The plan can be non-empty from
      // the carry-over alone — a player whose only mask part is hidden but whose
      // mounted child still clips (`InstancePropagation`, `Hole32` hidden).
      maskPlan_.build(frame_, baker_, maskFlags_.data(), maskFlags_.size());
      for (const sscore::SsInstanceDraw& mount : baker_.instances()) {
        const sscore::SsInstanceState* st = instances_.stateFor(mount.partIndex);
        if (st == nullptr || !st->visible || st->child == nullptr) continue;
        auto* child = static_cast<HybridSsContext*>(st->child);
        if (!child->prepareForBubble()) continue;
        // Writer-side composition (§2-6): the influence reaching the child is this
        // player's, ANDed with the instance part's `mask_influence`. It only sets
        // the writer's OP; the carry-over itself happens for every visible child.
        const bool ownMi = mount.partIndex < maskFlags_.size()
                               ? maskFlags_[mount.partIndex].maskInfluence
                               : true;
        maskPlan_.bubbleChildClipWriters(child->baker_, child->maskPlan_, mount.m,
                                         mount.drawRank, inherited.influence && ownMi);
      }
      if (!maskPlan_.empty() && maskPlan_.width() > 0.0f && maskPlan_.height() > 0.0f) {
        mask.plan = &maskPlan_;
      }
    }
  }

  const size_t drawn =
      ::ssplayer::DrawBakedFrame(canvas, textures, textureCount, baker_, mask, this);
  drawTextures_ = nullptr;
  drawTextureCount_ = 0;
  return drawn;
}

bool HybridSsContext::prepareForBubble() {
  if (ctx_ == nullptr || frame_ == nullptr) return false;
  // Coverage ignores vertex colour, so alpha 1 and no effects: only the clipping
  // writers' shapes are wanted, and those are Normal / Shape / Mesh, never
  // Effect. This bake is thrown away when the child draws for real (it re-bakes
  // through `drawSubtree`), but the caller lifts what it needs out of it — and
  // out of the plan below — before that happens.
  baker_.bake(frame_, soa_);
  if (maskFlags_.empty()) return false;
  if (!maskPlan_.build(frame_, baker_, maskFlags_.data(), maskFlags_.size())) return false;
  for (const sscore::SsMaskWriter& w : maskPlan_.writers()) {
    if (w.isClipping) return true;
  }
  return false;
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

  // The root of the same recursion an instance mount enters one level down, at
  // `alphaScale` 1 because nothing above it dims it. Keeping the two on one path
  // is what stops a child from quietly missing a feature the root has.
  return static_cast<double>(
      drawSubtree(canvas.canvas, paintBindings_.data(), paintBindings_.size(), 1.0f));
}

}  // namespace margelo::nitro::ssplayer
