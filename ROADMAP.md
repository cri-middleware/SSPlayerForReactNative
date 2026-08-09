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
- ✅ flatc-generated FlatBuffers accessors + `check-framedata` guard
- ✅ RN Skia `SkCanvas`/`SkPaint` bridge (Nitro `CustomType`)
- ✅ Expo measurement harness with an auto-run sweep (retired in Phase 1, once
  both platforms had been measured in release — it lives in git history)
- ✅ Measured on the iOS simulator; **(c) is the only variant that holds 60 fps
  at full load** — 4.9× faster at 512 players, and the only one still at 60 fps
  where (a)/(b) have fallen to 20. (Re-taken in Phase 1: the Phase 0 figures were
  measured with the RN side in debug *and* the animation never started, so they
  overstated the gap at low load and understated where it appears. The
  conclusion held; the numbers did not — `docs/phase0-spike.md`.)

---

## 🚧 Phase 1 — Basic playback

Make one character animate correctly, on both platforms, through the real API.

- ✅ **Trim the L1 spike surface.** Variants (a) and (b) (`getSoA`, `getPlan`,
  `bake`) are gone; `drawInto` is the only draw path and the spec has stopped
  being a benchmark. The bench screen went with them — it was what the trim was
  deferred for, and the last thing keeping it was the missing Android
  measurement, which is now taken. `BuildBatchPlan` and the `Int32Array` batch
  offsets `index.ts` exported went too: nothing in JS walks batches any more.
  `SsBaker` **stays** — `drawInto` bakes through it, and `check-framedata`
  drives it under ASan as the FrameData read-path guard.
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
- ✅ **Asset resolution: a pack is a directory.** Everything a `.ssab` points at
  is a sibling name, so the unit that has to reach the device is the converter's
  output *directory* — and Metro cannot carry one. `require()` is therefore no
  longer an `SsSource`; a source is a location (`asset` / `file` / `remote`) and
  `core/assets.ts`'s `resolveAgainst` is the single seam every reference
  resolves through. The pack directories ship as **native app assets** via the
  Expo config plugin, read back by `cpp/SsAssets` — the `.app`'s resource
  directory on iOS (so the `.ssab` still goes disk → Brain with no JS heap in
  between) and `AAssetManager` on Android, which closes the APK gap this entry
  used to record. Textures use the same seam today; Instance parts and `.ssqb`
  sequences will use it unchanged.
- ✅ **Texture registry** keyed on `cellmap.name_hash`, multiple textures per
  pack, with the hash coming from the Brain via `SsRuntime.hashString`.
- ✅ **Read the `.ssab` in C++** — flatbuffers submodule + `flatc -c` into
  `cpp/format/ssab.h` (committed), the SSPlayerForGodot arrangement. Layer 1
  answers typed questions (`getTextures`, `getAnimationNames`); no FlatBuffer
  crosses into JS and the read happens in place against the Brain's own copy.
- ✅ **Load a pack's own textures on load**, walking both `cellmaps()` and
  `external_textures()`, embedded winning over a reference. **Reference mode now
  reaches its sibling everywhere an `SsSource` can point** — the asset
  directory, a real filesystem directory, or a server — because all three keep
  their directory and `resolveAgainst` hands back a URI of the same kind. This
  was the standing gap: while the `.ssab` was named with a `require()` there was
  no directory for the atlas to be a sibling of, and `example/` had to supply
  its reference pack's texture by hand. The `textures` prop is now for
  *replacing* a texture, not for making a pack draw.
