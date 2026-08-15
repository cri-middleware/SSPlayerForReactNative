---
title: 再生の制御
description: 再生・一時停止・シーク・方向・ループ — 宣言的にも命令的にも。そして直感どおりではない挙動について。
---

# 再生の制御

アニメーションが*どう*再生されるかのすべてです。宣言的な側は 3 つの prop で、残りは
レイヤー 3 のプレイヤー上にあり、ref から到達します。

**再生状態を所有しているのはプレイヤーで、その上の層はそれを複製しません。** prop は
素通しです — 真実は 1 つだけで、それは Rust コアの中にあります。

## 宣言的な側

```tsx
<SpriteStudioView source={…} animation="walk" playing speed={1.5} loop={0} />
```

| prop | 既定値 | 意味 |
|---|---|---|
| `animation` | パックの最初のもの | パック内のどのアニメーションか。 |
| `playing` | `true` | `false` なら最初のフレームで止まります。 |
| `speed` | `1` | 作成時のフレームレートに対する倍率。 |
| `loop` | `0` | 何回再生するか。**`0` は無限**、`1` は 1 回だけ。 |

## 命令的な側

```tsx
const ref = useRef<SpriteStudioViewRef>(null)

ref.current?.player?.setAnimation('attack')
ref.current?.player?.seek(12)
ref.current?.player?.setSpeed(0.5)
```

| | |
|---|---|
| `play()` / `pause()` / `stop()` | 下の「3 つは同種ではない」を参照。 |
| `seek(frameNo)` | 再生ヘッドを移動します。 |
| `setAnimation(name)` | 別のアニメーションを設定します。その名前が無ければ `false` を返します。 |
| `setSpeed(rate)` / `setLoop(loops)` | prop と同等のもの。 |
| `setPlaybackDirection(direction, style)` | 下記。 |
| `getAnimationNames()` | 読み込んだパックが持つアニメーション名。 |

現在位置を読むには `frameNo`・`isPlaying`・`isFinished`・`currentAnimation`・`fps`・
`partCount` があります。

## play・pause・stop は 3 つで同種ではありません

`play()` は**1 つの動詞で 2 つの動作を兼ねています**。レイヤー 1 は両者を区別しています
が（Brain の `ss_runtime_play` は巻き戻します）、コンポーネントの prop では区別できない
ためです。

- **`pause()` の後** — その場から再開します。`playing={false}` → `playing={true}` は
  やり直しではなく継続です。
- **`stop()` の後、または新しくセットアップされた直後** — 最初から始まります。

`stop()` はその場で停止し、次の `play()` が最初から始まるようにします。

::: warning `onAnimationStart` は再開では発火しません
start は*最初から始まった*ことを意味します。再開は同じ動詞のもう半分であり、そこで
「開始」を発火させるとリスナーから両者を区別できなくなります。同じ規則により、既に再生中の
アニメーションを設定し直すのは**やり直し**です。`onAnimationChange` ではなく
`onAnimationStart` として報告されます。
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

## `setup_animation` が何をリセットするか {#what-setup-animation-resets}

アニメーションを設定すると、再生設定**とオーバーライドレイヤー**が他のすべてと一緒に
リセットされます。これは Rust コアの挙動であって、ここでの選択ではありません。そのため
`SpriteStudioPlayer` は新しく設定されたアニメーションに対して両方を再適用します —
速度、ループ、方向、スタイル、再生中かどうか、そして `parts` マップ全体です。

これを知る必要があるのは、驚いたときだけです。速度を設定して*その後で*アニメーションを
切り替えても安全です。再適用はセットアップの後に行われるからです。

## クロック

`advance(dtMilliseconds)` は外部からクロックを与えられます。シーンが 20 個のプレイヤーを
1 つのループで駆動できるのは、まさにこのためです。`<SpriteStudioView>` は自身の
`requestAnimationFrame` を回し、`<SpriteStudioScene>` は内部のすべてに対してちょうど
1 つだけ回します。

::: tip バックグラウンドから戻っても早送りしません
どちらのクロックもステップを `MAX_STEP_MS`（1000/15 ≈ 66.7 ms）で頭打ちにします。この
上限が無いと、バックグラウンドから復帰したアプリに巨大なデルタが 1 つ渡り、アニメー
ションは取りこぼしたフレームをすべて早送りします — **その上のイベントもすべて発火
させながら**です。
:::

`advance()` を自分で駆動する場合、単位は**ミリ秒**で、`performance.now()` の差分は既に
その単位です。同じように上限を設けてください。
