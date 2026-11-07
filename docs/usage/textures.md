---
title: Textures & resources
description: Where atlases come from, replacing one at runtime, and paying the load cost before the mount.
---

# Textures & resources

A pack loads its own atlases and you can ignore this page entirely. It covers
the two cases where you cannot: replacing a texture, and making the load happen
before the mount rather than during it. Players of one pack already share its parsed file and decoded
atlases.

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
directories. A replacement *texture* is a single standalone image with nothing to
resolve against it, which is exactly what Metro is good at.
:::

`useSsTextures` is the hook behind the prop, exported for a caller that wants
the `SkImage`s. It returns `null` until every texture has been read and created as an `SkImage`, so you
can hold off drawing rather than flash a frame with a missing atlas; the pixels decode at the first
draw that uses them, unlike a pack's own atlases, which decode on a worker before they register.

### From code, at runtime

The `textures` prop is declarative — it describes the atlases in effect. When you
want to swap one **imperatively** instead — a costume the player earns mid-scene,
an expression driven by game state — reach the player through a ref and call
`setCellmapTexture`:

```tsx
const ref = useRef<SpriteStudioViewRef>(null)
// ...
ref.current?.player?.setCellmapTexture('Ringo', winterAtlas)   // swap
ref.current?.player?.setCellmapTexture('Ringo', null)          // back to the pack's own
```

`winterAtlas` is a Skia `SkImage` — what `useSsTextures` hands back, or one you decoded yourself — not a
`require()` or a URI. The player references it and never disposes it, so keep it alive for as long as
it is in effect.

This is what an avatar system is built on: one animation, and a wardrobe of
atlases you switch between, instead of a separate export per costume. Passing
`null` **restores** the pack's own atlas — it reloads nothing you have to
manage. `getCellmapTexture(name)` reads back the replacement in effect (the
override only, never the pack's own), and `getReplaceableTextureNames()` lists
every name you may pass — the cellmap names plus the texture *file* names an
authored texture change points at.

Three things worth knowing; the last is the SDK's own
[Runtime texture replacement](https://github.com/cri-middleware/SpriteStudio-SDK/blob/HEAD/libs/ssruntime/docs/50_features/30_external_resources.md#3-replacing-textures-at-runtime)
spec:

- **It reaches instance children.** The whole player tree draws through one
  texture table here, so a child part that samples the same cellmap picks up the
  swap too — there is nothing to set on the child separately.
- **It survives a `source` change**, re-keyed onto the new pack by name. Clear it
  with `null`, or let `dispose` drop it.
- **A texture change (`TCHG`) wins on the frames it applies to.** Those frames
  bind through the texture *file* name, not the cellmap name, so to affect them
  replace that name instead — it is in `getReplaceableTextureNames()`. And a
  replacement is assumed to share the original's **size and layout**: the cell
  rects stay in the original atlas's pixel space.

## The registry

`SsTextureRegistry` maps a cellmap-name hash to the paint its batches draw with.
Each player owns one, reachable as `player.textures`:

```tsx
player.textures.register('Ringo', someSkImage)
```

A registry passed through `SpriteStudioPlayerOptions` is shared by every player that receives it, for a
`SpriteStudioPlayer` you construct yourself (the view and the sprite always make their own). Atlases are
shared between players anyway; what a shared registry adds is that one `setCellmapTexture` or `register`
reaches all of them, and that two packs naming a cellmap alike draw with whichever atlas registered
first. Share it only between players of one pack. `register` takes the cellmap
name and hashes it through the runtime; `registerByHash` takes a hash you already
have.

::: warning Never hash a name yourself
A hash taken from a name must come from `SsRuntimeModule.hashString`; `register` and
`setCellmapTexture` already call it, and `registerByHash` takes one you got from it.
:::

## Preloading

Parsing the `.ssab` happens in C++, and for a bundled or file source against bytes that never enter the
JS heap (a URL source is fetched into an `ArrayBuffer` first). Decoding the atlases is different — **every texture is a PNG decode**, and that is
the slow half. A view that mounts against a cold cache shows its `placeholder`
while the atlas arrives.

```tsx
import { ssPreload, ssUnload } from 'react-native-spritestudio'

await ssPreload(SsAssets['Ringo/Ringo'])   // before the navigation
ssUnload(SsAssets['Ringo/Ringo'])          // when the screen is gone
```

`ssPreload` warms the resource cache (the parsed `.ssab`) and the atlas cache (the decoded images) and
keeps only those entries. Calling it twice for one source is safe and does the work once.

`ssUnload` drops the preload's own lease, not everybody's: a pack still mounted
somewhere stays loaded. `ssClearCaches()` drops the lot, which is what an app
under memory pressure wants.

## When a texture does not resolve

A missing texture does not throw: the batch is skipped, so the symptom is a part that is simply not
there. A dev build warns on the console; in production `player.lastTextureReport` is what says so.

```tsx
console.log(player.lastTextureReport?.unresolved)
// ['characters/ringo.png']
```

See [Troubleshooting](/troubleshooting#a-part-is-missing-or-nothing-draws).

## Checking for leaks

Native handles are not garbage collected. `ssCheckForLeaks(source)` loads and disposes the pack `cycles`
times (8 by default, `{ cycles }` to change it) and reports whether the counts came back. It empties
both caches before it measures and again after, so anything `ssPreload` warmed is gone when it returns.

```tsx
const result = await ssCheckForLeaks(SsAssets['Ringo/Ringo'])
if (result.leaked || result.registryLeaked) console.warn(result)
```

`ssLiveHandles()` is the raw counts, `{ resources, contexts }`. Both ship in the package, so they run on
a device.
