# SSPlayerForReactNative — Player Roadmap

The **React Native Player** roadmap. It tracks React-Native-specific work for capabilities the Rust runtime exposes (`SpriteStudio-SDK/ROADMAP.md`). This file is **forward-looking only** — already-shipped features (the draw kinds Normal / Mesh / Shape / Instance / Effect, the framebuffer blend table, PartColor, mask and clipping, the thirteen `ss-*` integration shaders, the override layer, user-data / audio / signal events, the animation lifecycle, `fit`/`align` placement, the resource and atlas caches, `<SpriteStudioScene>`, the Expo config plugin and the typed asset manifest) are not repeated here.

[AGENTS.md](AGENTS.md) is the working guide, [README.md](README.md) carries the requirements, and [`docs/phase0-spike.md`](docs/phase0-spike.md) is the measurement that put the drawing in Layer 1 — one call per player per frame, because `Skia.MakeVertices` caps anything that routes vertices through JS.

Legend: ☐ **Ready** (Player-only, can start now) · ⛔ **Blocked on the SDK** · 🕒 **Deferred**.

## Draw kinds and rendering

- ☐ **`Nines` and `Text`** — the two remaining kinds. Nines shares Shape's box-coord idea but has its own CSR buffers.
- ☐ **Masked Mesh and masked Effect.** Both draw unmasked today, for the same reason stated two ways: the replay places its coverage sample by inverting one affine quad's UV, and a mesh needs that texcoord channel for its atlas while an effect is a cloud of quads rather than one. A Shape can be masked precisely because it samples nothing.
- ☐ **Mask composition into an Instance child** (§2-6) — a mask reaching an instance part applies to the whole sub-animation, and the calling part's settings compose with the callee's rather than replacing them. A context to thread down the tree, not a finished test.
- ☐ **The Instance part's own PartColor** — both reference ports apply it as a whole-subtree *group tint*; this port does not do it at all.
- ☐ **The `ss-*` integration shaders, read in composition.** All thirteen have bodies and `npm run check-shader` pins each one, but it draws a flat quad through a single shader — what it cannot see is the effect with the atlas's real UVs, a PartColor riding along and a blend mode underneath. The neighbour-samplers are where that gap is widest: `ss-blur`, `ss-outline`, `ss-move` and `ss-scatter` step by texels, and a part whose cell is packed tight against its neighbours in the atlas will pull in whatever is next to it. SS6 and the other ports have the same property, so matching them may mean matching that too — worth reading on a screen before deciding it is a bug.
- ☐ **Cycle detection for Instance parts** — a depth cap of 8 stands in for it.
- ☐ **Pixel tests.** "The modes differ from each other" is proven for the blends; "each mode is *right*" is not, and the same gap covers PartColor, Mesh, Effect and the integration shaders. SSPlayerForFlutter measures every blend row against the GL formula; there is no equivalent here.
- 🚧 **Reanimated tick.** Part transforms already publish as a SharedValue (`useSsPartTransform`), which is the consumer-facing half and the one that does not change when the tick moves. **What is left is the tick itself**: it is still `requestAnimationFrame` on the JS thread. `useFrameCallback` needs the whole update→bake→draw chain reachable from a worklet runtime, and the borrow rule says update and draw cannot land on different threads. SharedValues *in* — frame / speed / blend weight — are untouched; the blend-source and crossfade C-API they would drive (`ss_runtime_add_blend_source`, `ss_runtime_crossfade`) is already there and unbound.

## Platform and verification

