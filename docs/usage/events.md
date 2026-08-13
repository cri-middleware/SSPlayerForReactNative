---
title: Events & user data
description: Reacting to the keys the artist placed on the timeline.
---

# Events & user data

Keys authored on the timeline arrive as callbacks, so a footstep sound or a
hit-frame comes from the animation itself rather than from a timer you maintain
beside it.

```tsx
<SpriteStudioView
  source={SsAssets['overall/UserData']}
  onUserData={(e) => console.log(e.partName, e.frameIndex, e.integer)}
  onAudio={(e) => playAudioEvent(e)}
  onSignal={(e) => console.log(e.commandName, e.params)}
/>
```

Each is **a read, not a drain**: the runtime rebuilds its list on every
collection, so calling twice in a tick returns the same events and never calling
loses nothing.

Handlers are installed only while the corresponding prop is present, because the
per-frame read is gated on them. Passing an inline arrow is fine — it does not
restart the load.

## Audio is reported, not played

`onAudio` tells you *what* to play, how many times, and where the file is. It
does not play it: React Native ships no audio API, and a package that picked a
library would make every project that authors no audio carry it.

The reference wiring is the example's `src/player/audio.ts`, which solves the
three things anyone writing their own will hit — an `asset`-scheme sibling has
no path an audio library can open, `loop_num` is a *count* where most APIs take
a boolean, and iOS is silent under the ringer switch without
`setAudioModeAsync({ playsInSilentMode: true })`.

## Lifecycle

`onAnimationStart`, `onAnimationChange`, `onLoop` and `onComplete` all carry the
animation name, because one player outlives the animations mounted on it.

Two semantics worth knowing: **start does not fire on a resume** (`playing`
false → true carries on rather than restarting), and **change does not fire on a
restart** of the same animation — that reports itself as a start.

::: warning An exception in a handler stops the clock
`advance()` is where these are delivered and it runs inside the frame loop, so a
throw from your handler stops the animation — and in a scene, every sprite in
it. That is deliberate: the exception is yours and it reaches your error path
rather than being swallowed here.
:::
