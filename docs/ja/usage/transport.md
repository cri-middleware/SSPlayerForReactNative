---
title: 再生の制御
description: 再生・一時停止・シーク・方向・ループ — 宣言的にも命令的にも。そして直感どおりではない挙動について。
---

# 再生の制御

アニメーションが*どう*再生されるかのすべてです。宣言的な側は 5 つの prop で、残りはプレイヤーオブジェクト上にあり、ref から到達します。

**再生状態を所有しているのはプレイヤーで、その上の層はそれを複製しません。** prop は素通しで、値を持つのはプレイヤーだけです。

## 宣言的な側

```tsx
<SpriteStudioView source={…} animation="walk" playing speed={1.5} loop={0} />
```

| prop | 既定値 | 意味 |
|---|---|---|
| `animation` | パックの最初のもの | パック内のどのアニメーションか。 |
| `transitionMs` | `0` | `animation` が変わるときにクロスフェードするミリ秒数。`0` ならそのまま切り替えます。[モーションブレンディング](/ja/usage/motion-blending)を参照。 |
| `playing` | `true` | `false` なら止めます — `false` で始めたときは最初のフレーム、あとから `false` にしたときはその場で。 |
| `speed` | `1` | 作成時のフレームレートに対する倍率。 |
| `loop` | `0` | 何回再生するか。**`0` は無限**、`1` は 1 回だけ。 |

## 命令的な側

```tsx
const ref = useRef<SpriteStudioViewRef>(null)

ref.current?.player?.setAnimation('attack')
ref.current?.player?.seek(12)
ref.current?.player?.setSpeedScale(0.5)
```

| | |
|---|---|
| `play()` / `pause()` / `resume()` / `stop()` | 下の「4 つの動詞」を参照。 |
| `seek(frameNo)` | 再生ヘッドを移動します。 |
| `setAnimation(name)` | 別のアニメーションを選択し、先頭フレームで待機させます。**再生は始めません** — `play()` を呼んでください。その名前が無ければ `false` を返し、すでに設定済みのアニメーションなら何もしません。 |
| `setSpeedScale(rate)` / `setLoopCount(loops)` | prop と同等のもの。 |
| `setAnimationSection(start, end)` | 現在のアニメーションの再生範囲を `start` から `end` までのフレームに制限します（両端を含みます）。範囲外の値（`-1` など）を渡すと、その側はアニメーションの端になります。両端が範囲内で `end` が `start` より前なら何も変えず、`false` を返して警告します。`setAnimation` を跨いでは保持されません。 |
| `setAnimationSectionByLabel(startLabel, endLabel, startOffset?, endOffset?)` | 同じことを、現在のアニメーションのラベルで指定します。`startLabel` のフレームに `startOffset` を足したところから、`endLabel` のフレームに `endOffset` を足したところまでです。`_start` と `_end` はアニメーションの最初と最後のフレームを指します。そのラベルが無いとき、または `setAnimationSection` が拒否する区間になったときは何も変えず、`false` を返して警告します。 |
| `setFrameSkipEnabled(enabled)` | ON（既定）は実時間に追従してフレームを飛ばし、OFF は 1 tick で 1 フレームだけ進めます。 |
| `setFrameRate(fps)` | 進行レートを **絶対値** の fps で上書きします。`0` で解除。`setAnimation` を跨いで保持されます。 |
| `setSubFrameEnabled(enabled)` | サブフレーム補間。**既定 ON** で、描画が authored フレームの間に位置することを許すかどうかです。 |
| `setPlaybackDirection(direction, style)` | 下記。 |
| `getAnimationNames()` | 読み込んだパックが持つアニメーション名。 |
| `getLabelTable(animation?)` | 現在のアニメーション（名前を渡せばそのアニメーション）のラベルをフレーム順に、最初と最後のフレームと一緒に返します。パックに無いアニメーションなら `null` です。 |

`setSpeedScale` と `setFrameRate` はどちらもレート制御で、併用できますが意味が違います。**速度は倍率**なのでどのクリップに対しても同じ意味になり、**フレームレートは置き換え**なので、30fps のクリップに 60 を指定すれば倍速、60fps のクリップなら等速です。

現在位置を読むには `frameNo`・`startFrame`・`endFrame`・`totalFrames`・`isPlaying`・
`isPausing`・`isFinished`・`isPlayingForward`・`justLooped`・`currentAnimation`・
`frameRate`・`partCount` があります。

上の setter にはそれぞれ getter が対応します（`speedScale`・`loopCount`・
`frameSkipEnabled`・`subFrameEnabled`・`playbackDirection`・`playbackStyle`）。返すのは要求値ではなく、ランタイムが適用した値です。特に `speedScale` で効きます。`0` と負値はランタイムが停止にクランプするので、`-2` を設定して読み戻すと、要求が示す逆再生ではなく実際になった `0` が返ります。

`partNames()` はパーツ名をパーツ index 順で返します。イベントの `partIndex` を人間が読める形に戻す、パーツ一覧 UI を作る、といった用途です。名前の無いパーツは `''` で枠を保持するので index と揃ったままです。個数は `partCount` より `partNames().length` を使ってください。`partCount` はランタイムのパーツ行列の数なので、最初の `advance` まで `0` です。

