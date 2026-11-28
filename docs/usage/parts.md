---
title: Part overrides & following
description: Recolouring, hiding or swapping a part, attaching a view to one, and testing a point against its outline.
---

# Part overrides & following

## Overriding a part

The `parts` prop is **declarative**: it describes the state, not a history of
calls, so removing an entry reverts that part to what the animation says.

```tsx
import { SpriteStudioView, SsBlendOp } from 'react-native-spritestudio'

<SpriteStudioView
  source={SsAssets['Ringo/Ringo']}
  parts={{
    body: { color: '#ff3366', blendOp: SsBlendOp.mix },
    hat: { hide: true },
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
| `hide` | `boolean` | `true` force-hides the part. `false`, like omitting the key, clears this player's hide override, so the animation's own hide applies again; it does not show a part the animation hides. |
| `cascade` | `boolean` | Whether a `hide: true` reaches descendants. Default `false` — a keyframed hide never cascades in SpriteStudio, so cascading is the opt-in. |
| `color` | `string \| number` | A tint. Anything Skia parses (`'#f00'`, `'rgba(255,0,0,.5)'`) or a packed `0xRRGGBBAA` number. |
| `blendOp` | `SsBlendOpValue` | How the tint combines: `SsBlendOp.mix` / `.mul` / `.add` / `.sub`. Default `mix`. |
| `cell` | `SsCellRef` | Swap which cell the part samples. |
| `priority` | `SsOverridePriorityValue` | For `color` and `cell`: how long the override outlives the timeline (below). `hide` has none: it always beats the animation's keys and is cleared when another animation is set up. |

::: tip Colour strings go through Skia
`color` is parsed by `Skia.Color`. `ssPackColor` is the same conversion, exported for a caller that
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

::: info `cell` swaps one part; `setCellmapTexture` swaps a whole atlas
These are two different tools and it is worth keeping them apart. `cell` here is
a **per-part** override — it changes which cell *one* part samples, from the
cells already in the atlas (a mouth shape, an eye state). To replace the **whole
texture** a cellmap draws from — recolour every part that uses it at once, or
swap in a costume atlas — reach for
[`player.setCellmapTexture`](./textures.md#from-code-at-runtime) instead. One
picks a different region of the same image; the other hands over a different
image.
:::

### How long an override lasts

`priority` applies to `color` and `cell` and defaults to `SsOverridePriority.holdUntilNextAnimation`.

What makes a map carrying `hat: { hide: true }` mean "the hat is hidden for
as long as the prop says so" is not the priority but the replay: as below, the
map is re-applied onto every newly set-up animation.

| | |
|---|---|
| `overwriteOnNextKeyframe` | The animation takes the part back at its next authored key. |
| `holdUntilNextAnimation` | Survives keyframes, dropped when another animation is set up. **The default.** |
| `permanent` | Holds across animation changes. |

Overrides are replayed onto each newly set-up animation whatever the priority,
because setting up an animation resets the override layer along with everything else —
see [Transport](./transport.md#what-setup-animation-resets).

## Following a part

`<SpriteStudioPartAnchor>` rides a React view on a part — a health bar over a
head, a targeting reticle on a hand — without a re-render per frame. In a
`<SpriteStudioView>`'s `children` it finds that view's player:

```tsx
<SpriteStudioView source={SsAssets['Ringo/Ringo']}>
  <SpriteStudioPartAnchor partName="head">
    <HealthBar />
  </SpriteStudioPartAnchor>
</SpriteStudioView>
```

The children's top-left corner sits on the part's origin and turns about it;
offset them to attach another point. They turn with the part (`rotation`,
default `true`) and keep their own size (`scale`, default `false`) — a name plate
should not breathe with the chest. The children mount with the first drawable
frame and are hidden until the part resolves.

For a style of your own, `useSsPartTransform` is what the anchor reads: it
publishes the placement through a Reanimated shared value. Inside the view's
`children`, `useSsViewPlayer()` is the player to pass it.

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

```tsx
// pinned at the view's top-left, turning about its own top-left, like the anchor
<Animated.View style={[{ position: 'absolute', left: 0, top: 0, transformOrigin: 'left top' }, style]}>
  <HealthBar />
</Animated.View>
```

What it reports is **view pixels, with the root transform already applied** —
the space the view's `children` live in. There is nothing left to project.

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

::: info Mirrored parts
Under the view's `flipX` or `flipY` a follower is not mirrored: it gets the mirrored position and
angle, upright. A part the **artist** mirrored — a negative Scale on itself or an ancestor, such as a
character authored facing left — has no pure rotation: `getPartTransform` and `useSsPartTransform`
put that mirror on `scaleY` (negative) and keep the rest in `rotation`, so a horizontal one reads as
`rotation` π. `<SpriteStudioPartAnchor>` turns with the part and ignores scale by default, so a view on
such a part comes out upside down; pass `scale` to mirror the view with the part, or
`rotation={false}` to keep it upright.
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
cannot disagree with what is on screen. It reports that frame's hide: the
animation's own, and a `setPartOverrides` `hide: true` too, on every descendant
it hides when `cascade` is set. An override shows up once the player next
advances or seeks, and at once on a stopped player. It is `false` for an
unknown name, an out-of-range index and
before the first frame has played.

Following is a pull API, so what to do about a hidden part is yours to choose:
hide the view alongside it, or leave it where it is.

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

`isPartSkinnedMesh(part)` reports which parts this applies to, read from the
pack's `.ssab`. Use it to build a picker that only offers parts a follower can sit on:

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

## A part's outline and hit testing {#part-outline}

`getPartQuad(part)` returns the outline a part is drawn with, as four corners:
`leftTopX` / `leftTopY`, `rightTopX` / `rightTopY`, `leftBottomX` /
`leftBottomY` and `rightBottomX` / `rightBottomY`. They are in **view pixels**,
the space of a point on the view, and they are the part's own corners, so a
rotated or flipped part has them wherever the pose put them.

`hitTestPart(x, y, parts?)` takes a point in the same space and returns the
index of the front-most part whose outline holds it, among the parts you name
(names or indices; omit it for every part — an empty list, or names the animation does not have,
hit nothing). It returns `-1` when none
does, as `findPartIndex` does for an unknown name.

```ts
const index = player.hitTestPart(x, y, ['button_face'])
if (index !== -1) start()
```

What has an outline:

| Part | Outline |
|---|---|
| A part with a cell | Its four drawn corners, skew and vertex deform included |
| Mesh | The box around its vertices. A skinned mesh's own transform sits near the root, so its corners would miss the art. |
| Shape | Its size around its pivot. A vertex deform that carries a corner outside that size is not followed. |
| Null, bone, Instance and Effect parts, and a hidden part | None. `getPartQuad` is `null`, and nothing hits them. A part drawn at alpha 0 still has an outline. |

Both read the frame the player last built, the one on screen, and build none
of their own. Before a load `getPartQuad` is `null` and `hitTestPart` is `-1`.
