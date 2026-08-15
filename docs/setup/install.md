---
title: Installation
description: Whether this package fits your app, how to install it, and the build it needs.
---

# Installation

::: danger Not published yet
`react-native-spritestudio` is **not on npm**, so the install command below does
not work yet. Until the first release the only way to run it is from a checkout
of the repository — see
[the example app](https://github.com/cri-middleware/SSPlayerForReactNative/tree/main/example).

The rest of this page describes the install as it will be.
:::

## 1. Check it fits

| | |
|---|---|
| React Native | `0.86.2` or newer, **New Architecture** |
| React | `19.2.8` or newer |
| Expo | SDK 57, or bare React Native |
| iOS | 15.1+ |
| Android | API 24+ |

Not supported: **Expo Go** (see step 3), **web** (use
[SSPlayerForWeb](https://github.com/cri-middleware/SSPlayerForWeb) instead), and
Windows / tvOS / visionOS. Full detail in
[Limitations & Scope](/limitations).

## 2. Install

```bash
npx expo install react-native-spritestudio @shopify/react-native-skia react-native-nitro-modules react-native-reanimated react-native-worklets
```

Four of those five are peer dependencies you install alongside the package — the
drawing backend, the JSI bindings, and Reanimated plus the worklets package
Reanimated itself requires. `expo install` picks versions that match your Expo
SDK, which is why it is used here in place of `npm install`.

## 3. Build it

**Expo Go cannot run this package.** It ships a fixed set of native modules and
this one is not among them, so you need a **development build** — your own app
binary with this package compiled into it. Fast Refresh and the dev menu still
work; what you give up is scanning a QR code into someone else's binary.

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

::: warning The bare route is not finished
The Expo config plugin does two things nothing does for you in a bare app: it
**ships your pack directories as native assets**, and it **narrows
`reactNativeArchitectures`** so the build stops asking for the 32-bit `x86`
slice the native core does not provide. Writing both down and verifying them is
still an open
[ROADMAP](https://github.com/cri-middleware/SSPlayerForReactNative/blob/main/ROADMAP.md)
item — until then, expect to work them out yourself.
:::

Next: [Preparing assets](/setup/assets), because a pack has to reach the device
before anything can play it.

## Troubleshooting the install

::: details The build fails, or the app crashes on launch

**Two copies of a native module.** This is the common one, and it is not a
duplicated dependency — it is two autolinked pods fighting over one JSI
registration. Check with `npm ls @shopify/react-native-skia`; in a monorepo, pin
every peer at the root.

**`react-native-worklets` is missing.** Reanimated 4 declares it as a peer of
*its* own rather than depending on it, so your app has to install it. The
command in step 2 already does.

:::

::: details Why these version floors

`@shopify/react-native-skia` `2.11` is where its API objects moved onto the
`jsi::NativeState` pattern, and this package unwraps them the new way — an older
Skia does not link.

`react-native-nitro-modules` `0.36.5` matches the generated bindings committed
in the repository.

:::
