---
title: Reanimated
description: Animating the view, following a part, and the two things you cannot drive from a shared value yet.
---

# Reanimated

Reanimated is a peer dependency, and `useSsPartTransform` hands you a
`SharedValue`. It is reasonable to assume from that the player is wired into
Reanimated both ways. **It is not**, and the boundary is worth knowing before
you build against it.

## Animating the view

`<SpriteStudioView>` is an ordinary React Native view. To move, fade or scale
the whole animation, wrap it — nothing special is needed and nothing about the
playback is involved:

```tsx
import Animated, { useAnimatedStyle, withTiming } from 'react-native-reanimated'

const style = useAnimatedStyle(() => ({
  opacity: withTiming(visible.value ? 1 : 0),
  transform: [{ translateY: withTiming(visible.value ? 0 : 40) }],
}))

<Animated.View style={style}>
  <SpriteStudioView source={…} style={{ width: 200, height: 200 }} />
</Animated.View>
```

The player keeps drawing at its own rate underneath; Reanimated moves the box it
draws into. Those are two independent clocks and they do not need to agree.

## Following a part

The one place the two genuinely meet. `useSsPartTransform` samples a part every
frame and publishes it into a shared value, so a React view can ride on a part
without a re-render:

```tsx
const transform = useSsPartTransform(player, 'head')

const barStyle = useAnimatedStyle(() => ({
  opacity: transform.value.valid ? 1 : 0,
  transform: [
    { translateX: transform.value.x },
    { translateY: transform.value.y },
  ],
}))

<View>
  <SpriteStudioView ref={ref} source={…} style={{ flex: 1 }} />
  <Animated.View style={[styles.healthBar, barStyle]} pointerEvents="none" />
</View>
```

The value is in **view pixels with the root transform applied**, so it drops
straight into a style. Gate on `valid` — it is false until the part resolves,
and an unknown name never becomes true.

Note what is and is not on the UI thread here: the **sample** runs on the JS
thread, and the **consumer** runs on the UI thread. Publishing through a shared
value is what makes the second half true today and keeps it true when the first
half moves.

## What you cannot do yet

### Drive playback from a shared value

There is **no** shared-value input. `speed`, `loop` and the playhead are
ordinary props and imperative calls; a `SharedValue<number>` cannot be handed to
any of them, and reading `.value` during render to fake it defeats the point.

```tsx
// Does not work — speed takes a number, not a shared value.
<SpriteStudioView speed={speedShared} />
```

Drive it from JS instead — `player.setSpeedScale(x)`, or the `speed` prop.

### Expect the frame loop on the UI thread

The tick is still `requestAnimationFrame` on the **JS thread**, for both the
view and the scene. A busy JS thread will show up as uneven playback, which no
amount of Reanimated on your side fixes.

Moving it needs the whole update → bake → draw chain reachable from a worklet
runtime, and the borrow rule says update and draw cannot land on different
threads — so it is one move, not an incremental one. Tracked in the
[ROADMAP](https://github.com/cri-middleware/SSPlayerForReactNative/blob/main/ROADMAP.md).

::: tip Each follower costs its own loop
`useSsPartTransform` starts a second `requestAnimationFrame` beside the view's,
per hook instance, and reads the part **by name** across JSI every frame. Two or
three followers are fine; a dozen is not the shape to build on.
:::
