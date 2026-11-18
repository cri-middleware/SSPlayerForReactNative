---
title: Reanimated
description: ビューを動かす、パーツに追従する、そしてまだできない 2 つのこと。
---

# Reanimated

Reanimated は peer 依存で、`useSsPartTransform` は `SharedValue` を返します。そこから「プレイヤーは Reanimated と双方向につながっている」と考えるのは自然です。**つながっていません。** 作り込む前にその境界を知っておく価値があります。

## ビューを動かす

`<SpriteStudioView>` はごく普通の React Native ビューです。アニメーション全体を移動・フェード・拡縮させたいなら、外側を包むだけです。特別なことは何も要らず、再生には一切関係しません。

```tsx
import Animated, { useAnimatedStyle, withTiming } from 'react-native-reanimated'

const style = useAnimatedStyle(() => ({
  opacity: withTiming(visible.value ? 1 : 0),
  transform: [{ translateY: withTiming(visible.value ? 0 : 40) }],
}))

<Animated.View style={style}>
  <SpriteStudioView source={…} style={{ width: 200, height: 200 }} />
</Animated.View>
```

プレイヤーはその下で自身のレートで描き続け、Reanimated は描き込まれる箱の方を動かします。これは独立した 2 つのクロックで、一致している必要はありません。

## パーツに追従する

自分のコードの中で両者が出会う唯一の場所です。`useSsPartTransform` はプレイヤーが新しいフレームを見せるたびにパーツをサンプリングして shared value に公開するので、React のビューが再レンダリングなしにパーツへ乗れます。ビューの `children` の中では、`useSsViewPlayer()` が渡すべきプレイヤーです。

```tsx
function HealthBar() {
  const player = useSsViewPlayer()
  const transform = useSsPartTransform(player, 'head')

  const barStyle = useAnimatedStyle(() => ({
    opacity: transform.value.valid ? 1 : 0,
    transform: [
      { translateX: transform.value.x },
      { translateY: transform.value.y },
    ],
  }))

  return <Animated.View style={[styles.healthBar, barStyle]} pointerEvents="none" />
}

<SpriteStudioView source={…} style={{ flex: 1 }}>
  <HealthBar />
</SpriteStudioView>
```

値は**ビューピクセルで、ルートトランスフォーム適用済み**なので、そのままスタイルに入ります。`valid` で判定してください — パーツが解決されるまで false で、存在しない名前は永久に true になりません。

ここで UI スレッドにあるものと無いものを区別しておきます。**サンプリングは JS スレッド**、**消費側は UI スレッド**です。shared value 経由で公開していることが、今日その後半を成立させており、前半が移ったときにもそれを保ちます。

## まだできないこと

### shared value から再生を駆動する

shared value の**入力はありません**。`speed`・`loop`・再生位置は通常の prop と命令的呼び出しであり、`SharedValue<number>` をそれらに渡すことはできません。レンダー中に
`.value` を読んで模倣するのは本末転倒です。

```tsx
// 動きません — speed が取るのは数値であって shared value ではありません。
<SpriteStudioView speed={speedShared} />
```

JS 側から駆動してください — `player.setSpeedScale(x)`、または `speed` prop です。

### フレームループが UI スレッドにあると期待する

ティックはビューでもシーンでも、まだ **JS スレッド**の `requestAnimationFrame` です。
JS スレッドが混雑すれば再生のムラとして現れ、あなたの側でどれだけ Reanimated を使っても解決しません。

これを移すには、フレームごとの更新と描画をまとめて UI スレッドで動かす必要があります。2 つを別々のスレッドに分けることはできないので、段階的にではなく一度に移す作業です。[ROADMAP](https://github.com/cri-middleware/SSPlayerForReactNative/blob/HEAD/ROADMAP.md) で追跡されています。
