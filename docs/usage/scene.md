---
title: Many animations, one canvas
description: SpriteStudioScene and SpriteStudioSprite — one canvas and one clock for a whole cast.
---

# Many animations: a scene

`<SpriteStudioView>` owns a canvas and a frame loop. That is right for one
animation and wrong for twenty: twenty views is twenty canvases and twenty
clocks.

```tsx
import { SpriteStudioScene, SpriteStudioSprite } from 'react-native-spritestudio'

<SpriteStudioScene style={{ flex: 1 }}>
  <SpriteStudioSprite source={SsAssets['Ringo/Ringo']} x={100} y={200} />
  <SpriteStudioSprite source={SsAssets['Ringo/Ringo']} x={260} y={200} speed={0.5} />
</SpriteStudioScene>
```

Unlike a view, a scene has no size of its own: give it `flex: 1` or a `width` and `height`, or its
canvas is 0 high and nothing draws.

One canvas, one clock, one frame: each player's `advance(dt)` ([the clock](./transport.md#the-clock))
takes its time from outside, so a whole tree can tick off one loop.

A sprite **renders nothing of its own**. Its entire job is to hold a player,
keep its root transform current and stay enrolled in the scene; the scene owns
the canvas everything draws into.

## What a sprite adds, and what it shares

Everything about *which animation and how it plays* is shared with
`<SpriteStudioView>` — `source`, `animation`, `playing`, `speed`, `loop`,
`parts`, `textures` and every callback mean exactly what they mean there. The
difference is placement: a sprite sits at a point in the scene rather than
fitting itself to a view.

| Prop | Means |
|---|---|
| `x` / `y` | The top-left corner of the sprite's box, in **scene pixels from the scene's top-left**. With no `width`/`height` there is no box, and they place the animation's own origin. |
| `width` / `height` | A box to fit the art into. Omit both for no fit at all. |
| `align` | Where the fitted art sits inside that box — the same vocabulary as on a view. |
| `scale` | Multiplier on top of the fit's scale, or the whole scale with no fit. |
| `flipX` / `flipY` | Mirror. |
| `z` | Draw order within the scene; higher is in front. Ties break on enrolment order — mount order, except that a sprite whose `z` or `source` changes re-enrols and then draws in front of the others at that `z`. |

::: info What `x`/`y` actually pins depends on the rest
With a `width` and `height` there is a box: `x`/`y` is its top-left corner, and `fit` and `align`
place the art inside it, as they do inside a view (the default `center` puts the art's centre at
`x + width / 2`, `y + height / 2`). **Without them there is no box to fit**, so `x`/`y`
place the animation's own origin — wherever the author put it in the editor.
:::

## Pausing the whole scene

```tsx
<SpriteStudioScene paused={backgrounded}>
```

`paused` stops the scene's clock — every sprite in it, in one place. That is
different from `playing={false}` on each sprite, which sets the transport per
player; this stops the tick that drives them all.

## Reaching a sprite's player

```tsx
const ref = useRef<SpriteStudioSpriteRef>(null)
ref.current?.player?.setAnimation('attack')
ref.current?.player?.play() // setAnimation selects; play() starts it
```

The same player as a view's, with the same [transport](./transport.md).

::: warning A sprite outside a scene draws nothing
It warns to the console and renders nothing, rather than silently producing an
empty box. It draws through the scene's canvas, so outside one there is nothing
for it to draw into.
:::

::: tip One throw stops the whole scene
Events are delivered inside the scene's single `advance()` pass, so an exception
from one sprite's handler stops the clock for **every** sprite in the scene —
see [Troubleshooting](../troubleshooting.md#the-animation-froze-mid-play).
:::
