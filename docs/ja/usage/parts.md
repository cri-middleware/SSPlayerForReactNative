---
title: パーツの上書きと追従
description: パーツの色変え・非表示・差し替えと、パーツにビューを追従させる方法。
---

# パーツの上書きと追従

## パーツを上書きする

`parts` prop は**宣言的**です。呼び出しの履歴ではなく状態を記述するので、エントリを取り除けばそのパーツはアニメーションが言うとおりの状態に戻ります。

```tsx
import { SpriteStudioView, SsBlendOp } from 'react-native-spritestudio'

<SpriteStudioView
  source={SsAssets['Ringo/Ringo']}
  parts={{
    body: { color: '#ff3366', blendOp: SsBlendOp.mix },
    hat: { hide: true },
  }}
/>
```

マップのキーは**アーティストが付けたパーツ名**です。現在のアニメーションが持たない名前はコンソールに警告を出してスキップされるので、打ち間違いは黙って無視されるのではなくその旨が表示されます。

### 1 つのパーツに指定できるもの

すべてのフィールドは省略可能で、省略したものはアニメーションに委ねられます。オーバーライドは置き換えではなくパッチです。

| フィールド | 型 | 意味 |
|---|---|---|
| `hide` | `boolean` | `true` でパーツを強制的に隠します。`false` はキーを省いたときと同じく、このプレイヤーの hide オーバーライドを解除し、アニメーション自身の hide に戻します。アニメーションが隠しているパーツを表示するものではありません。 |
| `cascade` | `boolean` | `hide: true` を子孫まで及ぼすか。既定は `false` — SpriteStudio ではキーフレームの hide が子孫に及ばないため、カスケードは opt-in です。 |
| `color` | `string \| number` | 色味。Skia が解釈できるもの（`'#f00'`、`'rgba(255,0,0,.5)'`）か、パックされた `0xRRGGBBAA` の数値。 |
| `blendOp` | `SsBlendOpValue` | 色味の合成方法：`SsBlendOp.mix` / `.mul` / `.add` / `.sub`。既定は `mix`。 |
| `cell` | `SsCellRef` | パーツが参照するセルを差し替えます。 |
| `priority` | `SsOverridePriorityValue` | タイムラインに対してどれだけ長く残るか。 |

::: tip 色の文字列は Skia が解釈します
`color` を解釈するのは `Skia.Color` であって、このパッケージで書かれたパーサーではありません。共通の概念に対する 2 つ目の実装は、整合を保てる数より 1 つ多いからです。
`ssPackColor` は同じ変換で、パックされた数値そのものが欲しい呼び出し側のために公開されています。
:::

### セルを差し替える

`cell` はパーツをアトラス内の別の画像に向けます。どちらの名前も `.ssab` が持っているものを使い、セルマップ名は `.ssce` 拡張子を**付けません**。

```tsx
parts={{
  face: { cell: { cellmap: 'Ringo', cell: 'face_angry' } },
}}
```

