#pragma once

#include <memory>
#include <string>
#include <vector>

#include "HybridSsContextSpec.hpp"
#include "HybridSsResource.hpp"
#include "SsAnimeBinary.hpp"
#include "SsBaker.hpp"
#include "SsFrameData.hpp"
#include "SsSkiaBridge.hpp"
// For `SsPaintBinding` only. Safe in a header: SsSkiaDraw.hpp keeps its Skia
// pointers opaque precisely so consumers never need the Skia headers.
#include "SsSkiaDraw.hpp"

namespace margelo::nitro::ssplayer {

/// One playing animation — the Phase 0 measurement subject.
///
/// Every buffer handed to JS is a borrow that `update()` invalidates. Two
/// separate things can dangle and they are kept apart deliberately:
///
///   - the Brain's SoA buffers and FrameData, recycled inside `libssruntime`;
///   - this object's own `plan_` / `partAlpha_` / baker vectors, resized here.
///
/// Neither is refcounted by the JS side, so `generation_` is the only thing
/// standing between a retained ArrayBuffer and a read of recycled memory. It is
/// stamped into every struct handed out; JS compares before it reads.
class HybridSsContext final : public HybridSsContextSpec {
 public:
  explicit HybridSsContext(const std::shared_ptr<HybridSsResource>& resource);
  ~HybridSsContext() override;

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

  SsFramePlan getPlan() override;
  SsSoAFrame getSoA() override;
  SsBakedFrame bake() override;
  double drawInto(SkCanvasHandle canvas, const std::vector<SsTextureBinding>& textures) override;

 private:
  /// Refreshes `frame_`, the SoA pointers and `partCount_` from the Brain for
  /// the current frame. Called by `update()`; the getters below just read it.
  void refreshFrame();

  /// A view over the bound `.ssab`, read in place out of the Brain's copy.
  /// Cheap (two pointers), so the load-time metadata queries just build one each
  /// rather than caching a parse nothing else needs.
  sscore::SsAnimeBinaryView ssab() const;

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

  sscore::FrameDataView frame_;
  sscore::SsSoAPointers soa_;

  sscore::SsBaker baker_;
  /// Variant (a)'s batch list — the same walk `bake()` does, without the bake.
  std::vector<sscore::SsBatchDesc> plan_;
  /// Variant (a)'s per-part alpha, lifted out of the FrameData `parts` vector
  /// so JS does not have to know the 144-byte `PartState` layout.
  std::vector<float> partAlpha_;
  /// `drawInto`'s texture table, in the Nitro-free shape `SsSkiaDraw` takes.
  /// A member so the per-frame repack reuses one allocation.
  std::vector<::ssplayer::SsPaintBinding> paintBindings_;
};

}  // namespace margelo::nitro::ssplayer
