---
title: Events & user data
description: onUserData, onSignal and onAudio for the keys the artist placed on the timeline — the user-data payload, signal params and audio your app plays — plus the start, loop, finish and change callbacks.
---

# Events & user data

Keys authored on the timeline arrive as callbacks, so a footstep sound or a
hit-frame comes from the animation itself rather than from a timer you maintain
beside it.

```tsx
const SOURCE = SsAssets['overall/UserData']

<SpriteStudioView
  source={SOURCE}
  onUserData={(e) => console.log(e.partName, e.frameNo, e.integer)}
  onAudio={(e) => playAudioEvent(SOURCE, e)}
  onSignal={(e) => console.log(e.commandId, e.params)}
/>
```

All three carry `partIndex`, `partName` and `frameNo` — **the frame the key sits
on, not the frame it was noticed on**. A user-data key's payload is four
optional slots, each with its own `has…` flag: `integer`, `pointX`/`pointY`,
`rect` and `text`. Read the flag first; the value beside a false one is
whatever zero looks like, not an authored zero.

A signal's `params` is a list of `{ id, type, boolValue, intValue, floatValue, textValue }`; `type`
(`SsSignalParamType`: `bool`, `index`, `integer`, `floating`, `text`, `none`) says which field holds the
value, `index` and `integer` both in `intValue`.

Each also carries `source`: the handle of the animation source that fired it. Without
[motion blending](/usage/motion-blending#events) that is always track 0’s main animation, and
`frameNo` is a frame of whichever animation fired. On a crossfade of track 0 the incoming
animation’s keys fire from the moment the fade begins, and the outgoing one’s stop.

A handler sees the keys the playhead crosses while it is installed; one added later does not get the
earlier keys replayed. Passing an inline arrow is fine — it does not restart the load.

## Audio is reported, not played

`onAudio` tells you *what* to play, how many times, and where the file is. It
does not play it: React Native ships no audio API, and a package that picked a
library would make every project that authors no audio carry it.

For an **Embedded** pack the event's `embedded` is `true` and `filePath` names a file that is not on
disk; this package does not expose the embedded audio bytes, so ship a pack that carries audio as a
**Reference** pack.

The reference wiring is [`example/src/player/audio.ts`](https://github.com/cri-middleware/SSPlayerForReactNative/blob/HEAD/example/src/player/audio.ts) in the repository
(`playAudioEvent(baseUri, event)` takes the `.ssab`'s own URI, because a sound's `filePath` is relative to
it). It solves the three things anyone writing their own will hit — an `asset`-scheme file has no
path an audio library can open, `loopNum` is a *count* where most APIs take a boolean, and iOS is
silent under the ringer switch without `expo-audio`'s `setAudioModeAsync({ playsInSilentMode: true })`.

**Skip what a seek lands on.** A `seek` makes the next update the player runs report the audio keys of
the frame it landed on, though the playhead crossed none of them: at once while playing, and for a seek
made while paused, by the first tick after `resume()`. To keep a seek silent, skip the keys on the landing
frame that the first update after it reports. The first frame after `play()` is meant to sound.

## Lifecycle

`onAnimationStarted`, `onAnimationChanged`, `onAnimationLooped` and `onAnimationFinished` all carry the
animation name, because one player outlives the animations mounted on it.

Two semantics worth knowing: **start does not fire on a resume** (`playing`
false → true carries on rather than restarting), and **change fires only for a different
animation** — selecting the one already set up does nothing, and restarting it with `play()` reports
as a start.

::: warning An exception in a handler stops the clock
`advance()` delivers user-data, audio, signal, looped and finished events and runs inside the frame
loop, so a throw from one of those handlers stops the animation — and in a scene, every sprite in it.
That is deliberate: the exception is yours and it reaches your error path rather than being swallowed
here. `onAnimationStarted` and `onAnimationChanged` are delivered by `play()`, `setAnimation()` and
`crossfade()` instead, so a throw there reaches the code that made the call and does not stop the
clock.
:::
