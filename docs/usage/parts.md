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
| `cascade` | `boolean` | Whether a `visible: false` reaches descendants. Default `false` — a keyframed hide never cascades in SpriteStudio, so cascading is the opt-in. |
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

`priority` defaults to `SsOverridePriority.holdUntilNextAnimation` — the C-API's
own default (`HoldUntilNextAnimation`), and the one the sibling players take.

What makes a map carrying `hat: { visible: false }` mean "the hat is hidden for
as long as the prop says so" is not the priority but the replay: as below, the
map is re-applied onto every newly set-up animation.

| | |
|---|---|
| `overwriteOnNextKeyframe` | The animation takes the part back at its next authored key. |
| `holdUntilNextAnimation` | Survives keyframes, dropped when another animation is set up. **The default.** |
| `permanent` | Holds across animation changes. |

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

::: info Skew is not part of the followed transform
A part's **Skew** is a non-inheriting local-vertex deform — a per-part quad
shear — so it never enters the world matrix and never reaches a follower.
`getPartTransform` reports **position, rotation and scale only**. A view riding
a sheared part, or a part *under* a sheared parent, stays unsheared. That is
what SpriteStudio shows: Skew does not inherit to children or attachments.
:::

### Whether the part is showing this frame

`getPartTransform` and `useSsPartTransform` report where a part **would** be
whether or not it is drawn — a part the animation hides keeps a perfectly good
transform. A view driven from a part therefore needs the second half of the
answer:

```ts
// Place the follower from the transform, show it from the hide flag.
const hidden = player.isPartHidden(target)
```

`isPartHidden(part)` takes a part **name or index** and reads the **display**
frame — the same frame that was drawn, floored when sub-frame is off — so it
cannot disagree with what is on screen. It reports the animation's own hide, not
a `setPartOverrides` `visible: false`, and it is `false` for an unknown name, an
out-of-range index and before the first frame has played.

This is the `onHide` option the sibling players offer on their built-in
attachments. This player has no managed attachment — following is a pull API —
so the choice of what to do about a hidden part is the host's: hide the view
alongside it, or leave it where it is.

### Mesh (skinned) parts cannot be followed directly

A **skinned** mesh part — a deforming part such as a hand or a face, bound to
bones — has its vertices drawn by the bones' skinning, while the part's own
transform (the one `useSsPartTransform` reports) stays at its **setup node
position, usually near the character root**. So targeting such a part makes the
follower snap near the root rather than onto the visible art. This is not a bug
to fix but the shape of the data: the node and the deformed vertices are two
different places, and the transform is faithful to the node.

To follow the position of a mesh part, add a **NULL part** (a bone-point / empty
part) at that spot in SpriteStudio and target *that* part's name instead. A bone
(armature) or joint part works the same way — a null, joint, armature or
bone-point part places its own node where the art is, so it is a good follow
target.

`isPartSkinnedMesh(part)` reports which parts this applies to — the same
judgement the sibling players make (ForWeb, ForWgpu), read from the pack's
`.ssab`. Use it to build a picker that only offers parts a follower can sit on:

```ts
// The parts a follower can actually track: everything except a skinned mesh.
const followable = player
  .partNames()
  .filter((name) => name !== '' && !player.isPartSkinnedMesh(name))
```

It takes a part **name or index**, and is `false` for a rigid (deform-only)
mesh and every non-mesh part — those follow correctly — as well as for an
unknown name or before a load. As a backstop, following a skinned mesh through
`useSsPartTransform` also logs a one-time `__DEV__` warning naming the part; it
is **non-blocking**, so the transform is still published rather than refused.

::: warning This one costs a frame loop
Each hook instance currently runs its own `requestAnimationFrame` beside the
view's and reads the part **by name** across JSI every frame. It works, and it
is the one API here that reintroduces per-frame JS work — see the
[ROADMAP](https://github.com/cri-middleware/SSPlayerForReactNative/blob/main/ROADMAP.md).
:::
