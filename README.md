# SpriteStudio Player for React Native

Play [SpriteStudio](https://www.webtech.co.jp/spritestudio/) 7 animations in
React Native, on the New Architecture.

> [!WARNING]
> **Phase 0 — not usable yet.** This repository currently holds the measurement
> spike that decided the architecture, not a player. There is no
> `<SpriteStudioView>`, no blend modes, masks or effects; the npm package is not
> published. See [ROADMAP.md](ROADMAP.md) for what lands when, and
> [docs/phase0-spike.md](docs/phase0-spike.md) for what has been measured.

## What Phase 0 established

The design doc assumed the open question was **where to bake the geometry** — in
JS like the Flutter Player, or natively. Measurement said that was the wrong
question. 512 players / 32960 vertices, iOS simulator, release on both sides:

| variant | total ms | fps |
|---|---:|---:|
| (a) JS bake → `Skia.MakeVertices` | 50.1 | 20.0 |
| (b) native bake → `Skia.MakeVertices` | 49.7 | 20.1 |
| **(c) native bake *and* native draw** | **10.2** | **60.0** |

`Skia.MakeVertices` takes `SkPoint[]` — an array of JSI *host objects* — and
unmarshals it one vertex at a time. Both (a) and (b) pay that, so moving the
bake buys nothing: they stay within 1% of each other at every load, and their
cost is strictly linear in instance count. (c) is sublinear, so the gap widens —
2.7× at 128 players, 4.9× at 512.

**Layer 1 therefore owns the drawing, not just the geometry**, and JS's
per-frame job is one call per player.

## Repository layout

```
SSPlayerForReactNative/
├── SpriteStudio-SDK/                   <- [submodule] the Rust core ("the Brain")
├── scripts/
│   ├── SDK_VERSION.txt                 <- pinned SDK release tag
│   ├── download-sdk.{js,sh,ps1}        <- install the pinned release (NO Rust needed)
│   ├── build-runtime.{js,sh,ps1}       <- build the Brain from the submodule instead
│   ├── deploy-examples.{js,sh,ps1}     <- convert the SDK's test projects to .ssab
│   └── generate-nitro-code.{js,sh,ps1} <- run nitrogen over the Layer 1 spec
├── packages/react-native-spritestudio/ <- the npm package
│   ├── src/specs/SsRuntime.nitro.ts    <- Layer 1 spec (nitrogen input)
│   ├── cpp/                            <- Nitro implementation + the Skia bridge
│   ├── plugin/                         <- Expo config plugin: ships pack directories
│   ├── nitrogen/                       <- [generated, committed, do not hand-edit]
│   └── native/                         <- [gitignored] libssruntime + headers
├── example/                            <- Expo app: the Phase 0 measurement harness
├── tools/check-framedata.sh            <- guards the generated FlatBuffers accessors
└── docs/phase0-spike.md                <- the measurement
```

## Quick start

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

The example app is the benchmark harness: it runs the whole variant ×
instance-count matrix on launch and renders the results table. Set
`AUTO_SWEEP = false` in `example/App.tsx` to drive it by hand instead.

### Working on the Brain

`download-sdk` needs **no Rust toolchain**. Use `build-runtime` only when you
are changing the Brain itself — it builds from the submodule into the same
layout, stamped `<tag>+submodule-<sha>` so the two never get confused. On
Windows it covers the Android slice only (the iOS xcframework needs Xcode);
`download-sdk` is the complete answer there.

Scripts take `key=value` arguments and honour `$SSSDK` to point at an SDK
checkout other than the submodule, matching the sibling Players:

```bash
npm run build-runtime -- platform=ios build=release
npm run download-sdk -- --force
npm run deploy-examples -- --embedded
```

> [!IMPORTANT]
> **Build the Brain in release before measuring anything.** A `build=debug`
> `libssruntime` swamps every other cost and flattens the differences a
> benchmark exists to find — it already produced one wrong conclusion during
> Phase 0.

## Requirements

| | |
|---|---|
| React Native | 0.79+ — **New Architecture only** |
| React | 19+ |
| Peer deps | `react-native-nitro-modules`, `@shopify/react-native-skia` **2.11+**, `react-native-reanimated` 4+ |
| iOS | 14+ |
| Android | API 24+ (React Native 0.79+ ships prefabs built for 24) |
| SpriteStudio-SDK | `scripts/SDK_VERSION.txt` |

**Expo Go does not work.** The package contains native code, so a prebuild
(CNG) is required. Windows, tvOS and visionOS are out of scope; see
[ROADMAP.md](ROADMAP.md#-deferred) for why.

`.sspj` → `.ssab` conversion is a host-side step using the SDK's
`ssconverter-cli` — no converter is bundled, because React Native has no editor
to host an importer in.

## Shipping animations

**A pack is a directory, not a file.** A `.ssab` names its textures, the
external packs its Instance parts reach and — through a `.ssqb` — the packs it
sequences, all by paths relative to itself. So `ssconverter-cli`'s output
directory is what has to reach the device intact.

Metro cannot carry one: it bundles only what a `require()` names and never walks
a directory, and Android's packager then flattens what it did name into `res/`.
So the pack directories are shipped as **native app assets** instead. Point the
config plugin at them:

```json
{
  "expo": {
    "plugins": [["react-native-spritestudio", { "assets": ["./assets/ss"] }]]
  }
}
```

and address a pack by path inside that root:

```tsx
<SpriteStudioView source="ss/overall/Basic.ssab" animation="anime_1" />
```

The textures come with it — the loader resolves each `image_path` next to the
`.ssab`, and takes the embedded atlas instead when the pack was converted with
`--embedded`. Nothing else has to be supplied.

A `source` can also be a filesystem path or `file://` URI (a download, an
unpacked bundle) or an `http(s)` URL (a dev server, a CDN); siblings resolve the
same way in all three. A `require()`d module is **not** a source — that is the
form with no directory behind it.

The plugin re-copies on every build, so re-running `ssconverter-cli` needs only
a rebuild, not a fresh `prebuild`. Changing an asset does mean a native build,
though: assets do not Fast Refresh.

## Documentation

| | |
|---|---|
| [AGENTS.md](AGENTS.md) | Working guide: architecture, invariants, **Traps**, verification. Start here before changing anything. |
| [ROADMAP.md](ROADMAP.md) | Phases, exit criteria, deliberate non-goals |
| [docs/phase0-spike.md](docs/phase0-spike.md) | The measurement, its method and its pitfalls |
| [SpriteStudio-SDK/libs/ssruntime/docs/](SpriteStudio-SDK/libs/ssruntime/docs/) | The Brain's own docs — the DrawBatch contract, masks, FrameData |

## Related repositories

The same `.ssab` runs on every one of these:

- [SpriteStudio-SDK](https://github.com/cri-middleware/SpriteStudio-SDK) — the Rust core
- [SSPlayerForFlutter](https://github.com/cri-middleware/SSPlayerForFlutter) — the closest reference for this port
- [SSPlayerForGodot](https://github.com/cri-middleware/SSPlayerForGodot)
- [SSPlayerForUnity](https://github.com/cri-middleware/SSPlayerForUnity)
- [SSPlayerForWeb](https://github.com/cri-middleware/SSPlayerForWeb)

## License

BSD-3-Clause — see [LICENSE.md](LICENSE.md).
