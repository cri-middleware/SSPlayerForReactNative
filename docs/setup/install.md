---
title: Installation
description: Whether this package fits your app, how to install it, and the build it needs.
---

# Installation

For adding the player to **your own app** — whether you go on to use nothing but
`<SpriteStudioView>`, or reach for events, part overrides and custom textures.
The install is the same either way. To work on the player or the Rust core
instead, see [Working from a checkout](/development/from-source).

**Every consumer of this package compiles native code.** There is no
JavaScript-only artifact to drop into a project — no CDN bundle, no prebuilt
`.js` you can vendor. So "installing" here means getting the package *and*
producing a native build of your app that contains it. Both halves are below.

## 1. Check it fits

| | |
|---|---|
| React Native | `0.88.0` or newer, **New Architecture** |
| React | `19.3.0` or newer |
| Expo | SDK 58, or bare React Native |
| iOS | 15.1+ |
| Android | API 26+, with Vulkan |

Not supported: **Expo Go** (see step 3) and Windows / tvOS / visionOS.

**On web nothing draws** — but adding this package does not break a web build,
so an app shipping web as well as native is fine. For SpriteStudio on the web
use [SpriteStudio Player for Web](https://github.com/cri-middleware/SSPlayerForWeb) instead.
Full detail in [Limitations & Scope](/limitations).

## 2. Install

```bash
npx expo install react-native-spritestudio react-native-skia react-native-nitro-modules react-native-reanimated react-native-worklets
```

Four of those five are peer dependencies you install alongside the package — the
drawing backend, the JSI bindings, and Reanimated plus the worklets package
Reanimated itself requires. `expo install` is used in place of `npm install`
because it picks versions matching your Expo SDK.

The published tarball **carries the native core with it**, so there is nothing
further to fetch and no Rust toolchain to install.

::: warning A git URL is not a substitute
`npm install github:cri-middleware/…` **cannot work**. Neither the native core
nor the built `lib/` is tracked in git, so the install produces a package whose
`main` points at a file that is not there and whose native side has nothing to
link. To work from the source tree, see
[Working from a checkout](/development/from-source) — that is a different job
from this page, and it needs the repository, not a dependency.
:::

## 3. Build your app

::: info This is *your app's* build, not a build of this package
Nothing here is compiled separately by you — the native core arrives prebuilt
from npm, or from `download-sdk` on the checkout route. What this step produces
is your own app binary, with the package linked into it.
:::

**Expo Go cannot run it.** Expo Go ships a fixed set of native modules and this
one is not among them, so you need a **development build**. Fast Refresh and the
dev menu still work; what you give up is scanning a QR code into someone else's
binary.

::: code-group

```bash [Managed]
# no ios/ or android/ in your repo
npx expo prebuild
npx expo run:ios     # or run:android
```

```bash [Bare]
# you already have ios/ and android/ — do not run prebuild
npx pod-install
npx react-native run-ios     # or run-android
```

:::

Autolinking picks the package up on both platforms either way.

**Android's `minSdkVersion` has to be 26**, React Native Skia 3's floor, and
React Native projects default lower. In a managed app, set it with
`expo-build-properties` (`npx expo install expo-build-properties`):

```json
{
  "expo": {
    "plugins": [
      ["expo-build-properties", { "android": { "minSdkVersion": 26 } }]
    ]
  }
}
```

In a bare app, set `minSdkVersion = 26` in `android/build.gradle`.

::: warning In a bare app, the plugin's two jobs are yours
The Expo config plugin does two things nothing does for you in a bare app: it
**ships your pack directories as native assets**, and it **narrows
`reactNativeArchitectures`** so the build stops asking for the 32-bit `x86`
slice the native core does not provide. A bare app does both by hand; written
steps for them are tracked in the
[ROADMAP](https://github.com/cri-middleware/SSPlayerForReactNative/blob/HEAD/ROADMAP.md).
:::

Next: [Preparing assets](/setup/assets), because a pack has to reach the device
before anything can play it.

## Troubleshooting the install

::: details The build fails, or the app crashes on launch

**Two copies of a native module.** This is the common one, and it is not a
duplicated dependency — it is two autolinked pods fighting over one JSI
registration. Check with `npm ls react-native-skia`; in a monorepo, pin
every peer at the root.

**`react-native-worklets` is missing.** Reanimated 4 declares it as a peer of
*its* own rather than depending on it, so your app has to install it. The
command in step 2 already does.

:::

::: details Why these version floors

`react-native-skia` `3` renders with Skia Graphite, and this package compiles
against its headers with the defines it builds with. `@shopify/react-native-skia`
(v2) does not stand in for it.

`react-native-nitro-modules` `0.37.0` matches the generated bindings committed
in the repository.

:::
