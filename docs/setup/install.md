---
title: Installation
description: Installing react-native-spritestudio and its peer dependencies.
---

# Installation

```bash
npx expo install react-native-spritestudio @shopify/react-native-skia react-native-nitro-modules react-native-reanimated react-native-worklets
```

::: warning Not published yet
The package is not on npm yet. Until the first release, run the example app from
a checkout — see [Working on this repository](https://github.com/cri-middleware/SSPlayerForReactNative/blob/main/AGENTS.md).
:::

## Peer dependencies

| Package | Why |
|---|---|
| `@shopify/react-native-skia` `^2.11.0` | The drawing backend. 2.11 is the floor — that is where the API objects moved onto `jsi::NativeState`. |
| `react-native-nitro-modules` `^0.36.5` | The JSI bindings. |
| `react-native-reanimated` `^4.5.3` | Frames reach the canvas through a shared value. |
| `react-native-worklets` `^0.11.3` | Not a peer of this package — Reanimated 4 declares it as a peer of *its* own rather than depending on it, so your app is the one that has to install it. |

**Keep each of these single-copy.** Two copies of a native module is not a
duplicated dependency — it is two autolinked pods fighting over one JSI
registration. In a monorepo, pin them at the root.

## Expo Go does not work

The package contains native code, so a prebuild (CNG) is required:

```bash
npx expo prebuild
npx expo run:ios     # or run:android
```

A bare React Native app works too; autolinking picks the package up on both
platforms.

## Requirements

| | |
|---|---|
| React Native | `^0.86.2`, New Architecture |
| React | `^19.2.8` |
| iOS | 15.1+ |
| Android | minSdk 24 |
| Expo | SDK 57 — the release whose `expo install` picks RN 0.86.2 (or bare RN) |
