# SSPlayerForReactNative — Roadmap

Derived from the design doc (*SpriteStudio-SDK v7 React Native Player
アーキテクチャ設計書*, ch.8), amended by what Phase 0 actually measured.

## Design principle — one call per player per frame

Phase 0 established that `Skia.MakeVertices` unmarshals JSI host objects one
vertex at a time, so **any design that routes vertices through JS is capped by
that cost regardless of where the geometry is baked**
([`docs/phase0-spike.md`](docs/phase0-spike.md)).

Everything below therefore assumes **Layer 1 owns the drawing**: the batch walk,
the geometry bake and the Skia calls are all C++, and JS supplies the canvas,
the paint and the transport. This is further down than the design doc originally
drew the line, and it is the one architectural amendment Phase 0 forces.

## Status legend

| | |
|---|---|
| ✅ | Done |
| 🚧 | In progress |
| ☐ | Planned |
| 🕒 | Deferred |
| ⛔ | Blocked on something outside this repo |

---

## ✅ Phase 0 — Decide the L1/L2 boundary by measurement

Done. The spike, the harness and the result.

- ✅ Repo skeleton, SDK submodule, npm workspaces
- ✅ `download-sdk` / `build-runtime` / `deploy-examples` / `generate-nitro-code`,
  `.sh` + `.ps1` + `.js` shims
- ✅ Layer 1: Nitro spec, generated bindings (committed), C++ implementation
- ✅ flatc-generated FlatBuffers accessors + `check-framedata` guard
- ✅ RN Skia `SkCanvas`/`SkPaint` bridge (Nitro `CustomType`)
- ✅ Expo measurement harness with an auto-run sweep (retired in Phase 1, once
  both platforms had been measured in release — it lives in git history)
- ✅ Measured on the iOS simulator; **(c) is the only variant that holds 60 fps
  at full load** — 4.9× faster at 512 players, and the only one still at 60 fps
  where (a)/(b) have fallen to 20. (Re-taken in Phase 1: the Phase 0 figures were
  measured with the RN side in debug *and* the animation never started, so they
  overstated the gap at low load and understated where it appears. The
  conclusion held; the numbers did not — `docs/phase0-spike.md`.)

---

## 🚧 Phase 1 — Basic playback

Make one character animate correctly, on both platforms, through the real API.

- ✅ **Trim the L1 spike surface.** Variants (a) and (b) (`getSoA`, `getPlan`,
  `bake`) are gone; `drawInto` is the only draw path and the spec has stopped
  being a benchmark. The bench screen went with them — it was what the trim was
  deferred for, and the last thing keeping it was the missing Android
  measurement, which is now taken. `BuildBatchPlan` and the `Int32Array` batch
  offsets `index.ts` exported went too: nothing in JS walks batches any more.
  `SsBaker` **stays** — `drawInto` bakes through it, and `check-framedata`
  drives it under ASan as the FrameData read-path guard.
- ✅ **Extend L1 with the transport** the Brain already owns — play / pause /
  stop / seek / loop / speed / direction / section, plus `is_finished` and
  friends — so no layer above mirrors playback state. Plus `hashString`,
  `createResourceFromBytes`, and a `drawInto` that takes a
  `texture_hash → SkPaint` table instead of one paint.
- ✅ **Android native draw.** `SSPLAYER_ENABLE_SKIA_DIRECT=1`, verified on an
  emulator: `overall/Basic` renders and animates, with its embedded textures
  loaded automatically. This was billed as the single biggest risk in Phase 1
  and as possibly needing an upstream prefab request; neither held.
  - The premise was wrong three times over. RN Skia **does** publish a prefab
    (`rnskia`, enabled for RN > 68), it **does** export Skia — 37015 `Sk*`
    symbols — and, underneath all of it, **the Android side had never been
    built at all**: no `ReactPackage` implementation meant autolinking skipped
    the package, so it was not even a Gradle subproject.
  - Eight of the ten things that had to be fixed were wiring that had simply
    never been exercised: no `ReactPackage`, no Kotlin plugin (so the generated
    Kotlin was never compiled), no `JNI_OnLoad` (nitrogen generates the
    registration but not its caller), a wrong dependency project name, a
    hardcoded `abiFilters` that ignored the app's choice, `minSdk 21` against
    React Native's floor of 24, and two stale autolinking caches.
  - Two are genuinely upstream, and both are worth reporting:
    **(a)** RN Skia's prefab flattens `cpp/**` into one directory, so
    `cpp/jsi/JSIConverter.h` lands as `JSIConverter.h` while `JsiSkConverters.h`
    still includes it as `"jsi/JSIConverter.h"` — its own headers do not compile.
    We take the library from the prefab and the headers from its source tree.
    **(b)** Skia is built with hidden visibility and exports only what `SK_API`
    marks. `SkCanvas::drawVertices` is exported; `SkVertices::MakeCopy` is not,
    and sits in the same `.so` as a local symbol — while RN Skia ships
    `JsiSkVertices.h`, whose inline code calls it. Closed by linking `libskia.a`
    *after* the prefab, so only the un-exported leaves come from the archive and
    there is still one Skia in the process.
- ✅ **Layer 2** — `SsInternalPlayer`: native-handle lifecycle, `dispose()`
  discipline, the root transform, one draw call per frame. **Zero
  `react`/`react-native` imports.**
