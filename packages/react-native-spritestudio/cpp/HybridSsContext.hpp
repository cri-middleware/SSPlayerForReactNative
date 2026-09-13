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
#include "SsInstance.hpp"
#include "SsMask.hpp"
#include "SsRNSkiaInterop.hpp"
// For `SsPaintBinding` only. Safe in a header: SsSkiaDraw.hpp keeps its Skia
// pointers opaque precisely so consumers never need the Skia headers.
#include "SsSkiaDraw.hpp"

namespace margelo::nitro::ssplayer {

/// A pack an instance part can mount, keyed by `SsAnimeBinary.name_hash`.
///
/// Shared down the whole tree by value-copy of the vector, which is a handful of
/// `shared_ptr`s: a pack referenced twice is loaded once and both mounts hold
/// the same resource, which is also what keeps `liveHandles`' resource count
/// meaningful.
struct SsInstancePackEntry {
  uint32_t nameHash = 0;
  std::shared_ptr<HybridSsResource> resource;
};

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
/// The geometry no longer leaves C++ at all — `drawInto` bakes and
/// draws in one call — so the only buffer still crossing is an embedded atlas on
/// its way to Skia. The rule stays, because the next thing to cross will be
/// subject to it too.

class HybridSsContext final : public HybridSsContextSpec,
                              public sscore::SsInstanceChild,
                              public ::ssplayer::SsInstanceRenderer {
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
  bool getIsPlayingForward() override;
  double getFps() override;
  double getStartFrame() override;
  double getEndFrame() override;
  double getAnimationSpeed() override;
  double getLoops() override;
  double getRemainLoops() override;
  double getPlaybackDirection() override;
  double getPlaybackStyle() override;
  bool getSkipFrames() override;
  bool getSubFrame() override { return subFrame_; }

  /// Takes the *spec* type, because that is what nitrogen declares — every
  /// `SsResource` crossing from JS is one of ours, so the downcast below is
  /// checked rather than assumed only to keep a hand-rolled implementer honest.
  bool bindInstancePack(const std::shared_ptr<HybridSsResourceSpec>& pack) override;
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
  void setFrameRate(double fps) override;
  void setSubFrame(bool enabled) override;

  double findPartIndex(const std::string& partName) override;

  SsBox measureContentBox(const std::vector<std::string>& animations,
                          double maxFrames) override;

  SsPartTransform getPartTransform(double partIndex) override;
  bool isPartHidden(double partIndex) override;
  bool isPartSkinnedMesh(double partIndex) override;
  double getPassedEventCount() override;
  std::vector<SsUserDataEvent> getUserDataEvents() override;
  std::vector<SsAudioEvent> getAudioEvents() override;
  std::vector<SsSignalEvent> getSignalEvents() override;

  bool setPartVisibility(double partIndex, double force, bool cascade) override;
  bool clearPartVisibility(double partIndex) override;
  bool setPartColor(double partIndex, double blendOp, double rgba, double priority) override;
  bool clearPartColor(double partIndex) override;
  bool setPartCell(double partIndex, double cellmapNameHash, double cellNameHash,
                   double priority) override;
  bool clearPartCell(double partIndex) override;
  bool clearPartOverrides() override;

  std::vector<SsTextureInfo> getTextures() override;
  std::vector<std::string> getAnimationNames() override;
  std::vector<std::string> partNames() override;
  std::vector<std::string> cellmapNames() override;
  std::vector<std::string> cellNames(const std::string& cellmapName) override;

  double drawInto(SkCanvasHandle canvas, const std::vector<SsTextureBinding>& textures) override;

  // --- `SsInstanceChild`: this player driven as somebody else's instance ----
  //
  // The same object is a root player and a child, exactly as
  // `SpriteStudioInternalPlayer` is in SSPlayerForFlutter. What differs is only
  // who owns the clock: a root advances its own in `update()`, a child has
  // `ss_instance_slot_step` seek it and then only refreshes.

  void* instanceContext() const override { return ctx_; }
  float instanceFrameNo() const override;
  void instancePlay() override;
  void instanceStop() override;
  void instanceResetSlots() override;
  void instanceStepSlots(float childFrame, float dtMilliseconds, bool childLooped) override;

  // --- `SsInstanceRenderer`: draw the child mounted on one of my parts ------

  size_t drawInstance(void* canvas, uint32_t partIndex, float alphaScale,
                      const ::ssplayer::SsMaskInput& mask) override;

 private:
  /// The child constructor. `packs` is the resolved external set, passed down
  /// unchanged.
  ///
  /// **Nothing bounds the recursion**, deliberately — see the non-goal in
  /// ROADMAP.md. An instance part that mounts its own animation has no finite
  /// expansion, and this port follows the data rather than deciding on the
  /// author's behalf where it should have stopped.
  HybridSsContext(const std::shared_ptr<HybridSsResource>& resource,
                  std::vector<SsInstancePackEntry> packs);

  /// Bakes and draws this player's whole subtree into `canvas`.
  ///
  /// Shared by `drawInto` (root, `alphaScale` 1) and `drawInstance` (child,
  /// carrying the mount point's opacity), so the two cannot drift — a child is
  /// not a special case of drawing, it is the same draw one transform down.
  ///
  /// `inherited` is the caller's mask, already composed at the mount point
  /// (§2-6). When it carries a plan this subtree resolves against **that**
  /// coverage instead of building its own, so a mask drawn one level up reaches
  /// down here; its `flags` are filled in below from this player's own parts,
  /// because part indices do not cross an instance boundary.
  size_t drawSubtree(void* canvas, const ::ssplayer::SsPaintBinding* textures,
                     size_t textureCount, float alphaScale,
                     const ::ssplayer::SsMaskInput& inherited = {});

  /// Bakes this child and builds its own writer plan so a **caller** can carry
  /// its clipping writers into its own coverage (§2-6 carry-over). Returns true
  /// only when the plan holds at least one clipping writer worth lifting. Baked
  /// at alpha 1 (coverage ignores vertex colour) and re-baked for real when the
  /// child later draws; a caller reads `baker_` / `maskPlan_` right after this,
  /// before that re-bake. Called by an owner's `drawSubtree`, on the child.
  bool prepareForBubble();

  /// Spawns one child per instance part, once.
  ///
  /// Deferred to the first `setupAnimation` rather than done in the constructor,
  /// which is what SSPlayerForWeb's `PackResolver` does and for the same reason:
  /// an external pack has to be bound before its child can resolve, and binding
  /// happens after `createContext`.
  void buildInstanceChildren();

  /// Appends this player's textures and then every child's, skipping hashes
  /// already present. Recursive, so a pack three mounts down still contributes.
  void collectTextures(std::vector<SsTextureInfo>& out);

  /// The resource holding `packNameHash`'s animations, or null.
  ///
  /// External packs win, then the own pack, matching the flagship's
  /// `_resolve_ssab_by_hash`. A hash of 0 is an author who left the reference
  /// pack-less, which also means the own pack.
  std::shared_ptr<HybridSsResource> resolvePack(uint32_t packNameHash) const;
  /// Refreshes `frame_`, the SoA pointers and `partCount_` from the Brain for
  /// the current frame. Called by `update()`; the getters below just read it.
  void refreshFrame();

  /// Unions this player's baked vertices into `box`, mapped through the 2D
  /// affine `m`, and recurses into every child an Instance part mounts.
  ///
  /// Mirrors `drawSubtree` deliberately: an instance contributes no geometry of
  /// its own, so a walk that stopped here would measure an empty box for a pack
  /// like `overall/Instance.ssab`, whose art is *entirely* mounted. `box` is
  /// `{minX, minY, maxX, maxY}` and is left untouched when nothing drew.
  void accumulateSubtreeBox(float box[4], const float m[6]);

  /// `ssab_`, or an empty view once the context is gone.
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

  /// A verified view over the bound `.ssab`, built once in the constructor.
  ///
  /// Kept rather than rebuilt per query, because building one runs the
  /// FlatBuffers verifier over the whole pack — 470 us on Ringo — and the
  /// queries are not all load-time: `resolvePack` asks per instance part, and
  /// the three event getters ask on every frame carrying an event. It borrows
  /// through `resource_`, so `release()` clears it.
  sscore::SsAnimeBinaryView ssab_;

  double generation_ = 0;
  float frameNo_ = 0.0f;
  /// Whether the DISPLAY frame keeps its fraction. On by default: this Player
  /// draws for applications, where interpolating between authored frames is the
  /// point (the game engines default it off). `frameNo_` itself is never
  /// rounded — see `refreshFrame`.
  bool subFrame_ = true;
  /// Index of the animation `setupAnimation` last selected, or -1.
  ///
  /// The Brain reports a passed event as a position in *that* animation's
  /// `events` vector, so without this the indices cannot be resolved back to
  /// the keys they name.
  int32_t animationIndex_ = -1;
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

  /// One slot **and one child player** per instance part. Same stepping rule as
  /// the effects, and the same reason.
  sscore::SsInstanceSlots instances_;
  /// Built once, at the first `setupAnimation`.
  bool instancesBuilt_ = false;
  /// The external packs this subtree may mount, resolved by JS and handed down.
  std::vector<SsInstancePackEntry> instancePacks_;

  /// The texture table of the `drawSubtree` currently on the stack, borrowed so
  /// `drawInstance` can pass it down. Null outside a draw.
  const ::ssplayer::SsPaintBinding* drawTextures_ = nullptr;
  size_t drawTextureCount_ = 0;
};

}  // namespace margelo::nitro::ssplayer
