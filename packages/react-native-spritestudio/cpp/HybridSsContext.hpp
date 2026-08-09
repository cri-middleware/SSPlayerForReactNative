#pragma once

#include <cstdint>
#include <memory>
#include <string>
#include <vector>

#include "HybridSsContextSpec.hpp"
#include "HybridSsResource.hpp"
#include "SsAnimeBinary.hpp"
#include "SsBaker.hpp"
#include "SsEffect.hpp"
#include "SsMask.hpp"
#include "SsRNSkiaInterop.hpp"
// For `SsPaintBinding` only. Safe in a header: SsSkiaDraw.hpp keeps its Skia
// pointers opaque precisely so consumers never need the Skia headers.
#include "SsSkiaDraw.hpp"

namespace margelo::nitro::ssplayer {

/// One playing animation.
///
/// Every buffer handed to JS is a borrow that `update()` invalidates. Two
/// separate things can dangle and they are kept apart deliberately:
///
///   - the Brain's SoA buffers and FrameData, recycled inside `libssruntime`;
///   - this object's own baker vectors, resized here.
///
/// Neither is refcounted by the JS side, so `generation_` is the only thing
/// standing between a retained ArrayBuffer and a read of recycled memory. It is
/// stamped into every struct handed out; JS compares before it reads.
///
/// Since Phase 0 the geometry no longer leaves C++ at all — `drawInto` bakes and
/// draws in one call — so the only buffer still crossing is an embedded atlas on
/// its way to Skia. The rule stays, because the next thing to cross will be
/// subject to it too.
class HybridSsContext final : public HybridSsContextSpec {
 public:
  explicit HybridSsContext(const std::shared_ptr<HybridSsResource>& resource);
  ~HybridSsContext() override;

  /// Tears the player down **now**, instead of whenever JS collects this object.
  ///
  /// Nitro's `HybridObject::dispose()` is a virtual no-op unless overridden, so
  /// without this a `<SpriteStudioView>` unmount would leave the Brain context —
  /// and, through `resource_`, the whole `.ssab` — alive until a GC that JS never
  /// promises to run. Mounting and unmounting a screen a few times would then
  /// hold several packs at once.
  ///
  /// Also the moment every outstanding borrow dies: `generation_` is bumped, so
  /// JS holding an ArrayBuffer from a previous frame sees the same staleness it
  /// would see after an `update()` rather than reading freed memory.
  /// Idempotent; the destructor runs the same release.
  void dispose() override;

  /// Instances currently holding a Brain context. Backs `SsRuntime.liveHandles`.
  static int32_t liveCount() noexcept;

  double getPartCount() override { return static_cast<double>(partCount_); }
  double getGeneration() override { return static_cast<double>(generation_); }
  double getFrameNo() override { return static_cast<double>(frameNo_); }

  bool getIsPlaying() override;
  bool getIsPausing() override;
  bool getIsFinished() override;
  bool getIsLooped() override;
  double getFps() override;
  double getStartFrame() override;
  double getEndFrame() override;
  double getLoops() override;
  double getRemainLoops() override;
  double getPlaybackDirection() override;
  double getPlaybackStyle() override;
  bool getSkipFrames() override;

  bool setupAnimation(const std::string& name) override;
  double update(double dtMilliseconds) override;

  void play() override;
  void playFrom(double frameNo) override;
  void pause() override;
  void resume() override;
  void stop() override;
  void setFrameNo(double frameNo) override;
  void setLoop(double loops) override;
  void setSpeed(double rate) override;
  void setPlaybackDirection(double direction, double style) override;
  void setSkipFrames(bool skip) override;
  void setSection(double startFrame, double endFrame) override;

  double findPartIndex(const std::string& partName) override;

  std::vector<SsTextureInfo> getTextures() override;
  std::vector<std::string> getAnimationNames() override;

  double drawInto(SkCanvasHandle canvas, const std::vector<SsTextureBinding>& textures) override;

 private:
  /// Refreshes `frame_`, the SoA pointers and `partCount_` from the Brain for
  /// the current frame. Called by `update()`; the getters below just read it.
  void refreshFrame();

  /// A view over the bound `.ssab`, read in place out of the Brain's copy.
  /// Cheap (two pointers), so the load-time metadata queries just build one each
  /// rather than caching a parse nothing else needs.
  sscore::SsAnimeBinaryView ssab() const;

  /// The one place the Brain context is given back, and the borrowed pointers
  /// with it. Guarded on `ctx_` so dispose-then-destruct releases once and
  /// decrements once.
  void release() noexcept;

  /// Drives every effect slot one tick at the current playhead.
  ///
  /// `dtMilliseconds` is what `update()` was handed (0 for a seek) and `looped`
  /// the parent's loop edge for this tick. Called from `update()` and from
  /// `resync()`, never from the draw: `40_components/20_effect.md` is explicit
  /// that stepping must not be driven off `draw_order`, since the Brain drops a
  /// hidden effect from it and an independent one would then freeze in mid-air.
  void stepEffects(float dtMilliseconds, bool looped);

  /// Re-reads the playhead from the Brain and republishes the frame.
  ///
  /// Every transport call that moves the playhead goes through this, so a seek
  /// invalidates outstanding buffers exactly the way an `update()` does — JS
  /// has one rule to follow instead of a list of exceptions. `frameNo_` is a
  /// cache of the Brain's playhead and `refreshFrame()` reads the FrameData
  /// *at* it, so skipping this would leave the pose showing the old frame.
  void resync();

  /// Keeps the `.ssab` alive for as long as this context can touch it.
  std::shared_ptr<HybridSsResource> resource_;
  void* ctx_ = nullptr;

  double generation_ = 0;
  float frameNo_ = 0.0f;
  size_t partCount_ = 0;

  /// The Brain's FrameData for `frameNo_`, read in place. A raw pointer on
  /// purpose: it is a borrow into a buffer `libssruntime` recycles on the next
  /// `update()`, and null whenever there is no frame to read.
  const ss::runtime::FrameData* frame_ = nullptr;
  sscore::SsSoAPointers soa_;

  sscore::SsBaker baker_;
  /// `drawInto`'s texture table, in the Nitro-free shape `SsSkiaDraw` takes.
  /// A member so the per-frame repack reuses one allocation.
  std::vector<::ssplayer::SsPaintBinding> paintBindings_;

  /// The static half of masking, read once from the `.ssab` at construction and
  /// indexed by part index. The per-frame half (`mask` / `hide` / the rank) comes
  /// out of `FrameData` in `maskPlan_`; keeping the two apart is the first thing
  /// the mask spec asks of a Player.
  std::vector<sscore::SsMaskPartFlags> maskFlags_;
  /// Rebuilt every `drawInto`. A member so the writer vector is reused rather
  /// than reallocated per frame, like `baker_`'s buffers.
  sscore::SsMaskPlan maskPlan_;

  /// One slot per effect part, bound at construction and stepped from
  /// `update()` — not from the draw, because an effect's clock needs a delta and
  /// because a hidden independent effect must keep running even though the Brain
  /// has dropped it from `draw_order`.
  sscore::SsEffectSlots effects_;
};

}  // namespace margelo::nitro::ssplayer