- ✅ **Make `dispose()` actually dispose, and make the leak check runnable.**
  The exit criterion below asks for "no leaked native handles" and there was
  nothing behind it — no way to observe a handle, and, it turned out, a teardown
  that did not happen. Nitro's `HybridObject::dispose()` is a virtual **no-op**:
  it calls the (empty) hook and strips the JS object's NativeState, leaving the
  C++ object to the collector. Neither `HybridSsResource` nor `HybridSsContext`
  overrode it, so every `dispose()` L2/L3/L4 make a point of calling — on
  unmount, on a superseded load, on a re-`load()` — released no Brain handle at
  the moment it was called, and four separate comments claiming "explicit
  teardown, never GC" described something that was not happening. Both hybrids
  now override it; `release()` is guarded on the handle so dispose-then-destruct
  frees exactly once, and the context bumps `generation_` on the way out because
  teardown invalidates outstanding borrows the same way `update()` does.
  `SsRuntime.liveHandles` (two atomic counters) and `ssCheckForLeaks()` are the
  instrument: load and dispose N times, and both counts must return to baseline.
  The comparison can be exact *because* the release is now eager — before the
  override there was no way to tell a leak from a GC that had not run yet.
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
- ✅ Re-measure on **Android**, release on both sides. The block this entry
  carried was stale twice over: Android's (c) landed earlier in Phase 1, and the
  Android table taken right after it was a *debug* one. In release the structure
  is iOS's exactly — (a) and (b) within 3% at every load and strictly linear in
  instance count, (c) sublinear and alone at 60 fps — and (c) at 512 players
  costs 10.01 ms against the iOS simulator's 10.15. The gap over (a) is 4.1× at
  128, 5.2× at 256, **5.8× at 512**. Note the direction the debug numbers erred:
  they made (c) look *better* (7.0× at 512), because a debug RN/Hermes inflates
  the very side (a)/(b) are limited by. Emulator, not a device —
  `docs/phase0-spike.md` has the caveats.
- ☐ Scope: Normal parts, normal blending, reference-layout `.ssab`.

**Exit criteria:** `overall/Basic` animates correctly from `<SpriteStudioView>`
on an iOS device and an Android device, at 60 fps, with no leaked native
handles.

Of these, **only "on a device" is still outstanding.** "No leaked native handles"
is closed on both platforms — an iOS 26.5 simulator and an `sdk_gphone64_arm64`
emulator both report `clean after 8 cycles — resources 1→1, contexts 1→1`. Both
were checked against a **negative control first**, because `1→1` is also exactly
what a *frozen* counter prints: holding three undisposed players takes the counts
to `4/4`, and disposing them returns them to `1/1` **in the same tick**, which is
the evidence that the release is eager rather than a GC that happened to run.
Without that control the check proves nothing — the same trap as `verts` holding
constant across the Phase 0 sweep while nothing was actually playing.

---

## 🚧 Phase 2 — Full feature parity

- ✅ All blend modes, including the multi-pass Sub / Invert reconstruction
  (ground truth: `ssplayer-webgl`'s `applyBlend`; **only RGB varies — alpha is
  premultiplied source-over for every mode**). `cpp/SsBlend.hpp`: ten types are
  one `SkBlendMode`, Sub and Invert are rebuilt from three passes each, and
  `SsSkiaDraw` peels those batches into single quads because the inversion passes
  have to cover each pixel exactly once. The Skia mapping is taken from
  **SSPlayerForFlutter**'s `render/blend.dart` rather than re-derived — Flutter's
  `ui.BlendMode` *is* `SkBlendMode`, so its algebra carries over unchanged.
  The table landed a commit before it did anything. Every mode was handed to
  `drawVertices`'s `SkBlendMode` argument, which blends against *vertex colours*
  and is ignored when there are none — so all twelve rendered as Mix. The
  framebuffer blend is `SkPaint::setBlendMode`. **The old "verified on Android"
  note recorded that bug as a pass**: the one black cell it cited was Invert's
  third pass drawing its black filter source-over, and Sub's cell was plain
  white. Both halves are now checked — the Brain emits all eight of
  `BlendMode.ssab`'s types (host probe over `SsBaker`), and the Player screen
  draws them differing from each other.
  **Still open:** Flutter carries pixel tests (`test/blend_pixel_test.dart`) that
  measure every row against the GL formula instead of trusting the algebra, and
  this port has no equivalent. "The modes differ from each other" is proven;
  "each mode is *right*" is not.
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
- 🚧 **Expo config plugin.** Landed in Phase 1 because the asset-path work
  needed it: it copies the pack directories into the app on every build (Xcode
  run-script phase; Gradle `Sync` task feeding an asset source set), verified
  through `expo prebuild` on both platforms. **Not** `assetExts += ssab` — that
  was the `require()` route, and it is deliberately gone. What is left: a bare
  RN app has no plugin system, so it needs the two build steps documented by
  hand and checked.
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
- ☐ Example app beyond one screen — the benchmark harness is gone and what is
  left is a single player; a real showcase is still owed

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
