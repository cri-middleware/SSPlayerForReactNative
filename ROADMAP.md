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
- ✅ Hand-written FlatBuffers reader + `check-framedata` guard
- ✅ RN Skia `SkCanvas`/`SkPaint` bridge (Nitro `CustomType`)
- ✅ Expo measurement harness with an auto-run sweep
- ✅ Measured on the iOS simulator; **(c) is 5.1× faster and the only variant
  that holds 60 fps at full load**

---

## 🚧 Phase 1 — Basic playback

Make one character animate correctly, on both platforms, through the real API.

- ☐ **Trim the L1 spike surface.** Drop variants (a) and (b) (`getSoA`,
  `getPlan`, `bake`); keep `drawInto`. The spec stops being a benchmark.
  Deliberately deferred until the bench screen is retired, so the Phase 0
  numbers stay reproducible from this tree.
- ✅ **Extend L1 with the transport** the Brain already owns — play / pause /
  stop / seek / loop / speed / direction / section, plus `is_finished` and
  friends — so no layer above mirrors playback state. Plus `hashString`,
  `createResourceFromBytes`, and a `drawInto` that takes a
  `texture_hash → SkPaint` table instead of one paint.
- ⛔ **Android native draw.** Currently `SSPLAYER_ENABLE_SKIA_DIRECT=0`: RN Skia's
  Android build publishes no prefab for `libskia`, so `libSsPlayer.so` cannot
  resolve Skia's symbols. Needs investigation — possibly a prefab request
  upstream, or linking against the `.so` RN Skia already ships in its AAR.
  **This is the single biggest risk in Phase 1**, because without it Android has
  no viable path at all: (a)/(b) were measured and rejected.
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
- ✅ **Asset resolution in L3** — `player/source.ts` absorbs the dev (Metro HTTP
  URL) vs release (bundled path) difference: the path route when `fopen` can
  reach it, fetched bytes otherwise. **Gap:** an Android release build resolves
  a bundled asset to a path inside the APK, which is neither `fopen`-able nor
  `fetch`-able — it needs `AAssetManager`. Not the binding constraint while
  Android has no drawing path at all.
- ✅ **Texture registry** keyed on `cellmap.name_hash`, multiple textures per
  pack, with the hash coming from the Brain via `SsRuntime.hashString`.
- ☐ **Read cellmap names out of the `.ssab`** so textures resolve by name
  without the caller supplying one. Needs an `.ssab` FlatBuffers reader (the
  Flutter Player's `ssab_info.dart` is the shape). Until then a one-cellmap pack
  works unnamed, because `drawInto` matches a single-entry table
  unconditionally.
- ☐ Re-measure on **release builds and real devices**, iOS and Android.
- ☐ Scope: Normal parts, normal blending, reference-layout `.ssab`.

**Exit criteria:** Ringo animates correctly from `<SpriteStudioView>` on an iOS
device and an Android device, at 60 fps, with no leaked native handles.

---

## ☐ Phase 2 — Full feature parity

- ☐ All blend modes, including the multi-pass Sub / Invert reconstruction
  (ground truth: `ssplayer-webgl`'s `applyBlend`; **only RGB varies — alpha is
  premultiplied source-over for every mode**)
- ☐ Mask via the coverage-pass method (Skia has no stencil), matching the
  Flutter Player's `mask.dart` / `mask_context.dart`
- ☐ PartColor, Mesh, Shape, Nines
- ☐ Effect (particles) and Instance parts
- ☐ The 13 `ss-*` integration shaders, GLSL → **SkSL** (the maths is identical;
  impellerc's restrictions do not apply, so the port relaxes rather than tightens)
- ☐ Audio behind an `IAudioManager` seam — **L2 must not know the playback
  mechanism**
- ☐ Events: end / user data / signal
- ☐ Override Layer API (colour / cell / visibility), flip / offset, part following
- ☐ **Reanimated integration** (design doc ch.3 D): UI-thread tick via
  `useFrameCallback`; part transforms out as SharedValues; SharedValues in as
  frame / speed / blend weight
- ☐ Expo config plugin (`assetExts` += `ssab`, build settings), verified on both
  prebuild and a bare RN app
- ☐ npm publishing: decide `react-native-builder-bob` vs plain `tsc` (the
  package currently points `main` at raw TypeScript, which Metro reads but npm
  consumers should not get)
- ☐ React Native Directory listing — **iOS/Android badges up, New Architecture
  flag up, "Expo Go does not work" stated in both the Directory and the README**

**Deliberate non-goals, matching the Web / Flutter / Godot ports:** shader × mask
combined (a masked part drops its shader); `map0`/`map1` extra shader textures;
shader parts on Mesh/Shape/Effect kinds.

---

## ☐ Phase 3 — Surroundings

- ☐ react-native-web via the existing `@spritestudio/ssplayer-webgl`, selected
  through `package.json` `exports`. **Only the L3 API and L4 prop types are
  shared** — the implementation is the existing Web one, not a port. Keeping L2
  React-free and L3 an interface is what leaves this door open.
- ☐ Documentation site
- ☐ Runtime texture replacement, `getPartNames()` and friends
- ☐ Example app beyond the benchmark harness

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

---

## Compatibility

| | |
|---|---|
| SpriteStudio-SDK | `scripts/SDK_VERSION.txt` (currently `v7.0.0-beta.1`) |
| React Native | 0.79+ (New Architecture only) |
| React | 19+ |
| @shopify/react-native-skia | **2.11+**, and the lower bound is real: 2.11 moved the API objects off `jsi::HostObject` onto the `jsi::NativeState` pattern, and `cpp/SsSkiaBridge.cpp` unwraps them the new way |
| react-native-reanimated | 4+ (required — RN Skia 2.10+ demands it) |
| iOS | 14+ |
| Android | API 21+ |

The `.ssab` format and the C-API are both tied to the SDK version, so the pin
and the README's compatibility table have to move together.
