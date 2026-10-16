#include "HybridSsContext.hpp"

#include <NitroModules/ArrayBuffer.hpp>

#include <atomic>
#include <cmath>
#include <limits>
#include <stdexcept>

#include "ssruntime.h"
#include "SsLog.hpp"
#include "SsSkiaDraw.hpp"
#include "SsTick.hpp"

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
  // Verified, on the Brain's copy of a pack `adopt()` already gated, because a
  // view that skipped the verifier would be a second path for every reader
  // below to trust.
  ssab_ = resource_->view(ctx_);
  maskFlags_ = ssab_.maskFlags();
  for (const sscore::SsMaskPartFlags& f : maskFlags_) {
    if (f.isWriter() && f.bakedGeometry) hasWriterParts_ = true;
  }
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
    instancePacks_.clear();
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
  textures_.clear();
  paintBindings_.clear();
  // The kept mask coverage samples those paints' atlases.
  drawScratch_ = {};
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
  // The external packs with it, for the same reason. Their handles are JS's to
  // dispose; this only keeps a released context from holding the objects until
  // the collector reaches it.
  instancePacks_.clear();
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
  // Before the update, as `advances()` is read: the tick that completes a fade
  // still moves the pose, and after it the stack reports at rest.
  const bool stackMoves = ::ssplayer::SsStackMovesPose(ctx_);
  // Passed through unconverted: the C-API's delta is milliseconds, and so is
  // this spec's, deliberately — see the spec comment.
  frameNo_ = ss_runtime_update(ctx_, static_cast<float>(dtMilliseconds));
  // Rebuilt only when the pose can differ from the one built last. Rebuilding
  // regardless re-evaluated and redrew the same pose on every tick of a frame
  // that lasts several, and on every tick of a pause.
  const float drawFrame = subFrame_ ? frameNo_ : std::floor(frameNo_);
  if (stale_ || stackMoves || frame_ == nullptr || drawFrame != builtFrame_) {
    ++generation_;
    refreshFrame();
  } else if (hasSlots()) {
    // Same pose, but an effect or instance part steps below on a clock of its
    // own, so the picture still moves.
    ++generation_;
  }
  // The steps below are the ones a track call left pending.
  slotsStale_ = false;
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

bool HybridSsContext::advances() const {
  return ::ssplayer::SsAdvances(ctx_, hasSlots());
}

bool HybridSsContext::hasSlots() const {
  return !effects_.empty() || !instances_.states().empty();
}

void HybridSsContext::markStale() {
  if (ctx_ != nullptr) stale_ = true;
}

void HybridSsContext::refreshIfStale() {
  if (!stale_ || ctx_ == nullptr) return;
  // Unbumped, `frameDrawn` would stay true and the view keep the old picture.
  ++generation_;
  refreshFrame();
  // A track call can move track 0's playhead with no time passing, which is a
  // seek, and the slots follow it the way `resync()` has them follow one. Left
  // to the next `update()`, a held player — which gets none — drew its own
  // parts at the new frame and its children and effects at the old one.
  if (slotsStale_) {
    slotsStale_ = false;
    stepEffects(0.0f, false);
    instances_.step(ctx_, frameNo_, 0.0f, false);
  }
}

bool HybridSsContext::getFrameDrawn() {
  return ctx_ == nullptr || (!stale_ && drawnGeneration_ == generation_);
}