- ✅ **Layer 3** — `SpriteStudioPlayer`: `play`/`pause`/`stop`/`setAnimation`/
  `seek`/`speed`/`loop`, externally clocked via `advance(dt)` by default
  (`startClock()` self-drives for headless use). `SpriteStudioPlayerApi` states
  the transport surface with no drawing backend in it, so the Phase 3 web
  implementation can satisfy the same one.
- ✅ **Layer 4** — `<SpriteStudioView>`: RN Skia `Canvas`, declarative props
  (`source`/`textures`/`animation`/`playing`/`speed`/`loop`/`flipX`/`flipY`/
  `offset`/`scale`) plus imperative `ref`.
- ✅ **Asset resolution: a pack is a directory.** Everything a `.ssab` points at
  is a sibling name, so the unit that has to reach the device is the converter's
  output *directory* — and Metro cannot carry one. `require()` is therefore no
  longer an `SsSource`; a source is a location (`asset` / `file` / `remote`) and
  `core/assets.ts`'s `resolveAgainst` is the single seam every reference
  resolves through. The pack directories ship as **native app assets** via the
  Expo config plugin, read back by `cpp/SsAssets` — the `.app`'s resource
  directory on iOS (so the `.ssab` still goes disk → Brain with no JS heap in
  between) and `AAssetManager` on Android, which closes the APK gap this entry
  used to record. Textures use the same seam today; Instance parts and `.ssqb`
  sequences will use it unchanged.
- ✅ **Texture registry** keyed on `cellmap.name_hash`, multiple textures per
  pack, with the hash coming from the Brain via `SsRuntime.hashString`.
- ✅ **Read the `.ssab` in C++** — flatbuffers submodule + `flatc -c` into
  `cpp/format/ssab.h` (committed), the SSPlayerForGodot arrangement. Layer 1
  answers typed questions (`getTextures`, `getAnimationNames`); no FlatBuffer
  crosses into JS and the read happens in place against the Brain's own copy.
- ✅ **Load a pack's own textures on load**, walking both `cellmaps()` and
  `external_textures()`, embedded winning over a reference. **Reference mode now
  reaches its sibling everywhere an `SsSource` can point** — the asset
  directory, a real filesystem directory, or a server — because all three keep
  their directory and `resolveAgainst` hands back a URI of the same kind. This
  was the standing gap: while the `.ssab` was named with a `require()` there was
  no directory for the atlas to be a sibling of, and `example/` had to supply
  its reference pack's texture by hand. The `textures` prop is now for
  *replacing* a texture, not for making a pack draw.
- ✅ **Make `dispose()` actually dispose, and make the leak check runnable.**
  The exit criterion below asks for "no leaked native handles" and there was
  nothing behind it — no way to observe a handle, and, it turned out, a teardown
  that did not happen. Nitro's `HybridObject::dispose()` is a virtual **no-op**:
  it calls the (empty) hook and strips the JS object's NativeState, leaving the
  C++ object to the collector. Neither `HybridSsResource` nor `HybridSsContext`
  overrode it, so every `dispose()` L2/L3/L4 make a point of calling — on
  unmount, on a superseded load, on a re-`load()` — released no Brain handle at
  the moment it was called, and four separate comments claiming "explicit
  teardown, never GC" described something that was not happening. Both hybrids
  now override it; `release()` is guarded on the handle so dispose-then-destruct
  frees exactly once, and the context bumps `generation_` on the way out because
  teardown invalidates outstanding borrows the same way `update()` does.
  `SsRuntime.liveHandles` (two atomic counters) and `ssCheckForLeaks()` are the
  instrument: load and dispose N times, and both counts must return to baseline.
  The comparison can be exact *because* the release is now eager — before the
  override there was no way to tell a leak from a GC that had not run yet.
- 🕒 **Free an embedded atlas after decoding.** Blocked on the Brain: the encoded
  bytes sit inside the same contiguous FlatBuffer `ss_resource_create_copy` holds
  for the resource's life, so embedded permanently costs one encoded atlas on top
  of the decoded texture. Needs an SDK-side way to drop `embedded_assets`, or a
  converter that emits a stripped companion.
- ✅ Re-measure on **release builds** — both sides, iOS simulator, with the
  animation actually playing. Turned up two measurement bugs and moved every
  absolute number; see `docs/phase0-spike.md`.
- ☐ Re-measure on a **real device**. Not done: no device was connected. The
  simulator's host is an Apple Silicon Mac, so the CPU side — the side (a)/(b)
  are limited by — is flattered relative to a phone.
- ✅ Re-measure on **Android**, release on both sides. The block this entry
  carried was stale twice over: Android's (c) landed earlier in Phase 1, and the
  Android table taken right after it was a *debug* one. In release the structure
  is iOS's exactly — (a) and (b) within 3% at every load and strictly linear in
  instance count, (c) sublinear and alone at 60 fps — and (c) at 512 players
  costs 10.01 ms against the iOS simulator's 10.15. The gap over (a) is 4.1× at
  128, 5.2× at 256, **5.8× at 512**. Note the direction the debug numbers erred:
  they made (c) look *better* (7.0× at 512), because a debug RN/Hermes inflates
  the very side (a)/(b) are limited by. Emulator, not a device —
  `docs/phase0-spike.md` has the caveats.
- ☐ Scope: Normal parts, normal blending, reference-layout `.ssab`.

**Exit criteria:** `overall/Basic` animates correctly from `<SpriteStudioView>`
on an iOS device and an Android device, at 60 fps, with no leaked native
handles.

