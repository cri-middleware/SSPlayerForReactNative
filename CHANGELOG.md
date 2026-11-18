# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [7.0.0-beta.1] - 2026-11-18

### Added
- **Initial public release.** `react-native-spritestudio`, a React Native player for SpriteStudio
  animations (`.ssab`). The SpriteStudio-SDK Rust runtime and the Skia draw calls run in C++ under
  Nitro Modules (JSI); no vertex passes through JavaScript.
- **Components**: `<SpriteStudioView>`, an ordinary view, and `<SpriteStudioScene>`, which draws a
  whole cast through one canvas and one clock.
- **Drawing**: Normal, Mesh, Shape, Instance and Effect parts; mask and clipping on Normal, Mesh and
  Shape targets; the full framebuffer blend table; PartColor; the thirteen `ss-*` integration shaders.
- **Playback** that follows the display's refresh rate and the speed you set, not the authored fps.
- **Events**: user data, audio cues and signals as callbacks. Audio is reported, not played.
- **Per-part overrides** to recolour, hide or swap a part at runtime, and `fit` / `align` placement.
- **UI**: `react-native-spritestudio-ui`, a package of its own, makes an animation a button whose
  states play its labels, pressable on its parts and still under reduced motion. The player gains
  the calls it is built on: `setAnimationSectionByLabel` / `getLabelTable`, and `getPartQuad` /
  `hitTestPart`.
- **Motion blending**: layer animations on tracks and crossfade between them, through the player
  (`crossfade`, `setTrackAnimation`, `addTrackSource`, per-track speed, loop count and the rest) or
  the `transitionMs` prop. Every event carries the `source` that fired it.
- **Platforms**: iOS 15.1+ and Android API 26+ with Vulkan, on the New Architecture only, with an Expo config
  plugin. On the web the package imports safely but does not play.
- **Documentation**: bilingual (EN/JA) documentation site.

### Known Limitations
- `Nines` and `Text` parts are not drawn, and a masked Effect draws unmasked. These and the other
  constraints are listed in [Limitations & Scope](./docs/limitations.md).
- Constraints inherited from the shared runtime are documented in
  [Shared Limitations](https://cri-middleware.github.io/SpriteStudio-Docs/sdk/limitations/).
