# SSPlayerForReactNative — AI Agent Guide

## Operating rules

*   Keep changes scoped to the requested task. Unrequested hardening is a suggestion, not a commit; a defect
    you actually hit in the code you touched is not — fix it, or say plainly why you did not.
*   Before editing, read enough surrounding context to understand callers and invariants, the ones below
    included.
*   **Anything that exists twice changes twice** — a page and its translation, a `.sh` and its `.ps1`.
    Missing one half is this family's most common defect.
*   **Never break a line between two Japanese characters**; Chrome renders the break as a space.
*   **Finish with this repository's checks**: the table in [CONTRIBUTING.md](./CONTRIBUTING.md) — typecheck
    after editing TypeScript, `pnpm run check-framedata` after touching `framedata.fbs` or the FrameData
    read path. Read what a run says it verified, not its exit code — several checks pass, or skip
    themselves, without a prerequisite.
*   **Do not restate what another file owns**; the table below says which file. A fact no file owns goes
    where its staleness will be noticed.
*   **Never commit inside the `SpriteStudio-SDK` submodule.** A core change is an SDK pull request, then a
    submodule bump here.
*   **Playback and rendering semantics are the SDK's**: its [AGENTS.md](./SpriteStudio-SDK/AGENTS.md) and
    the porting guide in `SpriteStudio-SDK/libs/ssruntime/docs/`. Where the guide is silent,
    SSPlayerForWgpu decides. Do not reimplement either.
*   **Code comments never cite the porting guide** (sections, paths, quotes): it moves, and nothing checks
    the citation. Say what breaks instead.
*   **Use the family's terms.** Grep `SpriteStudio-SDK/libs/*/docs` and the other players before coining
    one: a pack is **Reference** or **Embedded**, never "sibling" or "embedded atlas".

## What this repo is

The React Native **Body** for the SpriteStudio-SDK **Brain** (the `SpriteStudio-SDK/` submodule): a pnpm
workspace that drives the Rust `libssruntime` over **Nitro Modules (JSI)** and draws through
**React Native Skia**.

## Where each answer is written

| Question | File |
|---|---|
| Use | [README.md](./README.md), the [docs site](./docs/) |
| What does and does not draw | [docs/limitations.md](./docs/limitations.md), the single list |
| Constraints, setup, build, test, the docs site | [CONTRIBUTING.md](./CONTRIBUTING.md), [docs/development/](./docs/development/) |
| Releases, maintainers only | [RELEASING.md](./RELEASING.md) |
| Status, timing, non-goals | [ROADMAP.md](./ROADMAP.md) |
| What a layer is for | its header comment; `src/index.ts` lists the four in order |
| The reasoning behind an invariant | the code site named beside it |

## Invariants

Read the code site named after a rule before changing it.

*   **Nitro's `dispose()` is a no-op unless C++ overrides it.** — `cpp/HybridSsContext.hpp`
*   **Only `SsAnimeBinaryView` verifies the `.ssab`**: build one per load and keep it. —
    `cpp/SsAnimeBinary.hpp`
*   **The transport is passthrough to the Brain**, and its semantics are not the obvious ones. —
    `SpriteStudioPlayer.applySettings()`
*   **Slots step from the part list, never `draw_order`**, so a hidden part's clock keeps running. —
    `cpp/SsInstance.hpp`, `pnpm run check-hidden`
*   **A mask crossing an instance boundary hands its coverage down**; it is never rebuilt below. —
    `cpp/SsMask.hpp`, `pnpm run check-mask`
*   **Effect is the gap in the SDK's per-kind geometry**: its plan is in simulation space with normalized
    UVs. — `cpp/SsEffect.hpp`
*   **Never re-implement FNV-1a**; `SsRuntime.hashString` exposes the Brain's. —
    `src/core/SsTextureRegistry.ts`

These have no code site:

*   **No per-frame allocations in the playback hot path**, on either side of JSI. A per-frame buffer is a
    member resized in place, like `SsBaker`'s.
*   **A new `cpp/` file needs a step per platform, and iOS fails silently**: the podspec glob expands at
    `pod install`, while `android/CMakeLists.txt` lists sources and fails at link time. The same goes for a
    nitrogen run that adds a file.
*   **Android autolinking needs a `ReactPackage`, the Kotlin plugin and a hand-written `JNI_OnLoad`**, even
    for a C++-only module; nitrogen generates the registration, not its caller. Follow the app's
    `reactNativeArchitectures` and never hardcode `abiFilters` — the Brain ships no 32-bit `x86`.
    Autolinking reads `SsPlayerPackage.kt` with a whole-file regex, first match wins, so prose naming a
    type before `ReactPackage` becomes the class name.
*   **Peer dependencies stay single-copy**: two copies of a native module are two pods fighting over one
    JSI registration. `example/package.json` pins each to the exact version it builds against, and pnpm
    resolves the package's peers to those; move them by hand.
*   **RN Skia coupling lives only in `SsRNSkiaInterop`.** `RNSkia` in a name is the fragile dependency,
    `Skia` the stable one, and they never share a file, so `grep -rl 'RNSkia::' cpp/` lists what a Skia
    bump can break. The floor is 2.11.
*   **pnpm is isolated: nothing is hoisted.** A module is declared by the workspace that loads it — the
    example's Babel preset, the config plugin's `expo`.
*   **`.gitignore` inherits NuGet's `**/[Pp]ackages/*` from the gibo template**, which would swallow the
    workspace; the `### SSPlayerForReactNative ###` section undoes it. Re-append that section if the
    template is regenerated.
*   **Two Android caches survive a source fix**: `android/build/generated/autolinking/` and
    `android/app/build/generated/autolinking/`.
