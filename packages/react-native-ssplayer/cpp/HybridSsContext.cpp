#include "HybridSsContext.hpp"

#include <NitroModules/ArrayBuffer.hpp>

#include <stdexcept>

#include "SsRuntimeApi.h"
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

double HybridSsContext::update(double dtSeconds) {
  if (ctx_ == nullptr) return 0.0;
  frameNo_ = ss_runtime_update(ctx_, static_cast<float>(dtSeconds));
  ++generation_;
  refreshFrame();
  return static_cast<double>(frameNo_);
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

double HybridSsContext::drawInto(SkCanvasHandle canvas, SkPaintHandle paint) {
  if (!::ssplayer::SkiaDirectAvailable()) {
    throw std::runtime_error(
        "SsContext.drawInto: this build has no direct Skia drawing "
        "(SSPLAYER_ENABLE_SKIA_DIRECT=0). Use bake() instead.");
  }
  // Same bake as variant (b) — the difference measured here is purely what
  // happens to the result, not how it is produced.
  baker_.bake(frame_, soa_);
  return static_cast<double>(::ssplayer::DrawBakedFrame(canvas.canvas, paint.paint, baker_));
}

}  // namespace margelo::nitro::ssplayer