void HybridSsContext::stepEffects(float dtMilliseconds, bool looped) {
  if (ctx_ == nullptr || effects_.empty()) return;
  // The *animation's* authored fps, which is what converts an independent
  // slot's delta into frames — not the display's refresh rate.
  const int32_t fps = ss_runtime_get_frame_rate(ctx_);
  // `frame_` is the frame this tick draws, refreshed by every caller just
  // before, so a part it hides skips the particles nothing would draw.
  effects_.step(ctx_, frame_, frameNo_, dtMilliseconds / 1000.0f,
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
  // Halts where it stands: the whole clock, every track and fade with it. No
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
  ++generation_;
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

SsBox HybridSsContext::canvasBox() {
  // What track 0 plays now, which a crossfade changes from the call on — so
  // the canvas switches with it, as it does for a setup.
  const std::array<float, 4> box =
      ssab().canvasBox(ctx_ == nullptr ? -1 : ss_runtime_get_current_animation_index(ctx_));
  return SsBox(static_cast<double>(box[0]), static_cast<double>(box[1]),
               static_cast<double>(box[2]), static_cast<double>(box[3]));
}

SsPartTransform HybridSsContext::getPartTransform(double partIndex) {
  refreshIfStale();
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
  refreshIfStale();
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

int32_t HybridSsContext::passedEventAnimation(int32_t i) const {
  // The animation of the source that **fired** the event, not the one a setup
  // selected: an event index addresses that source's `events`, and after a
  // crossfade on track 0 — or with a second source firing — the two differ.
  // Resolved against the setup's table, a key came back as some other key of
  // the same index, or was dropped as out of range.
  const uint32_t handle = ss_runtime_get_passed_event_source_handle(ctx_, i);
  return ss_runtime_get_source_animation_index(ctx_, handle);
}

double HybridSsContext::passedEventSource(int32_t i) const {
  const uint32_t handle = ss_runtime_get_passed_event_source_handle(ctx_, i);
  return handle == SS_RUNTIME_INVALID_HANDLE ? -1.0 : static_cast<double>(handle);
}

std::vector<SsUserDataEvent> HybridSsContext::getUserDataEvents() {
  std::vector<SsUserDataEvent> out;
  if (ctx_ == nullptr) return out;

  const int32_t count = ss_runtime_get_passed_event_count(ctx_);
  if (count <= 0) return out;

  const sscore::SsAnimeBinaryView view = ssab();
  if (!view.valid()) return out;

  for (int32_t i = 0; i < count; ++i) {
    const ss::format::EventsPerFrame* frame =
        view.eventsAt(passedEventAnimation(i), ss_runtime_get_passed_event_index(ctx_, i));
    if (frame == nullptr) continue;
    const double source = passedEventSource(i);
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
          static_cast<double>(frame->frame_index()), source, integer != nullptr,
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
  if (ctx_ == nullptr) return out;

  const int32_t count = ss_runtime_get_passed_event_count(ctx_);
  if (count <= 0) return out;

  const sscore::SsAnimeBinaryView view = ssab();
  if (!view.valid()) return out;

  for (int32_t i = 0; i < count; ++i) {
    const ss::format::EventsPerFrame* frame =
        view.eventsAt(passedEventAnimation(i), ss_runtime_get_passed_event_index(ctx_, i));
    if (frame == nullptr) continue;
    const double source = passedEventSource(i);
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
          static_cast<double>(frame->frame_index()), source,
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
  if (ctx_ == nullptr) return out;

  const int32_t count = ss_runtime_get_passed_event_count(ctx_);
  if (count <= 0) return out;

  const sscore::SsAnimeBinaryView view = ssab();
  if (!view.valid()) return out;

  for (int32_t i = 0; i < count; ++i) {
    const ss::format::EventsPerFrame* frame =
        view.eventsAt(passedEventAnimation(i), ss_runtime_get_passed_event_index(ctx_, i));
    if (frame == nullptr) continue;
    const double source = passedEventSource(i);
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
                                  static_cast<double>(frame->frame_index()), source,
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
  const bool ok = ss_runtime_set_part_visibility_override(
      ctx_, static_cast<uint32_t>(partIndex), static_cast<unsigned char>(force),
      cascade ? 1 : 0);
  if (ok) markStale();
  return ok;
}

bool HybridSsContext::clearPartVisibility(double partIndex) {
  if (ctx_ == nullptr || partIndex < 0) return false;
  const bool ok = ss_runtime_clear_part_visibility_override(ctx_, static_cast<uint32_t>(partIndex));
  if (ok) markStale();
  return ok;
}

bool HybridSsContext::setPartColor(double partIndex, double blendOp, double rgba,
                                   double priority) {
  if (ctx_ == nullptr || partIndex < 0) return false;
  const bool ok = ss_runtime_set_part_color_override(
      ctx_, static_cast<uint32_t>(partIndex), static_cast<unsigned char>(blendOp),
      static_cast<uint32_t>(rgba), static_cast<unsigned char>(priority));
  if (ok) markStale();
  return ok;
}

bool HybridSsContext::clearPartColor(double partIndex) {
  if (ctx_ == nullptr || partIndex < 0) return false;
  const bool ok = ss_runtime_clear_part_color_override(ctx_, static_cast<uint32_t>(partIndex));
  if (ok) markStale();
  return ok;
}

bool HybridSsContext::setPartCell(double partIndex, double cellmapNameHash,
                                  double cellNameHash, double priority) {
  if (ctx_ == nullptr || partIndex < 0) return false;
  const bool ok = ss_runtime_set_part_cell_override(
      ctx_, static_cast<uint32_t>(partIndex), static_cast<uint32_t>(cellmapNameHash),
      static_cast<uint32_t>(cellNameHash), static_cast<unsigned char>(priority));
  if (ok) markStale();
  return ok;
}

bool HybridSsContext::clearPartCell(double partIndex) {
  if (ctx_ == nullptr || partIndex < 0) return false;
  const bool ok = ss_runtime_clear_part_cell_override(ctx_, static_cast<uint32_t>(partIndex));
  if (ok) markStale();
  return ok;
}

bool HybridSsContext::clearPartOverrides() {
  if (ctx_ == nullptr) return false;
  const bool ok = ss_runtime_clear_all_part_overrides(ctx_);
  if (ok) markStale();
  return ok;
}

// --- animation mixing: the track stack -----------------------------------------
//
// Straight through, like the override layer and for the same reason: the Brain
// owns the stack, and a copy up here would be a second answer to "what does
// track 1 play". What this layer adds is the bookkeeping the Brain cannot do
// for it — the playhead it caches, and the frame it published.

namespace {

/// A track or source number from JS, or false for one no `u32` can hold. A
/// negative one cast straight across would wrap to a huge, valid-looking index.
bool toIndex(double value, uint32_t& out) {
  if (!(value >= 0.0) || value > static_cast<double>(std::numeric_limits<uint32_t>::max())) {
    return false;
  }
  out = static_cast<uint32_t>(value);
  return true;
}

/// The C ABI's "no such handle" as the -1 the spec promises.
double handleOrMinusOne(uint32_t handle) {
  return handle == SS_RUNTIME_INVALID_HANDLE ? -1.0 : static_cast<double>(handle);
}

}  // namespace

void HybridSsContext::tracksChanged() {
  // A crossfade or a new animation on track 0 hands its playhead to another
  // animation from the call on, and `refreshFrame` reads the FrameData *at*
  // `frameNo_` — which the Brain validates against track 0's range, so the old
  // animation's playhead would fail on a shorter incoming one and draw nothing.
  frameNo_ = ss_runtime_get_frame_no(ctx_);
  // Rebuilt at the next read or draw, as an override is, so a player that does
  // not advance shows the new pose and one that does costs nothing extra. The
  // slots with it, onto the playhead just read.
  stale_ = true;
  slotsStale_ = true;
}

double HybridSsContext::getTrackCount() {
  return ctx_ == nullptr ? 0.0 : static_cast<double>(ss_runtime_get_track_count(ctx_));
}

double HybridSsContext::getCurrentAnimationIndex() {
  return ctx_ == nullptr ? -1.0 : static_cast<double>(ss_runtime_get_current_animation_index(ctx_));
}

bool HybridSsContext::setTrackAnimation(double track, const std::string& name) {
  uint32_t t = 0;
  if (ctx_ == nullptr || !toIndex(track, t)) return false;
  const bool ok = ss_runtime_set_track_animation(ctx_, t, name.c_str());
  if (ok) tracksChanged();
  return ok;
}

bool HybridSsContext::clearTrack(double track) {
  uint32_t t = 0;
  if (ctx_ == nullptr || !toIndex(track, t)) return false;
  const bool ok = ss_runtime_clear_track(ctx_, t);
  if (ok) tracksChanged();
  return ok;
}

bool HybridSsContext::crossfade(double track, const std::string& name, double durationMs) {
  uint32_t t = 0;
  if (ctx_ == nullptr || !toIndex(track, t)) return false;
  const bool ok =
      ss_runtime_crossfade(ctx_, t, name.c_str(), static_cast<float>(durationMs));
  if (ok) tracksChanged();
  return ok;
}

bool HybridSsContext::fadeTrack(double track, double targetAlpha, double durationMs) {
  uint32_t t = 0;
  if (ctx_ == nullptr || !toIndex(track, t)) return false;
  return ss_runtime_fade_track(ctx_, t, static_cast<float>(targetAlpha),
                               static_cast<float>(durationMs));
}

double HybridSsContext::getTrackFadeProgress(double track) {
  uint32_t t = 0;
  if (ctx_ == nullptr || !toIndex(track, t)) return std::numeric_limits<double>::quiet_NaN();
  return static_cast<double>(ss_runtime_get_track_fade_progress(ctx_, t));
}

bool HybridSsContext::cancelTrackFade(double track) {
  uint32_t t = 0;
  if (ctx_ == nullptr || !toIndex(track, t)) return false;
  return ss_runtime_cancel_track_fade(ctx_, t);
}

bool HybridSsContext::setTrackAlpha(double track, double alpha) {
  uint32_t t = 0;
  if (ctx_ == nullptr || !toIndex(track, t)) return false;
  const bool ok = ss_runtime_set_track_alpha(ctx_, t, static_cast<float>(alpha));
  if (ok) tracksChanged();
  return ok;
}

double HybridSsContext::getTrackAlpha(double track) {
  uint32_t t = 0;
  if (ctx_ == nullptr || !toIndex(track, t)) return std::numeric_limits<double>::quiet_NaN();
  return static_cast<double>(ss_runtime_get_track_alpha(ctx_, t));
}

bool HybridSsContext::setTrackBlend(double track, double blend) {
  uint32_t t = 0;
  uint32_t b = 0;
  if (ctx_ == nullptr || !toIndex(track, t) || !toIndex(blend, b)) return false;
  const bool ok = ss_runtime_set_track_blend(ctx_, t, b);
  if (ok) tracksChanged();
  return ok;
}

double HybridSsContext::getTrackBlend(double track) {
  uint32_t t = 0;
  if (ctx_ == nullptr || !toIndex(track, t)) return -1.0;
  return handleOrMinusOne(ss_runtime_get_track_blend(ctx_, t));
}

bool HybridSsContext::setTrackSync(double track, double sync) {
  uint32_t t = 0;
  uint32_t s = 0;
  if (ctx_ == nullptr || !toIndex(track, t) || !toIndex(sync, s)) return false;
  return ss_runtime_set_track_sync(ctx_, t, s);
}

double HybridSsContext::getTrackSync(double track) {
  uint32_t t = 0;
  if (ctx_ == nullptr || !toIndex(track, t)) return -1.0;
  return handleOrMinusOne(ss_runtime_get_track_sync(ctx_, t));
}

bool HybridSsContext::setTrackFrame(double track, double frameNo) {
  uint32_t t = 0;
  if (ctx_ == nullptr || !toIndex(track, t)) return false;
  const bool ok = ss_runtime_set_track_frame(ctx_, t, static_cast<float>(frameNo));
  if (ok) tracksChanged();
  return ok;
}

double HybridSsContext::getTrackFrame(double track) {
  uint32_t t = 0;
  if (ctx_ == nullptr || !toIndex(track, t)) return std::numeric_limits<double>::quiet_NaN();
  return static_cast<double>(ss_runtime_get_track_frame(ctx_, t));
}

bool HybridSsContext::setTrackSpeed(double track, double speed) {
  uint32_t t = 0;
  if (ctx_ == nullptr || !toIndex(track, t)) return false;
  return ss_runtime_set_track_speed(ctx_, t, static_cast<float>(speed));
}

double HybridSsContext::getTrackSpeed(double track) {
  uint32_t t = 0;
  if (ctx_ == nullptr || !toIndex(track, t)) return std::numeric_limits<double>::quiet_NaN();
  return static_cast<double>(ss_runtime_get_track_speed(ctx_, t));
}

bool HybridSsContext::setTrackFrameRate(double track, double fps) {
  uint32_t t = 0;
  if (ctx_ == nullptr || !toIndex(track, t)) return false;
  return ss_runtime_set_track_frame_rate(ctx_, t, static_cast<int>(fps));
}

double HybridSsContext::getTrackFrameRate(double track) {
  uint32_t t = 0;
  if (ctx_ == nullptr || !toIndex(track, t)) return -1.0;
  return static_cast<double>(ss_runtime_get_track_frame_rate(ctx_, t));
}

bool HybridSsContext::setTrackSkipFrames(double track, bool skip) {
  uint32_t t = 0;
  if (ctx_ == nullptr || !toIndex(track, t)) return false;
  return ss_runtime_set_track_skip_frames(ctx_, t, skip);
}

bool HybridSsContext::getTrackSkipFrames(double track) {
  uint32_t t = 0;
  if (ctx_ == nullptr || !toIndex(track, t)) return false;
  return ss_runtime_get_track_skip_frames(ctx_, t);
}

bool HybridSsContext::setTrackPlaybackDirection(double track, double direction, double style) {
  uint32_t t = 0;
  if (ctx_ == nullptr || !toIndex(track, t)) return false;
  return ss_runtime_set_track_playback_direction(ctx_, t, static_cast<int>(direction),
                                                 static_cast<int>(style));
}

double HybridSsContext::getTrackPlaybackDirection(double track) {
  uint32_t t = 0;
  if (ctx_ == nullptr || !toIndex(track, t)) return -1.0;
  return static_cast<double>(ss_runtime_get_track_playback_direction(ctx_, t));
}

double HybridSsContext::getTrackPlaybackStyle(double track) {
  uint32_t t = 0;
  if (ctx_ == nullptr || !toIndex(track, t)) return -1.0;
  return static_cast<double>(ss_runtime_get_track_playback_style(ctx_, t));
}

bool HybridSsContext::setTrackLoopCount(double track, double loops) {
  uint32_t t = 0;
  if (ctx_ == nullptr || !toIndex(track, t)) return false;
  return ss_runtime_set_track_loop_count(ctx_, t, static_cast<int>(loops));
}

double HybridSsContext::getTrackLoopCount(double track) {
  uint32_t t = 0;
  if (ctx_ == nullptr || !toIndex(track, t)) return 0.0;
  return static_cast<double>(ss_runtime_get_track_loop_count(ctx_, t));
}

bool HybridSsContext::isTrackFinished(double track) {
  uint32_t t = 0;
  return ctx_ != nullptr && toIndex(track, t) && ss_runtime_is_track_finished(ctx_, t);
}

bool HybridSsContext::trackJustLooped(double track) {
  uint32_t t = 0;
  return ctx_ != nullptr && toIndex(track, t) && ss_runtime_track_just_looped(ctx_, t);
}

bool HybridSsContext::setTrackOutgoingEventThreshold(double track, double threshold) {
  uint32_t t = 0;
  if (ctx_ == nullptr || !toIndex(track, t)) return false;
  return ss_runtime_set_track_outgoing_event_threshold(ctx_, t, static_cast<float>(threshold));
}

double HybridSsContext::getTrackOutgoingEventThreshold(double track) {
  uint32_t t = 0;
  if (ctx_ == nullptr || !toIndex(track, t)) return std::numeric_limits<double>::quiet_NaN();
  return static_cast<double>(ss_runtime_get_track_outgoing_event_threshold(ctx_, t));
}

double HybridSsContext::getTrackMainSource(double track) {
  uint32_t t = 0;
  if (ctx_ == nullptr || !toIndex(track, t)) return -1.0;
  return handleOrMinusOne(ss_runtime_get_track_main_source(ctx_, t));
}

double HybridSsContext::addTrackSource(double track, const std::string& name, double weight) {
  uint32_t t = 0;
  if (ctx_ == nullptr || !toIndex(track, t)) return -1.0;
  const uint32_t handle =
      ss_runtime_add_track_source(ctx_, t, name.c_str(), static_cast<float>(weight));
  if (handle != SS_RUNTIME_INVALID_HANDLE) tracksChanged();
  return handleOrMinusOne(handle);
}

bool HybridSsContext::setSourceWeight(double source, double weight) {
  uint32_t s = 0;
  if (ctx_ == nullptr || !toIndex(source, s)) return false;
  const bool ok = ss_runtime_set_source_weight(ctx_, s, static_cast<float>(weight));
  if (ok) tracksChanged();
  return ok;
}

double HybridSsContext::getSourceWeight(double source) {
  uint32_t s = 0;
  if (ctx_ == nullptr || !toIndex(source, s)) return std::numeric_limits<double>::quiet_NaN();
  return static_cast<double>(ss_runtime_get_source_weight(ctx_, s));
}

bool HybridSsContext::setSourceFrame(double source, double frameNo) {
  uint32_t s = 0;
  if (ctx_ == nullptr || !toIndex(source, s)) return false;
  const bool ok = ss_runtime_set_source_frame(ctx_, s, static_cast<float>(frameNo));
  if (ok) tracksChanged();
  return ok;
}

double HybridSsContext::getSourceFrame(double source) {
  uint32_t s = 0;
  if (ctx_ == nullptr || !toIndex(source, s)) return std::numeric_limits<double>::quiet_NaN();
  return static_cast<double>(ss_runtime_get_source_frame(ctx_, s));
}

double HybridSsContext::getSourceAnimationIndex(double source) {
  uint32_t s = 0;
  if (ctx_ == nullptr || !toIndex(source, s)) return -1.0;
  return static_cast<double>(ss_runtime_get_source_animation_index(ctx_, s));
}

bool HybridSsContext::setSourceEventThreshold(double source, double threshold) {
  uint32_t s = 0;
  if (ctx_ == nullptr || !toIndex(source, s)) return false;
  return ss_runtime_set_source_event_threshold(ctx_, s, static_cast<float>(threshold));
}

double HybridSsContext::getSourceEventThreshold(double source) {
  uint32_t s = 0;
  if (ctx_ == nullptr || !toIndex(source, s)) return std::numeric_limits<double>::quiet_NaN();
  return static_cast<double>(ss_runtime_get_source_event_threshold(ctx_, s));
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
                     std::string(entry.imagePath),
                     static_cast<double>(entry.embedded != nullptr ? entry.embeddedLength : 0));
  }

  // The children's, so one call answers for the whole tree. They exist only
  // after `setupAnimation`, which is why the spec says to ask afterwards.
  for (const sscore::SsInstanceState& state : instances_.states()) {
    if (state.child == nullptr) continue;
    static_cast<HybridSsContext*>(state.child)->collectTextures(out);
  }
}

bool HybridSsContext::findTexture(uint32_t textureHash, sscore::SsTextureEntry& out) const {
  const sscore::SsAnimeBinaryView view = ssab();
  if (!view.valid()) return false;
  const uint32_t count = view.textureCount();
  for (uint32_t i = 0; i < count; ++i) {
    const sscore::SsTextureEntry entry = view.textureAt(i);
    if (entry.textureHash == textureHash) {
      out = entry;
      return true;
    }
  }
  for (const sscore::SsInstanceState& state : instances_.states()) {
    if (state.child == nullptr) continue;
    if (static_cast<const HybridSsContext*>(state.child)->findTexture(textureHash, out)) {
      return true;
    }
  }
  return false;
}

std::shared_ptr<ArrayBuffer> HybridSsContext::copyEmbeddedTexture(double textureHash) {
  sscore::SsTextureEntry entry;
  // Copied, not borrowed: the loader decodes it across an `await`, and a
  // superseded load or an unmount can release the resource before it is done.
  if (findTexture(static_cast<uint32_t>(textureHash), entry) && entry.embedded != nullptr &&
      entry.embeddedLength > 0) {
    return ArrayBuffer::copy(entry.embedded, entry.embeddedLength);
  }
  return ArrayBuffer::allocate(0);
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
  stale_ = false;

  const unsigned char* fdPtr = nullptr;
  size_t fdLen = 0;
  // The DISPLAY frame. `frameNo_` keeps its fraction whatever `subFrame_` is
  // set to -- it is what the instance and effect slots are stepped from, and
  // truncating it there would freeze a child on any tick worth less than a
  // frame. Flooring it here is the whole of what turning sub-frame off does.
  const float drawFrame = subFrame_ ? frameNo_ : std::floor(frameNo_);
  ss_runtime_get_frame_data(ctx_, drawFrame, &fdPtr, &fdLen);
  builtFrame_ = drawFrame;
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
  if (!inherited.mounted) {
    // The root owns the mask for the whole tree: it numbers every part of it in
    // draw order, then gathers every writer of it into the one plan, before
    // anything draws — a pure mask reaches parts drawn before it, so the whole
    // coverage has to exist before the first of them. Children still hold this
    // frame (they are stepped before the root draws), and each one's bake below
    // stays untouched until the root's `DrawBakedFrame` has rasterised it.
    float counter = 0.0f;
    numberMaskTree(counter);
    maskPlan_.clear();
    static constexpr float kIdentity[6] = {1.0f, 0.0f, 0.0f, 1.0f, 0.0f, 0.0f};
    collectMaskTree(maskPlan_, kIdentity, -1.0f, sscore::SsMaskContext{}, true);
    if (maskPlan_.dropped() && !warnedDroppedWriters_) {
      warnedDroppedWriters_ = true;
      ::ssplayer::SsWarn(
          "more than %d mask writers at once (an instance counts again every time it is "
          "placed); the rest are ignored.",
          sscore::kSsMaxMaskWriters);
    }
    if (maskPlan_.finish()) mask.plan = &maskPlan_;
  } else {
    // The root's plan and coverage come in whole — not an optimisation, the
    // rule: they already hold this player's writers, at their places in the tree.
    mask.plan = inherited.plan;
    mask.coverage = inherited.coverage;
    mask.context = inherited.context;
    mask.mounted = true;
    for (int i = 0; i < 6; ++i) mask.slotXf[i] = inherited.slotXf[i];
  }
  // Numbered by the root's walk above, this frame.
  mask.seq = maskSeq_.data();
  mask.seqCount = maskSeq_.size();
  // The flags go in **whether or not a plan builds**. They are static PartData,
  // and the draw path needs them even on a frame with no coverage at all: a pure
  // mask writes coverage and never colour, whether it is cutting holes or opted
  // out with `mask == 0`, and a part that draws inside a mask draws nowhere when
  // no writer covers it. `flags` stays this player's, because part indices do
  // not cross an instance boundary.
  if (!maskFlags_.empty()) {
    mask.flags = maskFlags_.data();
    mask.flagCount = maskFlags_.size();
  }

  const size_t drawn =
      ::ssplayer::DrawBakedFrame(canvas, textures, textureCount, baker_, mask, this, &drawScratch_);
  drawTextures_ = nullptr;
  drawTextureCount_ = 0;
  return drawn;
}

HybridSsContext* HybridSsContext::mountedChild(uint32_t partIndex) {
  const sscore::SsInstanceState* state = instances_.stateFor(partIndex);
  // The same test `drawInstance` makes, so the walks below number and collect
  // exactly the children that will draw.
  if (state == nullptr || !state->visible || state->child == nullptr) return nullptr;
  return static_cast<HybridSsContext*>(state->child);
}

void HybridSsContext::numberMaskTree(float& counter) {
  const auto* order = frame_ != nullptr ? frame_->draw_order() : nullptr;
  const uint32_t n = order != nullptr ? order->size() : 0;
  maskSeq_.resize(n);
  for (uint32_t rank = 0; rank < n; ++rank) {
    maskSeq_[rank] = counter;
    counter += 1.0f;
    // A visible instance's sub-animation is drawn in its instance part's place,
    // so it is numbered right there, ahead of the next part.
    if (HybridSsContext* child = mountedChild(order->Get(rank))) child->numberMaskTree(counter);
  }
}

void HybridSsContext::collectMaskTree(sscore::SsMaskPlan& plan, const float toRoot[6],
                                      float startSeq, const sscore::SsMaskContext& context,
                                      bool root) {
  if (frame_ == nullptr) return;
  if (hasWriterParts_ && !maskFlags_.empty()) {
    // The root baked for real just before this; a child bakes here, at alpha 1
    // and with no effects, because coverage reads neither and writers are never
    // Effect. It is re-baked when it draws, but only after the root has
    // rasterised the coverage out of this one.
    if (!root) baker_.bake(frame_, soa_);
    plan.collect(frame_, baker_, maskFlags_.data(), maskFlags_.size(), maskSeq_.data(),
                 maskSeq_.size(), startSeq, context, root ? nullptr : &baker_,
                 root ? nullptr : toRoot);
  }

  const auto* order = frame_->draw_order();
  if (order == nullptr || soa_.worldMatrices == nullptr) return;
  for (uint32_t rank = 0; rank < order->size() && rank < maskSeq_.size(); ++rank) {
    const uint32_t partIndex = order->Get(rank);
    HybridSsContext* child = mountedChild(partIndex);
    if (child == nullptr || partIndex >= soa_.partCount) continue;
    // The instance matrix, read the way `SsBaker` reads it for the mount — the
    // 2D affine slice of the column-major world matrix — and chained onto ours.
    const float* w = soa_.worldMatrices + static_cast<size_t>(partIndex) * 16;
    const float m[6] = {w[0], w[1], w[4], w[5], w[12], w[13]};
    const float c[6] = {
        toRoot[0] * m[0] + toRoot[2] * m[1], toRoot[1] * m[0] + toRoot[3] * m[1],
        toRoot[0] * m[2] + toRoot[2] * m[3], toRoot[1] * m[2] + toRoot[3] * m[3],
        toRoot[0] * m[4] + toRoot[2] * m[5] + toRoot[4],
        toRoot[1] * m[4] + toRoot[3] * m[5] + toRoot[5],
    };
    // One level: the instance part's own flags, whatever this player was
    // composed with.
    sscore::SsMaskContext childContext;
    if (partIndex < maskFlags_.size()) {
      childContext.influence = maskFlags_[partIndex].maskInfluence;
      childContext.visibleInside = maskFlags_[partIndex].visibleInsideMask;
    }
    child->collectMaskTree(plan, c, maskSeq_[rank], childContext, false);
  }
}

void HybridSsContext::setTextures(const std::vector<SsTextureBinding>& textures) {
  textures_ = textures;
  // Repacked rather than handed through: SsSkiaDraw is shared with the host
  // harness and must not see Nitro's types.
  paintBindings_.clear();
  paintBindings_.reserve(textures_.size());
  for (const SsTextureBinding& binding : textures_) {
    paintBindings_.push_back({static_cast<uint32_t>(binding.textureHash), binding.paint.paint});
  }
}

double HybridSsContext::drawInto(SkCanvasHandle canvas, double x, double y, double scaleX,
                                 double scaleY) {
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
  if (paintBindings_.empty()) return 0.0;

  refreshIfStale();
  // The root of the same recursion an instance mount enters one level down, at
  // `alphaScale` 1 because nothing above it dims it. Keeping the two on one path
  // is what stops a child from quietly missing a feature the root has.
  // Restored on the way out however the draw leaves, or the placement would
  // stay on the caller's canvas for everything drawn after this player.
  struct Placement {
    void* canvas;
    int saveCount;
    ~Placement() { ::ssplayer::RestoreCanvas(canvas, saveCount); }
  } placement{canvas.canvas,
              ::ssplayer::SaveAndPlaceCanvas(canvas.canvas, static_cast<float>(x),
                                             static_cast<float>(y), static_cast<float>(scaleX),
                                             static_cast<float>(scaleY))};
  const size_t drawn =
      drawSubtree(canvas.canvas, paintBindings_.data(), paintBindings_.size(), 1.0f);
  drawnGeneration_ = generation_;
  return static_cast<double>(drawn);
}

}  // namespace margelo::nitro::ssplayer
