---
title: Limitations & Scope
description: What this port draws today, what it does not, and what it will not.
---

# Limitations & Scope

## Draws today

Normal, Mesh, Shape, Instance and Effect parts; mask and clipping on Normal,
Mesh and Shape targets; the full framebuffer blend table; PartColor; the thirteen `ss-*`
integration shaders; the override layer; user-data, audio and signal events; the
animation lifecycle; motion blending (tracks, crossfades, weighted sources); `fit`/`align` placement; the resource and atlas caches;
`<SpriteStudioScene>`; the Expo config plugin.

## Not yet

- **`Nines` and `Text`** parts.

## Motion blending

**Instance and effect children are not layered.** Tracks blend the character whose player you
hold; a part that plays another animation runs its own playback from the frame the root
composes, and which key drives it across a crossfade on track 0 is outside motion blending.
See [Motion blending](/usage/motion-blending#two-limits).

## Masks

**At most 96 mask writers at once.** Every mask and clipping part of an
instance tree shares one budget, and an instance's count again each time it
is placed. Past 96 the rest are ignored, with a warning.

## Platforms

| | |
|---|---|
| iOS / Android | supported |
| web | **nothing draws** — but installing the package does not break a web build: the web entry is a stub, so an app shipping both halves still bundles, and only rendering a player there throws. [SpriteStudio Player for Web](https://github.com/cri-middleware/SSPlayerForWeb) is SpriteStudio on the web. |
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
