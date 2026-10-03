# SSPlayerForReactNative — AI Agent Guide

## Operating rules

*   Keep changes scoped to the requested task. Unrequested hardening is a suggestion, not a commit; a defect
    you actually hit in the code you touched is not — fix it, or say plainly why you did not.
*   Do not commit, push, or open PRs unless the user explicitly asks.
*   Before editing, read enough surrounding context to understand callers and invariants, the ones below
    included. If the read tool truncated a file, read the remaining ranges first.
*   Follow the existing style of the file you touch (naming, type usage, control flow, error handling).
*   **Anything that exists twice changes twice** — a page and its translation, a `.sh` and its `.ps1`. A
    change that lands in one half is the defect this family produces most.
*   **Never break a line between two Japanese characters**: Chrome draws that break as a visible space.
*   **Finish by running this repository's checks**: the table in [CONTRIBUTING.md](./CONTRIBUTING.md) —
    typecheck after editing TypeScript, and `pnpm run check-framedata` after touching `framedata.fbs` or the
    FrameData read path. Read what a run says it verified rather than its exit code — several checks here
    pass, or skip themselves, when a prerequisite is missing.
*   **Do not restate here what another file owns.** The table below says which file that is; a fact that
    belongs to none of them goes where it will be seen to go stale.
*   **Never commit inside the `SpriteStudio-SDK` submodule.** A change the core needs is a pull request in
    the SDK repository, followed by a submodule bump here.
*   **Playback and rendering semantics are the SDK's** — see [its AGENTS.md](./SpriteStudio-SDK/AGENTS.md)
    and the porting guide in `SpriteStudio-SDK/libs/ssruntime/docs/`; where the guide is silent,
    SSPlayerForWgpu's behaviour decides. Do not reimplement the rules they own.
*   **Code comments do not cite the SDK's porting guide** — no section numbers, page paths or quotes.
    Its sections move as it is revised and nothing checks a citation inside a comment; say what breaks
    if the code changes, and leave the rule to the guide.
*   **Generated code is committed and never hand-edited** — `nitrogen/` and `cpp/format/`. Change the spec
    or the `.fbs` and re-run the generator.
*   **Write in the family's words.** Before coining a term, grep the SDK submodule
    (`SpriteStudio-SDK/libs/*/docs`) and check the other players — a pack is **Reference** or **Embedded**,
    never "sibling" or "embedded atlas".

## What this repo is

The React Native **Body** for the SpriteStudio-SDK **Brain**: a pnpm workspace whose package drives
the Rust `libssruntime` over **Nitro Modules (JSI)** and draws through **React Native Skia**. The
Brain lives in the `SpriteStudio-SDK/` submodule — see its own
[AGENTS.md](./SpriteStudio-SDK/AGENTS.md).

## Where each answer is written

| Question | File |
|---|---|
| What the package does, and how to use it | [README.md](./README.md), the [docs site](./docs/) |
| What does and does not draw | [docs/limitations.md](./docs/limitations.md), the single list |
| How to set up, build, test and verify | [CONTRIBUTING.md](./CONTRIBUTING.md), [docs/development/](./docs/development/) |
| How the site is built and a release is cut | [RELEASING.md](./RELEASING.md), maintainers only |
| Status, what lands when, and what is out of scope | [ROADMAP.md](./ROADMAP.md) |
| What a layer is for | that layer's own header comment; `src/index.ts` lists the four in order |
| The argument behind an invariant below | the code site named beside it |

## Invariants

The rules are here; **the argument for each is in the code**, at the site it binds. Follow the
pointer before changing one.

