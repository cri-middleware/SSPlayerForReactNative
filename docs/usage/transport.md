---
title: Transport
description: Play, pause, seek, direction and loop — declaratively and imperatively, and the semantics that are not the obvious ones.
---

# Transport

Everything about *how* an animation plays. The declarative half is five props;
the rest is on the player object, which you reach through the ref.

**The player owns the playback state and nothing above it mirrors that.** The
props are passthrough: the player holds the one copy.

## The declarative half

```tsx
<SpriteStudioView source={…} animation="walk" playing speed={1.5} loop={0} />
```

| Prop | Default | Means |
|---|---|---|
| `animation` | the pack's first | Which animation in the pack. |
| `transitionMs` | `0` | Milliseconds to crossfade over when `animation` changes; `0` switches outright. See [Motion blending](/usage/motion-blending). |
| `playing` | `true` | `false` holds it — on its first frame when it mounts false, where it stands when it goes false later. |
| `speed` | `1` | Multiplier on the authored frame rate. |
| `loop` | `0` | How many times to play. **`0` is forever**, `1` plays once. |

## The imperative half

```tsx
const ref = useRef<SpriteStudioViewRef>(null)

ref.current?.player?.setAnimation('attack')
ref.current?.player?.seek(12)
ref.current?.player?.setSpeedScale(0.5)
```

| | |
|---|---|
| `play()` / `pause()` / `resume()` / `stop()` | See the verbs below. |
| `seek(frameNo)` | Jump the playhead. |
| `setAnimation(name)` | Select a different animation, posed on its first frame. **Does not start it** — call `play()`. Returns `false` if the pack has no such name, and does nothing at all if that animation is already the one set up. |
| `setSpeedScale(rate)` / `setLoopCount(loops)` | The prop equivalents. |
| `setAnimationSection(start, end)` | Restrict playback to frames `start` to `end` of the current animation, both included; an end out of range (`-1`, say) is the animation's edge on that side. Returns `false` and warns, changing nothing, when both ends are in range and `end` is before `start`. Not carried across a `setAnimation`. |
| `setAnimationSectionByLabel(startLabel, endLabel, startOffset?, endOffset?)` | The same, with the ends named by labels of the current animation: from `startLabel`'s frame plus `startOffset` to `endLabel`'s frame plus `endOffset`. `_start` and `_end` name the animation's first and last frame. Returns `false` and warns, changing nothing, when the animation has no such label or the frames are a section `setAnimationSection` refuses. |
| `setFrameSkipEnabled(enabled)` | On (the default) keeps playback on the wall clock; off advances one frame per tick. |
| `setFrameRate(fps)` | Replace the advance rate, in **absolute** fps. `0` clears the override. Survives a `setAnimation`. |
| `setSubFrameEnabled(enabled)` | Sub-frame interpolation, **on** by default — whether what is drawn may sit between two authored frames. |
| `setPlaybackDirection(direction, style)` | Below. |
| `getAnimationNames()` | What the loaded pack carries. |
| `getLabelTable(animation?)` | The labels of the current animation, or of the one named, in frame order, with its first and last frame. `null` for an animation the pack does not have. |

**`play()`, `pause()`, `resume()`, `stop()` and `seek()` do nothing until the pack has loaded**, so call them from `onLoad` or later. `setAnimation()` and the settings (`setSpeedScale()` and the like) are kept and applied when it lands.

`setSpeedScale` and `setFrameRate` are both rate controls and they compose, but they
say different things: **speed is a multiple** of whatever the clip was authored
at, so it means the same against every clip; **frame rate replaces** it, so 60
against a 30fps clip is double speed and against a 60fps clip is none.

And to read where it is: `frameNo`, `startFrame`, `endFrame`, `totalFrames`,
`isPlaying`, `isFinished`, `isPausing`, `isPlayingForward`, `justLooped`,
`currentAnimation`, `frameRate`, `partCount`.

Every setter above has a getter beside it — `speedScale`, `loopCount`,
`frameSkipEnabled`, `subFrameEnabled`, `playbackDirection`, `playbackStyle`. They
read what the runtime applied, not what you asked for, which is the difference that matters
for `speedScale`: `0` and negatives clamp to a stop there, so setting `-2` and
reading it back gives `0` rather than the reverse playback the request looks
like.

`partNames()` lists the parts in part-index order — what turns the `partIndex` on
an event back into something a human reads, and what fills a part picker. An
unnamed part holds its slot as `''`, so the list stays index-aligned. Prefer its
`length` to `partCount`, which counts the runtime's part matrices and is `0` until the
first `advance`.

`justLooped` is a **pulse**: true only inside the tick `advance` just ran, and
replaced by the next one. `onAnimationLooped` delivers the same edge if you would rather not
poll for it.

`play()` takes an optional frame — `play(12)` heads out from frame 12 rather than
from the start of the section, and that frame becomes the reference the loop
count counts from. Seeking and then playing does not do the same thing, because
`play` rewinds.

`isPlayingForward` is the odd one out: it reports which way the playhead is
actually travelling, which is **not** the heading `setPlaybackDirection`
configured — under ping-pong the return leg runs backward while the configured
heading still reads forward. Gate audio on it. SpriteStudio has no reverse
audio, so a key crossed on a backward leg is not meant to sound:

```ts
player.onAudio = (e) => {
  if (player.isPlayingForward) mySoundBank.play(e.soundName, e.loopNum)
}
```

## play, pause, resume and stop are four distinct verbs

They are not interchangeable, and none of them is a synonym for another:

| | |
|---|---|
| `play()` | **Head-out.** Rewinds to the start of the section — its last frame when the direction is backward — and re-arms the loop count. Using it to lift a `pause()` sends the playhead back to the start. |
| `pause()` | Holds playback where it stands. Idempotent, and ignored while nothing is playing. Parts with independent playback keep running. |
| `resume()` | Lifts a `pause()`, carrying on from the same frame. Idempotent, and a **no-op on a stopped animation** — starting one is `play()`'s job. |
| `stop()` | Ends playback. Nothing rewinds, so the frame it stopped on stays on screen, and nothing moves until the next `play()` — parts with independent playback included. |

`isPlaying` stays **true** across a `pause()` — a pause is a hold, not a stop —
so `isPlaying && !isPausing` is what "currently advancing" means.

The `playing` prop maps onto these for you: `false` pauses, and `true` resumes a
held player or heads out into one that is not running at all. The player itself keeps the four
apart.

::: warning `onAnimationStarted` does not fire on a resume
Start means *started from the beginning*. A resume is the other half of the same
verb, and firing "started" for it would make the two indistinguishable to a
listener. `setAnimation` with the animation that is already set up does nothing and fires neither
`onAnimationStarted` nor `onAnimationChanged`; restarting it is `play()`, which reports through
`onAnimationStarted`.
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

## What switching animation resets {#what-setup-animation-resets}

Mounting an animation resets its loop count, its section and every part override
that is not `permanent`; the speed, the frame-rate override, the frame skip and the
direction and style carry over. `SpriteStudioPlayer` also replays its own settings onto every freshly
set-up animation — speed, loop count, frame skip, sub-frame, frame-rate override, direction, style and
the whole `parts` map — so a new animation comes up with what you last set. Playing is not among
them: a switch leaves the new animation stopped on its first frame, so call `play()`. The `animation`
prop does that for you while `playing` is true.

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
