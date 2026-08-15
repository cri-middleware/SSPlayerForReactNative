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

One canvas, one clock, one frame. That arrangement is what Layer 3 was built
for — `advance(dt)` is externally clocked precisely so a whole tree can tick off
one loop.

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
| `x` / `y` | Where the art goes, in **scene pixels from the scene's top-left**. |
| `width` / `height` | A box to fit the art into. Omit both for no fit at all. |
| `align` | Which point of that box lands on `x`/`y`. |
| `scale` | Multiplier on top of the fit's scale, or the whole scale with no fit. |
| `flipX` / `flipY` | Mirror. |
| `z` | Draw order within the scene. Ties break on mount order. |

::: info What `x`/`y` actually pins depends on the rest
With a `width` and `height` there is a box, and `align` decides which of its
points lands on `x`/`y`. **Without them there is no box to fit**, so `x`/`y`
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
```

Same Layer 3 player as a view's, with the same [transport](/usage/transport).

::: warning A sprite outside a scene draws nothing
It warns to the console and renders nothing, rather than silently producing an
empty box. It draws through the scene's canvas, so outside one there is nothing
for it to draw into.
:::

::: tip One throw stops the whole scene
Events are delivered inside the scene's single `advance()` pass, so an exception
from one sprite's handler stops the clock for **every** sprite in the scene —
see [Troubleshooting](/troubleshooting#the-animation-froze-mid-play).
:::
