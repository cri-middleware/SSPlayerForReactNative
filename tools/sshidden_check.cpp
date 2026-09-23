// Pins the rule that instance slots are stepped from the **part list**, never
// from `draw_order`.
//
// The Brain drops a `Hide`-ed part from `draw_order` and from the draw batches
// — documented SDK design, not a gap. A host that
// walked the draw plan to decide what to step would therefore stop stepping a
// part the moment it is hidden, and an independently-played child would resume
// late by exactly the time it spent hidden. `SsInstanceSlots::step` avoids that
// by iterating its own states, which come from `SsAnimeBinaryView::instanceParts`
// — but nothing failed if that changed, which is what this check is for.
// SSPlayerForWgpu pins the same invariant in `tests/slots.rs`, SSPlayerForRenPy
// in `tools/verify_hidden.py`; this is that check for this port.
//
// The step signal is `SsInstanceChild::instanceContext()`, which `step()` calls
// once per slot immediately before `ss_instance_slot_step` and nowhere else on
// the tick path. Counting it therefore counts "this slot was stepped", and a
// rewrite that drives stepping off the draw walk stops the count for exactly the
// ticks the part is hidden.
//
// `instanceStepSlots` — the recursion into the child's own slots, which `step()`
// runs only for a slot the Brain reports live — is counted beside it. On this
// fixture the two stay equal even across the hide window, and that is worth
// seeing: the slot's `visible` is `EventInstance` liveness, not the part's
// `hide`. Hiding a part removes it from `draw_order`, not from the slot walk.
//
// Usage: sshidden_check [ssab] [animation] [ticks]
//   ssab       default: example/assets/ss/overall/Instance.ssab
//   animation  default: anime_1
//   ticks      default: 130 (at 33 ms, past the fixture's hide window)

#include <cstdint>
#include <cstdio>
#include <string>
#include <vector>

#include "SsAnimeBinary.hpp"
#include "SsInstance.hpp"
#include "format/framedata.h"
#include "ssruntime.h"

namespace {

constexpr float kDeltaMs = 33.0f;

int gFailures = 0;

void Fail(const std::string& message) {
  ++gFailures;
  // Flushed first: the failures are interleaved with the per-part table, and
  // two streams that buffer differently would print them out of order.
  std::fflush(stdout);
  std::fprintf(stderr, "FAIL: %s\n", message.c_str());
}

std::vector<uint8_t> ReadFile(const std::string& path) {
  std::FILE* file = std::fopen(path.c_str(), "rb");
  if (file == nullptr) return {};
  std::fseek(file, 0, SEEK_END);
  const long size = std::ftell(file);
  std::fseek(file, 0, SEEK_SET);
  std::vector<uint8_t> bytes(size > 0 ? static_cast<size_t>(size) : 0);
  if (!bytes.empty() && std::fread(bytes.data(), 1, bytes.size(), file) != bytes.size()) {
    bytes.clear();
  }
  std::fclose(file);
  return bytes;
}

std::string DirectoryOf(const std::string& path) {
  const size_t slash = path.find_last_of("/\\");
  return slash == std::string::npos ? std::string(".") : path.substr(0, slash);
}

/// The half of `HybridSsContext` the slots actually drive, without Nitro or
/// Skia. Counts the two hooks rather than doing anything with them.
class HostChild final : public sscore::SsInstanceChild {
 public:
  HostChild(void* resource, const std::string& animeName) {
    ctx_ = ss_runtime_create();
    if (ctx_ == nullptr) return;
    if (!ss_runtime_bind_resource(ctx_, resource) ||
        !ss_runtime_setup_animation(ctx_, animeName.c_str())) {
      ss_runtime_destroy(ctx_);
      ctx_ = nullptr;
      return;
    }
    // Same as the real child: stopped until an `EventInstance` starts it, so it
    // cannot self-advance before the slot has ever fired.
    ss_runtime_stop(ctx_);
  }

  ~HostChild() override {
    if (ctx_ != nullptr) ss_runtime_destroy(ctx_);
  }

  bool ok() const { return ctx_ != nullptr; }
  int steps() const { return steps_; }
  int subTicks() const { return subTicks_; }

  void* instanceContext() const override {
    ++steps_;
    return ctx_;
  }
  float instanceFrameNo() const override {
    return ctx_ == nullptr ? 0.0f : ss_runtime_get_frame_no(ctx_);
  }
  void instancePlay() override {
    if (ctx_ != nullptr) ss_runtime_play(ctx_);
  }
  void instanceStop() override {
    if (ctx_ != nullptr) ss_runtime_stop(ctx_);
  }
  void instanceResetSlots() override {}
  void instanceStepSlots(float, float, bool) override { ++subTicks_; }

