---
title: UI buttons
description: A SpriteStudio animation as a button — states that play its labels, presses on its parts, reduced motion and screen readers.
---

# UI buttons

For an app that wants a button, a menu item or a tile drawn by a SpriteStudio
animation. `<SpriteStudioButton>` is a `<SpriteStudioView>` that is a button: a
`<Pressable>` covers the view's box, and each state the press, hover and focus
callbacks raise plays a section of one animation.

It lives in a package of its own, so an app that only plays animations installs
none of it:

```bash
npx expo install react-native-spritestudio-ui
```

Use the same version as `react-native-spritestudio`, which it takes as a peer.
The rules it follows are the SDK's
[UI integration](https://github.com/cri-middleware/SpriteStudio-SDK/blob/HEAD/libs/ssruntime/docs/50_features/80_ui_integration.md)
convention, which every SpriteStudio Player shares.

## Authoring the states

Put the states in one animation, as labels named after them, in lower case:
`normal`, `hover`, `pressed`, `disabled` and `focused`. Each state plays, looping,
from its label to the frame before the next label (any label, a state's or
not), and the last one to the end of the animation.

| A state with no label | Plays |
|---|---|
| `hover`, `focused`, `disabled` | `normal` |
| `pressed` | `hover`, or `normal` without that |
| `normal` | The whole animation |

When several hold at once, one wins: `disabled`, then `pressed`, `hover`,
`focused` and `normal`.

## The button

```tsx
import { SpriteStudioButton } from 'react-native-spritestudio-ui'

<SpriteStudioButton
  source="ss/ui/start.ssab"
  animation="button"
  accessibilityLabel="Start"
  hitParts={['face']}
  onPress={start}
  style={{ width: 240, height: 96 }}
/>
```

It takes the view's props that place and load the animation (`source`,
`textures`, `animation`, `fit`, `align`, `frame`, `style`, `placeholder`, the
event callbacks and the rest) and a `<Pressable>`'s (`onPress`, `onLongPress`,
`disabled`, `testID` and the rest). `animation` names the animation the states
are read from; without it, the one the pack loads on.

The button owns its player's playback: `playing`, `loop` and `transitionMs` are
not props here. `ref.current.player` is the view's player, for reading it, not
for playing or stopping it.

### A clip in place of a label

`clips` replaces a state's label with a section of your own: an animation, a
label, or a label in another animation. The states that fall back to it play it
too.

```tsx
<SpriteStudioButton
  source="ss/Ringo/Ringo.ssab"
  clips={{
    normal: { animation: 'wait1' },
    hover: { animation: 'walk' },
    pressed: { animation: 'attack1' },
    disabled: { animation: 'dead' },
  }}
/>
```

A clip that names an animation or a label the pack does not have is reported
once on the console, and the state plays as if it had none.

## The pressable area

By default the whole box takes a press. `hitParts` narrows it to the outlines of
the parts named, and `hitOnArtwork` to the outline of any part — see
[A part's outline and hit testing](/usage/parts#part-outline). A touch that
starts on none of them is not a press, and the button shows no `pressed` state
for it.

Only touches are narrowed. Keyboard focus and a screen reader's activation
reach the button as before, and hover still counts on the whole box. A touch
the button refuses goes to no view behind it either, as with any React Native
view.

## Reduced motion

`reducedMotion` holds each state on its first frame, stopped, so it fires no
events. `normal`, and the states that fall back to it, play a `reduced_motion`
label instead when the animation has one, so a calm idle loop can still move.

Without the prop, the button follows the system's reduce motion setting (Reduce Motion on iOS,
Remove animations on Android; `AccessibilityInfo.isReduceMotionEnabled()`) and changes with it. It shows no
state until it has read the setting.

## Screen readers

Without an `accessibilityLabel` the button is decoration: a screen reader does
not see it. With one it is read as a button with that label, and its
`disabled` state comes with it. The other accessibility props reach the
`<Pressable>`.

## Without the component

`SsUiStateDriver` is the state rule on its own, for a control of your own
around a `<SpriteStudioView>`. Give it the player and the animation, and show it
a state whenever one changes; showing the state already shown does nothing.

```ts
import { SsUiStateDriver, ssUiStateOf } from 'react-native-spritestudio-ui'

const driver = new SsUiStateDriver(player, { animation: 'button' })
driver.show(ssUiStateOf({ pressed, hovered, focused, disabled }), reducedMotion)
```

The driver takes over the player's playback, so give the view `playing={false}` (the button does). `show`
does nothing until the player has loaded a pack and does not remember the call, so call it again once
the pack has loaded — from `onLoad`, or from a listener added with `player.addListener`.

It plays the sections through the player's `getLabelTable` and
`setAnimationSection`, which `react-native-spritestudio` exposes for
any section named by labels — see [Transport](/usage/transport#the-imperative-half).
