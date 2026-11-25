[**English**](./README.md) | [**日本語**](./README.ja.md)

# react-native-spritestudio

**Drop artist-authored 2D animation into your React Native app — one component, no animation code, no video files.**

Plays **[SpriteStudio](https://www.webtech.co.jp/eng/spritestudio/)** animations (`.ssab`) on React Native's New Architecture, drawing natively through [React Native Skia](https://shopify.github.io/react-native-skia/) with the timeline and geometry in a Rust core under [Nitro Modules](https://nitro.margelo.com/) (JSI). SpriteStudio is a 2D animation tool: an artist adds bones, mesh deformation and effects to their own illustrations, and this package plays the result.

- 📖 **[Documentation](https://cri-middleware.github.io/SSPlayerForReactNative/)** — setup, usage, the generated API reference. The setup and usage pages for this version are in this package's `docs/` as English Markdown (start at `docs/README.md`), readable offline — the types and their comments are in `lib/typescript/` — and in `skills/react-native-spritestudio/` as an Agent Skill; [Docs for Your Assistant](https://cri-middleware.github.io/SpriteStudio-Docs/ai/docs/#-as-an-agent-skill) says how your package manager links it into your coding agent's skills directory
- 📦 **[Repository](https://github.com/cri-middleware/SSPlayerForReactNative)** — the long-form README, the roadmap and the example app
- 🌐 **[SpriteStudio Docs (portal)](https://cri-middleware.github.io/SpriteStudio-Docs/)** — the SDK and every official player in one place

## Install

```bash
npx expo install react-native-spritestudio react-native-skia react-native-nitro-modules react-native-reanimated react-native-worklets expo-build-properties
```

**Expo Go does not work** — the package contains native code, so a prebuild (Continuous Native Generation) is required, once your packs are in place below. `expo-build-properties` is for Android, whose `minSdkVersion` has to be 26.

## Ship your packs

A `.ssab` names its textures and its external packs **by paths relative to itself**, so **a pack is a directory, not a file** — and Metro ships a dependency graph rather than directories. Pack directories go in as native app assets through the Expo config plugin. Put each converter's
output folder in `assets/ss/`, point the plugin at it, and set Android's `minSdkVersion`:

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

Then build: `npx expo prebuild`, then `npx expo run:ios` / `run:android`.

`.sspj` → `.ssab` conversion happens on your machine — in the browser with [ssconverter-web](https://cri-middleware.github.io/SSPlayerForWeb/ssconverter/), with the desktop [SSConverterGUI](https://github.com/cri-middleware/SSConverterGUI), or with the `ssconverter-cli` from the [SpriteStudio-SDK Releases](https://github.com/cri-middleware/SpriteStudio-SDK/releases). No converter is bundled. No `.sspj` of your own yet? SpriteStudio's [official sample data](https://www.webtech.co.jp/help/ja/spritestudio7/download/sample/) works as-is — the page is in Japanese, the downloads are not. [Ringo](https://www.webtech.co.jp/help/ja/spritestudio7/download/sample/#ringo) is a good character to start with. To make your own, you use SpriteStudio itself — see [its site](https://www.webtech.co.jp/eng/spritestudio/).

## Play

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

That is the whole integration. The textures come with it, playback starts on load and loops forever by default.

For many animations at once, `<SpriteStudioScene>` + `<SpriteStudioSprite>` draw a whole cast through **one canvas and one clock**. Timeline keys arrive as `onUserData` / `onAudio` / `onSignal` callbacks, and the `parts` prop recolours, hides or swaps a part declaratively. `transitionMs` crossfades a change of `animation`, and the player layers animations on tracks — see [Motion blending](https://cri-middleware.github.io/SSPlayerForReactNative/usage/motion-blending) in the docs.

## Requirements

| | |
|---|---|
| React Native | **New Architecture only** |
| Peer deps | `react-native`, `react`, `react-native-skia`, `react-native-nitro-modules`, `react-native-reanimated` — plus `react-native-worklets`, at the version your Reanimated declares as a peer of its own. The ranges are this package's `peerDependencies` |
| iOS | 15.1+ |
| Android | API 26+, with Vulkan |
| Expo | SDK 58, built with `expo prebuild` — packs ship through the Expo config plugin |
| SpriteStudio | projects made in 7.6 or later |

React Native Skia is `react-native-skia` 3, which renders with Skia Graphite and sets the Android floor; `@shopify/react-native-skia` (v2) does not stand in for it and cannot be installed beside it. **Keep every peer single-copy** (`npm ls react-native-skia`; in a monorepo, pin the peers at the root).

Windows, tvOS and visionOS are out of scope. **This package does not play animations on web**; for SpriteStudio on the web use [SpriteStudio Player for Web](https://github.com/cri-middleware/SSPlayerForWeb). What ships here is a web *stub* so an app that targets web **as well as** native can still build its web bundle.

## License

BSD-3-Clause — see [LICENSE.md](./LICENSE.md).

It also compiles FlatBuffers and `libssruntime` into the app you publish, which carries obligations onto *your* binary — see [THIRD_PARTY_NOTICES.md](https://github.com/cri-middleware/SSPlayerForReactNative/blob/HEAD/THIRD_PARTY_NOTICES.md).
