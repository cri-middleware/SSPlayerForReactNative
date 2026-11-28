---
title: コンポーネント早見
description: 4 つのコンポーネント、ボタン、5 つのフック、それぞれの役割と、動く最小の形。
---

# コンポーネント早見

コンポーネント 4 つとフック 5 つ、それに別のパッケージのボタン。ほとんどのアプリはコンポーネント 1 つだけで足り、フックは使いません。

| | こういうとき |
|---|---|
| [`<SpriteStudioView>`](#spritestudioview) | アニメーションが**1 つ**。既定の選択肢。 |
| [`<SpriteStudioScene>`](#spritestudioscene) + [`<SpriteStudioSprite>`](#spritestudiosprite) | **複数**あり、まとめてキャンバス 1 枚・クロック 1 つで済ませたい。 |
| [`<SpriteStudioPartAnchor>`](#spritestudiopartanchor) | ビューをパーツに乗せたい — 頭の上の HP バーなど。 |
| [`<SpriteStudioButton>`](#spritestudiobutton) | アニメーションをボタンにしたい。`react-native-spritestudio-ui` にあります。 |

## `<SpriteStudioView>`

アニメーション 1 つを自身の箱に収めます。Skia のキャンバスとフレームループを内包した、ごく普通の React Native ビューです。

```tsx
import { SpriteStudioView } from 'react-native-spritestudio'

<SpriteStudioView
  source="ss/Ringo/Ringo.ssab"
  animation="wait1"
  fit="contain"
  style={{ width: '100%' }}
/>
```

| prop の分類 | |
|---|---|
| 何を再生するか | `source`・`animation`・`transitionMs`・`playing`・`speed`・`loop` |
| どこに置くか | `fit`・`align`・`offset`・`scale`・`flipX`・`flipY`・`style` |
| ボックス | `frame`・`frameScope`・`measureFrames` |
| 反応する | `onUserData`・`onAudio`・`onSignal`・`onLoad`・`onError`・`onAnimationFinished`・`onAnimationLooped`・`onAnimationStarted`・`onAnimationChanged` |
| 上書き | `parts`・`textures` |
| ロード中 | `placeholder` |
| 上に重ねる | `children`（アニメーションの箱に重なります） |
| `<View>` 自身のもの | `testID`・アクセシビリティ系の prop・`pointerEvents`・`onLayout` |

サイズを指定しなければ、作者のキャンバスを表示する `<Image>` と同じように並びます。[基本的な再生](./usage/basic.md#size)を参照してください。

`ref.current.player` が [`SpriteStudioPlayer`](./usage/transport.md) です —
シーク、アニメーション切り替え、コンテンツボックスの読み取り。

::: warning これを 20 個置けばキャンバスが 20 枚
1 つずつがキャンバス*と* `requestAnimationFrame` ループを所有します。キャスト全体を出すならシーンを使ってください。
:::

## `<SpriteStudioScene>`

複数のアニメーションを、**キャンバス 1 枚とクロック 1 つ**で。スプライトを保持し、それらが共有するキャンバス以外は自身では何も描きません。

```tsx
import { SpriteStudioScene, SpriteStudioSprite } from 'react-native-spritestudio'
import { SsAssets } from './ss-assets' // クイックスタートで生成する型付きマニフェスト

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
| `onError` | フレームループが止まったとき。渡していなければ、エラーは `console.error` に出ます。 |

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

シーンの外では警告を出して何も描きません。[複数アニメーション: シーン](./usage/scene.md)を参照してください。

## `<SpriteStudioPartAnchor>`

子をパーツに留めます。`<SpriteStudioView>` の `children` の中ではそのビューのプレイヤーを見つけ、それ以外の場所では `player` に渡します。

```tsx
<SpriteStudioView source={SsAssets['Ringo/Ringo']}>
  <SpriteStudioPartAnchor partName="head">
    <HealthBar />
  </SpriteStudioPartAnchor>
</SpriteStudioView>
```

| prop | 既定値 | |
|---|---|---|
| `partName` | | 追従するパーツ。 |
| `player` | 囲んでいるビューのもの | |
| `rotation` | `true` | パーツと一緒に回ります。 |
| `scale` | `false` | パーツと一緒に拡縮します。 |

[パーツの上書きと追従](./usage/parts.md#following-a-part)を参照してください。

## `<SpriteStudioButton>`

別のパッケージ `react-native-spritestudio-ui` にあります。ボタンになった `<SpriteStudioView>` で、状態（`normal`・`hover`・`pressed`・`disabled`・`focused`）ごとに、1 つのアニメーションのうち状態と同じ名前のラベルから始まる区間を再生します。

```tsx
import { SpriteStudioButton } from 'react-native-spritestudio-ui'

<SpriteStudioButton source="ss/ui/start.ssab" accessibilityLabel="Start" onPress={start} />
```

| prop | |
|---|---|
| `clips` | 状態のラベルの代わりに再生する区間。 |
| `hitParts`・`hitOnArtwork` | 押下を、指定したパーツの輪郭、または輪郭を持つすべてのパーツに絞ります。 |
| `reducedMotion` | 各状態を止めます。省略すると OS の設定に従います。 |
| `accessibilityLabel` | ボタンとして読み上げられます。無ければ装飾です。 |

アニメーションを読み込んで配置するビューの props と、`<Pressable>` の props が使えます。`playing`・`loop`・`transitionMs` は使えません。[UI ボタン](./usage/ui.md)を参照してください。

## フック

上記はすべてフックなしで作れます。コンポーネントで足りないときに手を伸ばしてください。

### `useSsPartTransform`

Reanimated の shared value でパーツに追従します — 頭の上の HP バーなど。普通のアプリが欲しがる可能性があるのは、このフックだけです。

```tsx
// <SpriteStudioView> の children の中のコンポーネントで
const player = useSsViewPlayer()
const transform = useSsPartTransform(player, 'head')
```

**ビューピクセル・ルートトランスフォーム適用済み**の
`SharedValue<SsPartScreenTransform>` を返します。[パーツの上書きと追従](./usage/parts.md#following-a-part)と
[Reanimated](./usage/reanimated.md)を参照してください。

### `useSsViewPlayer`

呼び出し側がいる `children` の持ち主である `<SpriteStudioView>` のプレイヤーを返し、その外では `null` を返します。自前の追従で `useSsPartTransform` に渡すのがこれです。

### `useSsTextures`

差し替え用アトラスを `SkImage` へデコードします。`textures` prop の背後にあるフックで、デコード済み画像そのものが欲しい呼び出し側のために公開されています。すべてのテクスチャがデコードされるまで `null` を返します。

```tsx
const images = useSsTextures({ Ringo: require('./winter.png') })
```

[テクスチャとリソース](./usage/textures.md#replacing-a-texture)を参照してください。

### `useSpriteStudioPlayer`

コンポーネント 1 つ分の `SpriteStudioPlayer` を所有します。ロードし、トランスポート系の
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
`SsTextureRegistry`・各キャッシュ・`ssPreload`・`ssCheckForLeaks`・オーバーライドの語彙・`SsRuntimeModule` — は[どこから見るか](./api-guide.md)と[生成リファレンス](https://cri-middleware.github.io/SSPlayerForReactNative/api/)が扱います。
