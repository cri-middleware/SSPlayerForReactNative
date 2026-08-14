# SSPlayerForReactNative — AI Agent Guide

React Native **Body** for the SpriteStudio-SDK **Brain**. An npm workspace whose package drives the Rust `libssruntime` over **Nitro Modules (JSI)** and draws through **React Native Skia**. The Brain lives in the `SpriteStudio-SDK/` submodule — see its own [AGENTS.md](./SpriteStudio-SDK/AGENTS.md). `CLAUDE.md` is a symlink to this file.

**Status, scope and what lands when live in [ROADMAP.md](ROADMAP.md)** — this file is the working guide and carries no progress narrative. The reasoning behind individual invariants lives in the source comments, at the site it applies to.

## Operating rules

*   Keep changes scoped to the requested task.
*   Do not commit unless the user explicitly asks.
*   Before editing, read enough surrounding context to understand callers and invariants; if the read tool truncated the file, read the remaining ranges before making non-trivial changes.
*   Follow existing code style in touched files (naming, type usage, control flow, error handling).
*   **Generated code is committed and never hand-edited** — `nitrogen/` and `cpp/format/`. Change the spec or the `.fbs` and re-run the generator.
*   After editing TypeScript, typecheck; after touching `framedata.fbs` or the FrameData read path, run `npm run check-framedata`. See [Verification](#verification).
*   Fix stale docs in the same turn you notice them (architecture/roadmap drift easily).
*   **SDK Alignment:** when modifying playback or rendering logic, refer to [`SpriteStudio-SDK/AGENTS.md`](./SpriteStudio-SDK/AGENTS.md) for the Rust runtime's constraints and to `SpriteStudio-SDK/libs/ssruntime/docs/` for the contracts this Player implements — the `DrawBatch` plan, `FrameData`, the part kinds, masks and playback control.

## Architecture in one paragraph

The Brain loads a `.ssab`, advances time, and emits per-frame **SoA buffers** (world matrices, local vertices/UVs, cell meta) plus a FlatBuffers **`FrameData`** carrying a **DrawBatch** plan. The Body is a four-layer downward dependency: **L1** Nitro bindings plus the C++ that walks the batch plan, bakes geometry and draws into `SkCanvas`; **L2** `SsInternalPlayer`, native lifetime and one draw call per frame; **L3** `SpriteStudioPlayer`, transport, events and clock; **L4** `<SpriteStudioView>` (one animation, its own RN Skia `Canvas` and frame loop) and `<SpriteStudioScene>` + `<SpriteStudioSprite>` (many animations, one canvas and one clock). Drawing is **React Native Skia** throughout — `drawVertices` into an `SkPicture` re-recorded once per frame and handed to the canvas through a Reanimated shared value, so a frame costs no React render. `.sspj` → `.ssab` conversion is a host-side `ssconverter-cli` step; nothing converts at runtime.

Phase 3 plans **react-native-web** by selecting the existing `@spritestudio/ssplayer-webgl` through `package.json` `exports` — only the L3 API and L4 prop types are shared, which is why L2 stays React-free and L3 is an interface.

## Key components

| Path | Role |
|---|---|
| `packages/react-native-spritestudio/` | The npm package. |
| `src/specs/SsRuntime.nitro.ts` | L1 spec, nitrogen's input. `drawInto` is the only draw path. |
| `src/core/` | **L2, and the react-free boundary** — `SsInternalPlayer`, the texture registry, the refcounted caches, `assets.ts` (sibling-reference resolution), `fit.ts` (the only copy of the placement arithmetic). |
| `src/player/` | L3 — `SpriteStudioPlayer`, `source.ts`, `preload.ts`, `leakCheck.ts`. |
| `src/view/` | L4 — the two components plus `useSpriteStudioPlayer` (the half they share), `useSsTextures`, `useSsPartTransform`. |
| `src/index.web.ts`, `src/runtime.web.ts`, `src/web/` | The web stub barrel, reached through `package.json` `browser`. **Not web support** — see the hard constraint below. |
| `cpp/` | L1: the Nitro hybrids, the baker, the Skia draw path, and one file per feature — `SsBlend`, `SsPartColor(+Shader)`, `SsPartShader(+SkSL)`, `SsMask(+Shader)`, `SsEffect`, `SsInstance`, `SsAnimeBinary`, `SsAssets`. |
| `cpp/SsRNSkiaInterop.{hpp,cpp}` | **The only place RN Skia's internals are touched.** Everything else uses Skia's public API. |
| `cpp/format/` + `nitrogen/` | flatc and Nitro codegen output. **Generated, committed, never hand-edited.** |
| `native/` | **Gitignored.** The Brain, installed by `download-sdk` or `build-runtime`. |
| `plugin/` + `bin/` | Expo config plugin (ships pack directories as native assets, narrows `reactNativeArchitectures`) and `npx react-native-spritestudio assets` (the typed asset manifest). |
| `example/` | Expo app, one Player screen — the rendering verification surface. |
| `tools/` + `scripts/` | Host checks (`ssbake_check`, `ssmask_check`, `sshidden_check`, `ssshader_check`) and the toolchain, `.js` shim → `.sh`/`.ps1`. |

## Hard constraints

*   **Layer 1 owns the drawing, not just the geometry.** `Skia.MakeVertices` takes an array of JSI host objects and unmarshals one vertex at a time, so any design that routes vertices through JS is capped by that cost regardless of where the geometry is baked. JS's per-frame job is one call per player ([`docs/phase0-spike.md`](docs/phase0-spike.md)).
*   **L2 must import nothing from `react`/`react-native`**, so headless use, react-native-web and a future renderer stay possible. Skia is fair game — it is the drawing backend, not the UI framework.
*   **`index.web.ts` is a build-compatibility stub, and what it has to survive is *import*, not render.** It is not web support and nothing on it draws (ROADMAP, *Surroundings*); it exists so an app shipping web **as well as** native can build its web bundle, which today it cannot: `runtime.ts` reaches `NitroModules.createHybridObject` at module scope and Nitro's web shim throws on any property access, and RN Skia's web entry is `JsiSkApi(global.CanvasKit)` at module scope too. Both fire on import, before anything renders. So the web barrel re-exports **only import-clean modules** — `core/fit`, `core/types`, `core/assets`, `core/parts`, `core/SsRefCache`, `core/caches`, `specs/SsRuntime.nitro`, each with type-only imports or none — and everything else is a throwing stub typed through `typeof import(...)`, which is erased. `ssPackColor` sits apart from the rest of the override vocabulary in `core/packColor.ts` for that reason and no other. Three ways to break it silently, **none caught by `npm run typecheck`**: giving one of those modules a runtime import that reaches Skia / RN / Nitro, adding an export to `index.ts` without adding it to `index.web.ts` (a web consumer then reads `undefined` rather than getting an error), and a stub that stops throwing — an arrow function turns `new SsTextureRegistry()` into "is not a constructor" instead of the message. `npm run check-web-barrel` pins all three, and needs no Brain.
*   **Borrow rule.** Every buffer handed to JS is valid only until the next `update()` — the Brain's SoA/FrameData, this module's own vectors, an effect slot's draw plan. `generation` is stamped into every returned struct; compare it before reading. Teardown is explicit: **Nitro's `dispose()` is a virtual no-op unless the C++ class overrides it**, so inheriting it releases no Brain handle. `SsRuntime.liveHandles` + `ssCheckForLeaks()` make that checkable.
*   **The Brain owns the playback state and nothing above mirrors it** — the transport is passthrough, and its semantics are **not** the obvious ones (`30_core/20_playback_control.md`: the delta is milliseconds, pause is a toggle, `setup_animation` resets the settings). Read that page before touching `SpriteStudioPlayer.applySettings()`, the one place the re-apply ordering lives.
*   **The `.ssab` is verified, and `SsAnimeBinaryView` is the only thing that verifies it.** libssruntime parses with `root_as_..._unchecked` and states that invalid input is undefined behaviour — that is the SDK's settled position, not a bug to wait on — and `source` accepts an `http(s)` URL, so the bytes are untrusted. Constructing the view runs `flatbuffers::VerifySsAnimeBinaryBuffer`, `HybridSsResource::adopt()` builds one **before** `ss_resource_create_copy`, and a pack that fails never reaches the Brain. There is no second, non-verifying way to build one: a view that reads `valid()` is verified. The cost tracks table count, not size (470 µs for Ringo's 28k tables, 1 µs for a 1.5 MB pack that is mostly embedded bytes), so **build one per load and keep it** — `HybridSsContext::ssab_` is built in the constructor because `ssab()` is asked per instance part and on every frame carrying an event.
*   **The example's subject list is read out of the generated manifest, not written by hand.** Packs ship as native app assets and nothing in the app can list a directory at runtime, so `example/src/ss-assets.ts` is the only enumeration there is — `filesOf()` filters each subject through it, and a subject with nothing deployed leaves the screen instead of loading nothing and blaming the renderer. A subject marked `ownsPack` offers the whole directory, which is what lets `example/SpriteStudio_Source/` stay out of the repository.
*   **A pack is a directory, not a file.** Everything a `.ssab` names — textures, the external packs Instance parts reach, a `.ssqb`'s sequences — is a sibling *path*. Metro ships a dependency graph and cannot carry one, so **`require()` is not a source**; packs ship as native app assets through the config plugin, and `assetExts` must stay clean of `ssab`/`ssqb`. Changing an asset needs a native build, not a Fast Refresh.
*   **Adding a file to `cpp/` needs a step on each platform, and iOS fails silently.** The podspec globs `cpp/**`, but the glob is expanded at `pod install` time; `android/CMakeLists.txt` lists sources explicitly and fails loudly at link time. Same for a nitrogen run that **adds** a file.
*   **Android autolinking needs a `ReactPackage` implementation even for a C++-only module**, plus the Kotlin plugin and a hand-written `JNI_OnLoad` (nitrogen generates the registration but not its caller). Follow the app's `reactNativeArchitectures` and never hardcode `abiFilters`; the Brain ships no 32-bit `x86`, which the config plugin narrows away.
*   **RN Skia coupling is confined to `SsRNSkiaInterop`.** `RNSkia` in a name means the fragile dependency, `Skia` means the stable one, and the two never share a file — so `grep -rl 'RNSkia::' cpp/` lists exactly what a Skia bump can break. The floor is **2.11**, where the API objects moved onto `jsi::NativeState`.
*   **Peer dependencies must stay single-copy.** Two copies of a native module is not a duplicated dependency, it is two autolinked pods fighting over one JSI registration; the root `overrides` block pins each onto the version `expo install` chose. Bump them together with the Expo SDK.
*   **Never re-implement FNV-1a** — every key the Brain hands over is pre-baked, and `SsRuntime.hashString` exposes its own. What `DrawBatch.texture_hash` resolves against is the SDK's to state (`30_core/30_render_loop.md` §2).
*   **Slots step from the part list, never from `draw_order`.** The Brain drops a `Hide`-ed Instance or Effect part from the draw plan entirely (SDK design, `40_components/40_mask.md`), so a walk that decided what to step by what it was about to draw would stop a hidden part's clock — and an independently-played child would then resume late by exactly the time it spent hidden. `SsInstanceSlots::step` and `stepEffects` both iterate the pack's parts, from `update()` where the delta is. `npm run check-hidden` pins it; SSPlayerForWgpu (`tests/slots.rs`) and SSPlayerForRenPy (`tools/verify_hidden.py`) pin the same rule.
*   **Geometry per kind is the SDK's contract** (`30_core/30_render_loop.md`, `40_components/`) — follow it rather than a copy here. The one gap it leaves is **Effect**: its plan is in the effect's own simulation space with normalised UVs, so the part's world matrix places it and the UVs scale back up by `size_original`. Getting either wrong still draws.
*   **A mask that crosses an instance boundary hands over its coverage; it is never rebuilt below.** §3-2-2's step 1, and it is not an optimisation: a plan's writers are the *caller's* part indices, so rasterising it against the child's geometry draws whatever happens to sit at those indices — an answer that is wrong in both directions and looks like "the mask stopped at the boundary". The AND of §2-6 is carried by **whether `SsMaskInput` arrives with a `plan` at all**, not by a flag. `npm run check-mask`'s fourth check pins both, one mount at a time, through the pack's real atlases — a flat test atlas makes every writer cover its whole quad and the invert OP's parity then comes out as stripes the asset does not have.
*   **Measure in release on both sides, and check the animation is playing.** A debug `libssruntime` swamps every other cost, and `setup_animation` leaves the transport stopped — a harness that forgets `play()` measures one static frame. The version does not record the build mode; `download-sdk` writes it separately, and `prepack` refuses to publish a debug Brain.

