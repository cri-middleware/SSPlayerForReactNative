---
title: Reanimated
description: Animating the view and following a part with Reanimated, and the two things you cannot do yet — driving playback from a shared value and running the frame loop on the UI thread.
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

The one place the two meet in your own code. `useSsPartTransform` samples a part on
every frame the player shows and publishes it into a shared value, so a React
view can ride on a part without a re-render. Inside the view's `children`, `useSsViewPlayer()` is the
player to pass:

```tsx
function HealthBar() {
  const player = useSsViewPlayer()
  const transform = useSsPartTransform(player, 'head')

  const barStyle = useAnimatedStyle(() => ({
    opacity: transform.value.valid ? 1 : 0,
    transform: [
      { translateX: transform.value.x },
      { translateY: transform.value.y },
    ],
  }))

  return <Animated.View style={[styles.healthBar, barStyle]} pointerEvents="none" />
}

<SpriteStudioView source={…} style={{ flex: 1 }}>
  <HealthBar />
</SpriteStudioView>
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

Moving it means running the per-frame update and draw together on the UI thread — they cannot be
split across threads — so it is one move, not an incremental one. Tracked in the
[ROADMAP](https://github.com/cri-middleware/SSPlayerForReactNative/blob/HEAD/ROADMAP.md).
