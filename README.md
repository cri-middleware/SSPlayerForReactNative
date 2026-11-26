[**English**](./README.md) | [**日本語**](./README.ja.md)

# SpriteStudio Player for React Native

**Drop artist-authored 2D animation into your React Native app — one component, no animation code, no video files.**

A player that renders **[SpriteStudio](https://www.webtech.co.jp/eng/spritestudio/)** animations (`.ssab`) in [React Native](https://reactnative.dev/), on the New Architecture. SpriteStudio is a professional 2D animation editor: an artist rigs the **raster** (PNG) art you already have — bones, mesh deformation, masks, particle effects — and exports one file. This package plays that file, drawing it natively through [React Native Skia](https://shopify.github.io/react-native-skia/). No spritesheet to slice, no timeline to hand-write, no video to decode.

## ✨ Why use SpriteStudio with React Native?

- **Bring your sprites — and whole screens — to life.** Breathing and blinking, swaying hair and clothes, flashy slash and magic effects, even an animated HUD: the motion is built visually in a dedicated editor (SpriteStudio) and `<SpriteStudioView>` just plays it — bone rigs, mesh deformation, masks and particles included. No `Animated` or Reanimated timeline to wire up per part.
- **Raster art, drawn natively — not vector, not video.** It animates **raster** (bitmap/PNG) sprite art, so painted illustrations and rich textures move exactly as drawn — a different fit from vector animation tools. Unlike a `.gif` or an `.mp4`, it scales freely, loops seamlessly, reacts to your app, and builds each frame as it is drawn so motion follows your display's refresh rate and playback speed instead of the authored fps.
- **An ordinary view, drawn by native code.** Lay it out, clip it and animate it like any other view. The timeline, geometry and drawing run in native code under [Nitro Modules](https://nitro.margelo.com/), so no vertex passes through JavaScript and a frame costs no React render — and `<SpriteStudioScene>` draws a whole cast through one canvas and one clock.
- **The animation can talk back to your app.** Keys the artist placed on the timeline — user data, signals, audio cues — arrive as callbacks, so a footstep sound or a hit reaction is timed by the animation itself, not by a timer you keep in sync. Per-part overrides recolour, hide or swap a part at runtime.
- **Blend animations instead of cutting between them.** Crossfade from a walk to a run, lay an aim or a blink on top of what is playing, or mix two animations by weight — from animations the artist authored separately. Set `transitionMs` and a change of `animation` crossfades.

## 📚 Documentation

- [**Documentation site**](https://cri-middleware.github.io/SSPlayerForReactNative/) — setup, usage, the generated API reference
- [**For AI assistants**](https://cri-middleware.github.io/SSPlayerForReactNative/llms.txt) — these docs as Markdown: `llms.txt` indexes the English pages and `llms-full.txt` holds all of them in one file; each Japanese page is available as `.md` under `ja/`; the npm package carries the same pages in its `docs/` folder and as an Agent Skill in `skills/` ([installing the skill](https://cri-middleware.github.io/SpriteStudio-Docs/ai/docs/))
- [**SpriteStudio Docs (portal)**](https://cri-middleware.github.io/SpriteStudio-Docs/) — the SDK and every official player in one place, with a [plugin](https://cri-middleware.github.io/SpriteStudio-Docs/ai/) that tells your coding assistant about SpriteStudio

---

## 🚀 Quick Start

**Using it in your app?** Read on — install, convert, play. Everything after
that (events, part overrides, custom textures) is the same path further in, on the
[documentation site](https://cri-middleware.github.io/SSPlayerForReactNative/).
**Working on the player, or the Rust core under it?**
[Working on the player](#%EF%B8%8F-working-on-the-player) below, then
[CONTRIBUTING.md](CONTRIBUTING.md) before changing anything; [ROADMAP.md](ROADMAP.md) is what
lands when.

You need a React Native app on the **New Architecture**, run as a **development build** — Expo Go
cannot load native code — and a project made in **SpriteStudio 7.6 or later**. The versions are
under [Requirements](#-requirements).

1. **Install** the package and its peers:

   ```bash
   npx expo install react-native-spritestudio react-native-skia react-native-nitro-modules react-native-reanimated react-native-worklets expo-build-properties
   ```

   `expo-build-properties` is for Android, whose `minSdkVersion` has to be 26: step 2 sets it.
2. **Convert** your `.sspj` with [ssconverter-web](https://cri-middleware.github.io/SSPlayerForWeb/ssconverter/)
   in the browser, the desktop [SSConverterGUI](https://github.com/cri-middleware/SSConverterGUI),
   or the `ssconverter-cli` from the [SpriteStudio-SDK Releases](https://github.com/cri-middleware/SpriteStudio-SDK/releases). Each gives you a folder named after the project (ssconverter-web
   inside a ZIP), with the `.ssab` and its textures inside. Put that folder in `assets/ss/`. In `app.json`, point the config
   plugin at `assets/ss` and set Android's `minSdkVersion`:

   ```
   my-app/
   ├── app.json
   ├── App.tsx               ← source="ss/Ringo/Ringo.ssab"
   └── assets/
       └── ss/               ← shipped into the app as ss/
           └── Ringo/        ← the converter's output folder
               ├── Ringo.ssab
               ├── Ringo.png
               └── …
   ```

   ```json
   {
     "expo": {
       "plugins": [
         ["expo-build-properties", { "android": { "minSdkVersion": 26 } }],
         ["react-native-spritestudio", { "assets": ["./assets/ss"] }]
       ]
     }
   }
   ```

   The folder travels as a native app asset rather than through Metro, so a changed pack needs a
   native build — [Preparing assets](docs/setup/assets.md) explains why.
3. **Play** it. Build the app — `npx expo prebuild`, then `npx expo run:ios` or `run:android` — and
   name the pack by its path inside the shipped folder:

   ```tsx
   import { SpriteStudioView } from 'react-native-spritestudio'

   export function Character() {
     return (
       <SpriteStudioView
         source="ss/Ringo/Ringo.ssab"
         animation="wait1"
         fit="contain"
         style={{ width: '100%' }}
       />
     )
   }
   ```

   Playback starts on load and loops forever; `loop={1}` plays once.

No `.sspj` of your own yet? SpriteStudio's [official sample data](https://www.webtech.co.jp/help/ja/spritestudio7/download/sample/) works as-is — the page is in Japanese, the downloads are not. [Ringo](https://www.webtech.co.jp/spritestudio/ss6user/download/OPTPiX_SpriteStudio_Ringo_Sample_20220121.zip) is a good character to start with. To make your own, you use SpriteStudio itself — see [its site](https://www.webtech.co.jp/eng/spritestudio/).

**Read next:** [Basic playback](docs/usage/basic.md) · [Components at a glance](docs/components.md) · [UI buttons](docs/usage/ui.md) (`react-native-spritestudio-ui`) ·
[Limitations & Scope](docs/limitations.md) · [Troubleshooting](docs/troubleshooting.md)

## 📋 Requirements

| | |
|---|---|
| React Native | **New Architecture only** |
| iOS | 15.1+ |
| Android | API 26+, with Vulkan |
| Expo | SDK 58, built with `expo prebuild` — packs ship through the Expo config plugin |
| Peer deps | `react-native`, `react`, `react-native-skia`, `react-native-nitro-modules`, `react-native-reanimated`, `react-native-worklets` — the versions are in [`peerDependencies`](packages/react-native-spritestudio/package.json) |

Drawing goes through React Native Skia 3, published as `react-native-skia`; it
renders with Skia Graphite and sets the Android floor. `@shopify/react-native-skia`
(v2) does not stand in for it and cannot be installed beside it. Windows,
tvOS and visionOS are out of scope — see [ROADMAP.md](ROADMAP.md#distribution--verification) (Windows) and
[ROADMAP.md](ROADMAP.md#needs-sdk) (tvOS and visionOS) for why.

### Web

**Nothing plays on web, but adding this package does not break your web build**: an app that
ships web as well as native still bundles, and only rendering a player there throws
([Limitations & Scope](docs/limitations.md)). For SpriteStudio on the web, use
[SpriteStudio Player for Web](https://github.com/cri-middleware/SSPlayerForWeb).

## ⚙️ Working on the player

The example app in this repository plays the SDK's own test animations, converted from the
`SpriteStudio-SDK` submodule. The [Build Guide](docs/development/build.md) is the path from clone
to running app — and on to using a changed package in an app and checking on a device — and
[the example app](example/README.md) describes its four screens and how to look at a project of
your own.
[How the Player Is Put Together](docs/development/architecture.md) gives the layers and the reasons
that span them. Converting those packs needs a Rust toolchain, because `deploy-examples` builds the
SDK's `ssconverter-cli` from source.

## 🔗 Related Repositories

- [SpriteStudio Docs](https://cri-middleware.github.io/SpriteStudio-Docs/) — the portal for the SDK and every official player
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