## Toolchain scripts (`scripts/`, `.js` shim → `.sh`+`.ps1`; SDK via `$SSSDK`)

| Script | Does | When |
|---|---|---|
| `download-sdk` | Install the pinned SDK release into `native/`. **No Rust needed.** | Normal setup |
| `build-runtime` | Build the Brain from the submodule into the same layout. Leaves no version behind — that describes the pinned release, which this is not. Windows: Android slice only. | Changing the Brain |
| `deploy-examples` | `.sspj` → `.ssab` for `example/` via `ssconverter-cli` (needs Rust), then refreshes `example/src/ss-assets.ts` to match. Sources come from the SDK's `tests/` and, optionally, `example/SpriteStudio_Source/` — third-party art this repo does not ship, reported and skipped when absent. | Refresh example assets |
| `generate-nitro-code` | `nitrogen` → `nitrogen/generated/`. Commit the result. | After a spec change |
| `generate-fbs-code` | `flatc -c` over the three schemas → `cpp/format/`. Commit the result. Needs `flatc`. | After a schema change |

The pinned tag lives in `scripts/SDK_VERSION.txt`, and `download-sdk` skips when what is installed already matches it. A `build-runtime` install writes no version, so it is always replaced, never published, and reports itself as `unknown`.

## Verification

Install the Brain first (`npm run download-sdk`, or `npm run build-runtime -- build=release` when working on it).

