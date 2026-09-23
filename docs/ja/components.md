---
title: コンポーネント早見
description: 3 つのコンポーネントと 4 つのフック、それぞれの役割と、動く最小の形。
---

# コンポーネント早見

コンポーネント 3 つとフック 4 つ。ほとんどのアプリはコンポーネント 1 つだけで足り、フックは使いません。

| | こういうとき |
|---|---|
| [`<SpriteStudioView>`](#spritestudioview) | アニメーションが**1 つ**。既定の選択肢。 |
| [`<SpriteStudioScene>`](#spritestudioscene) + [`<SpriteStudioSprite>`](#spritestudiosprite) | **複数**あり、まとめてキャンバス 1 枚・クロック 1 つで済ませたい。 |

## `<SpriteStudioView>`

アニメーション 1 つを自身の箱に収めます。Skia のキャンバスとフレームループを内包した、ごく普通の React Native ビューです。

```tsx
import { SpriteStudioView } from 'react-native-spritestudio'

<SpriteStudioView
  source="ss/overall/Basic.ssab"
  animation="anime_1"
  fit="contain"
  style={{ flex: 1 }}
/>
```

| prop の分類 | |
|---|---|
| 何を再生するか | `source`・`animation`・`playing`・`speed`・`loop` |
| どこに置くか | `fit`・`align`・`offset`・`scale`・`flipX`・`flipY`・`style` |
| 計測 | `frame`・`frameScope`・`measureFrames` |
| 反応する | `onUserData`・`onAudio`・`onSignal`・`onLoad`・`onError`・`onAnimationFinished`・`onAnimationLooped`・`onAnimationStarted`・`onAnimationChanged` |
| 上書き | `parts`・`textures` |
| ロード中 | `placeholder` |

`ref.current.player` がレイヤー 3 の [`SpriteStudioPlayer`](/ja/usage/transport) です —
シーク、アニメーション切り替え、コンテンツボックスの読み取り。

::: warning これを 20 個置けばキャンバスが 20 枚
1 つずつがキャンバス*と* `requestAnimationFrame` ループを所有します。キャスト全体を出すならシーンを使ってください。
:::

## `<SpriteStudioScene>`

複数のアニメーションを、**キャンバス 1 枚とクロック 1 つ**で。スプライトを保持し、それらが共有するキャンバス以外は自身では何も描きません。

```tsx
import { SpriteStudioScene, SpriteStudioSprite } from 'react-native-spritestudio'

<SpriteStudioScene style={{ flex: 1 }} paused={backgrounded}>
  <SpriteStudioSprite source={SsAssets['Ringo/Ringo']} x={100} y={200} />
  <SpriteStudioSprite source={SsAssets['Ringo/Ringo']} x={260} y={200} z={1} />
</SpriteStudioScene>
```

| prop | |
|---|---|
| `children` | スプライト群。 |
| `style` | キャンバスの箱。 |
| `paused` | **すべての**スプライトのクロックを一度に止めます。 |
| `onError` | |

## `<SpriteStudioSprite>`

シーンの中のアニメーション 1 つ — ビューではなく、位置と描画順です。**自分では何も描画せず**、シーンのキャンバスが描きます。

```tsx
<SpriteStudioSprite
  source={SsAssets['Ringo/Ringo']}
  animation="walk"
  x={100}
  y={200}
  z={1}
/>
```

*どのアニメーションをどう再生するか*に関するものは `<SpriteStudioView>` と共通です。違うのは配置で、`x`・`y`・`width`・`height`・`align`・`scale`・`flipX`・`flipY`・`z`。

シーンの外では警告を出して何も描きません。[複数アニメーション: シーン](/ja/usage/scene)を参照してください。

## フック

上記はすべてフックなしで作れます。コンポーネントで足りないときに手を伸ばしてください。

### `useSsPartTransform`

Reanimated の shared value でパーツに追従します — 頭の上の HP バーなど。普通のアプリが欲しがる可能性があるのは、このフックだけです。

```tsx
const transform = useSsPartTransform(player, 'head')
```

**ビューピクセル・ルートトランスフォーム適用済み**の
`SharedValue<SsPartScreenTransform>` を返します。[パーツの上書きと追従](/ja/usage/parts#following-a-part)と
[Reanimated](/ja/usage/reanimated)を参照してください。

### `useSsTextures`

差し替え用アトラスを `SkImage` へデコードします。`textures` prop の背後にあるフックで、デコード済み画像そのものが欲しい呼び出し側のために公開されています。すべてのテクスチャがデコードされるまで `null` を返します。

```tsx
const images = useSsTextures({ Ringo: require('./winter.png') })
```

[テクスチャとリソース](/ja/usage/textures#replacing-a-texture)を参照してください。

### `useSpriteStudioPlayer`

コンポーネント 1 つ分のレイヤー 3 プレイヤーを所有します。ロードし、トランスポート系の
prop を反映し続け、描画可能になったら報告します。**意図的にクロックではありません** —
プレイヤーを誰が進めるかは呼び出し側の裁量です。

```tsx
const { player, measured, ready } = useSpriteStudioPlayer(props)
```

`<SpriteStudioView>` と `<SpriteStudioSprite>` が共有している半分がこれです。自前のコンポーネントを書いていて、キャンバス抜きでロードと prop 同期だけが欲しい場合に使います。

### `useSsScene`

スプライトが登録されるシーンのレジストリを返し、シーンの外では `null` を返します。主に、コンポーネントが空の箱を描く代わりに「シーンが必要だ」とはっきり言えるようにするためのものです。

## それ以外

ここに挙げた以外の公開 API — `SpriteStudioPlayer`・`SsInternalPlayer`・
`SsTextureRegistry`・各キャッシュ・`ssPreload`・`ssCheckForLeaks`・オーバーライドの語彙・`SsRuntimeModule` — は[どこから見るか](/ja/api-guide)と[生成リファレンス](/api/)が扱います。
