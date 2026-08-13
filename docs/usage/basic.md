---
title: Basic playback
description: The props on SpriteStudioView, and what a source may be.
---

# Basic playback

```tsx
<SpriteStudioView
  source="ss/overall/Basic.ssab"
  animation="anime_1"
  playing
  speed={1}
  loop={0}
  fit="contain"
  style={{ flex: 1 }}
/>
```

## What a `source` may be

| Form | Example |
|---|---|
| a path inside your asset root | `"ss/overall/Basic.ssab"` |
| a filesystem path or `file://` URI | a download, an unpacked bundle |
| an `http(s)` URL | a dev server, a CDN |

Siblings — textures, external packs — resolve the same way in all three. A
`require()`d module is **not** a source; see [Preparing assets](/setup/assets).

::: tip A remote `.ssab` is untrusted input
The buffer is verified before the native runtime sees it, so a truncated
download is rejected rather than parsed. What is *not* checked is the reference
graph — see [Limitations](/limitations#untrusted-packs).
:::

## Transport

`playing`, `speed` and `loop` are declarative props; `loop={0}` is forever and
`loop={1}` plays once. For imperative control, reach the Layer 3 player through
the ref:

```tsx
const ref = useRef<SpriteStudioViewRef>(null)
ref.current?.player?.setAnimation('walk')
```

The player owns the playback state and nothing above it mirrors that — the props
are passthrough.

## Placement

`fit` takes `<Image resizeMode>`'s vocabulary (`contain`, `cover`, `none`) and
`align` picks which point of the content box lands on the matching point of the
view. Supply `frame` to skip the measurement when you already know the box.