Of these, **only "on a device" is still outstanding.** "No leaked native handles"
is closed on both platforms — an iOS 26.5 simulator and an `sdk_gphone64_arm64`
emulator both report `clean after 8 cycles — resources 1→1, contexts 1→1`. Both
were checked against a **negative control first**, because `1→1` is also exactly
what a *frozen* counter prints: holding three undisposed players takes the counts
to `4/4`, and disposing them returns them to `1/1` **in the same tick**, which is
the evidence that the release is eager rather than a GC that happened to run.
Without that control the check proves nothing — the same trap as `verts` holding
constant across the Phase 0 sweep while nothing was actually playing.

---

## 🚧 Phase 2 — Full feature parity

- ✅ All blend modes, including the multi-pass Sub / Invert reconstruction
  (ground truth: `ssplayer-webgl`'s `applyBlend`; **only RGB varies — alpha is
  premultiplied source-over for every mode**). `cpp/SsBlend.hpp`: ten types are
  one `SkBlendMode`, Sub and Invert are rebuilt from three passes each, and
  `SsSkiaDraw` peels those batches into single quads because the inversion passes
  have to cover each pixel exactly once. The Skia mapping is taken from
  **SSPlayerForFlutter**'s `render/blend.dart` rather than re-derived — Flutter's
  `ui.BlendMode` *is* `SkBlendMode`, so its algebra carries over unchanged.
  The table landed a commit before it did anything. Every mode was handed to
  `drawVertices`'s `SkBlendMode` argument, which blends against *vertex colours*
  and is ignored when there are none — so all twelve rendered as Mix. The
  framebuffer blend is `SkPaint::setBlendMode`. **The old "verified on Android"
  note recorded that bug as a pass**: the one black cell it cited was Invert's
  third pass drawing its black filter source-over, and Sub's cell was plain
  white. Both halves are now checked — the Brain emits all eight of
  `BlendMode.ssab`'s types (host probe over `SsBaker`), and the Player screen
  draws them differing from each other.
  **Still open:** Flutter carries pixel tests (`test/blend_pixel_test.dart`) that
  measure every row against the GL formula instead of trusting the algebra, and
  this port has no equivalent. "The modes differ from each other" is proven;
  "each mode is *right*" is not.
- 🚧 **Mask and clipping** via the coverage-pass method (§3-2 — Skia has no
  stencil), matching the Flutter Player's `mask.dart` / `mask_context.dart`.
  Writers are every kind the renderer bakes geometry for — Normal, Mask, Mesh
  and Shape; targets are the quad-shaped ones plus Shape, which can be one
  precisely because it samples nothing.
  `cpp/SsMask.{hpp,cpp}` is the Skia-free half — the roles (`pure_mask` /
  `is_writer` / `is_clipping`), the per-frame writer set walked off `draw_order`,
  the player-local coverage box and each target's two writer sets;
  `cpp/SsMaskShader.hpp` is the SkSL half.
  Two departures from the reference, both forced and both simplifications.
  **The coverage is an `SkImages::DeferredFromPicture`, not a render target**,
  because `drawInto` runs on a *recording* canvas — Layer 4 records one
  `SkPicture` per frame, so there is no `GrDirectContext` to make a surface
  from. Skia rasterises it when the outer picture plays back, in the same frame,
  which deletes §3-2-3 outright: size classes, the lightweight double buffer and
  the shrink hysteresis all exist to cover a one-frame delay this path does not
  have. **The replay reads its coverage UV from the texcoord**, the same trick
  `SsPartColorShader` uses, so the fragment-space inverse Flutter computes per
  writer disappears. Scope stays resolved on the CPU as it is there, so the
  shader takes two 24-bit sets instead of the flagship's `mask_meta[]`; the two
  planes are kept apart to the decision, which is §3-1-4 rather than an
  optimisation — `Invert` and `Increment` do not commute.
  Checked on the host in two places, and the split is the lesson. `ssbake_check`
  builds the plan under ASan every frame and asserts its ranges and that the
  planes stay disjoint — on `Mask.ssab`, 120 frames with a plan, 1080
  writer-frames, 1680 target-frames. But **the plan was never the fragile half**:
  it reported those seven healthy writers while nothing whatsoever was masked,
  because `SkImages::DeferredFromPicture` returns null for a null colour space
  and the draw path then quietly skipped every target. `tools/check-mask.sh`
  (`npm run check-mask`) is the guard that would have caught it: the SkSL
  compiles, all 24 coverage bits survive the image round-trip into an unmanaged,
  an sRGB and a Display P3 destination, the coverage planes stay apart, and the
  real `DrawBakedFrame` output must differ with the mask input from without.
  **The two writers this used to be waiting on are in**, so `Mask.ssab` no
  longer has parts that are expected to do nothing and can finally be read as
  pass or fail. Coverage is no longer quad-only: writers carry their own
  vertex/index ranges, the union box is taken over every vertex rather than four
  corners, and a writer with no atlas to threshold (a Shape) lays its bit down
  as a flat colour instead of through the sampling shader. `quadGeometry` became
  `bakedGeometry` with it — the name was the assumption. `tools/check-mask.sh`
  reports **9 writers where it reported 7**, which is the whole of the change
  measured in one number.
  **The iOS divergence is found, and it was colour management.** Android drew
  `Mask.ssab` as expected while the iOS simulator got `Normal-Clipping-True`,
  `mask_Circle_Reversed` and `mask_Circle_1` wrong, and the cause is that the
  bits used to ride in the coverage's **RGB** channels. RGB is colour, so Skia
  converts it: the coverage image is always tagged sRGB (a recording canvas has
  no colour space to match and `DeferredFromPicture` refuses a null one), RN
  Skia's Apple surface is `MakeRGB(kSRGB, kDisplayP3)` whenever the screen's
  gamut is P3 and its Android GL surface is unmanaged. The gamut matrix scales
  the channels by ~0.82/0.97/0.91 and bleeds each into the others, so bit 2
  decodes as bits 0+1 — six of `Mask.ssab`'s nine writers decoded as the wrong
  writer, on iOS only.
  It was "not reproducible on the host" only because **the check was wiring the
  two ends together**: `ssmask_check` built the coverage with the *destination's*
  colour space, so `src == dst`, the transform was skipped, and its Display P3
  case passed. Fixing the check to model the real pairing — sRGB coverage,
  varying destination — reproduces it in one run, 14 of 24 bits.
  The fix is the structural one this entry called for, one step better than the
  three A8 images it sketched: the bits move into **alpha**, which
  `SkColorSpaceXformSteps` passes through untouched (measured: all 256 values
  round-trip through sRGB → P3), and the three 8-bit planes are stacked
  vertically in the **one** deferred picture image rather than split across three
  of them — one child shader, one image, and only the planes a frame reaches get
  built. Two things fall out: the coverage's colour space becomes a formality,
  and a flat Shape writer no longer has to state one at all. The coverage UV's
  upper bound became exclusive with it, since `cuv.y == 1.0` now lands in the
  next plane rather than off the image.
  **Seen drawing on the iOS simulator**, with the three parts that were wrong
  now right, and the end-to-end host numbers are unchanged either side of the
  encoding change (`lit 49152 -> 33701, 15451 px differ`), so the Android
  emulator's picture is the same one it already was. This card is now the only
  place in the repo where the two platforms have ever disagreed, which is the
  argument for reading it on **both** rather than one.
  **What is left:** §2-6's instance composition — a mask reaching an instance
  part applies to the whole sub-animation, and the calling part's settings
  compose with the callee's rather than replacing them, which is a context to
  thread down the tree rather than a finished test; and the same pixel-test gap
  the blends and PartColor have. A **Mesh target** is still unmasked: the replay
  places its coverage sample from the texcoord, and a mesh needs that channel
  for its atlas — a Shape can be masked precisely because it does not. A masked part also drops the multi-pass Sub/Invert
  reconstruction for the one-pass approximation, because the inversion passes
  cancel only where the middle pass drew.
