---
layout: home
title: SpriteStudio Player for React Native
description: SpriteStudio animation in React Native — one component, no animation code.

hero:
  name: SpriteStudio Player
  text: for React Native
  tagline: Drop artist-authored 2D animation into your app — one component, no animation code, no video files.
  actions:
    - theme: brand
      text: Quick Start
      link: /setup/quickstart
    - theme: alt
      text: Installation
      link: /setup/install
    - theme: alt
      text: GitHub
      link: https://github.com/cri-middleware/SSPlayerForReactNative

# The details are rendered as HTML, not Markdown, so code is <code>.
features:
  - title: Zero animation code
    details: The motion is authored visually in SpriteStudio — bone rigs, mesh deform, masks, particles — and the player plays the exported file. No Animated or Reanimated timeline per part, no spritesheet to slice.
    link: /setup/quickstart
    linkText: Quick Start
  - title: Painted art, smooth at any refresh rate
    details: It animates hand-painted raster (PNG/bitmap) sprite art — a different fit from vector animation tools, and lighter than a .gif or .mp4 — with a float playhead evaluated at draw time so motion follows your display's refresh rate and playback speed.
    link: /usage/transport
    linkText: Playback control
  - title: No vertex passes through JavaScript
    details: The timeline, the geometry and the Skia draw calls happen in a Rust core and C++ under Nitro Modules (JSI), and a frame costs no React render. JavaScript makes the same few native calls per frame however complex the animation is.
    link: /usage/performance
    linkText: Performance
  - title: Events, overrides and dynamic costumes
    details: React to timeline events from JavaScript, recolour, hide or swap individual parts at runtime, or replace the atlas a cellmap draws from via <code>player.setCellmapTexture(name, image)</code> (<code>null</code> restores the original) without re-exporting.
    link: /usage/events
    linkText: Events
  - title: Blend animations instead of cutting
    details: Crossfade between animations with <code>transitionMs</code>, layer tracks over what is playing, mixed in or added on top (e.g. a facial expression or hit reaction over an idle loop), and mix track weights at runtime.
    link: /usage/motion-blending
    linkText: Motion blending
  - title: Buttons drawn by animations
    details: <code>&lt;SpriteStudioButton&gt;</code>, in <code>react-native-spritestudio-ui</code>, is a view that is a button. Press, hover and focus each play a section of one animation, a press can count on chosen parts only, and it follows the system's reduced-motion setting and screen readers.
    link: /usage/ui
    linkText: UI buttons
---

[SpriteStudio](https://www.webtech.co.jp/eng/spritestudio/) is a 2D animation tool: an artist adds bones, mesh deformation and effects to
their own illustrations, and this player plays the result in your app.

::: tip No SpriteStudio data of your own yet?
The [official sample data](https://www.webtech.co.jp/help/ja/spritestudio7/download/sample/) works as-is — that page is
Japanese only, but the downloads themselves are language-neutral.
[Ringo](https://www.webtech.co.jp/help/ja/spritestudio7/download/sample/#ringo) is a good character sample, and
[Particle](https://www.webtech.co.jp/help/ja/spritestudio7/download/sample/#Perticle_sample) is a good one if you want effects.
To make your own, you use SpriteStudio itself — see [its site](https://www.webtech.co.jp/eng/spritestudio/).
:::

## Related Repositories

- [SpriteStudio Docs](https://cri-middleware.github.io/SpriteStudio-Docs/) — the documentation portal for the SDK and its official players.
- [SpriteStudio-SDK](https://github.com/cri-middleware/SpriteStudio-SDK) — the SDK itself, providing `libssruntime` / `libssconverter`.
- [SSConverterGUI](https://github.com/cri-middleware/SSConverterGUI) — a standalone desktop GUI for converting `.sspj` without a player.
