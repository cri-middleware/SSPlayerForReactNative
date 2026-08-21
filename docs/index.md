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

## From `.sspj` to the screen {#pipeline}

Conversion happens **once, at build time**, on your machine. There is no editor
integration and nothing converts at runtime — which makes the middle stage below
the one that is easy to underestimate: a pack is a *directory*, it travels as a
**native app asset**, and changing it means building the app again.

```mermaid
graph LR
    SS[".sspj / images"]

    subgraph Convert ["① Convert — once, on your machine"]
        WEB["ssconverter-web<br>browser"]
        GUI["SSConverterGUI<br>desktop"]
        CLI["ssconverter-cli<br>CLI / CI"]
    end

    PACK["pack directory<br>.ssab + .png / .ssqb"]

    subgraph Ship ["② Ship — as a native app asset"]
        PLUGIN["Expo config plugin"]
        BUILD["native build"]
    end

    subgraph Run ["③ Run"]
        VIEW["SpriteStudioView"]
        RT("libssruntime<br>Rust + C++ under JSI") -. "advance · bake" .-> VIEW
    end

    CANVAS{{"Skia canvas"}}

    SS --> WEB
    SS --> GUI
    SS --> CLI
    WEB --> PACK
    GUI --> PACK
    CLI --> PACK
    PACK --> PLUGIN
    PLUGIN --> BUILD
    BUILD --> VIEW
    VIEW -->|"draw"| CANVAS
    VIEW -. "pack changed · run ② again" .-> PLUGIN

    classDef gen stroke-dasharray:5 5;
    class PACK gen;
    classDef tool fill:#eef2ff,stroke:#818cf8,color:#1e1b4b;
    class WEB,GUI,CLI tool;
    classDef ship fill:#fef9c3,stroke:#eab308,color:#422006;
    class PLUGIN,BUILD ship;
```

Picking a converter, and what a pack directory has to keep intact, are both in
[Preparing assets](/setup/assets).
