---
title: Many animations, one canvas
description: SpriteStudioScene and SpriteStudioSprite.
---

# Many animations: a scene

`<SpriteStudioView>` owns a canvas and a frame loop. That is right for one
animation and wrong for twenty: twenty views is twenty canvases and twenty
clocks.

```tsx
import { SpriteStudioScene, SpriteStudioSprite } from 'react-native-spritestudio'

<SpriteStudioScene style={{ flex: 1 }}>
  <SpriteStudioSprite source={SsAssets['Ringo/Ringo']} x={100} y={200} />
  <SpriteStudioSprite source={SsAssets['Ringo/Ringo']} x={260} y={200} speed={0.5} />
</SpriteStudioScene>
```

One canvas, one clock, one frame. A sprite sits at a point in the scene rather
than fitting itself to a view, which is the only difference in the prop types —
everything about *which animation and how it plays* is shared with
`<SpriteStudioView>`.
