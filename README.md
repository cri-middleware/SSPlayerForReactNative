# SpriteStudio Player for React Native

**Drop artist-authored 2D animation into your React Native app — one component, no animation code, no video files.**

▶️ **[Run the example app](#verifying-it-works)** — the SDK's sample animations playing through the real API on iOS and Android.

A player that renders **[OPTPiX SpriteStudio 7](https://www.webtech.co.jp/spritestudio/)** animations (`.ssab`) in [React Native](https://reactnative.dev/), on the New Architecture. SpriteStudio 7 is a professional 2D **raster** (sprite) animation editor: an artist rigs the PNG art you already have — bones, mesh deformation, masks, particle effects — and exports one file. This package plays that file, drawing it natively through [React Native Skia](https://shopify.github.io/react-native-skia/). No spritesheet to slice, no timeline to hand-write, no video to decode.

> [!WARNING]
> **Not released yet.** The npm package is not published, and nothing here has
> run on a **physical device** — iOS simulator and Android emulator only. See
> [Status](#-status) for what draws today and [ROADMAP.md](ROADMAP.md) for what
> lands when.

## ✨ Why SpriteStudio Player?

- **Bring your sprites — and whole scenes — to life, with zero animation code.** Breathing and blinking, swaying hair and clothes, flashy slash and magic effects. Instead of hand-wiring a Reanimated timeline or hand-slicing a spritesheet, the motion is authored visually in a dedicated editor and the player just plays it — bone rigs, mesh deform, masks and particles included. And it is not limited to a single mascot: compose entire animated **UIs, HUDs and full scenes** in the editor and render them as one.
- **Raster sprite animation, drawn natively — not vector, not video.** It rigs and deforms **raster sprite art**, so hand-painted characters and game sprites animate exactly as authored — a different fit from vector animation tools like Lottie, and far lighter than shipping a `.gif` or `.mp4`. It scales freely at runtime, loops seamlessly, and reacts to your app instead of merely playing back.
- **Built so the animation does not cost you a frame.** Everything expensive — the timeline, the geometry and the Skia draw calls — happens in a Rust core and C++ under [Nitro Modules](https://nitro.margelo.com/) (JSI). JavaScript's job per frame is **one call per player**, which is what lets a busy scene stay at 60 fps ([the measurement](docs/phase0-spike.md)).
- **Composes with the React Native tree.** `<SpriteStudioView>` is an ordinary view — position, size, clip and animate it like any other. Many animations at once? `<SpriteStudioScene>` draws a whole cast through **one canvas and one clock** instead of N of each.
- **The animation can talk back to your app.** Keys the artist placed on the timeline arrive as callbacks — user data, audio cues and signals — so a footstep sound or a hit-frame comes from the animation itself, not from a timer you maintain alongside it. Per-part overrides let you recolour, hide or swap a part at runtime, declaratively.
- **What the artist authored is what you get.** All twelve blend modes, part colours, masks and clipping, mesh deformation, particle effects and nested animations are handled by the same Rust core every official SpriteStudio player uses — the timeline and the geometry are not reimplemented here, so the same `.ssab` is the input everywhere. A few compositions are still catching up with the older players; **Status** below lists them.

## 🚧 Status

**Draws today, on both platforms:** **Normal, Mesh, Shape, Instance and Effect**
parts, **mask and clipping** (on Normal and Shape targets — see below), the full framebuffer **blend table** and
**PartColor** — plus the **override layer** (colour / cell / visibility),
**user-data, audio and signal events**, the **animation lifecycle** callbacks
(start / change / loop / complete), `fit`/`align` placement, the resource and
atlas caches, `<SpriteStudioScene>` and the Expo config plugin.

**Not yet:** **Nines and Text** parts; **masked Mesh and masked Effect**, which
both draw *unmasked* today; a **mask reaching into an Instance child**; the
**Instance part's own PartColor**, which the older players apply as a
whole-subtree tint; the **`ss-*` integration shaders** — one of the thirteen
(`ss-sepia`) has a body and even that one has never been confirmed on a screen,
while the other twelve fall back to the plain textured path — and the
**Reanimated tick**, where part transforms already publish as a shared value but
the frame loop is still `requestAnimationFrame` on the JS thread.
[ROADMAP.md](ROADMAP.md) has the detail on each.

**Audio is reported, not played.** `onAudio` says what to play, how many times
and where the file is; the app feeds its own audio stack. React Native has no
audio API of its own, and a package that picked a library would make every
project authoring no audio carry it. [`example/src/player/audio.ts`](example/src/player/audio.ts)
is the reference wiring, with `expo-audio` as the *example's* dependency.

## 📚 Documentation

A hosted documentation site is planned ([ROADMAP.md](ROADMAP.md) Phase 3). Until
then this README is the user-facing guide, and the files below cover the rest.

- [**SpriteStudio Docs (portal)**](https://cri-middleware.github.io/SpriteStudio-Docs/) — the SDK and every official player in one place — 🚧 live after the first release
- [**AGENTS.md**](AGENTS.md) — the working guide: architecture, invariants, **Traps**, verification. Start here before changing anything.
- [**ROADMAP.md**](ROADMAP.md) — phases, exit criteria, deliberate non-goals
- [**docs/phase0-spike.md**](docs/phase0-spike.md) — the measurement that shaped the architecture, its method and its pitfalls

### Where to read, by goal

You only need to read as far as your goal requires:

| You are… | Your goal | Where to read |
|---|---|---|
| **A general user** | Get an animation playing in your app | [Quick Start](#-1-quick-start) |
| **A customization user** | React to the timeline, override parts, place a whole scene | Above + [Going further](#going-further) |
| **An SDK / Player developer** | Extend or contribute to the player or the core | Above + [Full Build Environment](#-2-full-build-environment-for-sdk--player-developers) + [AGENTS.md](AGENTS.md) |

---

## 🚀 1. Quick Start

### Setup

> 🚧 The package is **not published to npm yet** — this path opens up after the
> first release. Until then, use [Verifying It Works](#verifying-it-works) to
> try it locally.

```bash
npx expo install react-native-spritestudio @shopify/react-native-skia react-native-nitro-modules react-native-reanimated
```

**Expo Go does not work.** The package contains native code, so a prebuild (CNG)
is required — `npx expo prebuild` then `npx expo run:ios` / `run:android`. A
bare React Native app works too; autolinking picks the package up on both
platforms.

### Preparing assets (`.sspj` → `.ssab`)

Animations are authored in SpriteStudio 7 and converted on your machine with the
SDK's `ssconverter-cli` (or the desktop [SSConverterGUI](https://github.com/cri-middleware/SSConverterGUI)).
No converter is bundled — React Native has no editor to host an importer in.

**A pack is a directory, not a file.** A `.ssab` names its textures, the
external packs its Instance parts reach and — through a `.ssqb` — the packs it
sequences, all by paths relative to itself. So `ssconverter-cli`'s **output
directory** is what has to reach the device intact.

Metro cannot carry one: it bundles only what a `require()` names and never walks
a directory, and Android's packager then flattens what it did name into `res/`.
So pack directories are shipped as **native app assets** instead. Point the Expo
config plugin at yours:

```json
{
  "expo": {
    "plugins": [["react-native-spritestudio", { "assets": ["./assets/ss"] }]]
  }
}
```

The plugin re-copies on every build, so re-running the converter needs only a
rebuild — not a fresh `prebuild`. Changing an asset does mean a native build,
though: assets do not Fast Refresh.

### Play it

Address a pack by its path inside that asset root:

```tsx
import { SpriteStudioView } from 'react-native-spritestudio'

export function Character() {
  return (
    <SpriteStudioView
      source="ss/overall/Basic.ssab"
      animation="anime_1"
      fit="contain"
      style={{ flex: 1 }}
    />
  )
}
```

That is the whole integration. The textures come with it — the loader resolves
each `image_path` next to the `.ssab`, and takes the embedded atlas instead when
the pack was converted with `--embedded`. Playback starts on load and loops
forever by default (`playing`, `speed` and `loop` are props; `loop={1}` plays
once).

A `source` can also be a filesystem path or `file://` URI (a download, an
unpacked bundle) or an `http(s)` URL (a dev server, a CDN); siblings resolve the
same way in all three. A `require()`d module is **not** a source — that is the
form with no directory behind it.

Prefer not to hand-write those strings? `npx react-native-spritestudio assets`
writes a typed manifest of the packs your app ships, so a wrong key is a **type
error** rather than a blank canvas.

### Going further

| You want to… | Reach for |
|---|---|
| React to keys the artist placed on the timeline | `onUserData`, `onAudio`, `onSignal` |
| Know when an animation started, changed, looped or finished | `onAnimationStart`, `onAnimationChange`, `onLoop`, `onComplete` |
| Recolour, hide or swap a part at runtime | the `parts` prop — declarative, so removing an entry reverts it |
| Draw a whole cast on one canvas and one clock | `<SpriteStudioScene>` + `<SpriteStudioSprite>` |
| Attach a React view to a part (a health bar over a head) | `useSsPartTransform` — publishes through a Reanimated shared value |
| Pay the load cost before the mount | `ssPreload` / `ssUnload` |
| Drive the transport imperatively | the ref's `player` — Layer 3's `SpriteStudioPlayer` |

The `.ssab` decides which of these are available; every part type and every key
listed under [Status](#-status) is handled without extra wiring.

### Verifying It Works

Run the example app to see the player working end to end. **No Rust toolchain
required** — `download-sdk` fetches the prebuilt native core from the pinned SDK
release. Every entry point is a `.js` shim that dispatches to `.sh` or `.ps1`
for the host OS, so these work on macOS, Linux and Windows alike.

```bash
git clone https://github.com/cri-middleware/SSPlayerForReactNative.git
cd SSPlayerForReactNative
git submodule update --init --recursive

npm install
npm run download-sdk        # the native core, from the pinned SDK release
npm run deploy-examples     # .sspj -> .ssab for the example app

cd example
npx expo prebuild --platform ios
npx expo run:ios            # or: npx expo prebuild --platform android && npx expo run:android
```

The example is one screen with four dropdowns, and each answers a different
question: **Subject** picks a feature card (`BlendMode`, `PartsColor`, `Mask`,
`Mesh`, `Effect`, `Instance`, `Sound`, `Signal`, `UserData`) or a real character
(`Ringo`) or the SDK's 40-pack particle showcase (`ParticleEffect`);
**Animation** is read out of the loaded `.ssab`; and **Textures** switches
between a pack whose atlas is embedded in the `.ssab` and one that keeps it as a
sibling file, so both texture routes are visible in one place. Below the stage,
the readouts show the timeline keys firing and the live native handle counts.

## ⚙️ 2. Full Build Environment (For SDK / Player Developers)

To work on the player or on the Rust core (the "Brain") itself.

### Repository layout

```
SSPlayerForReactNative/
├── SpriteStudio-SDK/                   <- [submodule] the Rust core ("the Brain")
├── scripts/                            <- .js shim -> .sh / .ps1 per host OS
│   ├── SDK_VERSION.txt                 <- pinned SDK release tag
│   ├── download-sdk.*                  <- install the pinned release (NO Rust needed)
│   ├── build-runtime.*                 <- build the Brain from the submodule instead
│   ├── deploy-examples.*               <- convert the SDK's test projects to .ssab
│   ├── generate-nitro-code.*           <- run nitrogen over the Layer 1 spec
│   └── generate-fbs-code.*             <- run flatc over the .fbs schemas
├── packages/react-native-spritestudio/ <- the npm package
│   ├── src/specs/SsRuntime.nitro.ts    <- Layer 1 spec (nitrogen input)
│   ├── src/core/ src/player/ src/view/ <- Layers 2, 3 and 4
│   ├── cpp/                            <- Nitro implementation, the baker, the Skia draw path
│   ├── plugin/                         <- Expo config plugin: ships pack directories
│   ├── bin/                            <- npx react-native-spritestudio assets
│   ├── nitrogen/                       <- [generated, committed, do not hand-edit]
│   └── native/                         <- [gitignored] libssruntime + headers
├── example/                            <- Expo app: the player screen
├── tools/                              <- host-side checks (FrameData, baker, mask)
└── docs/phase0-spike.md                <- the measurement
```

### Building the Brain

`download-sdk` needs **no Rust toolchain**. Use `build-runtime` only when you
are changing the Brain itself — it builds from the submodule into the same
layout, stamped `<tag>+submodule-<sha>` so the two never get confused. On
Windows it covers the Android slice only (the iOS xcframework needs Xcode);
`download-sdk` is the complete answer there.

Scripts take `key=value` arguments and honour `$SSSDK` to point at an SDK
checkout other than the submodule, matching the sibling Players:

```bash
npm run build-runtime -- platform=ios build=release
npm run download-sdk -- --force
npm run deploy-examples -- --embedded
```

> [!IMPORTANT]
> **Build the Brain in release before measuring anything.** A `build=debug`
> `libssruntime` swamps every other cost and flattens the differences a
> benchmark exists to find — it already produced one wrong conclusion during
> Phase 0.

### Checks

| Check | Command |
|---|---|
| Typecheck (package + example) | `npm run typecheck` |
| FlatBuffers accessors current + read path sound (needs `flatc`) | `npm run check-framedata` |
| Mask drawing, through the real shaders (macOS) | `npm run check-mask` |
| Nitro codegen is current | `npm run generate-nitro-code` → `git diff --exit-code packages/*/nitrogen` |

[AGENTS.md](AGENTS.md) carries the rest: the four-layer architecture, the
**Traps** section — the hard-won ones, like `update()`'s delta being
milliseconds and `ss_runtime_pause` being a toggle — and the per-feature
verification table that says which example subject proves what.
[docs/phase0-spike.md](docs/phase0-spike.md) is the measurement that put the
drawing in Layer 1 in the first place.

## 📋 Requirements

| | |
|---|---|
| React Native | `^0.86.2` — **New Architecture only** |
| React | `^19.2.8` |
| Peer deps | `@shopify/react-native-skia` `^2.11.0`, `react-native-nitro-modules` `^0.36.5`, `react-native-reanimated` `^4.5.3` |
| iOS | 14+ |
| Android | API 24+ |
| SpriteStudio-SDK | pinned in [`scripts/SDK_VERSION.txt`](scripts/SDK_VERSION.txt) |

The Skia lower bound is real: 2.11 moved its API objects onto the
`jsi::NativeState` pattern, and the package unwraps them the new way. Windows,
tvOS and visionOS are out of scope — see [ROADMAP.md](ROADMAP.md#platform-and-verification) for
why.

## 🔗 Related Repositories

The same `.ssab` runs on every one of these:

- [SpriteStudio-SDK](https://github.com/cri-middleware/SpriteStudio-SDK) — the Rust core (`libssruntime` / `libssconverter`) and the `.fbs` schemas
- [SSConverterGUI](https://github.com/cri-middleware/SSConverterGUI) — desktop GUI for converting `.sspj` → `.ssab`
- [SSPlayerForWeb](https://github.com/cri-middleware/SSPlayerForWeb)

## 📄 License

This project is licensed under the BSD-3-Clause License — see
[LICENSE.md](LICENSE.md).

It also compiles FlatBuffers and `libssruntime` into the app you publish, which
carries obligations onto *your* binary — see
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for what to include in your
acknowledgements.
