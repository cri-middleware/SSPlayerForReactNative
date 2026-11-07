---
title: Basic playback
description: The props on SpriteStudioView, what a source may be, and how the art is placed.
---

# Basic playback

```tsx
<SpriteStudioView
  source="ss/Ringo/Ringo.ssab"
  animation="wait1"
  fit="contain"
  style={{ width: '100%' }}
/>
```

`<SpriteStudioView>` is an ordinary React Native view that happens to contain a
Skia canvas and a frame loop. Position, size, clip and animate it like any
other; `testID`, the accessibility props, `pointerEvents` and `onLayout` reach
the view as they would a `<View>`. For **many** animations at once, reach for
[a scene](/usage/scene) instead — twenty views is twenty canvases and twenty
clocks.

## What a `source` may be

| Form | Example |
|---|---|
| a path into a folder the config plugin ships, that folder's name first | `"ss/Ringo/Ringo.ssab"` |
| a filesystem path or `file://` URI | a download, an unpacked bundle |
| an `http(s)` URL | a dev server, a CDN |

The files a pack names — textures, the external packs Instance parts reach — resolve the same
way in all three. A `require()`d module is **not** a source; see
[Preparing assets](/setup/assets).

::: tip A remote `.ssab` is untrusted input
The buffer is verified before the native runtime sees it, so a truncated
download is rejected rather than parsed. What is *not* checked is the reference
graph — see [Limitations](/limitations#untrusted-packs).
:::

## Transport

`playing`, `speed` and `loop` are declarative props; `loop={0}` is forever and
`loop={1}` plays once. For imperative control, reach the player through
the ref:

```tsx
const ref = useRef<SpriteStudioViewRef>(null)
ref.current?.player?.setAnimation('walk')
ref.current?.player?.play() // setAnimation selects; play() starts it
```

The player owns the playback state and nothing above it mirrors that — the props
are passthrough. [Transport](/usage/transport) covers seeking, direction,
ping-pong and the semantics that are not the obvious ones.

## Size

Given no size, the view is the size of its box — the authored canvas, one unit
to a point — as an `<Image>` of a bundled file is. Given one of `width` and
`height`, the box's aspect ratio sets the other. Given both, or a `flex`, the
style decides alone.

`SsAssets` is the typed manifest `npx react-native-spritestudio assets` generates; each value is such a
path ([Quick Start](/setup/quickstart)).

```tsx
<SpriteStudioView source={SsAssets['Ringo/Ringo']} />                          // 800×600
<SpriteStudioView source={SsAssets['Ringo/Ringo']} style={{ width: '100%' }} /> // full width, 4:3
```

The box is known once the pack loads. Until then an unsized view is 0 high, and
a `placeholder` in it shows nothing — size the view if the placeholder matters.

## Placement

The art has a **content box** in its own units, and placement decides where that
box lands in the view.

| Prop | Default | Means |
|---|---|---|
| `fit` | `'contain'` | How the box is scaled: `contain`, `cover` or `none`. `<Image resizeMode>`'s vocabulary. `none` is no fit: scale 1, origin at the view's centre; `align`, `frame` and `frameScope` have no effect, so place it with `offset` and `scale`. |
| `align` | `'center'` | Which point of the box lands on the matching point of the view. |
| `offset` | — | Pixels from where `fit`/`align` put it. Under `fit="none"`, measured from the view's centre. |
| `scale` | `1` | A multiplier **on top of** the fit's scale. |
| `flipX` / `flipY` | `false` | Mirror. |

`align` takes `center`, `top`, `bottom`, `left`, `right`, `top-left`, `top-right`, `bottom-left` and
`bottom-right`.

### Where the box comes from

With nothing supplied, the box is the **authored canvas of the animation the
view loaded on**: its size, placed against the origin by its pivot. It costs
nothing, and switching animations does not move it — canvases differ within a
pack (`Ringo`'s `dead` is 1300 wide against 800), and a box that followed them
would shrink the character as it dies. A new `source` takes it again. It is where
the artist composed, not where the art goes, so a pack whose art overflows its
canvas overflows the view too.

| Prop | Means |
|---|---|
| `frame` | The box, supplied by you: `{ x, y, width, height }` in player-local units, Y down, `x`/`y` being its top-left corner. It wins over `frameScope`. |
| `frameScope` | Measure the box instead: `'animation'` walks the one playing, `'pack'` unions every animation in the file. Omitted, nothing is measured. |
| `measureFrames` | Caps the walk. Default `0`, which is one authored cycle. |

Measuring is not free: it walks the animation, baking a frame at a time. It is
for art that does not sit inside its canvas — this repository's own `Shape`
(320 wide) draws into `x[-248, 132]`. `frameScope: 'pack'` costs a walk per
animation and draws smaller: `Ringo`'s `attack1` spans 383×527 player-local units
while the pack's union spans about 1030×878, because its `dead` animation slides
the character most of a screen to the right.

## The first frame

Until the pack has loaded **and at least one texture has registered**, there is
nothing drawable: every batch is skipped, so the honest thing to show is
not a blank rectangle:

```tsx
<SpriteStudioView source={…} placeholder={<ActivityIndicator />} />
```

`onLoad` fires when the pack is ready and hands over the player, so
`getAnimationNames()` can be read there with no ref. `onError` fires when it is
not; without one, the error goes to `console.error`. The way to make that window
short enough not to matter is [`ssPreload`](/usage/textures#preloading).