| Task | Command |
|---|---|
| Typecheck (package + example) | `npm run typecheck` |
| FlatBuffers accessors current + read path sound | `npm run check-framedata` (needs `flatc`) |
| Mask drawing, and a mask crossing into an instance child | `npm run check-mask` (macOS). The instance half **reports itself skipped** without the optional `MaskInstance` sample. |
| Instance slots keep stepping while out of the draw plan | `npm run check-hidden` |
| `ss-*` shaders compile, and their arithmetic | `npm run check-shader` (macOS) |
| The web stub barrel still imports clean, matches `index.ts` and throws | `npm run check-web-barrel` (any OS, no Brain needed) |
| Nitro codegen is current | `npm run generate-nitro-code` → `git diff --exit-code packages/*/nitrogen` |
| Bake / mask plan / effect / instance / shader geometry | `tools/.build/ssbake_check <pack.ssab> <animation> 120` (ASan) |
| iOS build | (in `example/`) `npx expo prebuild --platform ios && npx expo run:ios` |
| Android build | (in `example/`) `npx expo prebuild --platform android && npx expo run:android` — the prebuild must log `dropped x86 from reactNativeArchitectures` |
| Asset manifest | `deploy-examples` refreshes it; (in `example/`) `npx react-native-spritestudio assets --check --out src/ss-assets.ts` to verify. **`--check` calls it stale if you deployed the optional `MaskInstance` sample** — the manifest describes a deployed tree and the committed one is the without-it state. That modification is on purpose; do not commit it. |

