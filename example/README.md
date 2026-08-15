# Example app

The Expo app this repository verifies rendering on. One screen, one player, and
a *Subject* picker that steps through a feature card per SpriteStudio capability.

**This is not a standalone project.** It consumes the workspace package, and it
needs the native core and the converted packs before it can show anything — both
are produced by scripts at the repository root.

## Running it

From the **repository root**, not from here:

```bash
git submodule update --init --recursive
npm install
npm run download-sdk        # the native core, from the pinned SDK release
npm run deploy-examples     # .sspj -> .ssab for this app
```

`download-sdk` needs **no Rust toolchain**. Use `npm run build-runtime -- build=release`
instead only when you are changing the Rust core itself.

Then from here:

```bash
npx expo prebuild --platform ios
npx expo run:ios            # or: npx expo prebuild --platform android && npx expo run:android
```

**Expo Go cannot run this app** — the package contains native code, so the
prebuild is required. On Android the prebuild should log
`dropped x86 from reactNativeArchitectures`; the Rust core ships no 32-bit x86
slice, so use an `x86_64` or `arm64-v8a` emulator image.

## The screen

| Control | What it does |
|---|---|
| **Subject** | Picks a feature card. Each is built so a failure names itself. |
| **Pack file** | Appears when the subject has more than one `.ssab`. |
| **Animation** | Read out of the loaded pack. |
| **Textures** | Switches between a pack with its atlas **embedded** in the `.ssab` and one keeping it as a **sibling** file — both texture routes, in one place. |
| **Leak check** | 8 load/dispose cycles against `liveHandles`, then 8 loads into **one** player against the texture registry — the reload path the handle counts cannot see. |

Below the stage, the readouts show the timeline keys firing and the live native
handle counts.

Subjects are the feature cards `Basic`, `BlendMode`, `PartsColor`, `Mask`,
`Mesh`, `Shape`, `Shader`, `Effect`, `Instance`, `UserData`, `Sound` and
`Signal`; the real character `Ringo` and `RingoInstances` (that same cast
mounted as instance parts); and `ParticleEffect`, the heaviest packs.

**Read `Mask` and `BlendMode` on both platforms.** The only platform-specific
defect this screen has ever caught was iOS-only.

## The subject list is generated

`src/ss-assets.ts` is written by `npm run deploy-examples`, and the screen reads
its subject list out of it. Nothing in the app can list a directory at runtime,
so this manifest is the only enumeration there is — a subject with nothing
deployed leaves the screen rather than loading nothing and blaming the renderer.

**Do not hand-edit it.** To verify it matches what is deployed:

```bash
npx react-native-spritestudio assets --check --out src/ss-assets.ts
```

## The optional `MaskInstance` subject

One subject's source is **not in this repository**: `MaskInstance`, three scenes
that mask the stage and mount their characters as instance parts. It is the only
asset anywhere that exercises a mask crossing into an instance child, which is
what `npm run check-mask`'s fourth check runs against — and that check reports
itself skipped without it.

It is third-party sample art and the licence to redistribute it is not ours to
give. Download **OPTPiX SpriteStudio Basic Samples** from
[the SpriteStudio site](https://www.webtech.co.jp/spritestudio/) and copy its
`Mask` project in:

```
example/SpriteStudio_Source/Mask/        <- Mask.sspj and everything beside it
```

Then `npm run deploy-examples` picks it up and refreshes the manifest itself.

> [!WARNING]
> The committed manifest is the **without-optional-packs** state, so adding this
> leaves `src/ss-assets.ts` modified on purpose — **do not commit it**, and
> `assets --check` will call it stale for the same reason.

## Audio

`src/player/audio.ts` is the reference wiring for `onAudio`, using `expo-audio`
as *this app's* dependency — the package itself brings no audio stack. It solves
the three things anyone writing their own will hit: an `asset`-scheme sibling has
no path an audio library can open, `loop_num` is a *count* where most APIs take a
boolean, and iOS is silent under the ringer switch without
`setAudioModeAsync({ playsInSilentMode: true })`.
