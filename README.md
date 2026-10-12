[**English**](./README.md) | [**日本語**](./README.ja.md)

# SpriteStudio Player for React Native

**Drop artist-authored 2D animation into your React Native app — one component, no animation code, no video files.**

A player that renders **[SpriteStudio](https://www.webtech.co.jp/spritestudio/)** animations (`.ssab`) in [React Native](https://reactnative.dev/), on the New Architecture. SpriteStudio is a professional 2D **raster** (sprite) animation editor: an artist rigs the PNG art you already have — bones, mesh deformation, masks, particle effects — and exports one file. This package plays that file, drawing it natively through [React Native Skia](https://shopify.github.io/react-native-skia/). No spritesheet to slice, no timeline to hand-write, no video to decode.

> [!WARNING]
> Nothing here has run on a **physical device** — iOS simulator and Android
> emulator only. See [docs/limitations.md](docs/limitations.md) for what draws
> today and [ROADMAP.md](ROADMAP.md) for what lands when.

## ✨ Why use SpriteStudio with React Native?

- **Bring your sprites — and whole screens — to life.** Breathing and blinking, swaying hair and clothes, flashy slash and magic effects, even an animated HUD: the motion is built visually in a dedicated editor (SpriteStudio) and `<SpriteStudioView>` just plays it — bone rigs, mesh deformation, masks and particles included. No `Animated` or Reanimated timeline to wire up per part.
- **Hand-drawn art, drawn natively.** It animates raster sprite art, so painted characters move exactly as drawn — a different fit from vector tools like Lottie. Unlike a `.gif` or an `.mp4`, it scales freely, loops seamlessly and reacts to your app.
- **An ordinary view, drawn by native code.** Lay it out, clip it and animate it like any other view. The timeline, geometry and drawing run in native code under [Nitro Modules](https://nitro.margelo.com/), so no vertex passes through JavaScript and a frame costs no React render — and `<SpriteStudioScene>` draws a whole cast through one canvas and one clock.
- **Smooth motion, not locked to a frame rate.** Each frame is built at the moment it is drawn, so motion follows your display's refresh rate and playback speed instead of the authored fps.
- **The animation can talk back to your app.** Keys the artist placed on the timeline — user data, signals, audio cues — arrive as callbacks, so a footstep sound or a hit reaction is timed by the animation itself, not by a timer you keep in sync. Per-part overrides recolour, hide or swap a part at runtime.

## 📚 Documentation

- [**Documentation site**](https://cri-middleware.github.io/SSPlayerForReactNative/) — setup, usage, the generated API reference
- [**For AI assistants**](https://cri-middleware.github.io/SSPlayerForReactNative/llms.txt) — these docs as Markdown: `llms.txt` indexes the English pages and `llms-full.txt` holds all of them in one file; each Japanese page is available as `.md` under `ja/`
- [**SpriteStudio Docs (portal)**](https://cri-middleware.github.io/SpriteStudio-Docs/) — the SDK and every official player in one place

---

## 🚀 Quick Start

**Using it in your app?** Read on — install, prepare assets, play. Everything after
that (events, part overrides, custom textures) is the same path further in, on the
[documentation site](https://cri-middleware.github.io/SSPlayerForReactNative/).
**Working on the player, or the Rust core under it?**
[Working from a checkout](docs/development/from-source.md), then
[CONTRIBUTING.md](CONTRIBUTING.md) before changing anything; [ROADMAP.md](ROADMAP.md) is what
lands when.

### Install

```bash
npx expo install react-native-spritestudio @shopify/react-native-skia react-native-nitro-modules react-native-reanimated react-native-worklets
```

**Expo Go cannot run this package**, so your app needs a **development build** —
its own binary, with this package compiled into it. In a managed app that is
`npx expo prebuild` then `npx expo run:ios` / `run:android`; in a bare app you
already have the native projects, so rebuild them instead. Autolinking picks the
package up either way. [Installation](docs/setup/install.md) has the detail.

### See it running first

Nothing of yours is needed to watch this work: the example app in this repository
plays the SDK's own test animations, converted from the `SpriteStudio-SDK`
submodule. [Working from a checkout](docs/development/from-source.md) is the path
from clone to running app, and [the example app](example/README.md) says what each
subject on its screen proves.

> Converting those packs needs a Rust toolchain, because `deploy-examples`
> builds the SDK's `ssconverter-cli` from source.

### Preparing assets (`.sspj` → `.ssab`)

Animations are authored in SpriteStudio — **7.5 or later**, which is what the
format this reads is defined against — and converted on your machine with the
SDK's `ssconverter-cli` (or the desktop [SSConverterGUI](https://github.com/cri-middleware/SSConverterGUI)).
No converter is bundled and nothing converts at runtime — this is a step you run before the assets ship. [Converting with a standalone tool](https://cri-middleware.github.io/SpriteStudio-Docs/overview/convert-with-a-standalone-tool/) covers picking a tool and putting it in a build pipeline.

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

That is the whole integration. The textures come with it — for a **Reference**
pack the loader resolves each `image_path` next to the `.ssab`, and for an
**Embedded** one (`--embedded`) it reads the atlas out of the file. Playback starts on load and loops
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
| Know when an animation started, changed, looped or finished | `onAnimationStarted`, `onAnimationChanged`, `onAnimationLooped`, `onAnimationFinished` |
| Recolour, hide or swap a part at runtime | the `parts` prop — declarative, so removing an entry reverts it |
| Draw a whole cast on one canvas and one clock | `<SpriteStudioScene>` + `<SpriteStudioSprite>` |
| Attach a React view to a part (a health bar over a head) | `<SpriteStudioPartAnchor>` in the view's children — or `useSsPartTransform` for a style of your own |
| Pay the load cost before the mount | `ssPreload` / `ssUnload` |
| Drive the transport imperatively | the ref's `player` — a `SpriteStudioPlayer` |

The `.ssab` decides which of these are available, and every part type and key
this port supports is handled without extra wiring —
[docs/limitations.md](docs/limitations.md) is the list.

## 📋 Requirements

| | |
|---|---|
| React Native | **New Architecture only** |
| iOS | 15.1+ |
| Android | API 24+ |
| Peer deps | `react-native`, `react`, `@shopify/react-native-skia`, `react-native-nitro-modules`, `react-native-reanimated` — and `react-native-worklets`, which Reanimated 4 requires as a peer of its own rather than depending on. The version each one needs lives in [`peerDependencies`](packages/react-native-spritestudio/package.json), and your package manager enforces it at install |
| SpriteStudio-SDK | pinned in [`scripts/SDK_VERSION.txt`](scripts/SDK_VERSION.txt) |

The Skia lower bound is real: 2.11 moved its API objects onto the
`jsi::NativeState` pattern, and the package unwraps them the new way. Windows,
tvOS and visionOS are out of scope — see [ROADMAP.md](ROADMAP.md#distribution--verification) (Windows) and
[ROADMAP.md](ROADMAP.md#needs-sdk) (tvOS and visionOS) for why.

### Web

**Adding this package does not break your web build.** Importing
`react-native-spritestudio` under react-native-web is safe and that bundle
builds, because the entry point web resolves is a *stub* — carried for the app
that ships web **as well as** native and plays SpriteStudio only on the native
half. The placement arithmetic, the path helpers and the vocabulary enums are
the real implementations on both platforms; only the parts that need Skia or the
native runtime are stubbed, and rendering a player on web throws an error naming
this package.

**What it does not do is play animations on web.** For SpriteStudio on the web
the answer is [SpriteStudio Player for Web](https://github.com/cri-middleware/SSPlayerForWeb)
— `@spritestudio/ssplayer-webgl` renders the same `.ssab` with no React Native
in the way.

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
