# SSPlayerForReactNative — AI Agent Guide

React Native **Body** for the SpriteStudio-SDK **Brain**. An npm workspace whose
package drives the Rust `libssruntime` over **Nitro Modules (JSI)** and draws
through **React Native Skia**. The Brain lives in the `SpriteStudio-SDK/`
submodule — see its own [AGENTS.md](./SpriteStudio-SDK/AGENTS.md).
`CLAUDE.md` is a symlink to this file.

> [!IMPORTANT]
> **This repo is at Phase 0 + the start of Phase 1.** What exists is the
> measurement spike that decided the architecture, not a player. There is no
> `<SpriteStudioView>`, no L2/L3, no blend modes, masks or effects. Read
> [`docs/phase0-spike.md`](docs/phase0-spike.md) before designing anything —
> it overturned one of the design doc's premises.

## Operating rules

* Keep changes scoped to the request; read callers/invariants before editing.
* **Do not commit or push unless the user explicitly asks.**
* Never hand-edit `packages/react-native-ssplayer/nitrogen/` — change the spec
  and run `npm run generate-nitro-code`.
* After editing TypeScript, typecheck (see [Verification](#verification)).
  After editing `cpp/SsFrameData.hpp` or touching `framedata.fbs`, run
  `npm run check-framedata`.
* Fix stale docs in the same turn you notice them (architecture/roadmap drift easily).
* **Measure the Brain in release.** A `build=debug` `libssruntime` swamps every
  other cost and flattens the differences a benchmark exists to find. This has
  already produced one wrong conclusion — see `docs/phase0-spike.md`.
* When a rendering detail is unclear: **SSPlayerForFlutter** first (the closest
  reference — same Skia primitives, same layering), then **SSPlayerForGodot**,
  then the submodule's `libs/ssruntime/docs/`.

## The Phase 0 result, and what it means for the architecture

The design doc assumed the open question was *where to bake the geometry* — in
JS like the Flutter Player, or natively. Measurement said that was the wrong
question. 128 players / 8704 vertices, iOS simulator, **release** Brain:

| variant | total ms | fps |
|---|---:|---:|
| (a) JS bake → `Skia.MakeVertices` | 29.7 | 33.5 |
| (b) native bake → `Skia.MakeVertices` | 30.3 | 32.9 |
| **(c) native bake *and* native draw** | **5.8** | **60.0** |

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

* **L4** `<SpriteStudioView>` — an RN Skia `Canvas` plus props/ref. *Not built yet.*
* **L3** `SpriteStudioPlayer` — transport, events, clock. Externally clocked by
  default (`advance(dt)`), self-driving as a fallback. *Not built yet.*
* **L2** internal player — **must import nothing from `react`/`react-native`**,
  so react-native-web, headless tests and a future renderer stay possible.
  After Phase 0 this layer is thin: lifecycle and one draw call per frame.
  *Not built yet.*
* **L1** Nitro bindings + the C++ that walks the batch plan, bakes geometry and
  draws into `SkCanvas`. **This is what exists today.**

## Package layout (`packages/react-native-ssplayer/`)

| Path | Role |
|---|---|
| `src/specs/SsRuntime.nitro.ts` | L1 spec, nitrogen's input. Still the **Phase 0 spike surface**: it exposes all three variants side by side. (a)/(b) go away in Phase 1. |
| `src/index.ts` | Public exports + the `Int32Array` field offsets JS reads batches with. |
| `cpp/SsFrameData.hpp` | Hand-written FlatBuffers reader (see Traps). |
| `cpp/SsBaker.{hpp,cpp}` | SoA → vertex/index/batch arrays. Nitro-free and JSI-free so the host harness can link it. |
| `cpp/SsSkiaBridge.{hpp,cpp}` | Nitro `CustomType` that unwraps RN Skia's `SkCanvas`/`SkPaint` host objects. **The only place RN Skia's internals are touched.** |
| `cpp/SsSkiaDraw.{hpp,cpp}` | Variant (c): `SkVertices::MakeCopy` + `drawVertices`. |
| `cpp/Hybrid*.{hpp,cpp}` | The Nitro Hybrid Objects. |
| `nitrogen/` | **Generated, committed, never hand-edited.** |
| `native/` | **Gitignored.** The Brain, installed by `download-sdk` or `build-runtime`. |

`example/` is the Phase 0 measurement harness: an Expo app that runs the whole
variant × instance-count matrix on launch (`AUTO_SWEEP`) and renders the table.

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
| `check-framedata` | Diff the hand-written FlatBuffers offsets against flatc. macOS/Linux, needs `flatc`. | After a `.fbs` change |

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
* **World matrix is column-major 4×4** — `x' = m0·x + m4·y + m12`.
* **Texture key = `cellmap.name_hash` == `DrawBatch.texture_hash`** — use the
  pre-baked hash; never re-implement FNV-1a.
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
  every returned struct — compare it before reading. Nitro's built-in
  `dispose()` is the explicit teardown; never wait for GC.
* **Per-kind geometry differs**: Normal & Shape verts are **local** (apply the
  world matrix); **Mesh & Effect verts are world-space** (do not). Effect UVs
  are normalised 0..1 and need scaling back up.
* **PartColor alpha is pre-folded by the Brain** — do not re-multiply
  `PartState.alpha` when a PartColor is present.
* **Mask has no C-API** — roles come from the static `.ssab` `PartData`, read
  once at load. `FrameData.mask_indices` is *not* the writer list.
* **A world matrix can be a reflection, and the sign is a product** of authored
  negative scale and the player's flip, so they cancel. Read `determinant()`;
  never infer it from the flip settings.
* **`cpp/SsFrameData.hpp` hardcodes FlatBuffers offsets.** That is deliberate —
  it keeps flatbuffers out of every consumer's iOS/Android build, and
  `30_core/30_render_loop.md` §2 tells Players to raw-read the struct vectors
  anyway. `tools/check-framedata.sh` is the guard; run it after any schema
  change. A size assert alone would miss a same-size field reordering.
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
  spec is a hard nitrogen error.

## Verification

Install the Brain first (`npm run download-sdk`, or `npm run build-runtime --
build=release` when working on it).

| Check | Command |
|---|---|
| Package typecheck | `npm run typecheck` |
| FlatBuffers offsets | `npm run check-framedata` (needs `flatc`) |
| Nitro codegen is current | `npm run generate-nitro-code` → `git diff --exit-code packages/*/nitrogen` |
| iOS build | (in `example/`) `npx expo prebuild --platform ios && npx expo run:ios` |
| Renders correctly | The harness must draw Ringo upright with its texture — apple on head, face, body |
| Measurement | Launch with `AUTO_SWEEP = true`; the results table appears in-app |

## Render recipe (Normal kind, variant (c))

Per frame, per player: `update(dt)` → `get_frame_data(frameNo)` refreshes the
SoA pointers → for each `kind == Normal` batch, walk
`draw_order[start_rank .. +count]`, and for each part emit 4 world-transformed
corners (`m0·x + m4·y + m12`, `m1·x + m5·y + m13`) plus its pixel UVs and two
triangles. The batch's slice of the flat float arrays is already `SkPoint`-shaped,
so `SkVertices::MakeCopy` takes it without conversion, then
`canvas->drawVertices(v, SkBlendMode::kSrcOver, paint)` with `paint` carrying the
atlas image shader. JS supplies only the canvas, the paint and the root transform.
