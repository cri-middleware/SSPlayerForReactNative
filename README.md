# SSPlayerForReactNative

SpriteStudio 7 animation player for React Native.

> [!WARNING]
> **Phase 0 — not usable yet.** This repo currently contains the measurement
> spike that decides the architecture, not a player. There is no
> `<SpriteStudioView>`, no blend modes, no masks, no effects. See
> [`docs/phase0-spike.md`](docs/phase0-spike.md) for what has been measured and
> [ROADMAP](#roadmap) for what comes next.

Design: *SpriteStudio-SDK v7 React Native Player アーキテクチャ設計書*.

## What Phase 0 established

The design doc assumed the open question was **where to bake the geometry** —
in JS like the Flutter Player, or natively. Measurement says that was the wrong
question:

| variant | 128 players, 8704 verts | fps |
|---|---:|---:|
| (a) JS bake → `Skia.MakeVertices` | 29.7 ms | 33.5 |
| (b) native bake → `Skia.MakeVertices` | 30.3 ms | 32.9 |
| **(c) native bake **and** native draw** | **5.8 ms** | **60.0** |

`Skia.MakeVertices` takes `SkPoint[]` — an array of JSI *host objects* — and
unmarshals it one vertex at a time. Both (a) and (b) pay that, so moving the
bake changes nothing. (c) removes it entirely.

**So Layer 1 owns the drawing, not just the geometry.** JS's per-frame job is
one call per player.

## Repository layout

```
SSPlayerForReactNative/
├── SpriteStudio-SDK/                  <- [submodule] the Rust core ("the Brain")
├── scripts/
│   ├── SDK_VERSION.txt                <- pinned SDK release tag
│   ├── download-sdk.{js,sh,ps1}       <- install the pinned release (NO Rust needed)
│   ├── build-runtime.{js,sh}          <- build the Brain from the submodule instead
│   ├── deploy-examples.{js,sh,ps1}    <- convert the SDK's test projects to .ssab
│   └── generate-nitro.{js,sh,ps1}     <- run nitrogen over the Layer 1 spec
├── packages/react-native-ssplayer/    <- the npm package
│   ├── src/specs/SsRuntime.nitro.ts   <- Layer 1 spec (nitrogen input)
│   ├── cpp/                           <- Nitro implementation + the Skia bridge
│   ├── nitrogen/                      <- [generated, committed, do not hand-edit]
│   └── native/                        <- [git-ignored] libssruntime + headers
├── example/                           <- Expo app: the Phase 0 measurement harness
├── tools/check-framedata.sh           <- guards the hand-written FlatBuffers offsets
└── docs/phase0-spike.md               <- the measurement
```

## Getting started

Every entry point is a `.js` shim that dispatches to `.sh` or `.ps1` for the
host OS, so these work on macOS, Linux and Windows alike.

```bash
git submodule update --init --recursive
npm install

npm run download-sdk        # the Brain, from the pinned SDK release
npm run deploy-examples     # .sspj -> .ssab for the example app

cd example
npx expo prebuild --platform ios
npx expo run:ios
```

`download-sdk` needs **no Rust toolchain**. Use `npm run build-runtime` instead
only when you are changing the Brain itself — it builds from the submodule and
writes the same layout, stamped `<tag>+submodule-<sha>` so the two never get
confused.

### Requirements

- React Native 0.79+ / React 19+, **New Architecture only**
- `react-native-nitro-modules`, `@shopify/react-native-skia`,
  `react-native-reanimated` 4+
- **Expo Go does not work** — the package contains native code, so a prebuild
  (CNG) is required
- iOS 14+ / Android API 21+. Desktop, tvOS and visionOS are out of scope

## Development notes

**Do not hand-edit `packages/react-native-ssplayer/nitrogen/`.** Change
`src/specs/SsRuntime.nitro.ts` and run `npm run generate-nitro`. The output is
committed so consumers never need nitrogen.

**`npm run check-framedata`** diffs the hand-written FlatBuffers offsets in
`cpp/SsFrameData.hpp` against flatc-generated accessors over a real `.ssab`.
Run it after any `framedata.fbs` change. Needs `flatc` (`brew install
flatbuffers`) and is macOS/Linux only — it is a developer guard, not part of any
build.

**Measure the Brain in release.** A `build=debug` libssruntime swamps every
other cost and flattens the differences the spike exists to find; see the
"計測上の落とし穴" section of `docs/phase0-spike.md`.

## Roadmap

- **Phase 0 — done.** L1/L2 boundary decided by measurement.
- **Phase 1.** Basic playback on the (c) architecture: Layer 2 (React-free),
  Layer 3 (transport/events), Layer 4 (`<SpriteStudioView>`). Normal parts,
  normal blending, single texture. Android's native draw path.
- **Phase 2.** All blend modes, masks, PartColor, Mesh, Shape, Effect,
  Instance, `SHDR` shaders in SkSL, audio, events, Reanimated integration,
  Expo config plugin, React Native Directory listing.
- **Phase 3.** react-native-web, docs site, runtime texture replacement.

## License

MIT
