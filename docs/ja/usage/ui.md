---
title: UI ボタン
description: SpriteStudio のアニメーションをボタンにする。ラベルを再生する状態、パーツでの押下、reduced motion、読み上げ。
---

# UI ボタン

ボタン・メニュー項目・タイルを SpriteStudio のアニメーションで描きたいアプリ向けのページです。`<SpriteStudioButton>` はボタンになった `<SpriteStudioView>` です。`<Pressable>` がビューの箱を覆い、押下・ホバー・フォーカスのコールバックが立てる状態ごとに、1 つのアニメーションの区間を再生します。

別のパッケージにあるので、アニメーションを再生するだけのアプリには何も入りません。

```bash
npx expo install react-native-spritestudio-ui
```

`react-native-spritestudio` と同じバージョンを使ってください（peer として受け取ります）。従っている規則は、すべての SpriteStudio Player に共通の SDK の [UI 統合](https://github.com/cri-middleware/SpriteStudio-SDK/blob/HEAD/libs/ssruntime/docs/50_features/80_ui_integration.ja.md)の規約です。

## 状態を作る {#authoring-the-states}

状態は 1 つのアニメーションに、状態と同じ名前のラベルとして小文字で置きます。`normal`・`hover`・`pressed`・`disabled`・`focused` です。各状態は、そのラベルから次のラベル（状態の名前かどうかを問いません）の 1 フレーム手前までをループ再生し、最後のラベルはアニメーションの終わりまでです。

| ラベルの無い状態 | 再生するもの |
|---|---|
| `hover`・`focused`・`disabled` | `normal` |
| `pressed` | `hover`、それも無ければ `normal` |
| `normal` | アニメーション全体 |

同時に立ったときは、`disabled`・`pressed`・`hover`・`focused`・`normal` の順で 1 つが勝ちます。

## ボタン {#the-button}

```tsx
import { SpriteStudioButton } from 'react-native-spritestudio-ui'

<SpriteStudioButton
  source="ss/ui/start.ssab"
  animation="button"
  accessibilityLabel="Start"
  hitParts={['face']}
  onPress={start}
  style={{ width: 240, height: 96 }}
/>
```

アニメーションを読み込んで配置するビューの props（`source`・`textures`・`animation`・`fit`・`align`・`frame`・`style`・`placeholder`・イベントのコールバックなど）と、`<Pressable>` の props（`onPress`・`onLongPress`・`disabled`・`testID` など）を受け取ります。`animation` は状態のラベルを読むアニメーションで、省略するとパックが読み込み時に選ぶアニメーションです。

再生はボタンが握ります。`playing`・`loop`・`transitionMs` はここでは props にありません。`ref.current.player` はビューのプレイヤーで、読むためのものです。再生や停止には使わないでください。

### ラベルの代わりのクリップ {#a-clip-in-place-of-a-label}

`clips` は、状態のラベルを自分で選んだ区間に置き換えます。アニメーション、ラベル、または別のアニメーションのラベルを指定できます。その状態に落ちてくる状態も、同じ区間を再生します。

```tsx
<SpriteStudioButton
  source="ss/Ringo/Ringo.ssab"
  clips={{
    normal: { animation: 'wait1' },
    hover: { animation: 'walk' },
    pressed: { animation: 'attack1' },
    disabled: { animation: 'dead' },
  }}
/>
```

パックに無いアニメーションやラベルを指すクリップは、コンソールに 1 度だけ報告され、その状態はクリップが無いものとして再生します。

## 押せる範囲 {#the-pressable-area}

既定では箱全体が押下を受けます。`hitParts` は指定したパーツの輪郭に、`hitOnArtwork` は輪郭を持つすべてのパーツに絞ります（[パーツの輪郭と当たり判定](./parts.md#part-outline)）。どれの上でも始まらなかったタッチは押下にならず、ボタンは `pressed` の状態を示しません。

絞るのはタッチだけです。キーボードのフォーカスと読み上げからの操作はこれまでどおりボタンに届き、ホバーも箱全体で数えます。ボタンが受けなかったタッチは、ほかの React Native のビューと同じく、後ろにあるビューにも届きません。

## Reduced motion {#reduced-motion}

`reducedMotion` を指定すると、各状態は先頭フレームで停止し、イベントも出しません。アニメーションに `reduced_motion` ラベルがあれば、`normal`（と `normal` に落ちてくる状態）だけは代わりにその区間を再生するので、落ち着いた待機のループは動かせます。

prop を渡さなければ、OS の設定（iOS の「視差効果を減らす」、Android の「アニメーションを削除」。`AccessibilityInfo.isReduceMotionEnabled()`）に従い、設定の変化にも追従します。設定を読み終えるまでは状態を示しません。

## 読み上げ {#screen-readers}

`accessibilityLabel` が無ければ、ボタンは装飾として扱われ、スクリーンリーダーからは見えません。あれば、そのラベルのボタンとして読み上げられ、`disabled` の状態も伝わります。ほかのアクセシビリティの props は `<Pressable>` に届きます。

## コンポーネントを使わずに {#without-the-component}

`SsUiStateDriver` は状態の規則だけを取り出したものです。`<SpriteStudioView>` を包む自前の部品で使えます。プレイヤーとアニメーションを渡し、状態が変わるたびに示してください。すでに示している状態をもう一度示しても何もしません。

```ts
import { SsUiStateDriver, ssUiStateOf } from 'react-native-spritestudio-ui'

const driver = new SsUiStateDriver(player, { animation: 'button' })
driver.show(ssUiStateOf({ pressed, hovered, focused, disabled }), reducedMotion)
```

ドライバーはプレイヤーの再生を握るので、ビューには `playing={false}` を渡してください（ボタンはそうしています）。`show` はプレイヤーがパックを読み込むまで何もせず、呼び出しも覚えません。パックの読み込み後にもう一度呼んでください — `onLoad` か、`player.addListener` で足したリスナーからです。

区間の再生には、プレイヤーの `getLabelTable` と `setAnimationSection` を使います。ラベルで区間を指定する呼び出しは `react-native-spritestudio` にもあります（[再生の制御](./transport.md)）。