- 🚧 **PartColor** — landed for **Normal** parts, the kind the renderer draws.
  The *other* blend (§1-0): shader-side, four modes only, `rate`-weighted.
  `cpp/SsPartColor.hpp` is the data side (§1-4's coefficient table, the four
  corners, the UV inverse), `cpp/SsPartColorShader.hpp` the SkSL runtime effect.
  Ported from **SSPlayerForFlutter**'s `shaders/partcolor.frag`, which faced the
  same constraint — Skia vertices carry no custom attributes, so the corner
  colours and rates become uniforms and each tinted part is drawn on its own
  quad. One departure: the gradient is reconstructed from the **UV** rather than
  the fragment position, because `drawVertices` evaluates the shader at the
  interpolated texcoord, so the canvas matrix drops out and no CTM inverse has to
  be computed or passed. Exact: the host check measures 0 round-trip error on
  axis-aligned cells and ~1e-7 on rotated ones.
  It also closed a bug older than itself: **`PartState.alpha` was never read**,
  so every part drew fully opaque. `Basic.ssab` alone bakes 936 alpha-carrying
  vertices over 120 frames that used to be thrown away. Alpha now rides the
  vertex colour, which is also what keeps a `rate == 0` PartColor (§1-2-4's
  passthrough) on the batched path instead of the shader.
  **What is left:** the Mesh (whole-only) and Shape (rate forced to 1, formula
  bypassed) rules from §1-2, which need those part kinds first; and pixel tests,
  the same gap the framebuffer blends have.