| Rule | Where the reasoning is |
|---|---|
| Every buffer handed to JS is valid only until the next `update()`. `generation` is stamped into every struct; compare before reading. **Nitro's `dispose()` is a virtual no-op unless C++ overrides it.** | `src/specs/SsRuntime.nitro.ts`, "Lifetime rule" · `cpp/HybridSsContext.hpp` |
| The `.ssab` is **verified**, and `SsAnimeBinaryView` is the only thing that verifies it. Build one per load and keep it. | `cpp/SsAnimeBinary.hpp` · `HybridSsResource::adopt()` |
| The Brain owns playback state; the transport is passthrough, and its semantics are **not** the obvious ones. | `SpriteStudioPlayer.applySettings()` · SDK docs `30_core/20_playback_control.md` |
| **A pack is a directory, not a file** — so `require()` is not a source, and `assetExts` stays clean of `ssab` / `ssqb`. | `src/player/source.ts`, "Why not `require()`" |
| **Slots step from the part list, never from `draw_order`** — a hidden part's clock must keep running. | `cpp/SsInstance.hpp` · `pnpm run check-hidden` |
| A mask crossing an instance boundary **hands over its coverage**; it is never rebuilt below. | `cpp/SsMask.hpp` · `pnpm run check-mask` |
| Geometry per kind is the SDK's contract. The gap it leaves is **Effect**: its plan is in simulation space with normalised UVs. | SDK docs `30_core/40_render_loop.md` · `cpp/SsEffect.hpp` |
| **Never re-implement FNV-1a** — `SsRuntime.hashString` exposes the Brain's own. | `src/core/SsTextureRegistry.ts` |
| The example's subject list is read from the generated manifest, never hand-written. | `example/src/player/PlayerScreen.tsx`, `filesOf()` |
| The web barrel re-exports **only import-clean modules**; everything else is a throwing stub. | `src/index.web.ts` · `tools/check-web-barrel.mjs` |

And these, because no code site could hold them:

*   **Layer 1 owns the drawing, not just the geometry.** JS's per-frame job is one call per player,
    `drawInto`; nothing per-vertex crosses the JSI boundary. Routing vertices through JS was measured and
    does not work — `Skia.MakeVertices` unmarshals host objects one vertex at a time.
*   **L2 must import nothing from `react` or `react-native`**, so headless use, react-native-web and a
    future renderer stay possible. Skia is fair game: it is the drawing backend, not the UI framework.
    **Nothing enforces this** — no lint rule, no test.
*   **Adding a file to `cpp/` needs a step on each platform, and iOS fails silently.** The podspec globs
    `cpp/**`, but the glob is expanded at `pod install` time; `android/CMakeLists.txt` lists sources
    explicitly and fails loudly at link time. The same goes for a nitrogen run that adds a file.
*   **Android autolinking needs a `ReactPackage` implementation even for a C++-only module**, plus the
    Kotlin plugin and a hand-written `JNI_OnLoad` — nitrogen generates the registration but not its caller.
    Follow the app's `reactNativeArchitectures` and never hardcode `abiFilters`; the Brain ships no 32-bit
    `x86`. `SsPlayerPackage.kt` is read by an autolinking **regex over the whole file, first match wins**,
    so prose naming a type and `ReactPackage` in the wrong order gets instantiated as a class name.
*   **Peer dependencies must stay single-copy.** Two copies of a native module is not a duplicated
    dependency, it is two autolinked pods fighting over one JSI registration; the `overrides` in
    `pnpm-workspace.yaml` pin each onto the one version `example/` builds against. Bump them together, by hand.
*   **RN Skia coupling is confined to `SsRNSkiaInterop`.** `RNSkia` in a name means the fragile dependency,
    `Skia` means the stable one, and the two never share a file — so `grep -rl 'RNSkia::' cpp/` lists
    exactly what a Skia bump can break. The floor is **2.11**.
*   **pnpm, in its isolated layout: nothing is hoisted to borrow.** A module the code loads is declared by
    the workspace that loads it — the example's Babel preset, the config plugin's `expo`. The native build
    finds RN Skia through the layout, not a fixed path; both probes are commented where they run.
*   **`.gitignore` carries a NuGet rule from the shared gibo template** (`**/[Pp]ackages/*`) that would
    swallow the whole workspace; the `### SSPlayerForReactNative ###` section at the bottom undoes it.
    Re-append that if the template is ever regenerated.
*   **Two Android build caches survive a source fix** and present as "I changed it and nothing changed":
    `android/build/generated/autolinking/` and `android/app/build/generated/autolinking/`.
