# SSPlayerForReactNative — AI Agent Guide

React Native **Body** for the SpriteStudio-SDK **Brain**. An npm workspace whose package drives the Rust `libssruntime` over **Nitro Modules (JSI)** and draws through **React Native Skia**. The Brain lives in the `SpriteStudio-SDK/` submodule — see its own [AGENTS.md](./SpriteStudio-SDK/AGENTS.md). `CLAUDE.md` is a symlink to this file.

**Status and what lands when live in [ROADMAP.md](ROADMAP.md)**; this file is the working guide. **The reasoning behind an invariant lives in the code, at the site it binds** — this file is the index, saying what the rule is and where its argument is. The exception is the short list under [Hard constraints](#hard-constraints) that no file could hold: facts about the build system, about Nitro, about what happens when something is *absent*.

## Operating rules

*   Keep changes scoped to the requested task.
*   Do not commit unless the user explicitly asks.
*   Before editing, read enough surrounding context to understand callers and invariants; if the read tool truncated the file, read the remaining ranges before making non-trivial changes.
*   Follow existing code style in touched files (naming, type usage, control flow, error handling).
*   **Generated code is committed and never hand-edited** — `nitrogen/` and `cpp/format/`. Change the spec or the `.fbs` and re-run the generator.
*   After editing TypeScript, typecheck; after touching `framedata.fbs` or the FrameData read path, run `npm run check-framedata`. See [Verification](#verification).
*   Fix stale docs in the same turn you notice them (architecture/roadmap drift easily).
*   **Each fact has one home, and the others link to it.** Anything a *consumer* needs goes in `docs/` — `README.md` is a landing page that points there, and `docs/limitations.md` is the single list of what does and does not draw. Anything a *contributor* needs goes here, in `ROADMAP.md`, or in `docs/development/`. Writing a second copy of a list is how the first one goes stale: the feature list lived in three places and the README's copy spent months calling a shipped feature missing.
*   **Write for the reader, in the family's words.** State who a page is for before what it does, and give the reason from their side (`your app needs a development build`, not `this package contains native code`). Before coining a term, grep the SDK submodule (`SpriteStudio-SDK/libs/*/docs`) and check the other players at [github.com/cri-middleware](https://github.com/cri-middleware) — a pack is **Reference** or **Embedded**, not "sibling" or "embedded atlas".
*   **SDK Alignment:** when modifying playback or rendering logic, refer to [`SpriteStudio-SDK/AGENTS.md`](./SpriteStudio-SDK/AGENTS.md) for the Rust runtime's constraints and to `SpriteStudio-SDK/libs/ssruntime/docs/` for the contracts this Player implements — the `DrawBatch` plan, `FrameData`, the part kinds, masks and playback control.

## Architecture

The Brain loads a `.ssab`, advances time, and emits per-frame **SoA buffers** plus a FlatBuffers **`FrameData`** carrying a **DrawBatch** plan. The Body is a four-layer downward dependency — **L1** Nitro bindings and the C++ that walks the plan, bakes geometry and draws into `SkCanvas`; **L2** `SsInternalPlayer`, native lifetime; **L3** `SpriteStudioPlayer`, transport, events and clock; **L4** the components. Each layer's own header comment says what it is for; `src/index.ts` lists the four in order.

| Path | What you would not guess from the tree |
|---|---|
| `src/core/` | **L2, the react-free boundary.** `fit.ts` is the only copy of the placement arithmetic. |
| `src/index.web.ts`, `src/web/` | The web stub barrel, reached through `package.json` `browser`. **Not web support** — see below. |
| `cpp/SsRNSkiaInterop.{hpp,cpp}` | **The only place RN Skia's internals are touched.** Everything else uses Skia's public API. |
| `cpp/format/`, `nitrogen/`, `docs/api/` | Generated. **Committed except `docs/api/`, never hand-edited.** |
| `native/` | **Gitignored.** The Brain, installed by `download-sdk` or `build-runtime`. |
| `docs/` | The VitePress site — **user-facing documentation, and where anything a consumer needs belongs.** `.vitepress/config.mts`'s header carries the shelf conventions and the divergences from the sibling players. |

## Hard constraints

**These are the rules. The argument for each is in the code**, at the site it binds — follow the pointer before changing one.

| Rule | Where the reasoning is |
|---|---|
| Every buffer handed to JS is valid only until the next `update()`. `generation` is stamped into every struct; compare before reading. **Nitro's `dispose()` is a virtual no-op unless C++ overrides it.** | `src/specs/SsRuntime.nitro.ts`, "Lifetime rule" · `cpp/HybridSsContext.hpp` |
| The `.ssab` is **verified**, and `SsAnimeBinaryView` is the only thing that verifies it. Build one per load and keep it. | `cpp/SsAnimeBinary.hpp` · `HybridSsResource::adopt()` |
| The Brain owns playback state; the transport is passthrough and its semantics are **not** the obvious ones. | `SpriteStudioPlayer.applySettings()` · SDK docs `30_core/20_playback_control.md` |
| **A pack is a directory, not a file** — so `require()` is not a source, and `assetExts` stays clean of `ssab`/`ssqb`. | `src/player/source.ts`, "Why not `require()`" |
| **Slots step from the part list, never from `draw_order`** — a hidden part's clock must keep running. | `cpp/SsInstance.hpp` · `npm run check-hidden` |
| A mask crossing an instance boundary **hands over its coverage**; it is never rebuilt below. | `cpp/SsMask.hpp` · `npm run check-mask`, 4th check |
| Geometry per kind is the SDK's contract. The gap it leaves is **Effect**: its plan is in simulation space with normalised UVs. | SDK docs `30_core/30_render_loop.md`, `40_components/` · `cpp/SsEffect.hpp` |
| **Never re-implement FNV-1a** — `SsRuntime.hashString` exposes the Brain's own. | `src/core/SsTextureRegistry.ts` |
| The example's subject list is read from the generated manifest, never hand-written. | `example/src/player/PlayerScreen.tsx`, `filesOf()` |
| The web barrel re-exports **only import-clean modules**; everything else is a throwing stub. Three ways to break it silently, none caught by `typecheck`. | `src/index.web.ts` · `tools/check-web-barrel.mjs` |
| **Measure in release, and check the animation is playing** — `setup_animation` leaves the transport stopped. | `scripts/build-runtime.*` · `cpp/HybridSsContext.cpp` |

**And these live only here, because there is no code that could hold them:**

*   **Layer 1 owns the drawing, not just the geometry.** JS's per-frame job is one call per player — `drawInto`. Nothing per-vertex crosses the JSI boundary. Routing vertices through JS was measured and does not work: `Skia.MakeVertices` unmarshals JSI host objects one vertex at a time, so it caps the frame rate wherever the geometry is baked.
*   **L2 must import nothing from `react`/`react-native`**, so headless use, react-native-web and a future renderer stay possible. Skia is fair game — it is the drawing backend, not the UI framework. **Nothing enforces this**: no lint rule, no test. `npm run check-web-barrel` catches it only for the modules the web barrel re-exports.
*   **Adding a file to `cpp/` needs a step on each platform, and iOS fails silently.** The podspec globs `cpp/**`, but the glob is expanded at `pod install` time; `android/CMakeLists.txt` lists sources explicitly and fails loudly at link time. Same for a nitrogen run that **adds** a file.
*   **Android autolinking needs a `ReactPackage` implementation even for a C++-only module**, plus the Kotlin plugin and a hand-written `JNI_OnLoad` (nitrogen generates the registration but not its caller). Follow the app's `reactNativeArchitectures` and never hardcode `abiFilters`; the Brain ships no 32-bit `x86`.
*   **Peer dependencies must stay single-copy.** Two copies of a native module is not a duplicated dependency, it is two autolinked pods fighting over one JSI registration; the root `overrides` block pins each onto the version `expo install` chose. Bump them together with the Expo SDK.
*   **RN Skia coupling is confined to `SsRNSkiaInterop`.** `RNSkia` in a name means the fragile dependency, `Skia` means the stable one, and the two never share a file — so `grep -rl 'RNSkia::' cpp/` lists exactly what a Skia bump can break. The floor is **2.11**.

## Toolchain scripts (`scripts/`, `.js` shim → `.sh`+`.ps1`; SDK via `$SSSDK`)

| Script | Does | When |
|---|---|---|
| `download-sdk` | Install the release pinned in `scripts/SDK_VERSION.txt` into `native/`. **No Rust needed**, and skips when what is installed already matches. | Normal setup |
| `build-runtime` | Build the Brain from the submodule into the same layout. Writes no version — that describes the pinned release, which this is not — so it is always replaced, never published, and reports `unknown`. Windows: Android slice only. | Changing the Brain |
| `deploy-examples` | `.sspj` → `.ssab` for `example/` via `ssconverter-cli` (needs Rust), then refreshes `example/src/ss-assets.ts` to match. Sources come from the SDK's `tests/` and, optionally, `example/SpriteStudio_Source/` — third-party art this repo does not ship, reported and skipped when absent. | Refresh example assets |
| `generate-nitro-code` | `nitrogen` → `nitrogen/generated/`. Commit the result. | After a spec change |
| `generate-fbs-code` | `flatc -c` over the three schemas → `cpp/format/`. Commit the result. Needs `flatc`. | After a schema change |

## Verification

Install the Brain first (`npm run download-sdk`, or `npm run build-runtime -- build=release` when working on it).

| Task | Command |
|---|---|
| Typecheck (package + example) | `npm run typecheck` |
| The package compiles to `lib/` | `npm run build` (any OS) — `bob build`, the step `prepack` runs before publishing. |
| FlatBuffers accessors current + read path sound | `npm run check-framedata` (needs `flatc`) |
| Mask drawing, and a mask crossing into an instance child | `npm run check-mask` (macOS). The instance half **reports itself skipped** without the optional `MaskInstance` sample. |
| Instance slots keep stepping while out of the draw plan | `npm run check-hidden` |
| `ss-*` shaders compile, and their arithmetic | `npm run check-shader` (macOS) |
| The web stub barrel still imports clean, matches `index.ts` and throws | `npm run check-web-barrel` (any OS, no Brain needed) |
| The docs site builds, and no page link is dead | `npm run docs` (any OS, no Brain needed). **It does not check `#anchors`** — a link to a heading that does not exist still builds green, so verify those by hand. |
| Nitro codegen is current | `npm run generate-nitro-code` → `git diff --exit-code packages/*/nitrogen` |
| Bake / mask plan / effect / instance / shader geometry | `tools/.build/ssbake_check <pack.ssab> <animation> 120` (ASan) |
| Native build | (in `example/`) `npx expo prebuild --platform ios\|android && npx expo run:ios\|android`. The Android prebuild must log `dropped x86 from reactNativeArchitectures`. |
| Asset manifest | `deploy-examples` refreshes it; (in `example/`) `npx react-native-spritestudio assets --check --out src/ss-assets.ts` to verify. **`--check` calls it stale if you deployed the optional `MaskInstance` sample** — the manifest describes a deployed tree and the committed one is the without-it state. That modification is on purpose; do not commit it. |

**Rendering is verified on the example's Player screen** — one feature card per capability, a *Textures* toggle between a **Reference** and an **Embedded** pack, and a **Leak check**. What each subject proves, and the optional `MaskInstance` sample, are in [`example/README.md`](./example/README.md). Read `Mask` and `BlendMode` on **both** platforms: the only platform-specific defect this screen has ever caught was iOS-only.

**Two host checks report a clean bill when they did nothing, and each says so in its own header.** `ssbake_check` — zeroes mean the path never ran. `ssshader_check` — a broken `ss-*` body and an unported one look identical on screen, so **port a body and its row in `ssshader_check.cpp` together**.

## Workspace conventions

*   npm workspaces; **not** pnpm — isolated layouts break Metro, CMake and podspec path resolution.
*   Every toolchain script is a `.js` shim over a `.sh` + `.ps1` pair, so naming a `.sh` in `package.json` would shut Windows contributors out.
*   `.gitignore` carries a NuGet rule (`**/[Pp]ackages/*`) from the shared gibo template that would swallow the whole workspace; the `### SSPlayerForReactNative ###` section at the bottom undoes it. Re-append it if the template is ever regenerated.
*   `SsPlayerPackage.kt` is read by an autolinking **regex over the whole file, first match wins** — prose naming a type and `ReactPackage` in the wrong order gets instantiated as a class name.
*   Two Android build caches survive a source fix and present as "I changed it and nothing changed": `android/build/generated/autolinking/` and `android/app/build/generated/autolinking/`.
*   Expo Go cannot run this package; a prebuild (CNG) is required. Windows, tvOS and visionOS are out of scope — see [ROADMAP.md](ROADMAP.md).
