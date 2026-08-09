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
- ✅ Measured on the iOS simulator; **(c) is the only variant that holds 60 fps
  at full load** — 4.9× faster at 512 players, and the only one still at 60 fps
  where (a)/(b) have fallen to 20. (Re-taken in Phase 1: the Phase 0 figures were
  measured with the RN side in debug *and* the animation never started, so they
  overstated the gap at low load and understated where it appears. The
  conclusion held; the numbers did not — `docs/phase0-spike.md`.)

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
- ✅ **Android native draw.** `SSPLAYER_ENABLE_SKIA_DIRECT=1`, verified on an
  emulator: `overall/Basic` renders and animates, with its embedded textures
  loaded automatically. This was billed as the single biggest risk in Phase 1
  and as possibly needing an upstream prefab request; neither held.
  - The premise was wrong three times over. RN Skia **does** publish a prefab
    (`rnskia`, enabled for RN > 68), it **does** export Skia — 37015 `Sk*`
    symbols — and, underneath all of it, **the Android side had never been
    built at all**: no `ReactPackage` implementation meant autolinking skipped
    the package, so it was not even a Gradle subproject.
  - Eight of the ten things that had to be fixed were wiring that had simply
    never been exercised: no `ReactPackage`, no Kotlin plugin (so the generated
    Kotlin was never compiled), no `JNI_OnLoad` (nitrogen generates the
    registration but not its caller), a wrong dependency project name, a
    hardcoded `abiFilters` that ignored the app's choice, `minSdk 21` against
    React Native's floor of 24, and two stale autolinking caches.
  - Two are genuinely upstream, and both are worth reporting:
    **(a)** RN Skia's prefab flattens `cpp/**` into one directory, so
    `cpp/jsi/JSIConverter.h` lands as `JSIConverter.h` while `JsiSkConverters.h`
    still includes it as `"jsi/JSIConverter.h"` — its own headers do not compile.
    We take the library from the prefab and the headers from its source tree.
    **(b)** Skia is built with hidden visibility and exports only what `SK_API`
    marks. `SkCanvas::drawVertices` is exported; `SkVertices::MakeCopy` is not,
    and sits in the same `.so` as a local symbol — while RN Skia ships
    `JsiSkVertices.h`, whose inline code calls it. Closed by linking `libskia.a`
    *after* the prefab, so only the un-exported leaves come from the archive and
    there is still one Skia in the process.
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
- ✅ **Read the `.ssab` in C++** — flatbuffers submodule + `flatc -c` into
  `cpp/format/ssab.h` (committed), the SSPlayerForGodot arrangement. Layer 1
  answers typed questions (`getTextures`, `getAnimationNames`); no FlatBuffer
  crosses into JS and the read happens in place against the Brain's own copy.
- ✅ **Load a pack's own textures on load**, walking both `cellmaps()` and
  `external_textures()`, embedded winning over a reference. **Reference mode
  cannot always reach its sibling on React Native**, and the reason is
  structural: Flutter and Godot ship asset *directories*, Metro ships a
  dependency *graph* and bundles only what a `require()` names.
  - Embedded — works everywhere.
  - A real filesystem directory (runtime download, or assets copied in
    out-of-band) — works.
  - A `require()`d asset in a release build — cannot; the image is not in the
    bundle.
  - Inside an npm workspace — cannot, for a second reason: `watchFolders` pushes
    Metro's server root up to the workspace so the `.ssab`'s URL is
    `/assets/<pkg>/assets/...`, while Metro resolves an asset request against the
    *project* root. `example/` hits this and supplies its reference pack's
    texture explicitly.
- 🕒 **Free an embedded atlas after decoding.** Blocked on the Brain: the encoded
  bytes sit inside the same contiguous FlatBuffer `ss_resource_create_copy` holds
  for the resource's life, so embedded permanently costs one encoded atlas on top
  of the decoded texture. Needs an SDK-side way to drop `embedded_assets`, or a
  converter that emits a stripped companion.
- ✅ Re-measure on **release builds** — both sides, iOS simulator, with the
  animation actually playing. Turned up two measurement bugs and moved every
  absolute number; see `docs/phase0-spike.md`.
- ☐ Re-measure on a **real device**. Not done: no device was connected. The
  simulator's host is an Apple Silicon Mac, so the CPU side — the side (a)/(b)
  are limited by — is flattered relative to a phone.
- ⛔ Re-measure on **Android**. Blocked with the rest of Android: without
  `SSPLAYER_ENABLE_SKIA_DIRECT` there is no (c) to measure.
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
- ✅ **Package name decided: `react-native-spritestudio`** (was
  `@spritestudio/react-native-ssplayer`; the directory moved to
  `packages/react-native-spritestudio/` with it). The old name's problem was that
  the public API is named after SpriteStudio, not ssplayer, so the import line
  disagreed with everything in it — and `ssplayer` is a family stem legible to
  maintainers who see every port, while a package name is read almost entirely by
  people who see only this one. Unscoped won on the community shape
  (`react-native-reanimated`, `react-native-svg`, ...), on npm search and the
  Directory listing below, and on cost: `@spritestudio` has nothing published
  under it today, so a scoped name would have meant securing the org first. The
  runners-up were `@spritestudio/react-native` (the `@sentry/react-native` shape)
  and `@spritestudio/ssplayer-react-native` (matches the Web packages exactly, at
  the cost of keeping the stem that started this).
  The *native* identifiers (`SsPlayer.podspec`, the Gradle project, the JNI
  library, the `ssplayer` C++ namespace, `com.margelo.nitro.ssplayer`) were
  deliberately **not** renamed: autolinking keys on them, so that is a separate
  and riskier decision.
- ☐ npm publishing: decide `react-native-builder-bob` vs plain `tsc` (the
  package currently points `main` at raw TypeScript, which Metro reads but npm
  consumers should not get). Also unresolved: the published tarball's `files`
  lists only `native/VERSION`, so it ships without the Brain — and, now, without
  the flatbuffers headers `cpp/format/ssab.h` includes.
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
| Android | API 24+ (React Native 0.79+ ships prefabs built for 24) |

The `.ssab` format and the C-API are both tied to the SDK version, so the pin
and the README's compatibility table have to move together.