`justLooped` は**パルス**です。直近の `advance` が走った tick の間だけ真で、次の tick で置き換わります。ポーリングしたくなければ `onAnimationLooped` が同じエッジを配ります。

`play()` はフレームを 1 つ取れます。`play(12)` は区間の先頭ではなくフレーム 12 から頭出しし、そのフレームがループ回数の基準になります。seek してから play しても同じにはなりません（`play` は巻き戻すため）。

`isPlayingForward` だけは性質が異なります。これはプレイヘッドが実際にどちら向きに進んでいるかであり、`setPlaybackDirection` で設定した向きとは**別物**です — ピンポン再生の戻りの脚では、設定上の向きは forward のままでも実際には後ろ向きに進みます。音声はこれでゲートしてください。SpriteStudio に逆再生音声は無いため、後ろ向きの脚で跨いだキーは鳴らすべきものではありません。

```ts
player.onAudio = (e) => {
  if (player.isPlayingForward) mySoundBank.play(e.soundName, e.loopNum)
}
```

## play・pause・resume・stop は 4 つの別々の動詞です

どれも他の言い換えではありません。

| | |
|---|---|
| `play()` | **頭出し。** 区間の先頭（方向が backward のときは最後のフレーム）へ巻き戻し、ループ回数を再武装します。`pause()` を解除する目的で使うと再生ヘッドが先頭に戻ります。 |
| `pause()` | その場で保持します。冪等で、何も再生していなければ無視されます。独立再生のパーツは動き続けます。 |
| `resume()` | `pause()` を解除し、同じフレームから続けます。冪等で、**停止中は何もしません** — 開始は `play()` の役目です。 |
| `stop()` | 再生を終了します。巻き戻さないので、停止したフレームがそのまま残り、次の `play()` までは独立再生のパーツも含めて何も動きません。 |

`isPlaying` は `pause()` を跨いで **true のまま**です（pause は保持であって停止ではありません）。「いま進んでいるか」は `isPlaying && !isPausing` です。

`playing` prop はこの 4 つへの写像をこちらで行います。`false` は pause、`true` は保持中なら resume、まったく動いていなければ頭出しです。Player 自身は 4 つを分けたまま持ちます。

::: warning `onAnimationStarted` は再開では発火しません
start は*最初から始まった*ことを意味します。再開は同じ動詞のもう半分であり、そこで「開始」を発火させるとリスナーから両者を区別できなくなります。すでに設定済みのアニメーションを `setAnimation` で設定し直しても何も起きず、`onAnimationStarted` も `onAnimationChanged` も発火しません。やり直しは `play()` で、`onAnimationStarted` として報告されます。
:::

## 方向とスタイル

```tsx
import { SsPlaybackDirection, SsPlaybackStyle } from 'react-native-spritestudio'

player.setPlaybackDirection(SsPlaybackDirection.backward, SsPlaybackStyle.pingPong)
```

| | |
|---|---|
| `SsPlaybackDirection.forward` / `.backward` | 再生ヘッドが進む向き。 |
| `SsPlaybackStyle.normal` | 端に達したら先頭へ戻る、またはループ数に応じて停止する。 |
| `SsPlaybackStyle.pingPong` | 折り返して戻る。1「ループ」が往復 1 回分になります。 |

`style` を省略した場合の既定は `normal` です。

## アニメを切り替えると何がリセットされるか {#what-setup-animation-resets}

アニメーションを設定すると、ループ回数・再生区間と、`permanent` ではないパーツのオーバーライドがリセットされます。速度・フレームレートの上書き・フレームスキップ・方向とスタイルは引き継がれます。それに加えて `SpriteStudioPlayer` は、新しく設定されたアニメーションに自分の設定を再適用します（速度、ループ回数、フレームスキップ、サブフレーム、フレームレートの上書き、方向、スタイル、`parts` マップ全体）。そのため新しいアニメーションは、最後に設定した内容で立ち上がります。再生中かどうかは含まれません。切り替えた直後のアニメーションは先頭フレームで止まっているので、`play()` を呼んでください。`animation` prop なら、`playing` が true の間はこれをコンポーネントが行います。

これを知る必要があるのは、驚いたときだけです。速度を設定して*その後で*アニメーションを切り替えても安全です。再適用はセットアップの後に行われるからです。

## クロック {#the-clock}

`advance(dtMilliseconds)` は外部からクロックを与えられます。シーンが 20 個のプレイヤーを
1 つのループで駆動できるのは、まさにこのためです。`<SpriteStudioView>` は自身の
`requestAnimationFrame` を回し、`<SpriteStudioScene>` は内部のすべてに対してちょうど
1 つだけ回します。

::: tip バックグラウンドから戻っても早送りしません
どちらのクロックもステップを `MAX_STEP_MS`（1000/15 ≈ 66.7 ms）で頭打ちにします。この上限が無いと、バックグラウンドから復帰したアプリに巨大なデルタが 1 つ渡り、アニメーションは取りこぼしたフレームをすべて早送りします — **その上のイベントもすべて発火させながら**です。
:::

`advance()` を自分で駆動する場合、単位は**ミリ秒**で、`performance.now()` の差分は既にその単位です。同じように上限を設けてください。
