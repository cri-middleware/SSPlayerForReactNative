---
title: Build Guide
description: Building SpriteStudio Player for React Native from a checkout, using a changed package in an app, and checking it on a simulator or a device.
---

# Build Guide

For whoever works on SpriteStudio Player for React Native, or changes it for an app of their own:
anyone changing this package or the Rust core underneath it. How the layers fit together, and why
the player is built the way it is, is on
[How the Player Is Put Together](/development/architecture).

If you only want to *use* the package in your own app, you want
[Installation](/setup/install) instead — nothing on this page is part of that.

## Clone it

You need git, Node 24 or newer, and pnpm at the version `packageManager` in `package.json` names;
Rust as well for `deploy-examples`, `build-runtime` and the host checks.

```bash
git clone https://github.com/cri-middleware/SSPlayerForReactNative.git
cd SSPlayerForReactNative
git submodule update --init --recursive
pnpm install
```

The submodule is `SpriteStudio-SDK/` — the Rust core, referred to throughout the
repository as **the Brain**. The workspace is pnpm's, at the version
`packageManager` in `package.json` names (`corepack enable` picks it up on Node 24; Node 25 and later do
not ship Corepack, so install that pnpm version yourself).

## Get the Brain

`packages/react-native-spritestudio/native/` is gitignored, so a fresh checkout has no native core at all.

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

`build-runtime` builds from the `SpriteStudio-SDK/` submodule into the same layout, but writes no
`VERSION` or `BUILD_MODE` (it removes them), so the two can never be confused. It needs Rust with the
targets of the platforms it builds, Xcode for the iOS half, and the NDK and `cargo-ndk` for the Android
half; `platform=all` is the default, so name one when you have only one toolchain. On Windows it covers the Android slice only — the iOS xcframework
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

The two installs are also told apart on purpose: `download-sdk` records the
release's version and build mode beside what it installs, and `build-runtime`
records neither and clears the build mode. That is what lets `prepack` refuse to
publish a tarball built against a locally-built or debug Brain.
:::

## Convert the sample packs

```bash
pnpm run deploy-examples
```

`.sspj` → `.ssab` for the example app, via `ssconverter-cli` (needs Rust). It
also refreshes the generated manifest the example's subject list is read from.

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

The **Blending** tab drives motion blending by hand: crossfade or cut on track 0, an overlay on track 1
with its alpha, blend and loop count, track 0's speed and loop count, the sync of both tracks, and
whether the outgoing side fires. Its status line names track 0's animation, which changes the moment a
crossfade starts, and lists the last events with the source that fired them.

## Checks {#checks}

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

`check-framedata`, `check-hidden`, `check-motion` and `check-mask` build a host Brain from the
`SpriteStudio-SDK/` submodule, so they need Rust, and they read the packs `pnpm run deploy-examples`
converts into `example/assets/ss/` — run that first. `check-framedata` is also what builds
`tools/.build/ssbake_check`.

## Using a changed Player {#using-a-changed-player}

A git URL cannot install this package: neither the native core nor the built
`lib/` is tracked in git, so the install would produce a package whose `main`
points at a file that is not there and whose native side has nothing to link.
Build the tarballs a release publishes instead, from the pinned Brain:

```bash
pnpm run download-sdk
pnpm run deploy-examples
pnpm run build-release        # -> release-dist/npm/, a tarball per package
```

`build-release` also regenerates the Nitro bindings and requires them to match what is committed, then
runs the host checks (`check-hidden`, `check-motion`, and on macOS `check-mask` and `check-shader`;
`check-framedata` too when `flatc` is installed) before it packs. Those need Rust and the packs
`deploy-examples` converts; `skip=codegen,checks` packs without them. It packs only the Brain
`scripts/SDK_VERSION.txt` pins, and `prepack` refuses one built locally or in debug — one from
`build-runtime`, or a debug build — so a tarball always carries the release's native core. To run a
Brain you built yourself, use the example app: it takes the package from the workspace, native core
and all.

In the app, install the dependencies [Installation](/setup/install) lists alongside the package, but
not the package itself, which `expo install` would fetch from npm; then install the tarball, and the
UI package's beside it if the app uses `react-native-spritestudio-ui`. From there, build as that page
goes on, from its step 3.

```bash
npx expo install react-native-skia react-native-nitro-modules react-native-reanimated react-native-worklets
npm install <checkout>/release-dist/npm/react-native-spritestudio-<version>.tgz
npm install <checkout>/release-dist/npm/react-native-spritestudio-ui-<version>.tgz   # only with the UI package
```

## Checking against the real host {#checking-against-the-real-host}

`run-ios` and `run-android` build in Release with the bundle embedded, so neither
Metro nor a dev launcher is involved; what is left is looking at the screen.

- **Choose the subject in code.** A script cannot tap the simulator, so change the
  subject the example's player screen starts on (its `useState('Basic')`; with
  `config=debug`, Metro's fast refresh applies it) and take the picture with
  `xcrun simctl io <udid> screenshot`.
- **With `config=debug` only**, expo-dev-menu's onboarding sheet covers half the
  screen. `xcrun simctl spawn <udid> defaults write jp.co.cri-mw.spritestudio.ssplayer.example EXDevMenuIsOnboardingFinished -bool YES`
  dismisses it for good.
- **A Release build's `console.log` does not reach the iOS log**: show results in a
  `Text` and read the screenshot. On Android they reach logcat as `ReactNativeJS`.
- **Measuring.** The first launch after a build is an outlier: terminate and launch
  three times and take the median. Compare CPU time only within one build — the
  threads of a lighter build move to the efficiency cores, where the same work
  shows up as 1.6 to 2 times the samples — and compare counts (render passes),
  alternating host micro-benchmarks or host Metal benchmarks that wait for the GPU
  across builds. Before comparing the UI thread's cost, make the frames it actually
  drew equal: count the times the UI thread takes up a new frame picture, not the
  pictures published, since two published between its turns reach it as one.
- **The Android emulator renders in software**
  (`emulator -avd <avd> -no-window -no-audio -gpu swiftshader_indirect`), so its UI
  thread is far heavier than a device's. Launch the app with
  `adb shell am start -n jp.co.crimw.spritestudio.ssplayer.example/.MainActivity`,
  and stop the emulator when you are done (`adb emu kill`): it keeps the CPU busy.
- **iOS composites in Display P3 on a wide-gamut screen**, the simulator included —
  RN Skia picks the surface from the screen — so additive overlaps of pure red and
  blue saturate towards white there and stay magenta on Android. Android's is the
  sRGB result.
- **A build that succeeds does not prove Skia is in.** Without RN Skia found, the
  build quietly sets `SSPLAYER_ENABLE_SKIA_DIRECT=0`. After an RN Skia bump, look
  for `SSPLAYER_ENABLE_SKIA_DIRECT=1` in Android's `.cxx/**/compile_commands.json`,
  and in DerivedData's `SsPlayer.build/**/*-common-args.resp` on iOS.
- **A host check failing with "`.ssab` failed verification" is stale data**, not
  Skia: the example's packs are older than the Brain. Bring the submodule to the pin
  and run `deploy-examples`.

The layers, the native side and the reasons that span them are on
[How the Player Is Put Together](/development/architecture).
