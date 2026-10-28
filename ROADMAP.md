# SpriteStudio Player for React Native — Roadmap

This file lists **unfinished work only**: a finished item is deleted, technical constraints live in [docs/limitations.md](docs/limitations.md), and work that waits on the SDK is also tracked in the [SDK ROADMAP](https://github.com/cri-middleware/SpriteStudio-SDK/blob/HEAD/ROADMAP.md).

[CONTRIBUTING.md](CONTRIBUTING.md) is the working guide and [README.md](README.md) carries the requirements.

## Playback & rendering

- [ ] **`Nines` and `Text`** — The two draw kinds this Player does not draw, and no sibling Player draws either, so there is no reference port to read; Nines shares Shape's box-coordinate idea but needs its own buffers. Text is a Player responsibility, since an outline font is named by family only and never ships in the `.ssab` while a bitmap font ships (`FontBitmap` / `FontGlyphBitmap`) and leaves only layout; the Brain emits a geometry-less `Text` batch per text part so the part keeps its place in priority order.
- [ ] **Masked Effect** — An effect draws unmasked, where the editor and SpriteStudio Player for wgpu clip its particles. The masked Mesh's route reaches it — the mask test as a clip shader at the particles' own positions, taking the effect part's mask targeting — and waits for a concrete request.
- [ ] **The `ss-*` integration shaders, read in composition** — `pnpm run check-shader` compiles all thirteen and checks each against its neutral and characteristic case (and `ss-sepia` against the SpriteStudio reference to 1/255), but always as a flat quad through a single shader, so fidelity with the atlas's real UVs, a PartColor riding along and a blend mode underneath is not established. The gap is widest for the neighbour-samplers (`ss-blur`, `ss-outline`, `ss-move`, `ss-scatter`), which pull in whatever is packed next to a cell, as SpriteStudio and the other ports do too — read it on a screen before calling it a bug.
- [ ] **Reanimated tick** — Part transforms already publish as a SharedValue (`useSsPartTransform`), but the tick is still `requestAnimationFrame` on the JS thread, and SharedValue inputs (frame, speed, blend weight) are not bound. Moving it to `useFrameCallback` needs the whole update → bake → draw chain reachable from a worklet runtime, and update and draw cannot land on different threads, so it is one move rather than an incremental one.

## Distribution & verification

- [ ] **The Kotlin is compiled only by a platform build** — `android/src` (the `ReactPackage` autolinking finds) builds only under Gradle, so a change confined to it is verified by an Android build and nothing else. The C++ around it is `pnpm run check-glue`'s, which needs no platform build.
- [ ] **macOS** — RN Skia and Nitro both support it, so it may simply work. Not in CI, not guaranteed.
- [ ] **Windows** — neither Nitro nor RN Skia supports react-native-windows, which is a separate C++/WinRT stack. Blocked on: react-native-windows support in Nitro and RN Skia.
- [ ] **Bare React Native support** — an app with no Expo config plugin gets neither the asset copy nor the ABI narrowing, so both build steps need documenting by hand and checking. `CMakeLists.txt` already tells "does not ship this slice" apart from "not installed" and names the `-P` escape.
- [ ] **React Native Directory listing** — an entry appended to `react-native-libraries.json` (`react-native-community/directory`) with `ios` and `android` set; `false` values are skipped, so `web` and `expoGo` are stated by their absence, `newArchitecture` takes `'new-arch-only'`, and `alternatives` is not the place to point at SSPlayerForWeb. Blocked on: the package being on npm.
- [ ] **A fuller example app** — the example has four screens, Viewer (every pack through `<SpriteStudioView>`), Part follow (`useSsPartTransform` and `isPartSkinnedMesh`), Blending (the track stack by hand) and UI (`<SpriteStudioButton>`); `<SpriteStudioScene>`, `<SpriteStudioSprite>` and Yoga layout are not demonstrated, and a real showcase is still owed.

## Needs SDK

- [ ] **Stretch a `Nines` part to the layout box** — The runtime evaluates a Nines part's size from its keyframes and hands over finished vertices, and the Override Layer covers colour / cell / visibility only — nothing can resize one from the host, so an authored window frame cannot follow the box Yoga gives it, and scaling the player distorts the border art rather than stretching the middle. Waits for: Per-part size override.
- [ ] **tvOS / visionOS** — blocked on the **Brain**, not on React Native: the SDK's XCFramework has no tvOS or visionOS slices yet. Waits for: tvOS / visionOS XCFramework slices.

## Backlog

- [ ] **Embedded audio bytes** — An `--embedded` pack carries its audio in `embedded_assets` with no sibling on disk, so `filePath` names nothing openable; the event's `embedded` flag keeps that legible rather than presenting as a missing file. The shape it wants is the texture one — a pack-level `getSounds()` read once at load, not an `ArrayBuffer` per event that the next `update()` invalidates.
- [ ] **Free an Embedded pack's atlas bytes after decoding** — The encoded bytes sit inside the same contiguous FlatBuffer the resource holds for its life, so an Embedded pack permanently costs one encoded atlas on top of the decoded texture. Blocked on: an SDK-side way to drop `embedded_assets`, or a converter that emits a stripped companion (neither is in the SDK ROADMAP).
- [ ] **react-native-web** — The stub barrel (`src/index.web.ts`) keeps a mixed app's web bundle building, but nothing draws; a route would share one component tree between an app's web and native halves, which is narrower than SpriteStudio on the web, where SSPlayerForWeb already answers a web-only ask. Of the two routes, `@spritestudio/ssplayer-core` under CanvasKit shares L2–L4 and draws through the one Skia API, where `@spritestudio/ssplayer-webgl` as-is shares only L3–L4 and keeps two renderers to agree; either takes the package from npm rather than vendoring SSPlayerForWeb, and neither starts before a concrete request.

## Deliberate non-goals

Each is this port's own decision, **not** "matching the Web / Flutter / Godot ports" — those disagree with each other and with this one.

- **A recursion guard on Instance parts** — An instance part that mounts its own animation recurses until the stack gives out. Left as it is, and the general rule it comes from is worth stating once: **the safety code in this Player is kept to a minimum.** What a Player is for is simplicity and speed, and every defensive branch costs both. Which pack and which animation an app plays is the app's own business; a cyclic reference is a content bug its author can see in the editor. A depth cap decides on that author's behalf where legal nesting should have stopped, and cycle detection is more machinery than the case is worth.
- **Validating what a caller passes to the transport** — `seek(NaN)` reaches `ss_runtime_set_frame_no` unexamined — NaN fails every comparison, so the Brain's clamp passes it through and the frame it produces has no parts in it. One `Number.isFinite` would stop it, and it is left out for the same reason as the recursion guard above: what an app asks the transport to do is the app's own business, and a Player earns its keep by being simple and fast rather than by checking its caller's arithmetic. Recorded because the symptom — everything vanishes — reads as a renderer fault rather than a bad argument.
- **A per-frame callback (`frame_updated`)** — SSPlayerForGodot emits one every tick, but it is a C++ signal inside an engine there and would be a JS-thread callback here — on the one path this design is built around avoiding, for every player on screen, every tick. The per-frame *value* case has a better answer in `useSsPartTransform`; the *reaching a frame* case is what the authored user-data and signal keys are for. Revisit on a concrete case that neither covers.
- **`ss_runtime_reset`** — not needed by this design. It empties a context, and a load here builds a **new** `SsInternalPlayer` whose context is created fresh and disposed with it. It becomes necessary only if a context is ever reused across packs, which would be traded against the exact `liveHandles` accounting the leak check stands on.
- **A bundled converter** — React Native has no editor to host an importer in, so `.sspj` → `.ssab` stays a host-side step.
- **`map0`/`map1` extra shader textures** — no asset here authors one, and they would need a second and third entry in the per-call texture table.
- **Shader parts on Mesh / Shape / Effect kinds** — the reconstruction wants one affine quad to invert. Masking reaches Mesh and Shape by other routes (a layer cut, a spare texcoord channel), so only Effect is out of both.
