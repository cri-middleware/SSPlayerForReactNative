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
| `play()` / `pause()` / `resume()` / `stop()` | See the verbs below. |
| `seek(frameNo)` | Jump the playhead. |
| `setAnimation(name)` | Select a different animation, posed on its first frame. **Does not start it** — call `play()`. Returns `false` if the pack has no such name, and does nothing at all if that animation is already the one set up. |
| `setSpeed(rate)` / `setLoop(loops)` | The prop equivalents. |
| `setAnimationSection(start, end)` | Restrict playback to a frame range of the current animation. Not carried across a `setAnimation`. |
| `setSkipFrames(skip)` | On (the default) keeps playback on the wall clock; off advances one frame per tick. |
| `setPlaybackDirection(direction, style)` | Below. |
| `getAnimationNames()` | What the loaded pack carries. |

And to read where it is: `frameNo`, `isPlaying`, `isFinished`,
`currentAnimation`, `fps`, `partCount`.

## play, pause, resume and stop are four distinct verbs

They are not interchangeable, and none of them is a synonym for another:

| | |
|---|---|
| `play()` | **Head-out.** Rewinds to the start of the section and re-arms the loop count. Using it to lift a `pause()` sends the playhead back to the start. |
| `pause()` | Holds playback where it stands. Idempotent, and ignored while nothing is playing. |
| `resume()` | Lifts a `pause()`, carrying on from the same frame. Idempotent, and a **no-op on a stopped animation** — starting one is `play()`'s job. |
| `stop()` | Ends playback. Nothing rewinds, so the frame it stopped on stays on screen. |

`isPlaying` stays **true** across a `pause()` — a pause is a hold, not a stop —
so `isPlaying && !isPausing` is what "currently advancing" means.

The `playing` prop maps onto these for you: `false` pauses, and `true` resumes a
held player or heads out into one that is not running at all. That mapping lives
in the component precisely because it is the only layer that knows a boolean
prop exists; the player itself keeps the four apart.

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
