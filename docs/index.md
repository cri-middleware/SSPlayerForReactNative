---
layout: home
title: SpriteStudio Player for React Native
description: SpriteStudio animation in React Native — one component, no animation code.

hero:
  name: SpriteStudio Player
  text: for React Native
  tagline: Drop artist-authored 2D raster animation into your app — one component, no animation code, no video files.
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

features:
  - title: Zero animation code
    details: The motion is authored visually in SpriteStudio — bone rigs, mesh deform, masks, particles — and the player plays the exported file. No Animated or Reanimated timeline per part, no spritesheet to slice.
  - title: Raster art, smooth at any refresh rate
    details: It animates hand-painted raster (PNG/bitmap) sprite art — a different fit from vector tools like Lottie, and lighter than a .gif or .mp4 — with a float playhead evaluated at draw time so motion follows your display's refresh rate and playback speed.
  - title: No vertex passes through JavaScript
    details: The timeline, the geometry and the Skia draw calls happen in a Rust core and C++ under Nitro Modules (JSI), and a frame costs no React render. That is what lets a busy scene stay at 60 fps.
  - title: Events, overrides and dynamic costumes
    details: React to timeline events from JavaScript, recolour, hide or swap individual parts at runtime, or replace the atlas a cellmap draws from via `player.setCellmapTexture(name, image)` (`null` restores the original) without re-exporting.
  - title: Blend animations instead of cutting
    details: Crossfade between animations with `transitionMs`, layer tracks over what is playing, mixed in or added on top (e.g. a facial expression or hit reaction over an idle loop), and mix track weights at runtime.
---

## Related Repositories

- [SpriteStudio Docs](https://cri-middleware.github.io/SpriteStudio-Docs/) — the documentation portal for the SDK and its official players.
- [SpriteStudio-SDK](https://github.com/cri-middleware/SpriteStudio-SDK) — the SDK itself, providing `libssruntime` / `libssconverter`.
- [SSConverterGUI](https://github.com/cri-middleware/SSConverterGUI) — a standalone desktop GUI for converting `.sspj` without a player.