 private:
  void* ctx_ = nullptr;
  // Bumped from a `const` hook, which is what makes it a pure observation.
  mutable int steps_ = 0;
  int subTicks_ = 0;
};

/// One watched instance part.
struct Watch {
  uint32_t partIndex = 0;
  std::string name;
  const HostChild* child = nullptr;
  /// Ticks the part was missing from `draw_order`. Measured rather than assumed:
  /// it is both the thing a draw-order-driven walk would trip over and the proof
  /// that this fixture reaches the case at all.
  int unrankedTicks = 0;
  /// Unranked ticks on which the slot was **not** stepped — the freeze this
  /// check exists to catch. Must stay 0.
  int frozenTicks = 0;
  /// Every tick the slot was skipped, hidden or not. Reported per part rather
  /// than per tick: a real regression misses a whole hide window, and a hundred
  /// identical lines bury which part it was.
  int unsteppedTicks = 0;
  std::vector<int> firstUnstepped;
};

/// Every `.ssab` an instance part can reach: this one, plus the siblings the
/// pack's own manifest names. Keyed the way `packNameHash` addresses them.
struct PackTable {
  struct Entry {
    uint32_t nameHash = 0;
    void* resource = nullptr;
  };
  std::vector<Entry> entries;
  void* own = nullptr;
  uint32_t ownHash = 0;

  void* resolve(uint32_t packNameHash) const {
    if (packNameHash == 0 || packNameHash == ownHash) return own;
    for (const Entry& entry : entries) {
      if (entry.nameHash == packNameHash) return entry.resource;
    }
    return nullptr;
  }

  void release() {
    for (Entry& entry : entries) {
      if (entry.resource != nullptr) ss_resource_destroy(entry.resource);
    }
    entries.clear();
  }
};

}  // namespace