**`ssbake_check`'s per-kind lines all have the same contract: zeroes mean the path never ran**, and `parts > 0` with `peak 0` means enumerated-then-never-emitted. Run it over the `example/assets/ss/overall/` card for the kind you touched and compare against the previous run — the absolute counts are asset-dependent, the zeroes are not.

**An `ss-*` shader that is broken looks exactly like one that was never ported** — `SsShaderEffect` logs a compile failure once and then falls back to the plain textured draw, which is also what a null body does, so the example's Shader card cannot tell them apart and reads as *which ones are done*. `npm run check-shader` is what can: it compiles each body through the real `SsShaderEffect` and pins the arithmetic against the SS6 source the body cites. **Port a body and its row in `ssshader_check.cpp` together**, or the next reader has no way to know the port was right.

**Rendering is verified on the example's Player screen**, whose *Subject* dropdown is one feature card each — `Basic`, `BlendMode`, `PartsColor`, `Mask`, `Mesh`, `Shape`, `Shader`, `Effect`, `Instance`, `UserData`, `Sound`, `Signal` — plus `Ringo` (a real character, the features composing), `RingoInstances` (that cast mounted as instance parts), `MaskInstance` (a mask crossing into an instance child, §2-6/§3-2-2 — **optional**, its source is third-party sample art this repo does not ship; see README.md) and `ParticleEffect` (the heaviest packs). Each card is built so a failure names itself; the *Textures* toggle switches embedded and sibling atlases, and **Leak check** runs 8 load/dispose cycles against `liveHandles`, then 8 loads into **one** player against the texture registry — the reload path handle counts cannot see. Read `Mask` and `BlendMode` on **both** platforms — the only platform-specific defect this screen has ever caught was iOS-only.

## Workspace conventions

*   npm workspaces; **not** pnpm — isolated layouts break Metro, CMake and podspec path resolution.
*   Every toolchain script is a `.js` shim over a `.sh` + `.ps1` pair, so naming a `.sh` in `package.json` would shut Windows contributors out.
*   `.gitignore` carries a NuGet rule (`**/[Pp]ackages/*`) from the shared gibo template that would swallow the whole workspace; the `### SSPlayerForReactNative ###` section at the bottom undoes it. Re-append it if the template is ever regenerated.
*   `SsPlayerPackage.kt` is read by an autolinking **regex over the whole file, first match wins** — prose naming a type and `ReactPackage` in the wrong order gets instantiated as a class name.
*   Two Android build caches survive a source fix and present as "I changed it and nothing changed": `android/build/generated/autolinking/` and `android/app/build/generated/autolinking/`.
*   Expo Go cannot run this package; a prebuild (CNG) is required. Windows, tvOS and visionOS are out of scope — see [ROADMAP.md](ROADMAP.md).
