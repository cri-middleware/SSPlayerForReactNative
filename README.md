[**English**](./README.md) | [**日本語**](./README.ja.md)

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

- **Bring your sprites — and whole scenes — to life, with zero animation code.** Breathing and blinking, swaying hair and clothes, flashy slash and magic effects. Instead of hand-wiring an `Animated` or Reanimated timeline per part, or slicing a spritesheet and flipping through it with `<Image>`, the motion is authored visually in a dedicated editor and the player just plays it — bone rigs, mesh deform, masks and particles included. And it is not limited to a single mascot: compose entire animated **UIs, HUDs and full scenes** in the editor and render them as one.
- **Raster sprite animation, drawn natively — not vector, not video.** It rigs and deforms **raster sprite art**, so hand-painted characters and game sprites animate exactly as authored — a different fit from vector tools like Lottie, and far lighter than shipping a `.gif` or an `.mp4`. It scales freely at runtime, loops seamlessly, and reacts to your app instead of merely playing back. The timeline and the geometry come from the same Rust core every official SpriteStudio player uses rather than a reimplementation, so what your artist exports is what every platform is given — though what *this* port draws from it is still catching up in places, which **Status** below lists.
- **Smooth motion, not locked to a frame rate.** The playhead is a float and the frame is built at the moment it is drawn, so motion follows your display's refresh rate and the speed you set — not the authored fps flipbook, and not a video baked at 30.
- **Built so the animation does not cost you a frame.** Everything expensive — the timeline, the geometry and the Skia draw calls — happens in a Rust core and C++ under [Nitro Modules](https://nitro.margelo.com/) (JSI). JavaScript's job per frame is **one call per player**, which is what lets a busy scene stay at 60 fps.
- **Composes with the React Native tree.** `<SpriteStudioView>` is an ordinary view — position, size, clip and animate it like any other. Many animations at once? `<SpriteStudioScene>` draws a whole cast through **one canvas and one clock** instead of N of each.
- **The animation can talk back to your app.** Keys the artist placed on the timeline arrive as callbacks — user data, audio cues and signals — so a footstep sound or a hit-frame comes from the animation itself, not from a timer you maintain alongside it. Per-part overrides let you recolour, hide or swap a part at runtime, declaratively.

## 🚧 Status

**Draws today, on both platforms:** **Normal, Mesh, Shape, Instance and Effect**
parts, **mask and clipping** (on Normal and Shape targets — see below, and
including a mask that crosses into an Instance child), the full framebuffer
**blend table**, **PartColor** and the thirteen **`ss-*` integration shaders** —
plus the **override layer** (colour / cell / visibility),
**user-data, audio and signal events**, the **animation lifecycle** callbacks
(start / change / loop / complete), `fit`/`align` placement, the resource and
atlas caches, `<SpriteStudioScene>`, the Expo config plugin and the typed asset
manifest.

**Not yet:** **Nines and Text** parts; **masked Mesh and masked Effect**, which
both draw *unmasked* today; **a child's own mask writers while a caller's mask
reaches into it** — the caller's coverage is handed down and the child's own
writers then write nothing for that frame; the
**Instance part's own PartColor**, which both reference ports apply as a
whole-subtree tint; and the
**Reanimated tick**, where part transforms already publish as a shared value but
the frame loop is still `requestAnimationFrame` on the JS thread.
[ROADMAP.md](ROADMAP.md) has the detail on each.

**Audio is reported, not played.** `onAudio` says what to play, how many times
and where the file is; the app feeds its own audio stack. React Native has no
audio API of its own, and a package that picked a library would make every
project authoring no audio carry it. [`example/src/player/audio.ts`](example/src/player/audio.ts)
is the reference wiring, with `expo-audio` as the *example's* dependency.

## 📚 Documentation

- [**Documentation site**](https://cri-middleware.github.io/SSPlayerForReactNative/) — setup, usage, the generated API reference. 🚧 Live after the first release.
- [**SpriteStudio Docs (portal)**](https://cri-middleware.github.io/SpriteStudio-Docs/) — the SDK and every official player in one place.

This README stays the short version; the files below cover the rest.

- [**AGENTS.md**](AGENTS.md) — the working guide: architecture, invariants, **hard constraints**, verification. Start here before changing anything.
- [**ROADMAP.md**](ROADMAP.md) — phases, exit criteria, deliberate non-goals

### Where to read, by goal

Two audiences, and the line between them is sharp: people **using** the player
in an app, and people **changing** it. There is no configurable middle — the
drawing lives in C++ behind a single call per frame, so altering *what* gets
drawn means working on the package itself rather than passing it options.

You only need to read as far as your goal requires:

| You want to… | Where to read |
|---|---|
| Get an animation playing in your app | [Quick Start](#-1-quick-start) |
| React to the timeline, override parts, place a whole scene | Above + [Going further](#going-further) |
| Change the player, or the Rust core under it | Above + [Full Build Environment](#-2-full-build-environment-for-sdk--player-developers) + [AGENTS.md](AGENTS.md) |

The first two rows are the same audience at different depths — both are ordinary
consumers of the published package, and neither needs anything from the third.

---

## 🚀 1. Quick Start

### Setup

> 🚧 The package is **not published to npm yet** — this path opens up after the
> first release. Until then, use [Verifying It Works](#verifying-it-works) to
> try it locally.

```bash
npx expo install react-native-spritestudio @shopify/react-native-skia react-native-nitro-modules react-native-reanimated react-native-worklets
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

The example is one screen. **Subject** picks a feature card (`Basic`,
`BlendMode`, `PartsColor`, `Mask`, `Mesh`, `Shape`, `Shader`, `Effect`,
`Instance`, `UserData`, `Sound`, `Signal`), a real character (`Ringo`, and
`RingoInstances` for the same cast mounted as instance parts), or the SDK's
40-pack particle showcase (`ParticleEffect`); **Pack file** appears when the
subject has more than one `.ssab`; **Animation** is read out of the loaded pack;
and the **Textures** toggle switches between a pack whose atlas is embedded in
the `.ssab` and one that keeps it as a sibling file, so both texture routes are
visible in one place. Below the stage,
the readouts show the timeline keys firing and the live native handle counts.

Every subject comes from what `deploy-examples` actually produced — the list is
read out of the generated manifest, so a pack that was not converted takes its
subject off the screen rather than leaving a card that loads nothing.

### An optional subject: `MaskInstance`

One subject is not in the list above because its source is **not in this
repository**: `MaskInstance`, three scenes that mask the stage and mount their
characters as instance parts. It is the only asset anywhere that exercises a
mask crossing into an instance child — the SDK's own samples keep masks and
instance parts in separate files — so it is what `npm run check-mask`'s fourth
check runs against, and that check reports itself as skipped without it.

It is third-party sample art and the licence to redistribute it is not ours to
give. To add it, download **OPTPiX SpriteStudio Basic Samples** from
[the SpriteStudio site](https://www.webtech.co.jp/spritestudio/) and copy its
`Mask` project in:

```
example/SpriteStudio_Source/Mask/        <- Mask.sspj and everything beside it
```

Then `npm run deploy-examples` picks it up — it refreshes the manifest itself, so
the subject appears on the next reload. That manifest is committed in its
**without-optional-packs** state, so adding one leaves `example/src/ss-assets.ts`
modified on purpose: do not commit it, and `assets --check` will call it stale
for the same reason.

## ⚙ 2. Full Build Environment (For SDK / Player Developers)

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
├── tools/                              <- host-side checks (FrameData, baker, mask, hidden, shader)
└── docs/                               <- the VitePress site
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
> the spike.

### Checks

| Check | Command |
|---|---|
| Typecheck (package + example) | `npm run typecheck` |
| FlatBuffers accessors current + read path sound (needs `flatc`) | `npm run check-framedata` |
| Mask drawing, and a mask crossing into an instance child (macOS) | `npm run check-mask` |
| Instance slots keep stepping while out of the draw plan | `npm run check-hidden` |
| The `ss-*` shaders compile, and their arithmetic (macOS) | `npm run check-shader` |
| The web stub barrel imports clean, matches `index.ts` and throws (any OS, no Brain) | `npm run check-web-barrel` |
| Nitro codegen is current | `npm run generate-nitro-code` → `git diff --exit-code packages/*/nitrogen` |

[AGENTS.md](AGENTS.md) carries the rest: the four-layer architecture, the
**hard constraints** — the ones learned the hard way, like `update()`'s delta
being milliseconds and `ss_runtime_pause` being a toggle — and the per-feature
verification table that says which example subject proves what.

## 📋 Requirements

| | |
|---|---|
| React Native | `^0.86.2` — **New Architecture only** |
| React | `^19.2.8` |
| Peer deps | `@shopify/react-native-skia` `^2.11.0`, `react-native-nitro-modules` `^0.36.5`, `react-native-reanimated` `^4.5.3` — and `react-native-worklets` `^0.11.3`, which Reanimated 4 requires as a peer of its own rather than depending on |
| iOS | 15.1+ |
| Android | API 24+ |
| SpriteStudio-SDK | pinned in [`scripts/SDK_VERSION.txt`](scripts/SDK_VERSION.txt) |

The Skia lower bound is real: 2.11 moved its API objects onto the
`jsi::NativeState` pattern, and the package unwraps them the new way. Windows,
tvOS and visionOS are out of scope — see [ROADMAP.md](ROADMAP.md#platform-and-verification) for
why.

### Web

**This package does not play animations on web**, and for SpriteStudio on the
web the answer is [SSPlayerForWeb](https://github.com/cri-middleware/SSPlayerForWeb)
— `@spritestudio/ssplayer-webgl` renders the same `.ssab` with no React Native
in the way.

What the package does carry is a web *stub*, for the app that ships web **as
well as** native and plays SpriteStudio only on the native half. Importing
`react-native-spritestudio` under react-native-web is safe, so that app's web
bundle builds; rendering a player there throws an error naming this package.
The placement arithmetic, the path helpers and the vocabulary enums are the
real implementations on both platforms — only the parts that need Skia or the
native runtime are stubbed.

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
