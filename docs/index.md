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

features:
  - title: Zero animation code
    details: The motion is authored visually in SpriteStudio — bone rigs, mesh deform, masks, particles — and the player plays the exported file. No Animated or Reanimated timeline per part, no spritesheet to slice.
  - title: Raster, drawn natively
    details: It rigs and deforms raster sprite art, so hand-painted characters animate exactly as authored. A different fit from vector tools, and lighter than shipping a .gif or an .mp4.
  - title: Smooth, not locked to a frame rate
    details: The playhead is a float and the frame is built at the moment it is drawn, so motion follows your display's refresh rate and the speed you set.
  - title: No vertex passes through JavaScript
    details: The timeline, the geometry and the Skia draw calls happen in a Rust core and C++ under Nitro Modules (JSI), and a frame costs no React render. That is what lets a busy scene stay at 60 fps.
  - title: Dynamic costumes
    details: Swap the atlas a cellmap draws from at runtime — a colour variant, an equipment change, an avatar built from parts — without re-exporting the animation. `player.setCellmapTexture(name, image)`, and `null` puts the original back.
---

## Related Repositories

- [SpriteStudio Docs](https://cri-middleware.github.io/SpriteStudio-Docs/) — the documentation portal for the SDK and its official players.
- [SpriteStudio-SDK](https://github.com/cri-middleware/SpriteStudio-SDK) — the SDK itself, providing `libssruntime` / `libssconverter`.
- [SSConverterGUI](https://github.com/cri-middleware/SSConverterGUI) — a standalone desktop GUI for converting `.sspj` without a player.
