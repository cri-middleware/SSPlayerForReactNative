# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [7.0.0-beta.1] - Unreleased

### Added
- **Initial public release.** `react-native-spritestudio`, a React Native player for SpriteStudio
  animations (`.ssab`). The SpriteStudio-SDK Rust runtime and the Skia draw calls run in C++ under
  Nitro Modules (JSI); JavaScript makes one call per player per frame.
- **Components**: `<SpriteStudioView>`, an ordinary view, and `<SpriteStudioScene>`, which draws a
  whole cast through one canvas and one clock.
- **Drawing**: Normal, Mesh, Shape, Instance and Effect parts; mask and clipping on Normal, Mesh and
  Shape targets; the full framebuffer blend table; PartColor; the thirteen `ss-*` integration shaders.
- **Playback** that follows the display's refresh rate and the speed you set, not the authored fps.
- **Events**: user data, audio cues and signals as callbacks. Audio is reported, not played.
- **Per-part overrides** to recolour, hide or swap a part at runtime, and `fit` / `align` placement.
- **Platforms**: iOS 15.1+ and Android API 24+, on the New Architecture only, with an Expo config
  plugin. On the web the package imports safely but does not play.
- **Documentation**: bilingual (EN/JA) documentation site.

### Known Limitations
- The API may change without notice while the package is in beta.
- `Nines` and `Text` parts are not drawn, and a masked Effect draws unmasked. These and the other
  constraints are listed in [Limitations & Scope](./docs/limitations.md).
- Constraints inherited from the shared runtime are documented in
  [Shared Limitations](https://cri-middleware.github.io/SpriteStudio-Docs/sdk/limitations/).