::: info `cell` は 1 パーツ、`setCellmapTexture` はアトラスまるごと
この 2 つは別のツールで、混同しないことが大切です。ここでの `cell` は**パーツ単位**のオーバーライドで、*1 つの*パーツが参照するセルを、アトラスに既にあるセルの中から変えます（口の形、目の状態など）。セルマップが描画に使う**テクスチャそのもの**を差し替える — そのセルマップを使う全パーツをまとめて色替えする、衣装アトラスに入れ替える — なら、代わりに
[`player.setCellmapTexture`](/ja/usage/textures#from-code-at-runtime) を使います。一方は同じ画像の別の領域を選び、もう一方は別の画像を渡します。
:::

### オーバーライドはどれだけ持続するか {#how-long-an-override-lasts}

`priority` の既定は `SsOverridePriority.holdUntilNextAnimation` で、これは C-API の既定（`HoldUntilNextAnimation`）と同じ、他のプレイヤーとも揃った値です。

`hat: { hide: true }` を持つマップが「その prop がそう言っている限り帽子は隠れている」という意味になることは、priority ではなくマップの再適用が担保します — 下記のとおり、オーバーライドはアニメーションが設定されるたびに replay されるためです。

| | |
|---|---|
| `overwriteOnNextKeyframe` | 次に作成されたキーでアニメーションがそのパーツを取り戻します。 |
| `holdUntilNextAnimation` | キーフレームは越えますが、別のアニメーションが設定されると解除されます。**既定値。** |
| `permanent` | アニメーションの切り替えを越えて保持されます。 |

オーバーライドは priority に関わらず、新しく設定されたアニメーションのたびに再適用されます。`setup_animation` がオーバーライドレイヤーを他のすべてと一緒にリセットするためです — [再生の制御](/ja/usage/transport#what-setup-animation-resets)を参照してください。

## パーツに追従する {#following-a-part}

`<SpriteStudioPartAnchor>` は React のビューをパーツに乗せます — 頭の上の HP バー、手に添えた照準レティクル — フレームごとの再レンダリングなしに。`<SpriteStudioView>` の `children` の中では、そのビューのプレイヤーを見つけます。

```tsx
<SpriteStudioView source={SsAssets['Ringo/Ringo']}>
  <SpriteStudioPartAnchor partName="head">
    <HealthBar />
  </SpriteStudioPartAnchor>
</SpriteStudioView>
```

子の左上の角がパーツの原点に乗り、そこを中心に回ります。別の点で留めたいなら子をずらしてください。子はパーツと一緒に回り（`rotation`、既定 `true`）、大きさは変えません（`scale`、既定 `false`） — 名札が胸と一緒に呼吸しては困るからです。子は最初に描画できるフレームでマウントされ、パーツが解決されるまで隠れています。

自前のスタイルで追従させるなら、anchor が読んでいる `useSsPartTransform` を使います。パーツの配置を Reanimated の shared value 経由で公開します。ビューの `children` の中では、渡すプレイヤーは `useSsViewPlayer()` です。

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

返ってくるのは**ビューピクセルで、ルートトランスフォームが適用済み**のもの — ビューの `children` が存在する空間です。射影すべきものは残っていません。

`valid` はパーツが特定されるまで false で、存在しない名前は永久に true になりません。最初のフレームから位置があると仮定せず、これを確認してください。shared value は原点から始まるので、確認を省いた追従表示はパーツが解決されるまで隅に座り続けます。

::: info プレイヤーローカルの読み取りはもう一方です
`player.getPartTransform(name)` はパーツを**プレイヤーローカル単位**で、ルートトランスフォーム未適用のまま返します。アニメーション自身の空間で作業しているときはこちらを使います。画面に到達するのは `useSsPartTransform` の方です。
:::

::: info 追従姿勢に Skew は含まれません
パーツの **Skew** は非伝搬のローカル頂点変形（パーツ単位のクアッドせん断）で、ワールド行列には乗らず、追従先にも伝わりません。`getPartTransform` が報告するのは**位置・回転・スケールだけ**です。せん断されたパーツに乗せたビューや、せん断された親の配下にあるパーツに追従したビューは、せん断されません。これは SpriteStudio の挙動どおりで、Skew は子やアタッチメントに継承されないためです。
:::

### そのフレームでパーツが表示されているか

`getPartTransform` と `useSsPartTransform` が報告するのは、描画されているかどうかに関わらず「パーツがどこに**いるはずか**」です。アニメーションが隠しているパーツも、変換そのものは正しく持っています。パーツから駆動するビューには、もう半分の答えが必要になります:

```ts
// 位置は変換から、表示するかどうかは hide フラグから決めます。
const hidden = player.isPartHidden(target)
```

`isPartHidden(part)` はパーツ**名またはインデックス**を取り、**表示フレーム**（実際に描かれたフレーム。サブフレームが off のときは floor されたもの）を読むので、画面に出ているものと食い違いません。返すのはそのフレームの hide で、アニメーション自身の hide に加えて `setPartOverrides` の `hide: true` も含み、`cascade` を指定したときはそれで隠れる子孫も含みます。オーバーライドは、プレイヤーが次に進むかシークしたときに反映されます。未知の名前・範囲外のインデックス・最初のフレームが再生される前は `false` です。

これは兄弟プレイヤーが組み込みのアタッチメントに用意している `onHide` オプションにあたるものです。このプレイヤーに管理型のアタッチメントは無く、追従は pull API なので、隠れたパーツをどう扱うか（ビューも一緒に隠すか、その場に残すか）はホストの判断です。

### メッシュ（スキン）パーツには直接追従できません

ボーンにバインドされた**スキンメッシュ**パーツ（手・顔などの変形パーツ）は、頂点がボーンのスキニングで描かれる一方、パーツ自身の変換（`useSsPartTransform` が報告するもの）は**セットアップ時のノード位置、多くはキャラクターのルート付近**に留まります。そのため、こうしたパーツを追従先に指定すると、対象は見た目の絵ではなくルート付近に吸い寄せられます。これは直すべき不具合ではなくデータの性質です — ノードと変形後の頂点は別の位置にあり、変換はノードに忠実だからです。

メッシュパーツの位置に追従させたいときは、SpriteStudio 側でその位置に **NULL パーツ**（ボーンポイント／空パーツ）を1つ置き、**そのパーツ名**を追従先に指定してください。ボーン（armature）やジョイントパーツを指定しても同様です — null / joint / armature /
ボーンポイントのパーツは自身のノードが絵の位置にあるため、良い追従先になります。

`isPartSkinnedMesh(part)` は、どのパーツがこれに該当するかを報告します — 兄弟プレイヤー（SpriteStudio Player for Web・SpriteStudio Player for wgpu）と同じ判定で、パックの `.ssab` から読み取ります。追従先として妥当なパーツだけを提示するピッカーの構築に使えます:

```ts
// 追従先として実際に使えるパーツ: スキンメッシュ以外すべて。
const followable = player
  .partNames()
  .filter((name) => name !== '' && !player.isPartSkinnedMesh(name))
```

パーツの**名前またはインデックス**を取り、リジッド（変形のみ）メッシュと非メッシュパーツ — これらは正常に追従できます — に対しては `false`、不明な名前やロード前も
`false` を返します。加えて安全弁として、`useSsPartTransform` でスキンメッシュを追従しようとするとパーツ名を挙げた `__DEV__` 警告が一度だけ出力されます。これは**非ブロッキング**で、変換は拒否されず publish され続けます。

::: warning こちらはフレームループを 1 つ消費します
このフックのインスタンスは現在、ビューのものとは別に自前の `requestAnimationFrame` を回し、毎フレーム**名前で**パーツを JSI 越しに読んでいます。動作はしますが、設計の他の部分が取り除いたはずのフレームごとの JS 処理を再導入している唯一の API です —
[ROADMAP](https://github.com/cri-middleware/SSPlayerForReactNative/blob/HEAD/ROADMAP.md)
を参照してください。
:::
