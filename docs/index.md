---
layout: home
title: SSPlayerForReactNative
description: SpriteStudio 7 animation in React Native — one component, no animation code.

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
    details: The motion is authored visually in SpriteStudio 7 — bone rigs, mesh deform, masks, particles — and the player plays the exported file. No Animated or Reanimated timeline per part, no spritesheet to slice.
  - title: Raster, drawn natively
    details: It rigs and deforms raster sprite art, so hand-painted characters animate exactly as authored. A different fit from vector tools, and lighter than shipping a .gif or an .mp4.
  - title: Smooth, not locked to a frame rate
    details: The playhead is a float and the frame is built at the moment it is drawn, so motion follows your display's refresh rate and the speed you set.
  - title: One JS call per frame, per player
    details: The timeline, the geometry and the Skia draw calls happen in a Rust core and C++ under Nitro Modules (JSI). That is what lets a busy scene stay at 60 fps.
---

::: warning Not released yet
The npm package is not published, and nothing here has run on a **physical
device** — iOS simulator and Android emulator only. See
[Limitations & Scope](/limitations) for what draws today.
:::
