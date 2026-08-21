---
title: 基本的な再生
description: SpriteStudioView の prop、source に指定できるもの、そして描画位置の決め方。
---

# 基本的な再生

```tsx
<SpriteStudioView
  source="ss/overall/Basic.ssab"
  animation="anime_1"
  fit="contain"
  style={{ flex: 1 }}
/>
```

`<SpriteStudioView>` は、たまたま Skia のキャンバスとフレームループを内包しているだけの、
ごく普通の React Native ビューです。他のビューと同じように配置し、サイズを決め、
クリップし、アニメーションさせられます。**複数**のアニメーションを同時に扱うなら
[シーン](/ja/usage/scene)を使ってください — ビュー 20 個はキャンバス 20 枚とクロック
20 個です。

## `source` に指定できるもの

| 形式 | 例 |
|---|---|
| アセットルート内のパス | `"ss/overall/Basic.ssab"` |
| ファイルシステムのパス、`file://` URI | ダウンロード、展開済みバンドル |
| `http(s)` URL | 開発サーバー、CDN |

兄弟ファイル — テクスチャ、Instance パーツが参照する外部パック — の解決はいずれの形式でも
同じです。`require()` したモジュールは source としては**使えません**。
[アセットの準備](/ja/setup/assets)を参照してください。

::: tip リモートの `.ssab` は信頼できない入力です
バッファはネイティブランタイムに渡る前に検証されるので、途中で切れたダウンロードは
パースされずに拒否されます。検証*されない*のは参照グラフの方です —
[制約と適用範囲](/ja/limitations#untrusted-packs)を参照してください。
:::

## 再生の制御

`playing`・`speed`・`loop` は宣言的な prop です。`loop={0}` は無限、`loop={1}` は 1 回だけ
再生します。命令的に操作する場合は、ref からレイヤー 3 のプレイヤーに到達します。

```tsx
const ref = useRef<SpriteStudioViewRef>(null)
ref.current?.player?.setAnimation('walk')
```

再生状態を所有しているのはプレイヤーで、その上の層はそれを複製しません — prop は
素通しです。シークや再生方向、ピンポン再生、そして直感に反する挙動については
[再生の制御](/ja/usage/transport)が扱います。

## 配置

素材は自身の単位系で**コンテンツボックス**を持ち、配置はそのボックスがビューのどこに
収まるかを決めます。

| prop | 既定値 | 意味 |
|---|---|---|
| `fit` | `'contain'` | ボックスの拡縮方法：`contain`・`cover`・`none`。`<Image resizeMode>` と同じ語彙です。 |
| `align` | `'center'` | ボックスのどの点をビューの対応する点に合わせるか。 |
| `offset` | — | `fit`/`align` が決めた位置からのピクセル数。`fit="none"` ではビュー中心からの計測になります。 |
| `scale` | `1` | fit によるスケールに**上乗せ**する倍率。 |
| `flipX` / `flipY` | `false` | 反転。 |

`align` は `center`・`top`・`bottom`・`left`・`right` と 4 隅を取ります。

### 計測と、その省略

コンテンツボックスはタダではありません。計測はアニメーションを走査し、1 フレームずつ
ベイクします。これを制御する prop が 3 つあります。

| prop | 意味 |
|---|---|
| `frame` | ボックスを自分で与えます。**計測を完全に省略します。** |
| `frameScope` | `'animation'`（既定）は再生中のものを計測、`'pack'` はファイル内の全アニメーションの和を取ります。 |
| `measureFrames` | 走査の上限。既定は `0` で、作成時の 1 サイクル分です。 |

`frameScope: 'pack'` はアニメーションごとの走査コストがかかり、描画も小さくなりますが、
既定では得られないものが手に入ります — **安定したスケール**です。アニメーションが変わって
もキャラクターの大きさが変わりません。その差は大きくなり得ます。`Ringo` の `attack1` は
383×527（プレイヤーローカル単位）ですが、パック全体の和は約 1030×878 です。`dead`
アニメーションがキャラクターを画面のほとんど右まで滑らせるためです。

ボックスが既に分かっていて、どちらのコストも払いたくない場合は `frame` を与えます。

## 最初のフレーム

パックがロードされ、**かつ少なくとも 1 つのテクスチャが登録される**まで、描画できるものは
ありません。`drawInto` はすべてのバッチをスキップするので、そこで空白の矩形を見せるのは
誠実ではありません。

```tsx
<SpriteStudioView source={…} placeholder={<ActivityIndicator />} />
```

`onLoad` はパックの準備ができたときに、`onError` はできなかったときに発火します。
この待ち時間を気にならない程度まで短くする方法が
[`ssPreload`](/ja/usage/textures#preloading) です。
