#pragma once

#include <memory>
#include <string>
#include <vector>

#include "HybridSsContextSpec.hpp"
#include "HybridSsResource.hpp"
#include "SsBaker.hpp"
#include "SsFrameData.hpp"
#include "SsSkiaBridge.hpp"

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

  bool setupAnimation(const std::string& name) override;
  double update(double dtSeconds) override;

  SsFramePlan getPlan() override;
  SsSoAFrame getSoA() override;
  SsBakedFrame bake() override;
  double drawInto(SkCanvasHandle canvas, SkPaintHandle paint) override;

 private:
  /// Refreshes `frame_`, the SoA pointers and `partCount_` from the Brain for
  /// the current frame. Called by `update()`; the getters below just read it.
  void refreshFrame();

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
};

}  // namespace margelo::nitro::ssplayer