- 🚧 **Mesh** — landed. The Brain does the skinning, so the Player's whole job is
  to slice the CSR SoA buffers (`40_components/30_mesh.md`) and draw: vertices
  arrive **already world-space** and must not meet the world matrix again, UVs
  are static, indices are part-local and get rebased onto the batch.
  It forced the baker's shape to change, which was overdue: `SsQuadInfo` became
  `SsPartDraw` and now carries each part's own vertex/index ranges instead of
  deriving them by multiplying by four. Instance and Effect want the same shape.
  PartColor works on a mesh through the existing shader because §1-2 makes it
  **whole-only** — `lt` copied to all four corners collapses the gradient to a
  constant. Masking a mesh does **not** work and is switched off deliberately:
  the replay inverts an affine quad's UV to place its coverage sample, and a
  triangle soup has no such inverse. That also still leaves a Mesh *writer*
  unimplemented (`Mask.ssab`'s `Mesh-WriteMask-True`).
  Host-checked: `Mesh.ssab` bakes 32 vertices where it baked 0, Ringo 68 → 653,
  all under ASan with the CSR range guards in place. **Seen drawing on the iOS
  simulator and the Android emulator**, no physical device.
- 🚧 **Effect (particles)** — landed. Chosen ahead of Instance because the two
  need the *same* scaffolding — a persistent slot per part, enumerated from the
  pack's metadata and stepped every frame — and Effect is much the cheaper place
  to build it: it fits entirely inside Layer 1. No spec change, no asset
  resolution, no new texture entries (a command's `cellmap_hash` keys the table
  that is already there), nothing above C++ touched. Instance is the opposite on
  every count, and can host effects itself, so it wants this to exist first.
  The split is the same one the rest of `cpp/` keeps: `SsEffect.{hpp,cpp}` owns
  the *clock* (the C-API slots), `SsBaker` owns the *geometry*, and the baker
  stays C-API-free so `ssbake_check` links it unchanged.
  Three things the reference ports had to teach, all of which fail plausibly.
  **The plan is in the effect's own simulation space** — `ss_effect_slot_step`
  takes no matrix — so the part's world matrix applies, which is the opposite of
  Mesh and the opposite of what this repo's own trap list said. **The UVs are
  normalised** and scale back up by the cellmap's `size_original`. And an
  emitter's `blend` is the raw `0 = Mix / 1 = Add` byte, **not** a `BlendType`,
  whose Add is 2 — passing it straight through renders every additive effect as
  multiply. It is also the first kind whose bake **emits its own batch
  descriptors**: the Brain leaves an Effect batch's `texture_hash` at 0 and each
  emitter names its own cellmap and blend, so one batch becomes one descriptor
  per adjacent (cellmap, blend) run — merged, per the SDK's dynamic-batching
  advice, under a 16383-quad cap the `uint16_t` indices impose.
  Host-checked under ASan across `overall/Effect` (13 parts, peak 155 quads) and
  all 40 drawable `ParticleEffect` packs (peak 1376 baked vertices on `e002`,
  against Ringo's 653 — design doc ch.8's claim that effects set the vertex
  ceiling, measured). **Seen drawing on the iOS simulator and the Android
  emulator**, which is as far as any of this has been taken — no physical
  device, and no pixel test, the same gap the blends and PartColor have.
  Finding this took fixing the check itself: `ssbake_check` had never called
  `play()` and passed its delta in seconds, so every number it had ever printed
  was frame 0 repeated — both of them traps this file already documented, in the
  program written to catch that class of mistake. `Mask.ssab`'s target-frames
  above are 1680 rather than the 1560 recorded earlier for that reason.
  **What is left:** effects under a mask (excluded like Mesh — the replay wants
  one quad to invert, and an effect is a cloud of them), and the same pixel-test
  gap the blends, PartColor and Mesh have.
- 🚧 **Shape** — landed. The Normal path's geometry rules with the Mesh path's
  batching: the vertices are **local** and take the world matrix, and several
  parts concatenate into one draw. Fixed stride rather than CSR — 24 floats per
  part, 12 vertices, with `shape_vertex_counts` saying how many are real — and
  triangulated as a **centre-first fan**, vertex 0 being the middle, so `n`
  vertices give `n - 2` triangles.
  The colour is the whole of the rest, and it is the one place PartColor does
  **not** go through the shader: §1-2-3 has a Shape bypass the composite formula
  outright, so the corner colours *are* the colour, at forced Mix with the rate
  pinned to 1, interpolated bilinearly per vertex over the Brain's box coords —
  which is why it emits them, and why the fan's centre lands on the average of
  the four corners instead of creasing along a diagonal. Without a PartColor it
  is white at the part's alpha. That collapses the kind onto plain vertex
  colours, so a Shape needs no texture and no shader at all — and it must be
  kept away from `PaintFor`, whose single-entry rule would hand it the atlas and
  texture a polygon that samples nothing.
  Host-checked: `overall/Shape` bakes 2 parts and 12 vertices a frame, and
  `Mask.ssab` went from 92 baked vertices to 98 as its Shape writer joined.
  Both platforms build. **Not yet seen on a simulator or a device.**
  A Shape is also a mask **target**, which this port's replay could not do for
  a non-quad — it reconstructs the coverage position by inverting a quad's UV.
  The way out is that a Shape samples nothing, so its texcoord channel is free:
  the coverage UV goes straight in there per vertex and the shader is handed the
  unit square for both its inverse and its corners, which makes the whole
  reconstruction the identity. No shader change. `coverageUv` is affine in the
  world position, so interpolating it across a triangle is exact rather than an
  approximation. A **Mesh** target still draws unmasked, and now for a reason
  that can be stated precisely: it needs that one channel for its atlas.
  **What is left:** Nines, which shares the box-coord idea but has its own CSR
  buffers.
- ☐ Nines
- 🚧 **Instance parts** — landed. A mount point, and the thing mounted is a
  whole other player: `HybridSsContext` is now both a root and — one level down —
  somebody's instance child, exactly as `SpriteStudioInternalPlayer` is in
  SSPlayerForFlutter and `SsInternalPlayer` in SSPlayerForGodot. `drawInto` and
  the child draw share one `drawSubtree`, so a child cannot quietly miss a
  feature the root has, and the recursion falls out of that.
  **The staging this entry used to propose was based on a wrong reading and is
  gone.** It said Ringo's nine instance parts were same-pack and would need no
  asset work; they are not in `Ringo.ssab` at all. They live in `Ringo_tyu.ssab`,
  which mounts `Ringo` — *external*. So does `overall/Instance.ssab`, whose 20
  parts all mount `Instance_SourceAnime`. **Every instance asset this repo has is
  an external reference**, which makes the sibling-pack walk not a second phase
  but the only way to see the feature work at all. Checking the converted `.ssab`
  rather than the authored `.ssae` is what surfaced it.
  That walk is JS's, through `core/assets.ts`'s `resolveAgainst` — the seam the
  textures already use, which is why it works from an asset directory, an
  unpacked one and a dev server without three code paths. Breadth-first over
  each pack's `external_instances` manifest with a `seen` set, because it is
  genuinely transitive and two packs can name the same third one;
  SSPlayerForWeb's `PackResolver` settles the same question the same way. One
  resource per pack, which is also what keeps `liveHandles` meaningful. A pack
  that will not load is warned about and skipped, so one missing sibling does not
  take the animation down.
  Four things the reference ports had to settle. **`ss_instance_slot_step` owns
  every playback attribute** — labels, loop count, speed, reverse, pingpong,
  independent — so nothing here reads `PartAttributeInstance`. **A transition
  edge requires `play()` on the child**, and the two ports disagree about why
  (Godot: the side effect; Flutter: the child is otherwise left stopped and an
  independent one freezes forever) — it is correct under both, since a
  transition *is* a head-out. **On that tick the reported frame is stale**,
  from before `play()` snapped it, so the child's clock is re-read. And **the
  child's own effects and nested instances still need a tick**, at the frame the
  Brain moved it to, with `child_looped` rather than the parent's edge.
  The mount point's alpha folds into the child's **bake** as an `alphaScale`
  rather than becoming a layer, because SpriteStudio modulates a sub-animation
  per part and a group alpha disagrees wherever the child's own parts overlap —
  the one place Flutter's comment is explicit that the flagship's behaviour is
  per-part. `SsBaker` records the mount matrices because the draw path has no
  SoA to read them from.
  Host-checked under ASan: `overall/Instance` 20 parts / 20 mounts a frame,
  `Ringo_tyu` 9 parts / 7, with the mounts asserted in rank order, in range and
  finite. **Both subjects seen drawing on the iOS simulator and the Android
  emulator.** `RingoInstances` is the one that proves the texture half: it holds
  no cellmaps of its own, so every texture it draws with was collected out of the
  pack it mounts — and its nine copies are a whole rig, mesh deforms included,
  which is a child subtree rather than a sprite.
  **What is left:** the instance part's own PartColor, which both ports apply as
  a whole-subtree *group tint* and this port does not do at all; §2-6 mask
  composition into a child, which waits on masking being finished anyway; and a
  depth cap of 8 standing in for real cycle detection.
- ☐ The 13 `ss-*` integration shaders, GLSL → **SkSL** (the maths is identical;
  impellerc's restrictions do not apply, so the port relaxes rather than tightens)
- ☐ Audio behind an `IAudioManager` seam — **L2 must not know the playback
  mechanism**
- ☐ Events: end / user data / signal
- ☐ Override Layer API (colour / cell / visibility), flip / offset, part following
- 🚧 **Reanimated integration** (design doc ch.3 D). Part transforms now go out
  as a SharedValue (`useSsPartTransform`), which is the consumer-facing half and
  the one that does not change when the tick moves. **What is left is the tick
  itself**: it is still `requestAnimationFrame` on the JS thread, so the hook
  samples there and publishes across. `useFrameCallback` needs the whole
  update→bake→draw chain reachable from a worklet runtime, and the borrow rule
  (ch.9 F) says update and draw cannot land on different threads. SharedValues
  *in* — frame / speed / blend weight — are untouched; the blend-source and
  crossfade C-API they would drive is already there (`ss_runtime_add_blend_source`,
  `ss_runtime_crossfade`) and unbound.
- ✅ **Override Layer API** (colour / cell / visibility) — declarative, as a
  `parts` prop keyed by part name, over the Brain's own override layer. A part
  dropped from the map reverts, which is what makes the prop describe state
  rather than a history of calls. Flip / offset are props on both L4 components;
  part *following* is `useSsPartTransform`.
- ✅ **Events: user data.** `takeUserDataEvents` drains the Brain's passed-event
  list and resolves each index back through the `.ssab`'s `EventsPerFrame`,
  surfacing as an `onUserData` prop.
- ✅ **Events: animation lifecycle** — `onAnimationStart` / `onAnimationChange` /
  `onLoop` / `onComplete`, which closes the gap against the flagship:
  `SpriteStudioPlayer2D` emits `animation_started`, `animation_changed`,
  `animation_finished` and `animation_looped`, and of those only finished had a
  counterpart here (`onLoop` existed on Layer 3 and was never exposed as a
  prop). Its fifth, `frame_updated`, is deliberately not matched — see Deferred. All four animation
  callbacks now carry **which animation**, as the sibling Players' do — one
  player outlives the animations mounted on it, and a scene shares one handler
  across many, so a bare notification cannot say what it is about. That changed
  `SsCompleteCallback` into `SsAnimationCallback`; free to do while unpublished,
  and the kind of change that stops being free the day it is not.
  `onAnimationStart` fires on a start and **not on a resume** — Layer 3 folds
  both into one `play()` because that is what a `playing` prop means, but they
  are different events and only one of them rewinds.
- ✅ **Events: signals** — `getSignalEvents` / an `onSignal` prop, the third and
  last `EventsPerFrame` table that is a *key* rather than a slot (`instances`
  and `effects` are read by their own slot machinery). A signal is a named
  command and its parameters; nothing here interprets `commandId`, which is the
  point of it. Two things are load-bearing. **Inactive signals are dropped** — a
  command left in the timeline and switched off is authoring state, not
  something that happened, and every sibling Player drops them. And the
  parameter values are read **through the FlatBuffers union tag, not through the
  authored `type`**: the two enums are offset by one, because a union gets an
  implicit `NONE = 0` prepended, so switching on `type()` reads a `Bool` as an
  `Index` and still compiles. `SsSignalParam` is flat rather than a union
  (Nitro has none) but needs no `has*` flags, since `type` is the discriminant.
  **Fixture gap:** `overall/Signal.ssae` authors two signals and both are
  active, so the inactive-drop rule is asserted in code and exercised by
  nothing — one for the SDK's "close the coverage gap the fixtures leave"
  backlog item.
- 🚧 **Events: audio** — landed, as `getAudioEvents` / an `onAudio` prop, the
  same walk one table across (`EventsPerFrame.audios`). **The package plays
  nothing**: the event says what to play and how many times, and the app feeds
  its own audio stack, which is where every sibling Player but Godot draws the
  line and what `ssplayer-wgpu`'s `AudioEvent` says in as many words. Godot can
  play because it owns an audio server; React Native ships **no audio API at
  all**, so playing means a library, and a package that picked one would make
  every project authoring no audio carry it. An *optional* peer dependency does
  not rescue that either — RN autolinks native modules out of the app's own
  dependency graph, so "not installed" would surface at runtime rather than at
  install time.
  The other half of that argument lives in `example/src/player/audio.ts`: the
  reference wiring, with `expo-audio` as the app's dependency and not the
  package's. Swapping it for `react-native-audio-api` (a Web Audio port, and the
  better fit for many overlapping SE) changes that one file. Three things it has
  to solve are worth knowing before writing your own: an `asset`-scheme sibling
  has **no path an audio library can open** — inside the `.app` on iOS, an APK
  entry on Android — so its bytes go through `readAsset` into a cache file;
  `loop_num` is a **count** where `expo-audio`'s `loop` is a boolean, so the
  repeat is driven off `didJustFinish`; and iOS is **silent under the ringer
  switch** unless `setAudioModeAsync({ playsInSilentMode: true })` ran, which
  presents exactly as a broken event path.
  Each key is resolved against the pack's `SoundList` in C++, because that table
  lives in the `.ssab` and the `.ssab` deliberately never enters the JS heap —
  so the event carries `filePath` (relative to the `.ssab`, exactly like a
  cellmap's `image_path`, so `resolveAgainst` opens it) and `totalMs` alongside
  the two hashes a host would key its own audio by. The **two-hash** lookup is
  the part worth stating: `SoundFile.name_hash` is unique only within its
  `SoundList`, so a search that took the file hash alone would resolve to
  whichever list came first.
  `passedEventCount` gates this the way it gates user data, and now says less
  than it looks: it counts *frames* carrying any event, so it cannot tell the
  two kinds apart and over-reports each. Layer 4 therefore installs each
  forwarder only while its prop is supplied — a permanently-installed one would
  defeat the gate and pay a Nitro array marshal per event frame to reach a `?.`.
  **What is left:** an **embedded** pack (`--embedded`) carries the audio bytes
  in `embedded_assets` and there is no sibling on disk, so `filePath` names
  nothing openable. The event's `embedded` flag keeps that legible instead of
  presenting as a missing file, but reading those bytes out is unwired — the
  shape it wants is the texture one, a pack-level `getSounds()` read once at
  load, not an `ArrayBuffer` per event that the next `update()` invalidates.
- ✅ **Placement**: `fit`/`align`/`frame`, backed by `measureContentBox`. The
  authored canvas turned out not to frame the art — see the traps.
- ✅ **Resource and atlas caches** + `ssPreload`, so N players of one pack cost
  one parse and one decode.
- ✅ **`<SpriteStudioScene>`**: one canvas and one clock for many sprites.
- ✅ **Typed asset manifest**: `npx react-native-spritestudio assets`.
- 🚧 **Expo config plugin.** Landed in Phase 1 because the asset-path work
  needed it: it copies the pack directories into the app on every build (Xcode
  run-script phase; Gradle `Sync` task feeding an asset source set), verified
  through `expo prebuild` on both platforms. **Not** `assetExts += ssab` — that
  was the `require()` route, and it is deliberately gone.
  It also narrows `reactNativeArchitectures` now, which is a second job but the
  same reason: Expo's template asks for 32-bit `x86` and the Brain does not
  build it (emulator-only, negligible device share, `x86_64` covers the
  emulator), so a default `run:android` died at `configureCMakeDebug[x86]`.
  `android/gradle.properties` is the wrong place to fix that — gitignored *and*
  rewritten by every `prebuild` — so the plugin intersects the app's list with
  what `native/libs/android/` actually holds, reading the directory rather than
  hardcoding so a differently-built Brain is respected.
  What is left: a bare RN app has no plugin system, so it needs the two build
  steps documented by hand and checked — and, now, the ABI list too, which is
  why `CMakeLists.txt` tells "does not ship this slice" apart from "not
  installed" and names the `-P` escape.
- ✅ **Package name decided: `react-native-spritestudio`** (was
  `@spritestudio/react-native-ssplayer`; the directory moved to
  `packages/react-native-spritestudio/` with it). The old name's problem was that
  the public API is named after SpriteStudio, not ssplayer, so the import line
  disagreed with everything in it — and `ssplayer` is a family stem legible to
  maintainers who see every port, while a package name is read almost entirely by
  people who see only this one. Unscoped won on the community shape
  (`react-native-reanimated`, `react-native-svg`, ...), on npm search and the
  Directory listing below, and on cost: `@spritestudio` has nothing published
  under it today, so a scoped name would have meant securing the org first. The
  runners-up were `@spritestudio/react-native` (the `@sentry/react-native` shape)
  and `@spritestudio/ssplayer-react-native` (matches the Web packages exactly, at
  the cost of keeping the stem that started this).
  The *native* identifiers (`SsPlayer.podspec`, the Gradle project, the JNI
  library, the `ssplayer` C++ namespace, `com.margelo.nitro.ssplayer`) were
  deliberately **not** renamed: autolinking keys on them, so that is a separate
  and riskier decision.
- ☐ npm publishing: decide `react-native-builder-bob` vs plain `tsc` (the
  package currently points `main` at raw TypeScript, which Metro reads but npm
  consumers should not get). Also unresolved: the published tarball's `files`
  lists only `native/VERSION`, so it ships without the Brain — and, now, without
  the flatbuffers headers `cpp/format/ssab.h` includes.
- ☐ React Native Directory listing — **iOS/Android badges up, New Architecture
  flag up, "Expo Go does not work" stated in both the Directory and the README**

**Deliberate non-goals** — but **not** "matching the Web / Flutter / Godot
ports", which is what this line used to claim and is false on two counts:
SSPlayerForGodot declares `map0`/`map1` (`ss_library_fs.glsl`) *and* combines
shader with mask, since its `ss_output_color()` calls `ss_mask_passes()` and
discards. Each of these is this port's own decision and needs its own argument:

* `map0`/`map1` extra shader textures — no asset here authors one, and they
  would need a second and third entry in the per-call texture table.
* Shader parts on Mesh/Shape/Effect kinds — the reconstruction wants one affine
  quad, the same reason those kinds are excluded from masking.
* **Shader × mask is now doubtful as a non-goal and should be tried before it is
  kept.** `SsSkiaDraw`'s replay already wraps "whichever shader it turns out to
  be" and changes neither, so an `SHDR` effect slotted in where the PartColor
  tint goes should compose with masking for free. Do not hard-code
  "masked ⇒ drop the shader" while wiring `SHDR` in; wire it so the two can
  meet, then read `Mask.ssab` against `Shader.ssab` and let the result decide.

---

## ☐ Phase 3 — Surroundings

- ☐ react-native-web via the existing `@spritestudio/ssplayer-webgl`, selected
  through `package.json` `exports`. **Only the L3 API and L4 prop types are
  shared** — the implementation is the existing Web one, not a port. Keeping L2
  React-free and L3 an interface is what leaves this door open.
- ☐ Documentation site
- ☐ Runtime texture replacement, `getPartNames()` and friends
- ☐ Example app beyond one screen — the benchmark harness is gone and what is
  left is a single player; a real showcase is still owed

---

## 🕒 Deferred

### 🕒 macOS
RN Skia and Nitro both support it, so it may simply work. Not in CI, not
guaranteed.

### ⛔ tvOS / visionOS
Blocked on the **Brain**, not on React Native: the Rust targets are Tier 3 and
the SDK's XCFramework has no slices for them (an SDK ROADMAP backlog item).

### ⛔ Windows
Neither Nitro nor RN Skia supports react-native-windows, which is a separate
C++/WinRT stack. No route.

### 🕒 Bundled converter
Not planned. React Native has no editor to host an importer, so `.sspj` →
`.ssab` stays a host-side `ssconverter-cli` step (design doc ch.9 G).

### 🕒 A per-frame callback (`frame_updated`)
Not provided. The flagship emits one every tick, but it is a C++ signal inside an
engine there and would be a JS-thread callback here — on the one path this
design is built around avoiding, for every player on screen, every tick. The
per-frame *value* case already has a better answer in `useSsPartTransform`,
which publishes through a Reanimated shared value without waking React, and the
*reaching a frame* case is what the authored user-data and signal keys are for.
Revisit on a concrete case that neither covers.

### 🕒 `ss_runtime_set_frame_rate`
On request only — it overrides the authored fps of the animation being played,
which nothing here needs. Two things to know before binding it: it belongs in
`applySettings()`, because `setup_animation` resets `fps` and `fps_rate` the same
way it resets the loop count; and `ss_runtime_get_fps` reports the **effective**
fps, not the authored one, which `stepEffects` currently reads as if it were
authored.

### ⛔ `ss_runtime_reset`
Not needed by this design. It empties a context — drops the bound resource,
clears the part overrides, and returns render mode / coordinate system / origin
to their defaults — and a load here builds a **new** `SsInternalPlayer`, whose
context is created fresh and disposed with it, so there is no carried-over state
for it to clear. It becomes necessary only if a context is ever reused across
packs (`bind_resource` *replaces* the SSAB), which would be traded against the
exact `liveHandles` accounting the leak check stands on. To rewind, `play()` or
`setFrameNo` — not this.

---

## Compatibility

| | |
|---|---|
| SpriteStudio-SDK | `scripts/SDK_VERSION.txt` (currently `v7.0.0-beta.1`) |
| React Native | 0.79+ (New Architecture only) |
| React | 19+ |
| @shopify/react-native-skia | **2.11+**, and the lower bound is real: 2.11 moved the API objects off `jsi::HostObject` onto the `jsi::NativeState` pattern, and `cpp/SsRNSkiaInterop.cpp` unwraps them the new way |
| react-native-reanimated | 4+ (required — RN Skia 2.10+ demands it) |
| iOS | 14+ |
| Android | API 24+ (React Native 0.79+ ships prefabs built for 24) |

The `.ssab` format and the C-API are both tied to the SDK version, so the pin
and the README's compatibility table have to move together.
