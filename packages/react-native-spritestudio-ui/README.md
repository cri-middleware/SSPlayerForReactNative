[**English**](./README.md) | [**日本語**](./README.ja.md)

# react-native-spritestudio-ui

**A SpriteStudio animation as a button in a React Native app.**

`<SpriteStudioButton>` is a [`react-native-spritestudio`](https://www.npmjs.com/package/react-native-spritestudio) view that is a button: press, hover, keyboard focus and `disabled` each play a section of one animation, a press can be made to count only on some of its parts, and under reduced motion each state holds still.

- 📖 **[UI buttons](https://cri-middleware.github.io/SSPlayerForReactNative/usage/ui)** — the guide
- 📦 **[Repository](https://github.com/cri-middleware/SSPlayerForReactNative)** — the player, the roadmap and the example app

## Install

```bash
npx expo install react-native-spritestudio-ui
```

It takes `react-native-spritestudio` as a peer at the same version — install and set that up first ([Installation](https://cri-middleware.github.io/SSPlayerForReactNative/setup/install)).

## Use

1. **Author the states** in one animation: a label named after each state — `normal`, `hover`, `pressed`, `disabled`, `focused` — where that state's loop starts. Each runs to the frame before the next label. A state without a label falls back (`pressed` to `hover`, the rest to `normal`), and with no labels at all the whole animation plays.
2. **Make the button:**

   ```tsx
   import { SpriteStudioButton } from 'react-native-spritestudio-ui'

   <SpriteStudioButton
     source="ss/ui/start.ssab"
     accessibilityLabel="Start"
     hitParts={['face']}
     onPress={start}
     style={{ width: 240, height: 96 }}
   />
   ```

Under the system's reduce motion setting each state holds its first frame, and `normal` plays a `reduced_motion` label instead when the animation has one. Without `accessibilityLabel` the button is decoration to a screen reader.

## License

BSD-3-Clause — see [LICENSE.md](./LICENSE.md).
