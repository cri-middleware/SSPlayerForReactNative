---
title: Preparing assets
description: Converting .sspj to .ssab, and why a pack is a directory rather than a file.
---

# Preparing assets (`.sspj` → `.ssab`)

Conversion happens on your machine with the SDK's `ssconverter-cli`, or the
desktop [SSConverterGUI](https://github.com/cri-middleware/SSConverterGUI). **No
converter is bundled** — React Native has no editor to host an importer in, so
there is no live edit-to-runtime loop here the way there is in the Ren'Py and
Flutter players.

## A pack is a directory, not a file

A `.ssab` names its textures, the external packs its Instance parts reach, and —
through a `.ssqb` — the packs it sequences, **all by paths relative to itself**.
So the converter's *output directory* is what has to reach the device intact.

Metro cannot carry one. It bundles what a `require()` names and never walks a
directory, and Android's packager then flattens what it did name into `res/`.
Two consequences follow, and both are load-bearing:

- **A `require()`d module is not a valid `source`.** It is the one form with no
  directory behind it.
- **`assetExts` must stay clean of `ssab` / `ssqb`.** Teaching Metro about them
  would produce exactly the flattened, sibling-less copy that cannot work.

Pack directories ship as **native app assets** instead:

```json
{
  "expo": {
    "plugins": [["react-native-spritestudio", { "assets": ["./assets/ss"] }]]
  }
}
```

The plugin re-copies on every build, so re-running the converter needs only a
rebuild — not a fresh `prebuild`.

::: warning Assets do not Fast Refresh
Changing a pack means a native build. There is no way around it: the file is an
app asset, not a bundle entry.
:::

## Reference and Embedded packs

The converter emits one of two kinds, and these are the SDK's names for them.
`ssconverter-cli --embedded` produces an Embedded pack; without the flag you get
a Reference one.

| Kind | Ships as | Trade |
|---|---|---|
| **Reference** | the `.ssab` plus its `.png` files beside it | one file per texture, shared between packs naming the same cellmap |
| **Embedded** | one self-contained `.ssab` | nothing to lose in transit; the encoded bytes stay resident for the life of the resource |

Both work here. The loader picks per texture, with Embedded winning, so a pack
that mixes the two is fine.
