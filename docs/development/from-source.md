---
title: Working from a checkout
description: Getting the repository running — the native core, the sample packs, and the example app.
---

# Working from a checkout

For **SDK and Player developers**: anyone changing this package or the Rust
core underneath it.

If you only want to *use* the package in your own app, you want
[Installation](/setup/install) instead — nothing on this page is part of that.

## Clone it

```bash
git clone https://github.com/cri-middleware/SSPlayerForReactNative.git
cd SSPlayerForReactNative
git submodule update --init --recursive
pnpm install
```

The submodule is `SpriteStudio-SDK/` — the Rust core, referred to throughout the
repository as **the Brain**. The workspace is pnpm's, at the version
`packageManager` in `package.json` names (`corepack enable` picks it up).

## What you just cloned

```
SSPlayerForReactNative/
├── SpriteStudio-SDK/                   <- [submodule] the Rust core ("the Brain")
├── scripts/                            <- .js shim -> .sh / .ps1 per host OS
│   ├── SDK_VERSION.txt                 <- pinned SDK release tag
│   ├── download-sdk.*                  <- install the pinned release (NO Rust needed)
│   ├── build-runtime.*                 <- build the Brain from the submodule instead
│   ├── deploy-examples.*               <- convert the SDK's test projects to .ssab
│   ├── generate-nitro-code.*           <- run nitrogen over the Layer 1 spec
│   └── generate-fbs-code.*             <- run flatc over the .fbs schemas
├── packages/react-native-spritestudio/ <- the npm package
│   ├── src/specs/SsRuntime.nitro.ts    <- Layer 1 spec (nitrogen input)
│   ├── src/core/ src/player/ src/view/ <- Layers 2, 3 and 4
│   ├── cpp/                            <- Nitro implementation, the baker, the Skia draw path
│   ├── plugin/                         <- Expo config plugin: ships pack directories
│   ├── bin/                            <- npx react-native-spritestudio assets
│   ├── nitrogen/                       <- [generated, committed, do not hand-edit]
│   └── native/                         <- [gitignored] libssruntime + headers
├── example/                            <- Expo app: Viewer, Part follow and Blending screens
├── tools/                              <- host-side checks (FrameData, baker, mask, hidden, shader)
└── docs/                               <- this site
```

## Get the Brain

`native/` is gitignored, so a fresh checkout has no native core at all.

```bash
pnpm run download-sdk
```

That installs the release pinned in `scripts/SDK_VERSION.txt` and **needs no
Rust toolchain**. It skips the work when what is already installed matches the
pin, so it is safe to re-run.

**Only when you are changing the Brain itself** do you need the other one:

```bash
pnpm run build-runtime build=release
```

`build-runtime` builds from the `SpriteStudio-SDK/` submodule into the same
layout, stamped `<tag>+submodule-<sha>` so the two can never be confused. It
needs Rust. On Windows it covers the Android slice only — the iOS xcframework
needs Xcode, so `download-sdk` is the complete answer there.

`build-runtime` takes `key=value` arguments and honours `$SSSDK`, which points
at an SDK checkout other than the submodule. `download-sdk` reads no checkout,
and its one option is `--force`:

```bash
pnpm run build-runtime platform=ios build=release
pnpm run download-sdk --force
```

::: warning Build release before measuring anything
A `build=debug` Brain swamps every other cost and flattens the differences a
benchmark exists to find.

The two installs are also told apart on purpose: `download-sdk` writes
`native/VERSION` and `native/BUILD_MODE`, `build-runtime` writes neither and
deletes the latter. That is what lets `prepack` refuse to publish a tarball
built against a locally-built or debug Brain.
:::

## Convert the sample packs

```bash
pnpm run deploy-examples
```

`.sspj` → `.ssab` for the example app, via `ssconverter-cli` (needs Rust). It
also refreshes `example/src/ss-assets.ts`, the generated manifest the example's
subject list is read from.

Sources come from the SDK's own `tests/` and from whatever is under
`example/SpriteStudio_Source/`, which this repository does not ship: a project
you put there to look at on a device shows up as its own subject, and the
optional third-party `MaskInstance` sample goes there too.

## Run the example

```bash
pnpm run run-ios         # or: pnpm run run-android
```

Each prebuilds `example/`, builds it in Release — the JS bundle embedded, so no
Metro — and launches it on a simulator or a connected device. `device=<name>`
picks one and `config=debug` serves the JS from Metro instead. Underneath they are
`expo prebuild` and `expo run:ios|android`, run in `example/`.

The example app is the rendering verification surface — its Viewer screen has
one feature card per capability. What each subject proves, how to look at a
project of your own, and the optional `MaskInstance` sample are covered in
[`example/README.md`](https://github.com/cri-middleware/SSPlayerForReactNative/tree/HEAD/example).

## Checks

| Task | Command |
|---|---|
| Typecheck (package + example) | `pnpm run typecheck` |
| FlatBuffers accessors current + read path sound (needs `flatc`) | `pnpm run check-framedata` |
| Mask drawing, and a mask crossing into an instance child (macOS) | `pnpm run check-mask` |
| Instance and effect slots keep stepping while out of the draw plan, and a hidden effect builds no particles | `pnpm run check-hidden` |
| A player keeps ticking while its track stack moves the pose, and only then | `pnpm run check-motion` |
| `ss-*` shaders compile, and their arithmetic (macOS) | `pnpm run check-shader` |
| The Nitro glue compiles for iOS (macOS, Xcode) and Android (the NDK) | `pnpm run check-glue` |
| Web stub barrel imports clean and throws (any OS, no Brain) | `pnpm run check-web-barrel` |
| Layer 2 imports nothing from `react` / `react-native` (any OS, no install) | `pnpm run check-layers` |
| No line break between two Japanese characters in the Markdown (any OS, no install) | `pnpm run check-ja-breaks` |
| The Skia-guarded draw path compiles, without linking (Windows, the NDK) | `tools/check-skia-compile.ps1` |
| Nitro codegen is current | `pnpm run generate-nitro-code` → `git diff --exit-code packages/*/nitrogen` |