- ☐ **A physical device.** Everything here has been seen on the iOS simulator and the Android emulator only — no device, on either platform. This is the one thing keeping the basic-playback exit criteria open.
- ☐ **Re-measure on a real device.** The simulator's host is an Apple Silicon Mac, so the CPU side — the side the JS-marshalling variants are limited by — is flattered relative to a phone.
- ☐ **The integration shaders on a screen.** `npm run check-shader` covers the half that can be automated — every body compiles, the uniforms line up, each port matches its neutral and characteristic case, and `ss-sepia` matches SS6 to 1/255. Reading the `Shader` card is what closes the rest; see the draw-kinds item above for what to look at. (`overall/Shader.ssab`'s "28 parts, all 13 ids" is not coverage: that comes out of the **bake plan**, which says what the pack asks for, not what drew.)
- 🕒 **macOS** — RN Skia and Nitro both support it, so it may simply work. Not in CI, not guaranteed.
- ⛔ **tvOS / visionOS** — blocked on the **Brain**, not on React Native: the Rust targets are Tier 3 and the SDK's XCFramework has no slices for them (an SDK ROADMAP item).
- ⛔ **Windows** — neither Nitro nor RN Skia supports react-native-windows, which is a separate C++/WinRT stack. No route.

## Distribution

- ☐ **npm publishing** — decide `react-native-builder-bob` vs plain `tsc`. The package currently points `main` at raw TypeScript, which Metro reads but npm consumers should not get. Also unresolved: the published tarball's `files` lists only `native/VERSION`, so it ships without the Brain, and without the flatbuffers headers `cpp/format/ssab.h` includes.
- ☐ **Bare React Native support** — an app with no Expo config plugin gets neither the asset copy nor the ABI narrowing, so both build steps need documenting by hand and checking. `CMakeLists.txt` already tells "does not ship this slice" apart from "not installed" and names the `-P` escape.
- ☐ **React Native Directory listing** — iOS/Android badges up, New Architecture flag up, "Expo Go does not work" stated in both the Directory and the README.
- ☐ **Documentation site.**
- ☐ **Example app beyond one screen** — the benchmark harness is gone and what is left is a single player; a real showcase is still owed.

## Surroundings

- ☐ **react-native-web** via the existing `@spritestudio/ssplayer-webgl`, selected through `package.json` `exports`. **Only the L3 API and L4 prop types are shared** — the implementation is the existing Web one, not a port. Keeping L2 React-free and L3 an interface is what leaves this door open.
- ☐ **Runtime texture replacement**, `getPartNames()` and friends.

## Backlog (small / optional)

- ☐ **Embedded audio bytes.** An `--embedded` pack carries its audio in `embedded_assets` with no sibling on disk, so `filePath` names nothing openable; the event's `embedded` flag keeps that legible rather than presenting as a missing file. The shape it wants is the texture one — a pack-level `getSounds()` read once at load, not an `ArrayBuffer` per event that the next `update()` invalidates.
- ⛔ **Free an embedded atlas after decoding.** The encoded bytes sit inside the same contiguous FlatBuffer the resource holds for its life, so embedded permanently costs one encoded atlas on top of the decoded texture. Needs an SDK-side way to drop `embedded_assets`, or a converter that emits a stripped companion.

## Deliberate non-goals

Each is this port's own decision, **not** "matching the Web / Flutter / Godot ports" — those disagree with each other and with this one.

- 🕒 **A per-frame callback (`frame_updated`).** The flagship emits one every tick, but it is a C++ signal inside an engine there and would be a JS-thread callback here — on the one path this design is built around avoiding, for every player on screen, every tick. The per-frame *value* case has a better answer in `useSsPartTransform`; the *reaching a frame* case is what the authored user-data and signal keys are for. Revisit on a concrete case that neither covers.
- 🕒 **`ss_runtime_set_frame_rate`** — on request only; it overrides the authored fps of the animation being played. Two things to know first: it belongs in `applySettings()`, because `setup_animation` resets `fps` the way it resets the loop count; and `ss_runtime_get_fps` reports the **effective** fps, not the authored one.
- ⛔ **`ss_runtime_reset`** — not needed by this design. It empties a context, and a load here builds a **new** `SsInternalPlayer` whose context is created fresh and disposed with it. It becomes necessary only if a context is ever reused across packs, which would be traded against the exact `liveHandles` accounting the leak check stands on.
- 🕒 **A bundled converter.** React Native has no editor to host an importer in, so `.sspj` → `.ssab` stays a host-side `ssconverter-cli` step.
- 🕒 **`map0`/`map1` extra shader textures** — no asset here authors one, and they would need a second and third entry in the per-call texture table.
- 🕒 **Shader parts on Mesh / Shape / Effect kinds** — the reconstruction wants one affine quad, the same reason those kinds are excluded from masking. (Shader × *mask*, which this list used to doubt, does compose and is shipped.)
