---
title: Performance
description: What a frame actually costs, and the few places where the one-call-per-player rule stops holding.
---

# Performance

## What a frame costs

Per frame, per player, **JavaScript makes one call** — `drawInto`. Advancing the
clock, building the geometry and issuing the Skia draw calls all happen below
it, in the Rust core and the C++ beside it, and no vertex ever crosses the JSI
boundary.

Two things follow, and they are worth designing around:

- **The JS cost scales with how many players are on screen, not with how complex
  they are.** A 300-part character and a 3-part logo cost the JS thread the
  same.
- **The drawing cost scales with pixels.** Effect and particle parts stack many
  large, mostly-transparent quads, so the same pixel is shaded over and over.
  The surface is the view's size times the device's pixel ratio, and nothing
  here decouples the two — a smaller view is less work.

::: warning There are no device numbers behind this page
Nothing has been measured on a physical device: iOS Simulator and Android
emulator only, on a host whose CPU flatters the very side a phone struggles
with. Treat this as a cost model, not a benchmark — and measure a **release**
build, since a debug bundle swamps everything described here.
:::

## Many animations: one scene, not many views

`<SpriteStudioView>` owns a canvas and a frame loop. Twenty views is twenty
canvases and twenty clocks, which is the one arrangement the rule above cannot
save you from. `<SpriteStudioScene>` draws a whole cast into **one canvas off
one clock**, and a sprite renders nothing of its own — see
[Many animations: a scene](/usage/scene), which also has the `paused` prop worth
wiring to your app going to the background.

## The one API that adds a frame loop

`useSsPartTransform` is the exception to everything above. Each hook instance
starts a **second `requestAnimationFrame` beside the view's**, and reads through
`getPartTransform(partName)` — a string across the JSI boundary, every frame,
per part. It is the one consumer-facing API that reintroduces exactly the
per-frame JS work the rest of the design removes.

That is a fine price for a health bar pinned over a character's head. It is not
a fine price for twenty parts, and it is worth knowing before you reach for it a
second time. See [Part overrides & following](/usage/parts).

## Loading is where the wait actually is

Parsing the `.ssab` is cheap and happens in C++ against bytes that never enter
the JS heap. **Decoding the atlases is not** — every texture is a PNG decode,
and that is the slow half. A view mounting against a cold cache shows its
`placeholder` while it happens.

- **Warm the cache before the navigation** with `ssPreload` —
  [Preloading](/usage/textures#preloading).
- **Share one registry between players** so several draw from one set of
  atlases, rather than decoding the same cellmap twice —
  [Textures & resources](/usage/textures).
- **Remember what an Embedded pack costs.** Its encoded bytes stay resident for
  the life of the resource, on top of the decoded texture. A Reference pack
  keeps one file per texture and shares it between packs naming the same
  cellmap — [Reference and Embedded packs](/setup/assets#reference-and-embedded-packs).

## Measuring the box is not free either

Fitting the art walks the animation, baking a frame at a time. `frame` supplies
the box and skips the walk entirely; `frameScope: 'pack'` buys a stable scale
across animations and costs a walk per animation. Both are in
[Basic playback](/usage/basic).
