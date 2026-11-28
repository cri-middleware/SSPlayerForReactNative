---
title: API Reference — where to start
description: The four to start from — SpriteStudioView, SpriteStudioScene with SpriteStudioSprite, SsPlayerProps and SsPlacement — then the names for the player itself, buttons, labels and outlines, loading ahead of time, diagnostics and textures.
---

# Where to start

The [generated reference](https://cri-middleware.github.io/SSPlayerForReactNative/api/) has everything. This page says which of it you
need, and in roughly the order you will need it.

## The four you will use

| | |
|---|---|
| [`SpriteStudioView`](https://cri-middleware.github.io/SSPlayerForReactNative/api/) | One animation, its own canvas and frame loop. The default. |
| [`SpriteStudioScene`](https://cri-middleware.github.io/SSPlayerForReactNative/api/) + `SpriteStudioSprite` | Many animations, one canvas and one clock. |
| `SsPlayerProps` | Everything about *which animation and how it plays* — shared by both components, so they cannot drift. |
| `SsPlacement` | Everything about *where it is drawn* — `fit`, `align`, `frame`, `frameScope`, `offset`, `scale`, `flipX`, `flipY`. |

## When you need the player itself

`SpriteStudioPlayer` is the transport, with no drawing backend in it. Reach it
through a ref (`ref.current.player`) to seek, switch animation or read the
content box imperatively.

It is also where the imperative-only calls live — the ones with no prop. Runtime
texture replacement is one: `setCellmapTexture(name, image)` swaps the atlas a
cellmap draws from (and `null` restores the pack's own), `getCellmapTexture(name)`
reads back the swap, and `getReplaceableTextureNames()` lists what you may pass.
See [Textures](./usage/textures.md#from-code-at-runtime).

## Buttons, labels and outlines

`SpriteStudioButton`, from `react-native-spritestudio-ui`, makes the view a
button whose states play label sections — see [UI buttons](./usage/ui.md), and
`SsUiStateDriver` for its state rule without the component. It is built on
calls the player has for any app: `getLabelTable(animation?)` and
`setAnimationSectionByLabel(startLabel, endLabel)` for a section named by
labels, and `getPartQuad(part)` and `hitTestPart(x, y, parts?)` for where a part
is drawn ([A part's outline and hit testing](./usage/parts.md#part-outline)).

## Loading ahead of time

`ssPreload(source)` warms the resource and atlas caches by loading a throwaway
player, so a view that mounts against a warm cache draws on its first frame.
`ssUnload(source)` gives that back; `ssClearCaches()` drops the lot.

## Diagnostics

- `ssCheckForLeaks(source)` — loads and disposes N times and reports whether the
  native handle counts came back — a leak check you can run in your own app.
- `SsRuntimeModule.liveHandles` — the counts themselves.
- `player.lastTextureReport` — what the last load could not resolve. A missing
  texture does not throw: the batch is skipped, so the symptom is a part that is
  simply not there. A dev build warns; a release build does not, so read this.

## Textures

`SsTextureRegistry` maps a cellmap-name hash to the paint its batches draw with.
You rarely touch it — a pack loads its own — but supplying one lets several
players share atlases, and `register(name, image)` replaces a texture at
runtime.
