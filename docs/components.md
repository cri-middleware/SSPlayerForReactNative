---
title: Components at a glance
description: The three components and four hooks, what each is for, and the smallest thing that works.
---

# Components at a glance

Three components and four hooks. Most apps use one component and no hooks.

| | Use it when |
|---|---|
| [`<SpriteStudioView>`](#spritestudioview) | You have **one** animation. The default. |
| [`<SpriteStudioScene>`](#spritestudioscene) + [`<SpriteStudioSprite>`](#spritestudiosprite) | You have **many**, and want one canvas and one clock for the lot. |

## `<SpriteStudioView>`

One animation, fitted to its own box. An ordinary React Native view with a Skia
canvas and a frame loop inside it.

```tsx
import { SpriteStudioView } from 'react-native-spritestudio'

<SpriteStudioView
  source="ss/overall/Basic.ssab"
  animation="anime_1"
  fit="contain"
  style={{ flex: 1 }}
/>
```

| Prop group | |
|---|---|
| What plays | `source`, `animation`, `playing`, `speed`, `loop` |
| Where it lands | `fit`, `align`, `offset`, `scale`, `flipX`, `flipY`, `style` |
| The box | `frame`, `frameScope`, `measureFrames` |
| Reacting | `onUserData`, `onAudio`, `onSignal`, `onLoad`, `onError`, `onAnimationFinished`, `onAnimationLooped`, `onAnimationStarted`, `onAnimationChanged` |
| Overriding | `parts`, `textures` |
| While loading | `placeholder` |
| A `<View>`'s own | `testID`, the accessibility props, `pointerEvents`, `onLayout` |

`ref.current.player` is the Layer 3 [`SpriteStudioPlayer`](/usage/transport) —
seek, switch animation, read the content box.

::: warning Twenty of these is twenty canvases
Each one owns a canvas *and* a `requestAnimationFrame` loop. For a cast, use a
scene.
:::

## `<SpriteStudioScene>`

Many animations, **one canvas and one clock**. Holds sprites; draws nothing
itself beyond the canvas they share.

```tsx
import { SpriteStudioScene, SpriteStudioSprite } from 'react-native-spritestudio'

<SpriteStudioScene style={{ flex: 1 }} paused={backgrounded}>
  <SpriteStudioSprite source={SsAssets['Ringo/Ringo']} x={100} y={200} />
  <SpriteStudioSprite source={SsAssets['Ringo/Ringo']} x={260} y={200} z={1} />
</SpriteStudioScene>
```

| Prop | |
|---|---|
| `children` | The sprites. |
| `style` | The canvas's box. |
| `paused` | Stops the clock for **every** sprite at once. |
| `onError` | |

## `<SpriteStudioSprite>`

One animation inside a scene — a position and a draw order, not a view. It
**renders nothing of its own**; the scene's canvas draws it.

```tsx
<SpriteStudioSprite
  source={SsAssets['Ringo/Ringo']}
  animation="walk"
  x={100}
  y={200}
  z={1}
/>
```

Everything about *which animation and how it plays* is shared with
`<SpriteStudioView>`. What differs is placement: `x`, `y`, `width`, `height`,
`align`, `scale`, `flipX`, `flipY`, `z`.

Outside a scene it warns and draws nothing. See
[Many animations: a scene](/usage/scene).

## Hooks

You can build everything above without these. Reach for them when the
components do not fit.

### `useSsPartTransform`

Follows a part with a Reanimated shared value — a health bar over a head. The
one hook an ordinary app is likely to want.

```tsx
const transform = useSsPartTransform(player, 'head')
```

Returns `SharedValue<SsPartScreenTransform>` in **view pixels, root transform
applied**. See [Part overrides & following](/usage/parts#following-a-part)
and [Reanimated](/usage/reanimated).

### `useSsTextures`

Decodes replacement atlases into `SkImage`s. The hook behind the `textures`
prop, exported for callers who want the decoded images themselves. Returns
`null` until every texture has decoded.

```tsx
const images = useSsTextures({ Ringo: require('./winter.png') })
```

See [Textures & resources](/usage/textures#replacing-a-texture).

### `useSpriteStudioPlayer`

Owns one Layer 3 player for a component: loads it, keeps the transport props on
it, reports when it is drawable. **Deliberately not a clock** — who advances the
player is the caller's business.

```tsx
const { player, measured, ready } = useSpriteStudioPlayer(props)
```

This is the half `<SpriteStudioView>` and `<SpriteStudioSprite>` share. Use it
if you are writing your own component and want the loading and prop-syncing
without the canvas.

### `useSsScene`

Returns the scene registry a sprite enrols in, or `null` outside a scene. Mostly
here so a component can say plainly that it needs a scene rather than rendering
an empty box.

## Everything else

The exported surface beyond this — `SpriteStudioPlayer`, `SsInternalPlayer`,
`SsTextureRegistry`, the caches, `ssPreload`, `ssCheckForLeaks`, the override
vocabulary, `SsRuntimeModule` — is covered by
[Where to start](/api-guide) and the [generated reference](/api/).
