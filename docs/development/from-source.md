---
title: Working from a checkout
description: Getting the repository running — the native core, the sample packs, and the example app.
---

# Working from a checkout

For **SDK and Player developers**: anyone changing this package, changing the
Rust core underneath it, or wanting to see the player run before the npm release
exists.

If you only want to *use* the package in your own app, you want
[Installation](/setup/install) instead — nothing on this page is part of that.

## Clone it

```bash
git clone https://github.com/cri-middleware/SSPlayerForReactNative.git
cd SSPlayerForReactNative
git submodule update --init --recursive
npm install
```

The submodule is `SpriteStudio-SDK/` — the Rust core, referred to throughout the
repository as **the Brain**. npm workspaces, deliberately not pnpm: an isolated
node_modules layout breaks Metro, CMake and podspec path resolution.

## Get the Brain

`native/` is gitignored, so a fresh checkout has no native core at all.

```bash
npm run download-sdk
```

That installs the release pinned in `scripts/SDK_VERSION.txt` and **needs no
Rust toolchain**. It skips the work when what is already installed matches the
pin, so it is safe to re-run.

**Only when you are changing the Brain itself** do you need the other one:

```bash
npm run build-runtime -- build=release
```

`build-runtime` builds from the `SpriteStudio-SDK/` submodule into the same
layout, stamped `<tag>+submodule-<sha>` so the two can never be confused. It
needs Rust. On Windows it covers the Android slice only — the iOS xcframework
needs Xcode, so `download-sdk` is the complete answer there.

Both scripts take `key=value` arguments and honour `$SSSDK`, which points at an
SDK checkout other than the submodule:

```bash
npm run build-runtime -- platform=ios build=release
npm run download-sdk -- --force
```

::: warning Build release before measuring anything
A `build=debug` Brain swamps every other cost and flattens the differences a
benchmark exists to find. It has produced a wrong conclusion here before.

The two installs are also told apart on purpose: `download-sdk` writes
`native/VERSION` and `native/BUILD_MODE`, `build-runtime` writes neither and
deletes the latter. That is what lets `prepack` refuse to publish a tarball
built against a locally-built or debug Brain.
:::

## Convert the sample packs

```bash
npm run deploy-examples
```

`.sspj` → `.ssab` for the example app, via `ssconverter-cli` (needs Rust). It
also refreshes `example/src/ss-assets.ts`, the generated manifest the example's
subject list is read from.

Sources come from the SDK's own `tests/` and, optionally, from
`example/SpriteStudio_Source/` — third-party art this repository does not ship,
reported and skipped when absent.

## Run the example

```bash
cd example
npx expo prebuild --platform ios
npx expo run:ios        # or --platform android && npx expo run:android
```

The example app is the rendering verification surface — one screen, one feature
card per capability. What each subject proves, and the optional `MaskInstance`
sample, are covered in
[`example/README.md`](https://github.com/cri-middleware/SSPlayerForReactNative/tree/main/example).

## Checks

| Task | Command |
|---|---|
| Typecheck (package + example) | `npm run typecheck` |
| FlatBuffers accessors current + read path sound (needs `flatc`) | `npm run check-framedata` |
| Mask drawing, and a mask crossing into an instance child (macOS) | `npm run check-mask` |
| Instance slots keep stepping while out of the draw plan | `npm run check-hidden` |
| `ss-*` shaders compile, and their arithmetic (macOS) | `npm run check-shader` |
| Web stub barrel imports clean and throws (any OS, no Brain) | `npm run check-web-barrel` |
| Nitro codegen is current | `npm run generate-nitro-code` → `git diff --exit-code packages/*/nitrogen` |
