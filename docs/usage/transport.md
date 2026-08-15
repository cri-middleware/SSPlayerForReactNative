---
title: Transport
description: Play, pause, seek, direction and loop — declaratively and imperatively, and the semantics that are not the obvious ones.
---

# Transport

Everything about *how* an animation plays. The declarative half is three props;
the rest is on the Layer 3 player, which you reach through the ref.

**The player owns the playback state and nothing above it mirrors that.** The
props are passthrough — there is one copy of the truth, and it lives in the Rust
core.

## The declarative half

```tsx
<SpriteStudioView source={…} animation="walk" playing speed={1.5} loop={0} />
```

| Prop | Default | Means |
|---|---|---|
| `animation` | the pack's first | Which animation in the pack. |
| `playing` | `true` | `false` leaves it on its first frame. |
| `speed` | `1` | Multiplier on the authored frame rate. |
| `loop` | `0` | How many times to play. **`0` is forever**, `1` plays once. |

## The imperative half

```tsx
const ref = useRef<SpriteStudioViewRef>(null)

ref.current?.player?.setAnimation('attack')
ref.current?.player?.seek(12)
ref.current?.player?.setSpeed(0.5)
```

| | |
|---|---|
| `play()` / `pause()` / `stop()` | See the verbs below. |
| `seek(frameNo)` | Jump the playhead. |
| `setAnimation(name)` | Mount a different animation. Returns `false` if the pack has no such name. |
| `setSpeed(rate)` / `setLoop(loops)` | The prop equivalents. |
| `setPlaybackDirection(direction, style)` | Below. |
| `getAnimationNames()` | What the loaded pack carries. |

And to read where it is: `frameNo`, `isPlaying`, `isFinished`,
`currentAnimation`, `fps`, `partCount`.

## play, pause and stop are not three of a kind

`play()` is **one verb covering two actions**, because Layer 1 keeps them apart
(the Brain's `ss_runtime_play` rewinds) and a component prop cannot:

- **After `pause()`** — resumes where it stands. `playing={false}` →
  `playing={true}` carries on rather than restarting.
- **After `stop()`, or from a fresh setup** — starts from the beginning.

`stop()` halts where it stands and arms the next `play()` to restart.

::: warning `onAnimationStart` does not fire on a resume
Start means *started from the beginning*. A resume is the other half of the same
verb, and firing "started" for it would make the two indistinguishable to a
listener. By the same rule, re-setting the animation that is already playing is
a **restart**: it reports through `onAnimationStart`, not `onAnimationChange`.
:::

## Direction and style

```tsx
import { SsPlaybackDirection, SsPlaybackStyle } from 'react-native-spritestudio'

player.setPlaybackDirection(SsPlaybackDirection.backward, SsPlaybackStyle.pingPong)
```

| | |
|---|---|
| `SsPlaybackDirection.forward` / `.backward` | Which way the playhead walks. |
| `SsPlaybackStyle.normal` | At the far end, jump back to the start — or stop, per the loop count. |
| `SsPlaybackStyle.pingPong` | Turn around and walk back. One "loop" is a full round trip. |

`style` defaults to `normal` when omitted.

## What `setup_animation` resets

Mounting an animation resets the transport settings **and the override layer**
along with everything else — that is the Rust core's behaviour, not a choice
made here. So `SpriteStudioPlayer` replays both onto every freshly set-up
animation: speed, loop, direction, style, whether it should be playing, and the
whole `parts` map.

You only need to know this when it surprises you. Setting speed and *then*
switching animation is safe, because the replay happens after the setup.

## The clock

`advance(dtMilliseconds)` is externally clocked, which is the whole reason a
scene can drive twenty players off one loop. A `<SpriteStudioView>` runs its own
`requestAnimationFrame`; a `<SpriteStudioScene>` runs exactly one for everything
inside it.

::: tip Returning from the background does not fast-forward
Both clocks cap the step at `MAX_STEP_MS` (1000/15 ≈ 66.7 ms). Without the cap,
a backgrounded app comes back with one enormous delta and the animation
fast-forwards through every frame it missed — **firing every event on them**.
:::

If you drive `advance()` yourself, the unit is **milliseconds** and
`performance.now()` deltas are already in it. Cap them the same way.
