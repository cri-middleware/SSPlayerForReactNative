---
title: Quick Start
description: From an installed package to an animation on screen.
---

# Quick Start

Two things have to be true: the pack has to reach the device, and the component
has to name it.

::: tip No SpriteStudio data of your own yet?
The [official sample data](https://www.webtech.co.jp/help/ja/spritestudio7/download/sample/)
works as-is — that page is Japanese only, but the downloads themselves are
language-neutral. [Ringo](https://www.webtech.co.jp/help/ja/spritestudio7/download/sample/#ringo) is a good
character sample, and
[Particle](https://www.webtech.co.jp/help/ja/spritestudio7/download/sample/#Perticle_sample) is a good one
if you want effects.
:::

## 1. Ship the pack

Animations are authored in SpriteStudio and converted on your machine to a
`.ssab` **directory** — see [Preparing assets](/setup/assets), which is the part
that surprises people. Put the converter's output folder in a directory the package's Expo
config plugin ships — `assets/ss/` here:

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

Adding the plugin changes the native projects, so build the app again: `npx expo prebuild`,
then `npx expo run:ios` or `run:android`.

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
      style={{ flex: 1 }}
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