int main(int argc, char** argv) {
  const char* ssabPath =
      argc > 1 ? argv[1] : "example/assets/ss/overall/Instance.ssab";
  const char* animation = argc > 2 ? argv[2] : "anime_1";
  const int ticks = argc > 3 ? std::atoi(argv[3]) : 130;

  const std::vector<uint8_t> ssab = ReadFile(ssabPath);
  if (ssab.empty()) {
    std::fprintf(stderr, "cannot read %s\n", ssabPath);
    return 1;
  }
  const sscore::SsAnimeBinaryView view(ssab.data(), ssab.size());
  if (!view.valid()) {
    std::fprintf(stderr, "%s failed .ssab verification\n", ssabPath);
    return 1;
  }

  PackTable packs;
  packs.own = ss_resource_create_copy(ssab.data(), ssab.size());
  packs.ownHash = view.packNameHash();
  if (packs.own == nullptr) {
    std::fprintf(stderr, "ss_resource_create_copy failed for %s\n", ssabPath);
    return 1;
  }

  // The siblings an Instance part reaches, loaded the way the JS pack walk does
  // it: a name in the manifest is a path next to the `.ssab`.
  const std::string dir = DirectoryOf(ssabPath);
  for (const sscore::SsExternalPack& pack : view.externalInstancePacks()) {
    const std::string path = dir + "/" + pack.name + ".ssab";
    const std::vector<uint8_t> bytes = ReadFile(path);
    if (bytes.empty()) {
      std::printf("    note: external pack '%s' not found beside the .ssab\n", pack.name.c_str());
      continue;
    }
    void* resource = ss_resource_create_copy(bytes.data(), bytes.size());
    if (resource != nullptr) packs.entries.push_back({pack.nameHash, resource});
  }

  void* ctx = ss_runtime_create();
  if (ctx == nullptr || !ss_runtime_bind_resource(ctx, packs.own)) {
    std::fprintf(stderr, "ss_runtime_bind_resource failed\n");
    return 1;
  }
  ss_runtime_set_render_mode(ctx, 0);
  if (!ss_runtime_setup_animation(ctx, animation)) {
    std::fprintf(stderr, "ss_runtime_setup_animation('%s') failed\n", animation);
    return 1;
  }

  std::vector<Watch> watches;
  sscore::SsInstanceSlots slots;
  slots.build(view, [&](const sscore::SsInstancePart& part) -> sscore::SsInstanceChild* {
    void* resource = packs.resolve(part.packNameHash);
    if (resource == nullptr) return nullptr;
    HostChild* child = new HostChild(resource, part.animeName);
    if (!child->ok()) {
      delete child;
      return nullptr;
    }
    watches.push_back({part.partIndex, std::string(view.partName(part.partIndex)), child, 0, 0, 0});
    return child;
  });

  if (watches.empty()) {
    std::fprintf(stderr, "no instance children built for %s / %s — nothing to check\n", ssabPath,
                 animation);
    return 1;
  }

  // Infinite, so the head keeps playing across the hide window instead of
  // finishing partway through and taking every slot with it.
  ss_runtime_set_loop_count(ctx, 0);
  ss_runtime_play(ctx);

  for (int tick = 0; tick < ticks; ++tick) {
    const float frameNo = ss_runtime_update(ctx, kDeltaMs);
    const bool looped = ss_runtime_just_looped(ctx);

    // Read before the step, so the draw plan is this tick's and not the one the
    // step left behind.
    const unsigned char* fdPtr = nullptr;
    size_t fdLen = 0;
    ss_runtime_get_frame_data(ctx, frameNo, &fdPtr, &fdLen);
    const ss::runtime::FrameData* frame =
        fdPtr != nullptr ? ss::runtime::GetFrameData(fdPtr) : nullptr;
    const auto* drawOrder = frame != nullptr ? frame->draw_order() : nullptr;

    std::vector<int> before(watches.size());
    for (size_t i = 0; i < watches.size(); ++i) before[i] = watches[i].child->steps();

    slots.step(ctx, frameNo, kDeltaMs, looped);

    for (size_t i = 0; i < watches.size(); ++i) {
      Watch& watch = watches[i];
      const bool stepped = watch.child->steps() > before[i];

      bool ranked = false;
      if (drawOrder != nullptr) {
        for (uint32_t r = 0; r < drawOrder->size(); ++r) {
          if (drawOrder->Get(r) == watch.partIndex) { ranked = true; break; }
        }
      }

      if (!ranked) ++watch.unrankedTicks;
      if (!ranked && !stepped) ++watch.frozenTicks;
      if (!stepped) {
        ++watch.unsteppedTicks;
        if (watch.firstUnstepped.size() < 8) watch.firstUnstepped.push_back(tick);
      }
    }
  }

  int unrankedParts = 0;
  for (const Watch& watch : watches) {
    if (watch.unrankedTicks > 0) ++unrankedParts;
    std::printf("    %-28s steps %3d/%d  unranked %3d  frozen %d  sub-ticks %3d\n",
                watch.name.c_str(), watch.child->steps(), ticks, watch.unrankedTicks,
                watch.frozenTicks, watch.child->subTicks());
    if (watch.unsteppedTicks > 0) {
      std::string ticksList;
      for (size_t i = 0; i < watch.firstUnstepped.size(); ++i) {
        ticksList += (i == 0 ? "" : ", ") + std::to_string(watch.firstUnstepped[i]);
      }
      if (watch.unsteppedTicks > static_cast<int>(watch.firstUnstepped.size())) ticksList += ", ...";
      Fail("part '" + watch.name + "' was not stepped on " +
           std::to_string(watch.unsteppedTicks) + " tick(s) [" + ticksList + "]" +
           (watch.frozenTicks > 0 ? " — " + std::to_string(watch.frozenTicks) +
                                        " of them while it was out of the draw plan, i.e. its "
                                        "clock froze exactly when it stopped drawing"
                                  : ""));
    }
  }

  // A fixture where every part stays in the draw plan for every tick asserts
  // nothing — the same rule as `ssbake_check`'s per-kind lines, where zeroes
  // mean the path never ran.
  if (unrankedParts == 0) {
    Fail(std::string("no instance part ever left draw_order in ") + ssabPath + " / " + animation +
         " — the case this check guards is not reached, so it would pass vacuously");
  }

  slots.release();
  ss_runtime_destroy(ctx);
  ss_resource_destroy(packs.own);
  packs.release();

  if (gFailures > 0) {
    std::fprintf(stderr, "\nFAILED: %d problem%s over %d ticks\n", gFailures,
                 gFailures == 1 ? "" : "s", ticks);
    return 1;
  }
  std::printf("OK: %zu instance parts, %d ticks, %d left draw_order mid-timeline, none frozen\n",
              watches.size(), ticks, unrankedParts);
  return 0;
}
