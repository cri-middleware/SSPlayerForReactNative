---
title: Performance
description: What a frame actually costs, which thread pays for it, and the few places that add to it.
---

# Performance

## What a frame costs

A frame runs on the JS thread, in a `requestAnimationFrame` callback. Per
player, JavaScript makes **the same few calls into native code however complex
the animation is** — advance the clock, read the playback state, `drawInto` —
and no vertex ever crosses the JSI boundary.

Those calls are synchronous, though. Advancing the timeline, building the
geometry and recording the Skia draw calls all happen inside them, in the Rust
core and the C++ beside it, so that time is spent on the JS thread as well. Two
things follow, and they are worth designing around:

- **The JS thread's cost scales with how many players are on screen and with
  how much each one draws.** A 300-part character costs more than a 3-part
  logo. Skinned meshes and particles carry the most vertices, and a part with a
  PartColor tint, an `ss-*` shader or a mask is drawn on its own rather than
  with its batch.
- **The drawing cost scales with pixels.** The recorded frame is drawn off the
  JS thread, and effect and particle parts stack many large, mostly-transparent
  quads, so the same pixel is shaded over and over. The surface is the view's
  size times the device's pixel ratio, and nothing here decouples the two — a
  smaller view is less work.
- **A mask that moves costs a render of its own.** A player draws its mask and
  clipping parts into a coverage image first, as a separate render off the JS
  thread. The image is kept while those parts hold still, so a fixed window
  with an animation playing inside it pays once. A mask part that moves, or
  changes its cell or texture, pays again on every frame it does.

::: warning There are no device numbers behind this page
Nothing has been measured on a physical device: iOS Simulator and Android
emulator only, on a host whose CPU flatters the very side a phone struggles
with. Treat this as a cost model, not a benchmark — and measure a **release**
build, since a debug bundle swamps everything described here.
:::

## Many animations: one scene, not many views

`<SpriteStudioView>` owns a canvas and a frame loop. Twenty views is twenty
canvases and twenty clocks, on top of what the twenty players cost anyway.
`<SpriteStudioScene>` draws a whole cast into **one canvas off one clock**, and
a sprite renders nothing of its own — see
[Many animations: a scene](/usage/scene), which also has the `paused` prop worth
wiring to your app going to the background.

## A player that holds still costs next to nothing

A player that is not playing (never started, stopped, or finished) builds no
frame, and neither does a paused one with no effect or instance part, since
nothing in it can move. Its view keeps the picture it last drew until something
changes it: a seek, another animation, an override, a texture swap or a new
placement. A screen of still poses costs the JS thread a couple of cheap reads
per player a frame, and the UI thread nothing.

A paused player with an effect or instance part still advances, because parts
with independent playback keep running in a pause. `playing={false}` pauses; if
the pose is all you need, call `stop()` on the player through the ref instead.

## What a part follower adds

`useSsPartTransform`, and so every `<SpriteStudioPartAnchor>`, reads its part
on the frames the player shows: right after the view or the scene draws one,
inside that same loop. Each read is one `getPartTransform` call across the JSI
boundary (the name is resolved once per animation), and the shared value is
written only when the pose changes. A player that stands still shows no new
frame, so its followers cost nothing. In a scene, every member's followers are
read whenever any member moves, because the scene redraws them all. See
[Part overrides & following](/usage/parts).

## Loading is where the wait actually is

Parsing the `.ssab` is cheap and happens in C++ against bytes that never enter
the JS heap. **Decoding the atlases is not** — every texture is a PNG decode,
and that is the slow half. It runs on a worker thread, so neither the JS thread
nor the UI thread waits for it, and a view mounting against a cold cache shows
its `placeholder` while it happens. A decoded atlas then takes width × height ×
4 bytes of memory for as long as a player holds it.

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

Fitting against the authored canvas, the default, costs nothing. Measuring the
box instead (`frameScope`) walks the animation, baking a frame at a time, and
`'pack'` pays that walk per animation. Both are in [Basic playback](/usage/basic).
