[**English**](./README.md) | [**日本語**](./README.ja.md)

# react-native-spritestudio

**Drop artist-authored 2D animation into your React Native app — one component, no animation code, no video files.**

Plays **[SpriteStudio](https://www.webtech.co.jp/spritestudio/)** animations (`.ssab`) on React Native's New Architecture, drawing natively through [React Native Skia](https://shopify.github.io/react-native-skia/) with the timeline and geometry in a Rust core under [Nitro Modules](https://nitro.margelo.com/) (JSI).

> [!WARNING]
> **Not released yet.** This package is not published to npm, and nothing here has run on a **physical device** — iOS simulator and Android emulator only.

- 📖 **[Documentation](https://cri-middleware.github.io/SSPlayerForReactNative/)** — setup, usage, the generated API reference
- 📦 **[Repository](https://github.com/cri-middleware/SSPlayerForReactNative)** — the long-form README, the roadmap and the example app
- 🌐 **[SpriteStudio Docs (portal)](https://cri-middleware.github.io/SpriteStudio-Docs/)** — the SDK and every official player in one place

## Install

```bash
npx expo install react-native-spritestudio @shopify/react-native-skia react-native-nitro-modules react-native-reanimated react-native-worklets
```

**Expo Go does not work** — the package contains native code, so a prebuild (CNG) is required: `npx expo prebuild` then `npx expo run:ios` / `run:android`. A bare React Native app works too; autolinking picks it up on both platforms.

## Ship your packs

A `.ssab` names its textures and its external packs **by paths relative to itself**, so **a pack is a directory, not a file** — and Metro ships a dependency graph rather than directories. Pack directories go in as native app assets through the Expo config plugin:

```json
{
  "expo": {
    "plugins": [["react-native-spritestudio", { "assets": ["./assets/ss"] }]]
  }
}
```

`.sspj` → `.ssab` conversion happens on your machine with the SDK's `ssconverter-cli` or the desktop [SSConverterGUI](https://github.com/cri-middleware/SSConverterGUI). No converter is bundled.

## Play

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

That is the whole integration. The textures come with it, playback starts on load and loops forever by default.

For many animations at once, `<SpriteStudioScene>` + `<SpriteStudioSprite>` draw a whole cast through **one canvas and one clock**. Timeline keys arrive as `onUserData` / `onAudio` / `onSignal` callbacks, and the `parts` prop recolours, hides or swaps a part declaratively.

## Requirements

| | |
|---|---|
| React Native | `^0.88.0-rc.1` — **New Architecture only** |
| React | `^19.3.0` |
| Peer deps | `@shopify/react-native-skia` `^2.11.2`, `react-native-nitro-modules` `^0.37.0`, `react-native-reanimated` `^4.6.0` — plus `react-native-worklets` `^0.12.2`, which Reanimated 4 declares as a peer of its own |
| iOS | 15.1+ |
| Android | API 24+ |

The Skia floor is real: 2.11 is where the API objects moved onto the `jsi::NativeState` pattern, and this package unwraps them the new way. **Keep every peer single-copy** — two copies of a native module is two autolinked pods fighting over one JSI registration.

Windows, tvOS and visionOS are out of scope. **This package does not play animations on web**; for SpriteStudio on the web use [SSPlayerForWeb](https://github.com/cri-middleware/SSPlayerForWeb). What ships here is a web *stub* so an app that targets web **as well as** native can still build its web bundle.

## License

BSD-3-Clause — see [LICENSE.md](./LICENSE.md).

It also compiles FlatBuffers and `libssruntime` into the app you publish, which carries obligations onto *your* binary — see [THIRD_PARTY_NOTICES.md](https://github.com/cri-middleware/SSPlayerForReactNative/blob/main/THIRD_PARTY_NOTICES.md).
