---
title: Part overrides & following
description: Recolouring, hiding or swapping a part, and attaching a view to one.
---

# Part overrides & following

## Overriding a part

The `parts` prop is **declarative**: it describes the state, not a history of
calls, so removing an entry reverts that part to what the animation says.

```tsx
<SpriteStudioView
  source={SsAssets['Ringo/Ringo']}
  parts={{
    body: { color: { rgba: 0xff3366ff, blend: 'mix' } },
    hat: { visible: false },
  }}
/>
```

Overrides are replayed onto each newly set-up animation, because
`setup_animation` resets the override layer along with everything else.

## Following a part

`useSsPartTransform` publishes a part's position through a Reanimated shared
value, so a React view can ride on a part — a health bar over a head, a
targeting reticle on a hand — without a re-render per frame.

```tsx
const transform = useSsPartTransform(player, 'head')
const style = useAnimatedStyle(() => ({
  transform: [{ translateX: transform.value.x }, { translateY: transform.value.y }],
}))
```

The transform is **player-local**: the root transform still has to be applied to
reach the screen, which is what `ssProjectPart` does.

::: tip This one costs a frame loop
Each hook instance currently runs its own `requestAnimationFrame` beside the
view's and reads the part by name across JSI every frame. It works, and it is
the one API here that reintroduces per-frame JS work — see the
[ROADMAP](https://github.com/cri-middleware/SSPlayerForReactNative/blob/main/ROADMAP.md).
:::
