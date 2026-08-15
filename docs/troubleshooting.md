---
title: Troubleshooting
description: Nothing draws, a part is missing, the animation stopped — told apart by their causes.
---

# Troubleshooting

Most failures here look identical from the outside: **a blank rectangle**. This
page separates them by cause. Check the console first — the package warns for
several of these by name, and in a dev build the texture warning names the exact
files it could not find.

## Nothing draws at all

### The pack never loaded

Pass `onError` and look. A `source` that names nothing throws there rather than
silently drawing an empty canvas:

```tsx
<SpriteStudioView source={…} onError={(e) => console.error(e)} onLoad={() => …} />
```

The most common cause is a path that is right relative to your source file and
wrong relative to the **asset root**. A pack is addressed by its path inside the
directory the config plugin ships, not by its position in your project tree.

::: tip Stop hand-writing the strings
`npx react-native-spritestudio assets --out src/ss-assets.ts` generates a typed
manifest, so a wrong key is a **type error** instead of a blank canvas.
:::

### The pack never reached the device

- **Did you `npx expo prebuild` after adding the plugin?** The plugin copies
  pack directories in as native assets; without a prebuild there is nothing to
  copy from.
- **Are you in Expo Go?** It cannot run this package at all — there is native
  code in it. `npx expo run:ios` / `run:android`.
- **Did you `require()` the pack?** That is not a valid source. A pack is a
  *directory* and Metro ships a dependency graph, not directories.
- **Did you add `ssab` to `assetExts`?** Remove it. Teaching Metro about the
  extension produces exactly the flattened, sibling-less copy that cannot work.

### You changed the pack and nothing changed

**Assets do not Fast Refresh.** A pack is an app asset, not a bundle entry, so a
re-converted `.ssab` needs a native build. The plugin re-copies on every build,
so a rebuild is enough — you do not need a fresh `prebuild`.

## A part is missing, or nothing draws

Both are the same fault at different scales: **a texture did not resolve**.
`drawInto` skips a batch it has no paint for, so one missing atlas is one
missing part and a pack that resolved none of its textures draws nothing.

In a dev build the package already warns:

```
react-native-spritestudio: 'ss/Ringo/Ringo.ssab' resolved 1/2 textures.
Missing: characters/effects.png. Those parts will not draw.
```

In production, read it yourself:

```tsx
player.lastTextureReport?.unresolved   // ['characters/effects.png']
```

The fix is almost always that the `.png` did not travel next to the `.ssab`.
Every `image_path` resolves **relative to the `.ssab`**, so the converter's
whole output directory has to reach the device intact. Converting to an
**Embedded** pack (`--embedded`) sidesteps it by putting the atlas inside the
file.

## An Instance part's child is missing

The package warns for this one too:

```
react-native-spritestudio: instance pack 'Enemy' referenced by '…' could not be
loaded — those parts will not draw.
```

An Instance part reaches a **sibling pack by name**. Same rule as the textures:
it has to be in the output directory beside the `.ssab` that names it.

## The sprite draws nothing and warns

```
<SpriteStudioSprite> must be inside a <SpriteStudioScene>.
```

It draws through the scene's canvas, so outside one there is nothing to draw
into. See [Many animations: a scene](/usage/scene).

## A part override does nothing

The name is checked against the **current animation**, and a miss warns:

```
react-native-spritestudio: no part called 'hatt' in 'walk' — its override is ignored.
```

If the name is right and the override still reverts a moment later, it is
`priority` — see [Part overrides](/usage/parts#how-long-an-override-lasts).

## The animation froze mid-play

**An exception in an event handler stops the clock.** Events are delivered from
inside `advance()`, which runs in the frame loop, so a throw from your
`onUserData` / `onAudio` / `onSignal` handler stops the animation — and in a
scene, every sprite in it.

That is deliberate: the exception is yours and it reaches your error path rather
than being swallowed here. Wrap the handler body if you would rather it did not.

## Everything vanished after a seek

`seek(NaN)` reaches the core unexamined — NaN fails every comparison, so the
clamp passes it through and the frame it produces has no parts in it. The
symptom reads as a renderer fault rather than a bad argument. Check the
arithmetic feeding `seek`.

## A follower sits in the top-left corner

`useSsPartTransform` starts at the origin and `valid` is false until the part
resolves — an unknown name never becomes true. Gate on it:

```tsx
opacity: transform.value.valid ? 1 : 0
```

## The build fails, or the app crashes on launch

### Two copies of a native module

Two copies is not a duplicated dependency — it is **two autolinked pods fighting
over one JSI registration**. Check with `npm ls @shopify/react-native-skia`, and
in a monorepo pin every peer at the root.

### Android, on an x86 emulator

The Rust core ships no 32-bit `x86` slice. The config plugin narrows
`reactNativeArchitectures` for you, and the prebuild logs
`dropped x86 from reactNativeArchitectures` when it does — use an `x86_64` or
`arm64-v8a` emulator image. Never hardcode `abiFilters`.

### You fixed the native side and nothing changed

Two Android caches survive a source fix: `android/build/generated/autolinking/`
and `android/app/build/generated/autolinking/`. Delete both.

## The web bundle throws

Rendering a player under react-native-web throws an error naming this package,
and that is correct — **this package does not play animations on web**. The web
entry exists so an app shipping web *as well as* native can build its web
bundle. For SpriteStudio on the web, use
[SSPlayerForWeb](https://github.com/cri-middleware/SSPlayerForWeb).

## No sound

`onAudio` reports what to play; it never plays it. See
[Audio is reported, not played](/usage/events#audio-is-reported-not-played).
