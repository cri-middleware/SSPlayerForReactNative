---
title: Basic playback
description: The props on SpriteStudioView, what a source may be, and how the art is placed.
---

# Basic playback

```tsx
<SpriteStudioView
  source="ss/overall/Basic.ssab"
  animation="anime_1"
  fit="contain"
  style={{ flex: 1 }}
/>
```

`<SpriteStudioView>` is an ordinary React Native view that happens to contain a
Skia canvas and a frame loop. Position, size, clip and animate it like any
other. For **many** animations at once, reach for
[a scene](/usage/scene) instead — twenty views is twenty canvases and twenty
clocks.

## What a `source` may be

| Form | Example |
|---|---|
| a path inside your asset root | `"ss/overall/Basic.ssab"` |
| a filesystem path or `file://` URI | a download, an unpacked bundle |
| an `http(s)` URL | a dev server, a CDN |

Siblings — textures, the external packs Instance parts reach — resolve the same
way in all three. A `require()`d module is **not** a source; see
[Preparing assets](/setup/assets).

::: tip A remote `.ssab` is untrusted input
The buffer is verified before the native runtime sees it, so a truncated
download is rejected rather than parsed. What is *not* checked is the reference
graph — see [Limitations](/limitations#untrusted-packs).
:::

## Transport

`playing`, `speed` and `loop` are declarative props; `loop={0}` is forever and
`loop={1}` plays once. For imperative control, reach the Layer 3 player through
the ref:

```tsx
const ref = useRef<SpriteStudioViewRef>(null)
ref.current?.player?.setAnimation('walk')
```

The player owns the playback state and nothing above it mirrors that — the props
are passthrough. [Transport](/usage/transport) covers seeking, direction,
ping-pong and the semantics that are not the obvious ones.

## Placement

The art has a **content box** in its own units, and placement decides where that
box lands in the view.

| Prop | Default | Means |
|---|---|---|
| `fit` | `'contain'` | How the box is scaled: `contain`, `cover` or `none`. `<Image resizeMode>`'s vocabulary. |
| `align` | `'center'` | Which point of the box lands on the matching point of the view. |
| `offset` | — | Pixels from where `fit`/`align` put it. Under `fit="none"`, measured from the view's centre. |
| `scale` | `1` | A multiplier **on top of** the fit's scale. |
| `flipX` / `flipY` | `false` | Mirror. |

`align` takes `center`, `top`, `bottom`, `left`, `right` and the four corners.

### Measuring, and skipping it

The content box is not free: measuring walks the animation, baking a frame at a
time. Three props control it.

| Prop | Means |
|---|---|
| `frame` | The box, supplied by you. **Skips measuring entirely.** |
| `frameScope` | `'animation'` (default) measures the one playing; `'pack'` unions every animation in the file. |
| `measureFrames` | Caps the walk. Default `0`, which is one authored cycle. |

`frameScope: 'pack'` costs a walk per animation and draws smaller, and buys the
one thing the default cannot: a **stable** scale, so a character does not resize
itself when its animation changes. The gap can be large — `Ringo`'s `attack1`
spans 383×527 player-local units while the pack's union spans about 1030×878,
because its `dead` animation slides the character most of a screen to the right.

Supply `frame` when you already know the box and want neither cost.

## The first frame

Until the pack has loaded **and at least one texture has registered**, there is
nothing drawable. `drawInto` skips every batch, so the honest thing to show is
not a blank rectangle:

```tsx
<SpriteStudioView source={…} placeholder={<ActivityIndicator />} />
```

`onLoad` fires when the pack is ready and `onError` when it is not. The way to
make that window short enough not to matter is
[`ssPreload`](/customize/textures#preloading).
