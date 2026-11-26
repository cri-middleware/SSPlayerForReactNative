---
title: Quick Start
description: Shipping a converted pack with the Expo config plugin, playing it with SpriteStudioView by its path, and typing the pack names.
---

# Quick Start

Two things have to be true: the pack has to reach the device, and the component
has to name it.

## 1. Ship the pack

Convert your `.sspj` in the browser with
[ssconverter-web](https://cri-middleware.github.io/SSPlayerForWeb/ssconverter/): it gives you a
ZIP holding a folder named after the project, with the `.ssab` and its textures inside. The other
converters, and why a pack is a directory, are in [Preparing assets](/setup/assets).

::: tip No SpriteStudio data of your own yet?
The [official sample data](https://www.webtech.co.jp/help/ja/spritestudio7/download/sample/)
works as-is — that page is Japanese only, but the downloads themselves are
language-neutral. [Ringo](https://www.webtech.co.jp/spritestudio/ss6user/download/OPTPiX_SpriteStudio_Ringo_Sample_20220121.zip) is a good
character sample, and
[Particle](https://www.webtech.co.jp/spritestudio/ss6user/download/OPTPiX_SpriteStudio_ParticleEffect_Sample_20191025.zip) is a good one
if you want effects.
:::

Put the converter's output folder in a directory the package's Expo config plugin ships —
`assets/ss/` here:

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

and add the plugin's entry to the `plugins` array of `app.json`:

```json
{
  "expo": {
    "plugins": [["react-native-spritestudio", { "assets": ["./assets/ss"] }]]
  }
}
```

The plugin changes the native projects, so build the app now: `npx expo prebuild`, then
`npx expo run:ios` or `run:android`.

## 2. Play it

A pack is named by its path inside the shipped folder, starting with that folder's name:
`assets/ss/Ringo/Ringo.ssab` is `ss/Ringo/Ringo.ssab`.

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

That is the whole integration. The textures come with it: for a **Reference**
pack the loader resolves each `image_path` next to the `.ssab`, and for an
**Embedded** one it reads the atlas out of the file. See
[Preparing assets](/setup/assets#reference-and-embedded-packs).

Playback starts on load and loops forever by default. `playing`, `speed` and
`loop` are props — `loop={1}` plays once.

## Typed pack names

A wrong path shows up only when the pack fails to load, so generate a manifest
of the packs your app ships and let the compiler check the names:

```bash
npx react-native-spritestudio assets --out src/ss-assets.ts
```

```tsx
import { SsAssets } from './ss-assets' // from a file in src/

<SpriteStudioView source={SsAssets['Ringo/Ringo']} />
```

`--check` fails when the manifest is out of date, which is what CI wants. Give it the same `--out` as the
run that wrote the file: `npx react-native-spritestudio assets --check --out src/ss-assets.ts`.
