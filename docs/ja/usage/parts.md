---
title: パーツの上書きと追従
description: パーツの色変え・非表示・差し替えと、パーツにビューを追従させる方法。
---

# パーツの上書きと追従

## パーツを上書きする

`parts` prop は**宣言的**です。呼び出しの履歴ではなく状態を記述するので、エントリを
取り除けばそのパーツはアニメーションが言うとおりの状態に戻ります。

```tsx
import { SpriteStudioView, SsPartColorBlend } from 'react-native-spritestudio'

<SpriteStudioView
  source={SsAssets['Ringo/Ringo']}
  parts={{
    body: { color: '#ff3366', colorBlend: SsPartColorBlend.mix },
    hat: { visible: false },
  }}
/>
```

マップのキーは**アーティストが付けたパーツ名**です。現在のアニメーションが持たない名前は
コンソールに警告を出してスキップされるので、打ち間違いは黙って無視されるのではなく
その旨が表示されます。

### 1 つのパーツに指定できるもの

すべてのフィールドは省略可能で、省略したものはアニメーションに委ねられます。
オーバーライドは置き換えではなくパッチです。

| フィールド | 型 | 意味 |
|---|---|---|
| `visible` | `boolean` | パーツの表示・非表示。 |
| `cascade` | `boolean` | `visible: false` を子孫まで及ぼすか。既定は `false` — SS7 ではキーフレームの hide が子孫に及ばないため、カスケードは opt-in です。 |
| `color` | `string \| number` | 色味。Skia が解釈できるもの（`'#f00'`、`'rgba(255,0,0,.5)'`）か、パックされた `0xRRGGBBAA` の数値。 |
| `colorBlend` | `SsPartColorBlendValue` | 色味の合成方法：`SsPartColorBlend.mix` / `.mul` / `.add` / `.sub`。既定は `mix`。 |
| `cell` | `SsCellRef` | パーツが参照するセルを差し替えます。 |
| `priority` | `SsOverridePriorityValue` | タイムラインに対してどれだけ長く残るか。 |

::: tip 色の文字列は Skia が解釈します
`color` を解釈するのは `Skia.Color` であって、このパッケージで書かれたパーサーでは
ありません。共通の概念に対する 2 つ目の実装は、整合を保てる数より 1 つ多いからです。
`ssPackColor` は同じ変換で、パックされた数値そのものが欲しい呼び出し側のために
公開されています。
:::

### セルを差し替える

`cell` はパーツをアトラス内の別の画像に向けます。どちらの名前も `.ssab` が持っている
ものを使い、セルマップ名は `.ssce` 拡張子を**付けません**。

```tsx
parts={{
  face: { cell: { cellmap: 'Ringo', cell: 'face_angry' } },
}}
```

### オーバーライドはどれだけ持続するか {#how-long-an-override-lasts}

`priority` の既定は `SsOverridePriority.untilNextAnimation` で、これは C-API の既定
（`HoldUntilNextAnimation`）と同じ、他のプレイヤー（ForWeb / ForUnity / ForFlutter /
ForGodot / ForRenPy / ForWgpu）とも揃った値です。

`hat: { visible: false }` を持つマップが「その prop がそう言っている限り帽子は隠れて
いる」という意味になることは、priority ではなくマップの再適用が担保します — 下記の
とおり、オーバーライドはアニメーションが設定されるたびに replay されるためです。

| | |
|---|---|
| `untilNextKeyframe` | 次に作成されたキーでアニメーションがそのパーツを取り戻します。 |
| `untilNextAnimation` | キーフレームは越えますが、別のアニメーションが設定されると解除されます。**既定値。** |
| `permanent` | アニメーションの切り替えを越えて保持されます。 |

オーバーライドは priority に関わらず、新しく設定されたアニメーションのたびに再適用
されます。`setup_animation` がオーバーライドレイヤーを他のすべてと一緒にリセットする
ためです — [再生の制御](/ja/usage/transport#what-setup-animation-resets)を参照してください。

## パーツに追従する {#following-a-part}

`useSsPartTransform` はパーツの配置を Reanimated の shared value 経由で公開するので、
React のビューがパーツに乗ることができます — 頭の上の HP バー、手に添えた照準
レティクル — フレームごとの再レンダリングなしに。

```tsx
const transform = useSsPartTransform(player, 'head')
const style = useAnimatedStyle(() => ({
  opacity: transform.value.valid ? 1 : 0,
  transform: [
    { translateX: transform.value.x },
    { translateY: transform.value.y },
    { rotate: `${transform.value.rotation}rad` },
  ],
}))
```

返ってくるのは**ビューピクセルで、ルートトランスフォームが適用済み**のもの — キャンバス
の上に置かれた `Animated.View` が存在する空間です。射影すべきものは残っていません。

`valid` はパーツが特定されるまで false で、存在しない名前は永久に true になりません。
最初のフレームから位置があると仮定せず、これを確認してください。shared value は原点から
始まるので、確認を省いた追従表示はパーツが解決されるまで隅に座り続けます。

::: info プレイヤーローカルの読み取りはもう一方です
`player.getPartTransform(name)` はパーツを**プレイヤーローカル単位**で、ルート
トランスフォーム未適用のまま返します。アニメーション自身の空間で作業しているときは
こちらを使います。画面に到達するのは `useSsPartTransform` の方です。
:::

::: warning こちらはフレームループを 1 つ消費します
このフックのインスタンスは現在、ビューのものとは別に自前の `requestAnimationFrame` を
回し、毎フレーム**名前で**パーツを JSI 越しに読んでいます。動作はしますが、設計の
他の部分が取り除いたはずのフレームごとの JS 処理を再導入している唯一の API です —
[ROADMAP](https://github.com/cri-middleware/SSPlayerForReactNative/blob/main/ROADMAP.md)
を参照してください。
:::
