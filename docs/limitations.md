---
title: Limitations & Scope
description: What this port draws today, what it does not, and what it will not.
---

# Limitations & Scope

## Not released

The npm package is not published, and nothing here has run on a **physical
device** — iOS simulator and Android emulator only.

## Draws today

Normal, Mesh, Shape, Instance and Effect parts; mask and clipping on Normal and
Shape targets; the full framebuffer blend table; PartColor; the thirteen `ss-*`
integration shaders; the override layer; user-data, audio and signal events; the
animation lifecycle; `fit`/`align` placement; the resource and atlas caches;
`<SpriteStudioScene>`; the Expo config plugin.

## Not yet

- **`Nines` and `Text`** parts.
- **Masked Mesh and masked Effect** — both draw *unmasked*. The mask replay
  places its coverage sample by inverting one affine quad's UV; a mesh needs that
  texcoord channel for its atlas, and an effect is a cloud of quads rather than
  one.
- **A child's own mask writers while a caller's mask reaches into it.** The
  caller's coverage is handed down and the child references it; its own writers
  then write nothing for that frame. The SDK calls the two "a separate track",
  and this port runs one. A sub-animation that masks itself is unaffected as long
  as no mask reaches it from outside.
- **The Instance part's own PartColor** — the older players apply it as a
  whole-subtree tint; this port does not do it at all.
- **The Reanimated tick** — part transforms already publish as a shared value,
  but the frame loop is still `requestAnimationFrame` on the JS thread.

## Platforms

| | |
|---|---|
| iOS / Android | supported |
| web | **nothing draws** — but installing the package does not break a web build: the web entry is a stub, so an app shipping both halves still bundles, and only rendering a player there throws. [SSPlayerForWeb](https://github.com/cri-middleware/SSPlayerForWeb) is SpriteStudio on the web. |
| macOS | may simply work — RN Skia and Nitro both support it. Not in CI, not guaranteed. |
| tvOS / visionOS | blocked on the runtime: the Rust targets are Tier 3 and the SDK's XCFramework has no slices. |
| Windows | no route — neither Nitro nor RN Skia supports react-native-windows. |

## Expo Go, and Fast Refresh

Expo Go cannot run this package: it contains native code, so a prebuild is
required. And a pack is an app asset rather than a bundle entry, so **changing an
asset needs a native build** — assets do not Fast Refresh.

## Untrusted packs

A `source` may be an `http(s)` URL, so this is worth stating precisely.

**The buffer is verified before the native runtime sees it.** A truncated
download, a half-written cache or a deliberately malformed `.ssab` is rejected
rather than parsed.

**The reference graph is not.** An Instance part that mounts its own animation
has no finite expansion, and nothing stops the load recursing until the stack
gives out. That is a deliberate non-goal: which pack an app plays is the app's
own business, and a cyclic reference is a content bug its author can see in the
editor.

So: the structure is checked, the content is not. If your app downloads `.ssab`
at runtime, serve it over a channel you control.

## Audio

Reported, not played — see [Events](/usage/events#audio-is-reported-not-played).
