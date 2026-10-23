---
title: How the player is put together
description: The four layers and the files that hold them, the native side, and the reasons that span files.
---

# How the player is put together

For whoever works on this package or changes it for an app of their own. It names
files and assumes a checkout; [Working from a checkout](/development/from-source)
gets one running, and
[CONTRIBUTING](https://github.com/cri-middleware/SSPlayerForReactNative/blob/HEAD/CONTRIBUTING.md)
has the constraints. This page is the map across them.

What every SpriteStudio Player shares — how playback, motion blending, sound keys
and part tracking behave — is written once, in the SDK's
[Player Porting Guide](https://github.com/cri-middleware/SpriteStudio-SDK/blob/HEAD/libs/ssruntime/docs/README.md).

## The four layers {#the-four-layers}

**The Brain** is `libssruntime`, the SpriteStudio-SDK's playback runtime, written in
Rust and kept in the `SpriteStudio-SDK/` submodule: it advances the timeline,
computes every part's pose and hands back each frame as a draw plan. Everything in
`packages/react-native-spritestudio/` turns that plan into Skia draws. The layers
are listed top to bottom in the header of `src/index.ts`.

| Layer | What it is | Where |
|---|---|---|
| **L4** | `<SpriteStudioView>` (a Skia canvas, props and a ref), `<SpriteStudioScene>` and `<SpriteStudioSprite>` (one canvas and one clock for many animations), `<SpriteStudioPartAnchor>` and `useSsPartTransform` (following a part) | `src/view/` |
| **L3** | `SpriteStudioPlayer`: transport, clock, events; preloading and the leak check | `src/player/` |
| **L2** | `SsInternalPlayer`: native lifetime and one draw call per frame; the texture registry and the shared caches. Imports nothing from `react` / `react-native`. | `src/core/` |
| **L1** | `SsRuntimeModule`: the Nitro seam onto the Brain, exported raw as the escape hatch | spec `src/specs/SsRuntime.nitro.ts`, generated `nitrogen/`, implementation `cpp/` |

### The native side {#the-native-side}

| File | What it does |
|---|---|
| `cpp/HybridSsRuntime.*` | The one autolinked Hybrid Object, and the factory for the rest |
| `cpp/HybridSsResource.*` | A loaded `.ssab`: owns the Brain's resource handle |
| `cpp/HybridSsContext.*` | One playing animation: drives the Brain, hands its buffers to JS, runs the draw |
| `cpp/SsBaker.*` | The per-vertex geometry bake. No Nitro and no JSI, so a host tool can run it under ASan |
| `cpp/SsSkiaDraw.*` | The baked frame turned into Skia draw calls, through Skia's public API only |
| `cpp/SsRNSkiaInterop.*` | The one place that touches RN Skia's JSI object model (`RNSkia::`) |
| `cpp/SsMask.*`, `SsMaskShader.hpp` | Masks and clipping as a coverage bitmap |
| `cpp/SsPartColor*.hpp`, `SsPartShader*.hpp`, `SsBlend.hpp` | PartColor, the `ss-*` shaders, the blend modes |
| `cpp/SsInstance.*`, `SsEffect.*` | Instance parts and particle effects |
| `cpp/SsTick.hpp` | Whether a player's update can change what it draws, and so whether it keeps ticking |
| `cpp/SsAnimeBinary.hpp` | Reads what rendering needs out of the `.ssab`, which the Brain does not hand over |
| `cpp/SsAssets.*` | The app's native asset directory, where a pack keeps its layout |
| `cpp/SsPlayerJni.cpp` | Android's `JNI_OnLoad` |
| `plugin/withSpriteStudio.js` | The Expo config plugin: ships pack directories as native assets and narrows architectures |
| `native/` | The Brain and its headers, from `download-sdk` or `build-runtime`; not in git |
| `tools/` | Host-side checks that link the baker, the mask code and the tick decision against the host Brain |

## Why it is built the way it is {#why-it-is-built-the-way-it-is}

Each reason here spans files; the code it points at carries the detail.

**Nothing per vertex crosses JSI.** JS makes the same few calls per player per frame
whatever the vertex count: `HybridSsContext` drives the Brain, `SsBaker` bakes the
vertices in C++, and `SsSkiaDraw` draws them into the canvas RN Skia hands over.
Routing vertices through JS was measured and capped the frame rate. That is also
why every buffer handed to JS carries a `generation` and is valid only until the
next `update()`.

**One copy of every native module.** React Native, Nitro Modules, RN Skia and
Reanimated are peer dependencies, and an app that ends up with two copies of one
has two native modules registering the same JSI objects — on iOS, two autolinked
pods. `example/package.json` pins the native ones to the exact versions the package
builds against, and pnpm resolves the package's peers to those pins; move them by
hand, together.

**RN Skia is coupled in one file.** `SsRNSkiaInterop` is named for RN Skia because
its JSI object model carries no compatibility promise and has broken once;
`SsSkiaDraw` uses only Skia's public API. `grep -rl 'RNSkia::' cpp/` lists what an
RN Skia bump can break. The native build defines what RN Skia's own build defines
and does not pass on (`SK_GRAPHITE` among them), in the podspec, in
`android/CMakeLists.txt` and in the host checks.

**Layer 2 stays free of React.** `SsInternalPlayer` and what it uses import nothing
from `react` / `react-native`, so the core runs headless and under
react-native-web; `pnpm run check-layers` holds it to that.

**A pack is a directory, not a file.** Metro ships a dependency graph: `require()`
names one file, and an Android release build flattens and lowercases what it
named, so a `.ssab` could not find its textures beside it. Packs therefore ship as
native assets through the config plugin, and `SsAssets` resolves them from the
app's native asset directory.

**The transport is passed through to the Brain.** `SpriteStudioPlayer` holds the
settings it was given only to replay them onto each freshly set-up animation
(`applySettings` in `src/player/SpriteStudioPlayer.ts`); what it reports is the
Brain's. Setting up an animation resets the loop count, the section and every
override that is not `permanent` in the Brain, and keeps the speed, the frame-rate
override, the frame skip and the direction and style.

**A player that cannot change stops ticking.** `SsTick.hpp` asks the Brain whether
a root player's next update can change what it draws — by the character's clock,
not track 0's, since the track stack can keep moving the pose after track 0 ends —
and a player that cannot change stops asking for frames. A copy of that judgement
kept on this side froze poses that should move; `pnpm run check-motion` runs the
decision against the host Brain.
