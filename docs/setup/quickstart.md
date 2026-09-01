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
that surprises people. Point the config plugin at the directory holding your
packs:

```json
{
  "expo": {
    "plugins": [["react-native-spritestudio", { "assets": ["./assets/ss"] }]]
  }
}
```

## 2. Play it

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

That is the whole integration. The textures come with it: for a **Reference**
pack the loader resolves each `image_path` next to the `.ssab`, and for an
**Embedded** one it reads the atlas out of the file. See
[Preparing assets](/setup/assets#reference-and-embedded-packs).

Playback starts on load and loops forever by default. `playing`, `speed` and
`loop` are props — `loop={1}` plays once.

## Typed pack names

A wrong path is a blank canvas rather than an error, so generate a manifest of
the packs your app ships and let the compiler check the names:

```bash
npx react-native-spritestudio assets --out src/ss-assets.ts
```

```tsx
import { SsAssets } from './ss-assets'

<SpriteStudioView source={SsAssets['overall/Basic']} />
```

`--check` fails when the manifest is out of date, which is what CI wants.
