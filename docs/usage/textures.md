---
title: Textures & resources
description: Where atlases come from, replacing one at runtime, and paying the load cost before the mount.
---

# Textures & resources

A pack loads its own atlases and you can ignore this page entirely. It covers
the three cases where you cannot: replacing a texture, sharing one between
players, and making the load happen before the mount rather than during it.

## Where a pack's atlases come from

A pack is one of two kinds — **Reference** or **Embedded**, the SDK's names. For
a Reference pack the loader resolves each `image_path` **relative to the `.ssab`
itself**; for an Embedded one it reads the atlas out of the file. Embedded wins
per texture, so a pack that mixes the two is fine.

| Kind | Ships as | Trade |
|---|---|---|
| **Reference** | the `.ssab` plus its `.png` files beside it | one file per texture, shared between packs naming the same cellmap |
| **Embedded** | one self-contained `.ssab` | nothing to lose in transit; the encoded bytes stay resident for the life of the resource |

## Replacing a texture

The `textures` prop puts your own atlas in front of the pack's — a palette swap,
a skin, a character recoloured without re-exporting:

```tsx
<SpriteStudioView
  source={SsAssets['Ringo/Ringo']}
  textures={require('./ringo-winter.png')}
/>
```

A bare source is the shorthand for a pack with **one** cellmap, which is the
common case and the one where you would otherwise have to know a name only the
`.ssab` carries. With several, key them by cellmap name — as the pack carries
it, **without** the `.ssce` extension:

```tsx
textures={{
  Ringo: require('./ringo-winter.png'),
  Effects: { uri: 'https://cdn.example.com/effects.png' },
}}
```

::: info `require()` is allowed here, and nowhere else
A *pack* cannot be named with one — it is a directory, and Metro does not ship
directories. A replacement *texture* is a single standalone image with no
siblings to resolve, which is exactly what Metro is good at.
:::

`useSsTextures` is the hook behind the prop, exported for a caller that wants
the decoded `SkImage`s. It returns `null` until every texture has decoded, so
you can hold off drawing rather than flash a frame with a missing atlas.

## The registry

`SsTextureRegistry` maps a cellmap-name hash to the paint its batches draw with.
Each player owns one, reachable as `player.textures`:

```tsx
player.textures.register('Ringo', someSkImage)
```

Supplying a shared registry through `SpriteStudioPlayerOptions` is what lets
several players draw from **one** set of atlases. `register` takes the cellmap
name and hashes it through the Brain; `registerByHash` takes a hash you already
have.

::: warning Never hash a name yourself
Every key the Rust core hands over is pre-baked with its own FNV-1a, and
`SsRuntimeModule.hashString` exposes exactly that function. A second implementation is
one more than can be kept in agreement.
:::

## Preloading

Parsing the `.ssab` happens in C++ against bytes that never enter the JS heap.
Decoding the atlases does not — **every texture is a PNG decode**, and that is
the slow half. A view that mounts against a cold cache shows its `placeholder`
while the atlas arrives.

```tsx
import { ssPreload, ssUnload } from 'react-native-spritestudio'

await ssPreload(SsAssets['Ringo/Ringo'])   // before the navigation
ssUnload(SsAssets['Ringo/Ringo'])          // when the screen is gone
```

`ssPreload` warms both caches by loading a whole player and throwing it away —
there is no shorter route, because the texture list is read out of the `.ssab`
by a context, and a context *is* a player. What survives is exactly the cache
entries. Calling it twice for one source is safe and does the work once.

`ssUnload` drops the preload's own lease, not everybody's: a pack still mounted
somewhere stays loaded. `ssClearCaches()` drops the lot, which is what an app
under memory pressure wants.

::: warning One known sharp edge
`ssUnload` can evict an atlas another preload is still holding, when two packs
share a cellmap name — the retain is a boolean rather than a count. The pack is
still listed as preloaded and its atlas is gone. Tracked in the
[ROADMAP](https://github.com/cri-middleware/SSPlayerForReactNative/blob/main/ROADMAP.md).
:::

## When a texture does not resolve

A missing texture is **silent by construction**: the batch is skipped, so the
symptom is a part that is simply not there. `player.lastTextureReport` is what
says so out loud.

```tsx
console.log(player.lastTextureReport?.unresolved)
// ['characters/ringo.png']
```

See [Troubleshooting](/troubleshooting#a-part-is-missing-or-nothing-draws).

## Checking for leaks

Native handles are not garbage collected. `ssCheckForLeaks(source)` loads and
disposes N times (8 by default) and reports whether the counts came back:

```tsx
const result = await ssCheckForLeaks(SsAssets['Ringo/Ringo'])
```

`ssLiveHandles()` is the raw counts. Both ship in the package rather than living
in this repo's example app, because the platform where a leaked handle actually
costs anything is a device — and a check that only exists here cannot be run
there.
