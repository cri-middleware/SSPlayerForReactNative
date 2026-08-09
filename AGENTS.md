# SSPlayerForReactNative — AI Agent Guide

React Native **Body** for the SpriteStudio-SDK **Brain**. An npm workspace whose
package drives the Rust `libssruntime` over **Nitro Modules (JSI)** and draws
through **React Native Skia**. The Brain lives in the `SpriteStudio-SDK/`
submodule — see its own [AGENTS.md](./SpriteStudio-SDK/AGENTS.md).
`CLAUDE.md` is a symlink to this file.

> [!IMPORTANT]
> **Phase 1 is done bar a real device; Phase 2 has started.** All four layers
> exist and `<SpriteStudioView>` plays an animation on **both** iOS and Android
> (simulator and emulator — **no physical device has ever been tried**, which is
> the one thing keeping Phase 1 open — the exit criteria's other half, "no
> leaked native handles", is now closed and, more to the point, *checkable*:
> `SsRuntime.liveHandles` + `ssCheckForLeaks()`, which found that `dispose()` had
> never actually released anything). Scope is Normal parts, now with the full
> framebuffer **blend table** (`cpp/SsBlend.hpp`), **PartColor**
> (`cpp/SsPartColor.hpp`), **mask + clipping** (`cpp/SsMask.hpp`) and **Mesh** —
> still no effects, Instance, Shape/Nines, events, part overrides or Reanimated
> integration. The last two features are host-verified but **have not been seen
> on a simulator or a device**, which is a weaker claim than the ones above it.
> Read
> [`docs/phase0-spike.md`](docs/phase0-spike.md) before designing anything —
> it overturned one of the design doc's premises, and its own numbers were then
> overturned in turn.

## Operating rules

* Keep changes scoped to the request; read callers/invariants before editing.
* **Do not commit or push unless the user explicitly asks.**
* Never hand-edit `packages/react-native-spritestudio/nitrogen/` — change the spec
  and run `npm run generate-nitro-code`. If that run says it **added** a file (a
  new struct gets its own header), `pod install` / a Gradle sync has to follow or
  the next build fails on a missing header that is sitting right there —
  `expo run:ios` does not always re-run it for you.
* **Adding a file to `cpp/` needs a step on each platform, and neither is
  automatic.** The podspec globs `cpp/**`, but the glob is expanded at
  `pod install` time, so until you re-run it Xcode compiles the old file list and
  the new code is *silently absent* rather than a build error. Android is the
  mirror image and louder: `android/CMakeLists.txt` lists sources explicitly, so
  a missing entry surfaces at link time. Check with `grep -c <name>
  example/ios/Pods/Pods.xcodeproj/project.pbxproj`. This is the same trap as the
  nitrogen rule above, one layer down — and it bites hand-written files too, not
  just generated ones.
