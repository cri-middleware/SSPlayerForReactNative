---
title: 複数アニメーション、1 枚のキャンバス
description: SpriteStudioScene と SpriteStudioSprite — キャスト全体をキャンバス 1 枚とクロック 1 つで。
---

# 複数アニメーション: シーン

`<SpriteStudioView>` はキャンバスとフレームループを 1 つずつ所有します。アニメーション
1 つには正しく、20 個には誤りです — ビュー 20 個はキャンバス 20 枚とクロック 20 個です。

```tsx
import { SpriteStudioScene, SpriteStudioSprite } from 'react-native-spritestudio'

<SpriteStudioScene style={{ flex: 1 }}>
  <SpriteStudioSprite source={SsAssets['Ringo/Ringo']} x={100} y={200} />
  <SpriteStudioSprite source={SsAssets['Ringo/Ringo']} x={260} y={200} speed={0.5} />
</SpriteStudioScene>
```

キャンバス 1 枚、クロック 1 つ、フレーム 1 つ。`advance(dt)` は外からクロックを受け取るので、ツリー全体を 1 つのループで進められます。

スプライトは**自分では何も描画しません**。その仕事はプレイヤーを保持し、ルートトランスフォームを最新に保ち、シーンに登録され続けることだけです。すべてが描き込むキャンバスを所有しているのはシーンの方です。

## スプライト固有のものと、共通のもの

*どのアニメーションをどう再生するか*に関するものはすべて `<SpriteStudioView>` と共通です
— `source`・`animation`・`playing`・`speed`・`loop`・`parts`・`textures`、およびすべてのコールバックは、そちらとまったく同じ意味を持ちます。違うのは配置で、スプライトはビューに自身を合わせるのではなく、シーン内の一点に置かれます。

| prop | 意味 |
|---|---|
| `x` / `y` | 素材を置く位置。**シーン左上からのシーンピクセル**です。 |
| `width` / `height` | 素材を収めるボックス。両方省略すると fit は一切行われません。 |
| `align` | そのボックスのどの点が `x`/`y` に来るか。 |
| `scale` | fit のスケールに上乗せする倍率。fit が無ければスケールそのもの。 |
| `flipX` / `flipY` | 反転。 |
| `z` | シーン内の描画順。同値のときはマウント順で決まります。 |

::: info `x`/`y` が実際に何を固定するかは、他の prop 次第です
`width` と `height` があればボックスが存在し、`align` がそのどの点を `x`/`y` に合わせるかを決めます。**両方が無ければ収めるべきボックスがない**ので、`x`/`y` はアニメーション自身の原点 — 作者がエディタで置いた場所 — を指すことになります。
:::

## シーン全体を止める

```tsx
<SpriteStudioScene paused={backgrounded}>
```

`paused` はシーンのクロックを止めます — 内部のすべてのスプライトを、1 か所で。これは各スプライトへの `playing={false}` とは異なります。あちらはプレイヤーごとに再生状態を設定するもので、こちらはそれらを駆動しているティック自体を止めます。

## スプライトのプレイヤーに到達する

```tsx
const ref = useRef<SpriteStudioSpriteRef>(null)
ref.current?.player?.setAnimation('attack')
```

ビューのものと同じプレイヤーで、[再生の制御](/ja/usage/transport)も同じです。

::: warning シーンの外のスプライトは何も描きません
コンソールに警告を出し、何もレンダリングしません。空のボックスを黙って生成することはしません。シーンのキャンバスを通して描画するので、その外には描き込む先が無いためです。
:::

::: tip 1 つの例外がシーン全体を止めます
イベントはシーンのただ 1 つの `advance()` パスの中で配送されるので、あるスプライトのハンドラからの例外は、そのシーンの**すべての**スプライトのクロックを止めます —
[トラブルシューティング](/ja/troubleshooting#the-animation-froze-mid-play)を参照してください。
:::
