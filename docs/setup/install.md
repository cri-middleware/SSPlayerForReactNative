---
title: Installation
description: Whether this package fits your app, how to install it, and the build it needs.
---

# Installation

For adding the player to **your own app** — whether you go on to use nothing but
`<SpriteStudioView>`, or reach for events, part overrides and custom textures.
The install is the same either way. To work on the player or the Rust core
instead, see the [Build Guide](/development/build).

**Your app needs a native build.** Installing means adding the package *and*
building your app with it; both halves are below.

## 1. Check it fits

| | |
|---|---|
| React Native | `0.88` (from `0.88.0`), **New Architecture** |
| React | `19` (from `19.3.0`) |
| React Native Skia | `3` (from `3.6.1`) |
| Reanimated | `4` (from `4.6.0`) |
| Expo | SDK 58 |
| iOS | 15.1+ |
| Android | API 26+, with Vulkan |
| SpriteStudio | projects made in 7.6 or later |

Not supported: **Expo Go** (see step 3) and Windows / tvOS / visionOS.

**On web nothing draws** — but adding this package does not break a web build,
so an app shipping web as well as native is fine. For SpriteStudio on the web
use [SpriteStudio Player for Web](https://github.com/cri-middleware/SSPlayerForWeb) instead.
Full detail in [Limitations & Scope](/limitations).

## 2. Install

```bash
npx expo install react-native-spritestudio react-native-skia react-native-nitro-modules react-native-reanimated react-native-worklets
```

The other four are what the package needs alongside it — the drawing backend, the JSI bindings,
Reanimated, and the worklets package that Reanimated itself requires as a peer. `expo install` is used
in place of `npm install` because it picks the versions Expo has tested for Reanimated and worklets.

The published tarball **carries the native core with it**, so there is nothing
further to fetch and no Rust toolchain to install. Install from npm: the native
core and the built JavaScript are in the published package, not in the git
repository.

## 3. Build your app

**Expo Go cannot run it.** Expo Go ships a fixed set of native modules and this
one is not among them, so you need a **development build**. Fast Refresh and the
dev menu still work; what you give up is scanning a QR code into someone else's
binary.

**Android's `minSdkVersion` has to be 26**, React Native Skia 3's floor, and React Native projects
default lower. Before the first build, add this entry to the `plugins` array in `app.json`
(`npx expo install expo-build-properties`):

```json
{
  "expo": {
    "plugins": [
      ["expo-build-properties", { "android": { "minSdkVersion": 26 } }]
    ]
  }
}
```

Then build:

```bash
npx expo prebuild
npx expo run:ios     # or run:android
```

Autolinking picks the package up on both platforms.

Next: [Quick Start](/setup/quickstart) — it ships a pack and plays it. [Preparing assets](/setup/assets)
explains the conversion behind it.

## Troubleshooting the install

::: details The build fails, or the app crashes on launch

**Two copies of a native module.** This is the common one: keep one copy of
each peer. Check with `npm ls react-native-skia`; in a monorepo, pin every peer
at the root.

**`react-native-worklets` is missing.** Reanimated 4 declares it as a peer of
*its* own rather than depending on it, so your app has to install it. The
command in step 2 already does.

:::

::: details Which Skia, and which Nitro Modules

`react-native-skia` is React Native Skia 3 (`3.6.1` or newer). `@shopify/react-native-skia` (v2) does
not stand in for it and cannot be installed beside it — remove it first. `react-native-nitro-modules`
must be on the `0.37` line (from `0.37.0`).

:::