* After editing TypeScript, typecheck (see [Verification](#verification)).
  After touching `framedata.fbs` or the FrameData read path, run
  `npm run check-framedata`.
* Fix stale docs in the same turn you notice them (architecture/roadmap drift easily).
* **Measure with release on BOTH sides, and check the animation is playing.**
  A `build=debug` `libssruntime` swamps every other cost; a debug RN/Hermes
  inflates the JS side, which is exactly the side under comparison. And
  `setup_animation` leaves the transport stopped, so a harness that forgets
  `play()` measures one static frame. Phase 0 shipped with the last two, and
  every absolute number it published was wrong — see `docs/phase0-spike.md`.
  **`verts` holding perfectly constant across a sweep means nothing is playing.**
  `native/VERSION` does not record the Brain's build mode, so if you did not
  build it yourself, assume nothing and rebuild.
* When a rendering detail is unclear: **SSPlayerForFlutter** first (the closest
  reference — same Skia primitives, same layering), then **SSPlayerForGodot**,
  then the submodule's `libs/ssruntime/docs/`.

## The Phase 0 result, and what it means for the architecture

The design doc assumed the open question was *where to bake the geometry* — in
JS like the Flutter Player, or natively. Measurement said that was the wrong
question. Re-taken in Phase 1 with **release** on both sides and the animation
actually playing (the Phase 0 run had neither — see `docs/phase0-spike.md`),
iOS simulator, 512 players / 32960 vertices:

| variant | total ms | fps |
|---|---:|---:|
| (a) JS bake → `Skia.MakeVertices` | 50.1 | 20.0 |
| (b) native bake → `Skia.MakeVertices` | 49.7 | 20.1 |
| **(c) native bake *and* native draw** | **10.2** | **60.0** |

(a) and (b) stay within 1% of each other at every load, and their CPU cost is
strictly linear in instance count — it *is* the marshalling. (c) is sublinear
and the gap widens with load: 2.7× at 128 players, 3.8× at 256, 4.9× at 512.

`Skia.MakeVertices(mode, positions, texs, colors, indices)` takes `SkPoint[]` —
an array of JSI **host objects** — and unmarshals it one vertex at a time
(`@shopify/react-native-skia/cpp/api/JsiSkVertices.h`). `SkColor` is worse: one
`Float32Array` host object per colour. (a) and (b) both pay that, which is why
moving the bake buys nothing.

**So Layer 1 owns the drawing, not just the geometry**, and JS's per-frame job
is one call per player. This is *further* than the design doc's stated goal
("JS does the batch walk and issues draw calls"); the batch walk moves down too.

## Architecture

The Brain loads a `.ssab`, advances time, and emits per-frame **SoA buffers**
(world matrices, local vertices/UVs, cell meta) plus a FlatBuffers **`FrameData`**
carrying a **DrawBatch** plan. Four layers, lower = nearer the Brain:

* **L4** `<SpriteStudioView>` — an RN Skia `Canvas` plus props/ref. Owns the
  frame loop: one `requestAnimationFrame` tick advances L3 and re-records one
  `SkPicture`, handed to the canvas through a Reanimated shared value so a frame
  costs no React render.
* **L3** `SpriteStudioPlayer` — transport, events, clock. Externally clocked by
  default (`advance(dt)`), self-driving via `startClock()` as a fallback for
  headless use. Also owns source resolution and replays transport settings onto
  each newly loaded animation. A `load()` with **no animation named sets up the
  pack's first**, because a resource that has had no `setup_animation` has none
  selected and draws an empty canvas — `currentAnimation` reports what it chose.
  `SpriteStudioPlayerApi` states the transport surface with no drawing backend in
  it, so the Phase 3 web implementation can satisfy the same one.
* **L2** `SsInternalPlayer` — **must import nothing from `react`/`react-native`**,
  so react-native-web, headless tests and a future renderer stay possible. (Skia
  is fair game: it is the drawing backend, not the UI framework.) After Phase 0
  this layer is thin: native lifetime, the root transform, and one draw call per
  frame.
* **L1** Nitro bindings + the C++ that walks the batch plan, bakes geometry and
  draws into `SkCanvas`. Also the transport passthroughs — the Brain owns the
  playback state and nothing above mirrors it.

## Package layout (`packages/react-native-spritestudio/`)

| Path | Role |
|---|---|
| `src/specs/SsRuntime.nitro.ts` | L1 spec, nitrogen's input. The Phase 0 variants (a)/(b) — `getSoA`, `getPlan`, `bake` — are **gone**, along with the bench that ran them; `drawInto` is the only draw path. |
| `src/runtime.ts` | The L1 module singleton. Its own file so `core/` can reach it without importing the barrel. |
| `src/core/` | **L2, and the react-free boundary.** `SsInternalPlayer`, `SsTextureRegistry`, and the playback/root-transform vocabulary both L2 and L3 name. |
| `src/core/assets.ts` | **The one place a sibling reference becomes something openable.** `schemeOf` / `resolveAgainst` — used by textures today, by Instance and `.ssqb` next. |
| `src/player/` | L3: `SpriteStudioPlayer` + `source.ts` (what an `SsSource` is, and which L1 door each kind opens) + `leakCheck.ts`, which drives the same load/dispose path a mount/unmount does and compares `SsRuntime.liveHandles` either side. |
| `src/view/` | L4: `SpriteStudioView` + `useSsTextures`. |
| `src/index.ts` | Public exports, layer by layer. The batch-layout constants went with the bench — nothing in JS walks batches now. |
| `plugin/withSpriteStudio.js` + `app.plugin.js` | Expo config plugin: copies the pack directories into the app as native assets, every build, on both platforms. Plain CommonJS — Expo requires it during `prebuild`, unbuilt. |
| `cpp/SsAssets.{hpp,cpp}` | The read side of that: the `.app`'s resource directory on Apple, `AAssetManager` on Android. |
| `cpp/SsAnimeBinary.hpp` | Reader for the `.ssab` *asset* — cellmaps, external textures, embedded assets, animation names. Thin wrapper over flatc's output. |
| `cpp/format/{ssab,framedata}.h` | **Generated, committed, never hand-edited.** `npm run generate-fbs-code`. The Brain's per-frame `FrameData` is read straight through `framedata.h`; there is no wrapper. |
| `third_party/flatbuffers` | Submodule, **headers only**: nothing links flatc's translation units and `flatbuffers/src` is off the include path. |
| `cpp/SsBaker.{hpp,cpp}` | SoA → vertex/index/colour/batch arrays, plus one `SsPartDraw` **per part** carrying its own vertex/index ranges — a Normal part is always four vertices, a Mesh part is however many the Brain skinned, so the ranges are carried rather than derived. Nitro-free and JSI-free so the host harness can link it. |
| `cpp/SsPartColor.hpp` | PartColor's data side: §1-4's coefficient table, the four corners, and `SsMakeUvInverse`. Skia-free, so the maths is checkable on the host. |
| `cpp/SsPartColorShader.hpp` | PartColor's SkSL runtime effect. Skia-only, included from `SsSkiaDraw.cpp` alone — the same rule as `SsBlend.hpp`. |
| `cpp/SsMask.{hpp,cpp}` | Mask **and** clipping: the part roles, the per-frame writer set, the player-local coverage box and each target's two writer sets. Skia-free, so `ssbake_check` drives it on the host. |
| `cpp/SsMaskShader.hpp` | The two mask SkSL halves — the coverage writer and the target's replay. Skia-only, same inclusion rule as above. |
| `cpp/SsRNSkiaInterop.{hpp,cpp}` | Nitro `CustomType` that unwraps RN Skia's `SkCanvas`/`SkPaint` JS objects. **The only place RN Skia's internals are touched** — hence `RNSkia` in the name, see the naming rule below. |
| `cpp/SsSkiaDraw.{hpp,cpp}` | The draw path: the batch walk, `SkVertices::MakeCopy` + `drawVertices`, and the per-batch paint lookup by `texture_hash`. Skia's *public* API only — nothing here breaks on an RN Skia bump. |
| `cpp/Hybrid*.{hpp,cpp}` | The Nitro Hybrid Objects. They `#include "ssruntime.h"` directly — see Traps. |
| `nitrogen/` | **Generated, committed, never hand-edited.** |
| `native/` | **Gitignored.** The Brain, installed by `download-sdk` or `build-runtime`. |

`example/` is an Expo app with one screen. **Player** drives the SDK's
`overall/Basic` through `<SpriteStudioView>` and is what you want when checking
that a change still renders; its *Textures* toggle points at two different
conversions of the same animation — `overall-embedded/` (atlas inside the
`.ssab`) and `overall/` (atlas as a sibling file) — so both texture routes are
visible. Nothing in the app selects a route; `SsTextureLoader` decides per
texture.

There was a second screen, **Bench** — the Phase 0 harness, which drove Layer 1
directly through all three variants and auto-ran a variant × instance-count
sweep. It is **retired**: the question it existed to answer is settled, and both
platforms have now been measured in release (`docs/phase0-spike.md` has the
numbers and the conditions). It is recoverable from git history — look for
`example/src/bench/` — but note that re-running it means restoring the `getSoA`
/ `getPlan` / `bake` spec surface with it, which is rather the point of its
being gone.

## Assets: a pack is a directory, not a file

Everything a `.ssab` points at is a **sibling name** — a cellmap's `image_path`,
an `external_textures` entry, the external `.ssab` an Instance part reaches, a
`.ssqb`'s `ref_anime_pack`. So the unit that has to survive into the app is the
converter's output *directory*, and the whole asset design follows from that.

**Metro cannot host one.** It ships a dependency graph: it bundles only what a
`require()` names and never walks a directory, and Android's packager then
flattens, lowercases and de-extensions what it did name into `res/`. So
`require()` is not an `SsSource` — it would work in development and lose every
sibling reference on release. `resolveSourceUri` throws on one by name, because
the alternative is a part that silently is not there.

A source is a **location**, in one of three kinds (`SsUriScheme`):

| | | |
|---|---|---|
| `asset` | `'ss/overall/Basic.ssab'` | the app's asset directory — what you ship |
| `file` | `'/…'`, `'file://…'` | a downloaded or unpacked directory |
| `remote` | `'http://…'` | dev server, CDN |

`resolveAgainst(baseUri, ref)` joins a sibling onto the `.ssab`'s own URI and
hands back the same kind, so each kind needs exactly one reader and every
reference — texture today, Instance and sequence next — goes through one seam.

The asset kind is the one with machinery behind it. The Expo config plugin
copies each listed directory in on **every build** (an Xcode run-script phase;
a Gradle `Sync` task feeding an asset source set), so re-running
`ssconverter-cli` and hitting Run is enough. `SsAssets` reads it back: on Apple
the `.app`'s resource directory, so `createResourceFromAsset` takes the `fopen`
route and the `.ssab` never enters the JS heap; on Android `AAssetManager`,
because an APK entry is not a file. `readAsset` is the same door for the bytes
JS itself has to decode — `Skia.Data.fromURI` knows neither platform's asset
storage.

## Toolchain scripts (`scripts/`, `.js` shim → `.sh`+`.ps1`; SDK via `$SSSDK`)

Every npm script goes through a `.js` shim that picks the `.sh` or `.ps1` for
the host OS, so Windows works. Arguments are forwarded verbatim and both
flavours parse the same spellings.

| Script | Does | When |
|---|---|---|
| `download-sdk` | Install the pinned SDK release into `native/`. **No Rust needed.** | Normal setup |
| `build-runtime` | Build the Brain from the submodule into the *same* layout, stamped `<tag>+submodule-<sha>`. Windows: Android slice only. | Changing the Brain |
| `deploy-examples` | `.sspj` → `.ssab` for `example/` via the SDK's `ssconverter-cli` (needs Rust). | Refresh example assets |
| `generate-nitro-code` | `nitrogen` → `nitrogen/generated/`. Commit the result. | After a spec change |
| `generate-fbs-code` | `flatc -c` over `ssab.fbs` and `framedata.fbs` → `cpp/format/`. Commit the result. Needs `flatc`. | After either schema changes |
| `check-framedata` | Re-generate `cpp/format/` and diff it, then run the baker against a real `.ssab` under ASan. macOS/Linux, needs `flatc` + `cargo`. | After a `.fbs` change, or an SDK bump |

The pinned tag lives in `scripts/SDK_VERSION.txt`. `download-sdk` skips when
`native/VERSION` already matches it; a `build-runtime` stamp never matches, so a
later `download-sdk` correctly replaces a local build.

## Traps (hard-won)

* **`Skia.MakeVertices` is the bottleneck, not your maths.** It takes arrays of
  JSI host objects. Any design that hands vertices to JS is capped by it — see
  the table above. Draw from C++.
* **`local_uvs`/`local_vertices` are texture-PIXEL coords, stride 10**
  (`lt,rt,lb,rb,center`), not normalised. Skia's image shader samples in pixels,
  so they go to `drawVertices` untouched — do **not** divide by the atlas size.
* **`update()`'s delta is MILLISECONDS**, all the way from
  `<SpriteStudioView>`'s frame loop down to `ss_runtime_update`
  (`30_core/20_playback_control.md` §"update" spells the conversion out). Every
  signature that carries it says so in the parameter name. Seconds is the
  natural-looking guess and it is wrong by 1000× — which does not throw, it just
  makes the animation look frozen. Phase 0 shipped with exactly that bug.
* **`ss_runtime_pause` is a TOGGLE**, not "pause" — `playback_controller.rs` is
  literally `is_pausing = !is_pausing`. L1 guards on `isPausing` and splits it
  into idempotent `pause()` / `resume()`. Two neighbouring surprises: **`play()`
  rewinds** to the start frame and re-arms the loop counter (it is not a resume),
  and **`stop()` does not rewind** — it only clears `is_playing`. `isPlaying`
  also stays true while paused; "actually advancing" is `isPlaying && !isPausing`.
* **`setup_animation` resets the loop count**, so `setLoop` has to be re-applied
  *after* setup and *before* `play` — `play` arms the counter with whatever is in
  effect at that moment. `SpriteStudioPlayer.applySettings()` is the one place
  that ordering lives.
* **World matrix is column-major 4×4** — `x' = m0·x + m4·y + m12`.
* **Texture key = `cellmap.name_hash` == `DrawBatch.texture_hash`** — use the
  pre-baked hash; never re-implement FNV-1a. `SsRuntime.hashString` exposes the
  Brain's own, which is why there is no TypeScript copy. `drawInto` also treats a
  **single-entry texture table as matching every batch**, so a one-cellmap pack
  is drawable without knowing its cellmap's name.
* **There are TWO texture lists, not one.** `DrawBatch.texture_hash` is the
  cellmap name's hash normally, but a part under an authored texture change
  (`TCHG`) carries the hash of a texture *file* name out of
  `external_textures()`. Skip that list and exactly those parts stop drawing,
  silently. `SsAnimeBinaryView::textureAt` presents both as one sequence.
* **`embedded_assets` is keyed by the FILE name's hash**, not the cellmap
  name's — the two differ, so the lookup goes through `cellmap.image_path_hash`.
  And an embedded atlas **cannot be freed after decoding**: it lives inside the
  same contiguous FlatBuffer the Brain holds for the resource's life, so embedded
  permanently costs one encoded atlas on top of the decoded texture.
* **Metro ships a dependency graph, not asset directories** — see "Assets"
  above. `require()` is not an `SsSource`, and re-adding it would quietly
  reintroduce the failure it was removed for. Two consequences worth spelling
  out: **changing an asset needs a native build**, not a Fast Refresh (both
  platforms re-sync on every build, so Run is enough — a prebuild is not); and
  **`assetExts` must stay clean of `ssab`/`ssqb`**, because a `require()` that
  resolves is the trap coming back.
* **Android reaches its assets through a `ContentProvider`, and it is not
  optional.** `AAssetManager` needs a `Context`, and nothing React Native hands
  this package gives one at a time we can rely on: the autolinked class gets
  none, and `createViewManagers` is resolved lazily under Fabric.
  `SsPlayerAssetBootstrap` (in the library's own `AndroidManifest.xml`) captures
  it before `Application.onCreate`. It deliberately does **not** load
  `libSsPlayer.so` — that early, RN's own libraries are not up yet — so the
  handover waits for `SsPlayerPackage.init`. Also: `AAssetManager_fromJava` does
  not retain the Java object, which is why `SsPlayerAssets` holds it in a field
  for the process's life. Drop that field and the pointer dangles.
* **A pack's `image_path` can start with `../`.** It is authored relative to the
  `.ssae`, so the joined path arrives with the `..` still in it and
  `AAssetManager_open` will not resolve one. `normalizeUri` collapses it in JS
  and `SsAssets` again in C++; a `..` that walks out of the asset root is
  reported rather than silently clamped.
* **The texture table goes in per draw call, not registered once.** The
  `SkPaint`s are JS-owned and RN Skia may recycle or mutate them between frames,
  so C++ must not hold one past the call — which now means leaving neither a
  colour filter *nor a blend mode* on one, so every pass draws through a copy.
  And the batches must be walked in the Brain's order rather than once per
  texture — that order *is* the depth sorting.
* **`drawVertices`'s `SkBlendMode` argument is NOT the framebuffer blend.** It
  blends the shader against the **vertex colours**, and Skia ignores it when
  there are none — which is every vertex the baker emits. The framebuffer blend
  is `SkPaint::setBlendMode`. Passing `SsBlend.hpp`'s answer to that parameter
  compiles, runs, draws, and renders all twelve types as Mix; it shipped that
  way in the commit that introduced the table. It becomes load-bearing once
  PartColor bakes vertex colours, where it has to be `kModulate`.
* **The root transform holds flip/offset/Y-flip, and it is applied exactly
  once** (`canvas.translate` + `canvas.scale(s, -s)` in the harness). Folding it
  into the vertex bake costs a term per vertex and detaches part-following the
  moment a player flips. Keeping it at the root also leaves everything below in
  player-local space, which is what the Phase 2 mask coverage pass and the SkSL
  shaders will need.
* **`ss_resource_create_*` takes bytes only — there is no path-based C-API.**
  `createResourceFromPath` means *C++ opens the file*; that is how the `.ssab`
  stays out of the JS heap (design doc ch.5 A).
* **Every ArrayBuffer handed to JS is a borrow that the next `update()`
  invalidates** (design doc ch.9 F). Two separate things can dangle: the Brain's
  SoA/FrameData, and this module's own vectors. `generation` is stamped into
  every returned struct — compare it before reading. `dispose()` is the explicit
  teardown; never wait for GC — but see the next entry for what that took.
* **Nitro's `dispose()` does nothing unless the C++ class overrides it.**
  `HybridObject::dispose()` is a virtual **no-op**; `disposeRaw` calls it and
  then strips the JS object's NativeState, leaving the C++ object to the
  collector. So inheriting the method buys nothing, and for a whole phase every
  `dispose()` the layers above make a point of calling released no Brain handle
  at the moment it was called — the `.ssab` and its context simply stayed
  resident until a GC that JS never promises to run. Both hybrids now override
  it, `release()` is guarded on the handle so dispose-then-destruct frees once,
  and `HybridSsContext::release()` bumps `generation_` because teardown
  invalidates outstanding borrows exactly the way an `update()` does. Order
  inside it is load-bearing: destroy the Brain context **before** dropping the
  resource `shared_ptr`, since the context is bound to that resource.
* **`SsRuntime.liveHandles` is what makes "no leaked native handles" checkable.**
  Two atomic counters, incremented at the *end* of each constructor — everything
  above the increment can throw, and a constructor that throws runs no
  destructor, so an earlier one would strand a count and the leak check would
  report leaks of its own. `ssCheckForLeaks()` loads and disposes N times and
  compares; the comparison is exact only because `dispose()` releases eagerly,
  which is precisely what the entry above fixed.
* **Per-kind geometry differs**: Normal & Shape verts are **local** (apply the
  world matrix); **Mesh & Effect verts are world-space** (do not). Effect UVs
  are normalised 0..1 and need scaling back up. Applying the matrix to a mesh
  compiles, draws, and puts the part somewhere else entirely.
* **Mesh arrives in CSR, and `offsets` has `partCount + 1` entries.** Part `p`
  owns `[offsets[p], offsets[p+1])` in both the vertex and the index arrays, so
  every read needs `p + 1` in range *first*. A **non-Mesh part is an empty
  range**, not an error — that is how the same array covers every part. Mesh
  indices are **part-local 0-based** and have to be rebased when several parts
  share one draw call, which is exactly what batching does here. UVs are static
  (resolved from frame 0's cell) and interleaved, so the offset is `v * 2`.
* **A mesh is not quad-shaped, and two things silently assume quads.** The
  PartColor shader and the mask replay both recover `(s,t)` by inverting an
  affine quad's UV; a triangle soup has no such inverse. `SsPartDraw::quadShaped`
  is the flag, and it is why a mesh is excluded from masking outright. PartColor
  still works on a mesh only because §1-2 makes it **whole-only**: `lt`'s colour
  and rate go to every vertex, so equalising the four corners collapses the
  shader's bilinear to a constant and the bad inverse stops mattering.
* **PartColor alpha is pre-folded by the Brain** — do not re-multiply
  `PartState.alpha` when a PartColor is present. The two alphas are therefore an
  either/or, which is exactly how `SsBaker` bakes the vertex colour: corner alpha
  when there is a PartColor, `PartState.alpha` when there is not.
* **There are TWO blends, on different axes** (`parts_color` §1-0). The
  framebuffer one is `DrawBatch.blend_type`, 12 values, `SsBlend.hpp`. The
  PartColor one is `PartAttributePartColor.blend_type`, and **only its first 4
  values are valid** — it is typed as the same 12-value enum, so anything ≥ 4
  clamps to Mix. Conflating them is the mistake the SDK doc opens by warning
  against.
* **`rate == 0` is a texel passthrough, and that is what keeps batching.** A
  PartColor whose rates are all zero changes no RGB, so it stays on the batched
  `drawVertices` path with its alpha in the vertex colour; only a real tint is
  peeled out for the shader. Peeling is per *part*, not per batch — unlike the
  Sub/Invert peel, which is a property of the batch.
* **The PartColor shader reconstructs its gradient from the UV, not the fragment
  position.** `drawVertices` evaluates the paint's shader at the interpolated
  texcoord, so `coord` is already texture-pixel space and the canvas matrix drops
  out — no CTM inverse to pass, unlike SSPlayerForFlutter's `partcolor.frag`,
  which has no texcoord to lean on. The quad's four UV corners are an affine
  image of the unit square, so `SsMakeUvInverse` is exact (the host check
  measures 0 error on axis-aligned cells, ~1e-7 on rotated ones).
* **A tinted quad must carry NO vertex colours.** The shader already returns
  `a = texel.a * col.a`, so leaving the baked colours on would apply the alpha a
  second time through `kModulate`. Only the `kPart` pass of a blend plan gets the
  tint shader — swapping the shader on a coverage or black pass would break the
  inversion those exist to perform.
* **Mask has no C-API** — roles come from the static `.ssab` `PartData`, read
  once at load. `FrameData.mask_indices` is *not* the writer list: it enumerates
  pure masks only, so it omits every clipping writer and keeps hidden mask parts
  the Brain already dropped from `draw_order`. Settle writers by walking
  `draw_order` with §1-2's three formulas, which is what `SsMaskPlan::build` does.
* **`mask_influence` means two different things and the reader picks which.**
  On a writer it is the OP (`0` = increment, `1` = invert); on a target it is the
  opt-in flag. A clipping part is both at once, from the *same* value — so
  normalising it to one meaning breaks the other. Same field, two questions.
* **Mask and clipping point in opposite directions.** A pure mask reaches the
  parts drawn **before** it (`rank < writerRank`), a clipping part the ones
  **after**. Getting the comparison backwards still renders — it just masks the
  wrong half of the animation, which reads as an authoring mistake.
* **A writer needs `mask != 0` *and* `hide == false`, checked here.** The Brain
  only drops hidden **mask parts** from `draw_order`; a drawn part turned into a
  mask by `draw_as_mask` still gets its batch when hidden, with only its colour
  suppressed. Skipping the `hide` test leaves a hidden part still cutting holes.
* **`drawInto` runs on a *recording* canvas**, so there is no `GrDirectContext`
  to make an offscreen surface from — Layer 4 records one `SkPicture` per frame.
  The coverage bitmap is therefore an `SkImages::DeferredFromPicture`, which
  Skia rasterises when the outer picture plays back. That is also why §3-2-3's
  size classes, double buffering and hysteresis have nothing to do here: those
  exist to cover a one-frame delay, and a deferred picture image has none.
* **`SkImages::DeferredFromPicture` returns null for a null colour space**, and
  its own doc comment says `may be nullptr`. It is wrong. This shipped once: the
  coverage image came back null, `masking` stayed false, and every target drew
  unmasked — no throw, no log, and the plan still reported seven healthy writers.
  Nothing about the symptom points at colour management.
* **The coverage bitmap is bits, not pixels, and three things corrupt it.**
  Antialiasing (partial edge alpha scales the bit under premultiplied `kPlus`),
  linear sampling (adjacent bits blend), and a colour-space *conversion* (a
  transfer function changes the numbers). So: `setAntiAlias(false)`,
  `SkFilterMode::kNearest`, and the **destination canvas's own** colour space on
  the image — matching it is what makes the conversion the identity, and the
  null that would sidestep the question outright is not available (above). An
  unmanaged canvas falls back to sRGB, which is a no-op because Skia does not
  convert into an unmanaged destination. All three fail *plausibly* — parts mask
  against writers that never covered them — so `tools/check-mask.sh` round-trips
  all 24 bits through the real shaders rather than trusting the reasoning.
* **SkSL runtime effects are ES2**, so the replay has no bitwise operators and no
  dynamic vector indexing. The 24-bit writer sets come apart with `floor`/`mod`
  over constant swizzles instead. `SkRuntimeEffect::Options` can lift the
  restriction and Skia's own header warns the software renderer will still fail;
  do not reach for it.
* **`Invert` and `Increment` do not commute**, so the two planes never share an
  accumulator (§3-1-4) — `increment → invert` covers where `invert → increment`
  does not. `SsMaskBits` keeps them apart to the very end and unions only at the
  decision; `ssbake_check` asserts the two sets stay disjoint.
* **A masked part drops the multi-pass Sub / Invert blend.** Those plans invert
  the destination and invert it back, and the cancellation only holds where the
  middle pass drew — which is exactly what a mask prevents, so the leftover
  inversion would stain the whole quad outside the mask. `BlendModeFor`'s
  one-pass approximation takes over: an approximate blend in the right shape
  beats an exact one in the wrong shape.
* **Only Normal and Mask parts can write coverage today.** A Mesh *can* be a
  clipping writer and a Shape *can* be a pure mask, but their coverage is a
  deformed mesh and a polygon respectively, and nothing bakes either yet.
  `SsMaskPartFlags::quadGeometry` drops them rather than clipping with the
  bounding quad, which would be wrong in a way that looks deliberate.
  `Mask.ssab` carries one of each (`Mesh-WriteMask-True`, `Shape-Mask-True`).
* **A world matrix can be a reflection, and the sign is a product** of authored
  negative scale and the player's flip, so they cancel. Read `determinant()`;
  never infer it from the flip settings.
* **"Raw-read the struct vectors" is not an argument against flatc.** There used
  to be a hand-written `cpp/SsFrameData.hpp` mirroring framedata.fbs's offsets,
  on two premises that both turned out to be false. `30_core/30_render_loop.md`
  §2's advice to read the struct vectors raw is satisfied *through* flatc's C++
  output, not around it: struct fields are direct member reads via
  `EndianScalar` (a no-op on little-endian) and `Vector<const T*>::Data()` hands
  back the contiguous pointer. The ~26x that argument leaned on is a **Unity/C#**
  measurement, where each accessor is a ByteBuffer read. And "keeps flatbuffers
  out of the build" was already untrue — `cpp/format/ssab.h` puts
  `third_party/flatbuffers/include` on both the podspec's and CMake's path.
* **The FrameData risk that survived the switch is a *stale* `cpp/format/`.**
  Generated offsets can no longer disagree with the schema, but a committed
  header older than the `libssruntime` in `native/` is internally consistent and
  simply wrong — a silently misread buffer, the same failure as before.
  `npm run check-framedata` is the guard: it regenerates and diffs, *then* drives
  a real `.ssab` through `SsBaker` under ASan with `flatbuffers::Verifier` on
  every frame. The `Verifier` is deliberately host-only; it walks the whole
  buffer and `refreshFrame()` runs once per player per frame.
* **`partCount` has two independent sources and they are not cross-checked.**
  `HybridSsContext::partCount_` comes from the *world matrix* length ÷ 16, while
  per-part attributes come from `FrameData.parts`. The only thing standing
  between a disagreement and a read past the end is `SsBaker::bake`'s
  `partIndex >= soa.partCount` skip; `ssbake_check` reports the disagreement
  itself. The old hand-written reader returned a default for an out-of-range
  index, which silently absorbed this instead of surfacing it.
* **Android autolinking needs a `ReactPackage` implementation, even for a
  C++-only module.** Without one in `android/src/main/`, the package is not a
  Gradle subproject and its native code is never built — silently. That is why
  Android went unbuilt for a whole phase. Two follow-ons: **apply the Kotlin
  plugin** (nitrogen only adds its generated Kotlin to `java.srcDirs`; javac
  ignores `.kt`), and **write `JNI_OnLoad` yourself** — nitrogen generates
  `registerAllNatives` but not its caller, so without it the `.so` loads and
  every `createHybridObject` then throws.
* **Prose in `SsPlayerPackage.kt` can break the build.** That autolinking lookup
  is a regex over the whole file, first match wins, so an English sentence
  naming a type and `ReactPackage` in the wrong order gets picked up as the
  class name and `PackageList.java` instantiates a word out of a comment. This
  has happened.
* **Two Android build caches survive a source fix**, and both present as "I
  changed it and nothing changed": `android/build/generated/autolinking/` (the
  dependency list) and `android/app/build/generated/autolinking/` (the generated
  `PackageList.java`). Delete them when autolinking behaviour looks stale.
* **Follow the app's `reactNativeArchitectures`, never hardcode `abiFilters`.**
  A hardcoded list builds ABIs the app is not building, whose prefab
  dependencies were never materialised — the link line then comes up missing
  `libNitroModules.so` and `librnskia.so`, and the errors name Nitro symbols
  rather than the ABI.
* **RN Skia's Android prefab: take the library, not the headers.** Its
  `prepareHeaders` flattens `cpp/**`, so `cpp/jsi/JSIConverter.h` becomes
  `JSIConverter.h` while `JsiSkConverters.h` still asks for `"jsi/JSIConverter.h"`
  — the published headers do not compile. Use the `rnskia` prefab for linking
  and RN Skia's own `cpp/` tree for includes, which is also what the podspec
  does on iOS.
* **Skia exports only what `SK_API` marks.** `SkCanvas::drawVertices` resolves
  out of `librnskia.so`; `SkVertices::MakeCopy` and `sk_abort_no_print` sit in
  the same `.so` as *local* symbols (`nm -C` shows `t`, not `T`) and do not.
  `libskia.a` is linked **after** the prefab to supply exactly those leaves — the
  order is load-bearing, since archive-first would satisfy everything from the
  archive and put a second Skia in the process.
* **Two copies of a native module is not a duplicated dependency** — it is two
  autolinked pods fighting over one JSI registration. npm auto-installs the
  package's peers at the workspace root, so the root `overrides` block pins each
  onto the version `expo install` chose. Bump them together with the Expo SDK.
* **`.gitignore` carries a NuGet rule (`**/[Pp]ackages/*`) from the shared gibo
  template that would swallow the whole npm workspace.** The
  `### SSPlayerForReactNative ###` section at the bottom undoes it and then
  re-excludes `node_modules`. If tooling regenerates the template, that section
  must be re-appended.
* **Nitro passes struct parameters by value** unless the `CustomType` sets
  `canBePassedByReference`. A `const T&` override silently fails to override.
* **Nitro's `HybridObject` already defines `dispose()`** — redeclaring it in a
  spec is a hard nitrogen error. Overriding it in the *C++ class* is not only
  allowed but required, and the two are easy to conflate: the spec must stay
  silent about disposal while `HybridSsResource`/`HybridSsContext` must each
  implement it. See the `dispose()` no-op trap above.
* **The RN Skia unwrap is version-sensitive, and 2.11 already broke it once.**
  RN Skia 2.11 moved its API objects off `jsi::HostObject` onto the
  `jsi::NativeState` pattern (`JsiSkNativeObject`), so `asHostObject<JsiSkCanvas>`
  stopped even compiling and `JsiSkPaint::fromValue` changed what it returns.
  `cpp/SsRNSkiaInterop.cpp` now goes through `RNSkia::getJsiObject` /
  `tryGetJsiObject` / `objectFromValue`. This is coupling to RN Skia's
  *internals*, which carry no compatibility promise — a Skia bump means
  rebuilding `example/ios` before believing anything, and the peer range says
  `>=2.11`.
* **`RNSkia` in a name means the fragile dependency; `Skia` means the stable
  one.** The two are disjoint and it is worth keeping them that way:
  `SsRNSkiaInterop.cpp` includes `JsiSk*.h` and no Skia header, `SsSkiaDraw.cpp`
  includes `include/core/Sk*.h` and no RN Skia header. So `grep -rl 'RNSkia::'
  cpp/` lists exactly what an RN Skia version bump can break — one file (drop the
  `::` and you also get the two that merely `#include` it). Both were
  once called `SsSkia*`, which flattened that distinction and made the grep
  useless; `Bridge` was the second half of the problem, since in RN that word
  means the legacy async bridge and this is JSI. Do not rename `SsSkiaDraw` to
  something backend-neutral either: when a second backend arrives it wants to sit
  next to it as `SsWebGpuDraw`.
* **A `CustomType` inside a struct needs an alias in `margelo::nitro`.**
  Nitrogen emits the struct's `JSIConverter` specialization into
  `margelo::nitro` but names the member's type unqualified
  (`JSIConverter<SkPaintHandle>`), which only resolves for types nitrogen itself
  declares — ours live one level down, under the `cxxNamespace`. `SsRNSkiaInterop.hpp`
  carries `using SkPaintHandle = ssplayer::SkPaintHandle;` for exactly this. It
  fails at *Swift module emission* for the pod, not at the struct's own header,
  so the error points somewhere unhelpful.
* **`cpp/` includes cbindgen's `ssruntime.h` directly, and that is
  load-bearing.** There used to be a hand-written `SsRuntimeApi.h` redeclaring
  the subset in use, so the sources compiled without the SDK present. It was
  retired: the C-API is `extern "C"`, so a hand-copied signature that drifts
  still *links* and then misbehaves at runtime, and "compiles without the SDK"
  bought nothing when linking needs `native/` anyway. A missing
  `download-sdk`/`build-runtime` now fails at compile, naming the header.

## Verification

Install the Brain first (`npm run download-sdk`, or `npm run build-runtime --
build=release` when working on it).

| Check | Command |
|---|---|
| Typecheck (package + example) | `npm run typecheck` |
| FlatBuffers accessors current + read path sound | `npm run check-framedata` (needs `flatc`) |
| Nitro codegen is current | `npm run generate-nitro-code` → `git diff --exit-code packages/*/nitrogen` |
| iOS build | (in `example/`) `npx expo prebuild --platform ios && npx expo run:ios` |
| Android build | (in `example/`) `npx expo prebuild --platform android && npx expo run:android` |
| Renders correctly | The **Player** screen must draw `overall/Basic` upright with its texture — the red/blue arrow cards, right way up, no untextured white — and animate. (`overall/Basic`, not Ringo, on purpose: `PlayerScreen.tsx` explains why.) |
| PartColor and part opacity | On the **Player** screen switch *Animation* to **PartsColor**. Eight tinted quads, all four PartColor modes, half with the four corners differing so the gradient is exercised — and every part semi-transparent, so it is the opacity check too. Flat tints where a gradient is authored means the UV reconstruction is wrong; uniformly opaque means the vertex colours are not reaching `drawVertices`. |
| Mesh deformation | On the **Player** screen switch *Animation* to **Mesh**. The parts must be *deformed* and sit where the rest of the animation does. A mesh drawn far off-centre, or scaled oddly, is the world matrix having been applied to vertices that were already world-space. On the host, `ssbake_check` on `Mesh.ssab` must report a **non-zero** peak vertex count (it was 0 for the whole of the time Mesh went unbaked) — currently 32, and Ringo's went 68 → 653 when Mesh landed. |
| Mask and clipping | On the **Player** screen switch *Animation* to **Mask**. Both directions have to be visible at once: `Mask-Hole` cuts holes in the parts *under* it, `Normal-Clipping-True` confines the parts *over* it. Everything drawing unclipped means the coverage never reached the replay (check the bitmap is not antialiased and the sampler is nearest); everything vanishing means the polarity is inverted — `masked == visible_inside` is the test, and getting it backwards is the one failure that still looks deliberate. The `Mesh-WriteMask-True` and `Shape-Mask-True` parts are **expected** not to clip yet. |
| Mask plan, on the host | `tools/.build/ssbake_check example/assets/ss/overall/Mask.ssab anime_1 120` — the plan is built under ASan and its ranges asserted. Read the `mask:` line: **zeroes mean the path never ran**, which is the same trap as `verts` holding constant across the Phase 0 sweep. It currently reports 120 frames with a plan, 840 writer-frames, 1560 target-frames. |
| Mask **drawing**, on the host | `npm run check-mask` (macOS). The plan was never the fragile half — everything that broke was Skia-side and broke silently. Checks the SkSL compiles (ES2), that all 24 coverage bits survive the image round-trip on both a managed and an unmanaged destination, and that the real `DrawBakedFrame` output actually differs with the mask input from without. |
| Blend modes reach the framebuffer | On the **Player** screen switch *Animation* to **BlendMode**. Eight 64×64 quads over a 256×256 Mix backdrop, one per type — they must differ *from each other*. All eight looking identical is the `drawVertices` trap above, and it is the only symptom that failure has. |
| Asset directory reaches its siblings | On the **Player** screen switch *Textures* to **reference**. That pack has no embedded atlas, so if `common.png` were not found next to the `.ssab` the parts would be untextured white — it is the only check that exercises sibling resolution end to end, and it must pass on **both** platforms and in a **release** build, which is where the old `require()` route failed. |
| No leaked native handles | On the **Player** screen press **Leak check**: 8 load/dispose cycles, and both counts in the readout above it must come back to where they started. Toggling *Animation* or *Textures* is the same check by hand — the counts must dip and return, not climb. Exact because `dispose()` releases eagerly; a count that stays high is a leak, not a pending GC. **`1→1` is also what a frozen counter prints**, so if you are changing this path, first confirm the counts *move*: hold N undisposed players, watch them reach `1+N`, then dispose and watch them return in the same tick. |
| Measurement | The harness is retired — `docs/phase0-spike.md` records the numbers. Re-measuring means restoring `example/src/bench/` and the `getSoA`/`getPlan`/`bake` spec surface from git history, and doing it in **release on both sides** |

## Render recipe (Normal kind)

Per frame, per player: `update(dt)` → `get_frame_data(frameNo)` refreshes the
SoA pointers → for each `kind == Normal` batch, walk
`draw_order[start_rank .. +count]`, and for each part emit 4 world-transformed
corners (`m0·x + m4·y + m12`, `m1·x + m5·y + m13`) plus its pixel UVs and two
triangles. The batch's slice of the flat float arrays is already `SkPoint`-shaped,
so `SkVertices::MakeCopy` takes it without conversion, then
`canvas->drawVertices(v, mode, paint)` — `paint` being the one the batch's
`texture_hash` selects out of the call's texture table, carrying that cellmap's
atlas image shader, and `mode` coming from `SsBlend.hpp`'s table. JS supplies only
the canvas, that table and the root transform.

Ten of the twelve blend types are one `SkBlendMode` and keep the
one-`drawVertices`-per-batch shape. **Sub and Invert do not**: Skia has no
reverse-subtract and no dst-replace, so each is rebuilt from three passes
(`SsBlend.hpp` derives them), and that costs the batching — the inversion passes
must cover each pixel exactly once, so those batches are peeled into single
quads. Two overlapping Sub parts drawn together would invert their overlap twice
and cancel it.

When the frame has any mask writer, one pass runs **before** all of this: each
writer's quad is drawn into an offscreen coverage bitmap with its own bit set
(`kPlus`, so disjoint bits OR together), and the bitmap is stretched over the
writers' union box in player-local space. It has to be complete first — a pure
mask reaches the parts drawn *before* it, so the very first target can already
need a writer nobody has walked yet. Each masked target is then peeled to its own
quad like a tinted one, and its shader is wrapped by the replay: reconstruct the
coverage UV from the texcoord, read back the writers whose scope reaches this
rank, and return transparent where `masked != visible_inside`. Scope is resolved
on the CPU, so the shader gets two 24-bit sets rather than a per-writer array.
