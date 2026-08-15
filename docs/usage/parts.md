---
title: Part overrides & following
description: Recolouring, hiding or swapping a part, and attaching a view to one.
---

# Part overrides & following

## Overriding a part

The `parts` prop is **declarative**: it describes the state, not a history of
calls, so removing an entry reverts that part to what the animation says.

```tsx
import { SpriteStudioView, SsPartColorBlend } from 'react-native-spritestudio'

<SpriteStudioView
  source={SsAssets['Ringo/Ringo']}
  parts={{
    body: { color: '#ff3366', colorBlend: SsPartColorBlend.mix },
    hat: { visible: false },
  }}
/>
```

The map is keyed by the **part name as the artist authored it**. A name the
current animation does not carry warns to the console and is skipped, so a typo
says so rather than quietly doing nothing.

### What one part may say

Every field is optional, and an omitted one is left to the animation — an
override is a patch, not a replacement.

| Field | Type | Means |
|---|---|---|
| `visible` | `boolean` | Show or hide the part. |
| `cascade` | `boolean` | Whether a `visible: false` reaches descendants. Default `true`. |
| `color` | `string \| number` | A tint. Anything Skia parses (`'#f00'`, `'rgba(255,0,0,.5)'`) or a packed `0xRRGGBBAA` number. |
| `colorBlend` | `SsPartColorBlendValue` | How the tint combines: `SsPartColorBlend.mix` / `.mul` / `.add` / `.sub`. Default `mix`. |
| `cell` | `SsCellRef` | Swap which cell the part samples. |
| `priority` | `SsOverridePriorityValue` | How long it outlives the timeline. |

::: tip Colour strings go through Skia
`color` is parsed by `Skia.Color`, not by a parser written in this package — a
second implementation of a shared notion is one more than can be kept in
agreement. `ssPackColor` is the same conversion, exported for a caller that
wants the packed number itself.
:::

### Swapping a cell

`cell` points the part at a different image in the atlas. Both names are the
ones the `.ssab` carries, and the cellmap is named **without** its `.ssce`
extension:

```tsx
parts={{
  face: { cell: { cellmap: 'Ringo', cell: 'face_angry' } },
}}
```

### How long an override lasts

`priority` defaults to `SsOverridePriority.permanent`, which is **not** the
C-API's default. It is what a declarative prop has to mean: a map carrying
`hat: { visible: false }` says the hat is hidden for as long as the prop says
so, and one the next keyframe silently undid would make the prop describe a
single frame.

| | |
|---|---|
| `untilNextKeyframe` | The animation takes the part back at its next authored key. |
| `untilNextAnimation` | Survives keyframes, dropped when another animation is set up. |
| `permanent` | Holds until the prop says otherwise. **The default.** |

Overrides are replayed onto each newly set-up animation whatever the priority,
because `setup_animation` resets the override layer along with everything else —
see [Transport](/usage/transport#what-setup-animation-resets).

## Following a part

`useSsPartTransform` publishes a part's placement through a Reanimated shared
value, so a React view can ride on a part — a health bar over a head, a
targeting reticle on a hand — without a re-render per frame.

```tsx
const transform = useSsPartTransform(player, 'head')
const style = useAnimatedStyle(() => ({
  opacity: transform.value.valid ? 1 : 0,
  transform: [
    { translateX: transform.value.x },
    { translateY: transform.value.y },
    { rotate: `${transform.value.rotation}rad` },
  ],
}))
```

What it reports is **view pixels, with the root transform already applied** —
the space an `Animated.View` sitting on top of the canvas lives in. There is
nothing left to project.

`valid` is false until the part has been located, and an unknown name never
becomes true. Check it rather than assuming the first frame has a position: the
shared value starts at the origin, so a follower that skips the check sits in
the corner until the part resolves.

::: info The player-local reading is the other one
`player.getPartTransform(name)` returns the part in **player-local units**, with
no root transform applied. That is the one to reach for when you are working in
the animation's own space; `useSsPartTransform` is the one that reaches the
screen.
:::

::: warning This one costs a frame loop
Each hook instance currently runs its own `requestAnimationFrame` beside the
view's and reads the part **by name** across JSI every frame. It works, and it
is the one API here that reintroduces per-frame JS work — see the
[ROADMAP](https://github.com/cri-middleware/SSPlayerForReactNative/blob/main/ROADMAP.md).
:::
