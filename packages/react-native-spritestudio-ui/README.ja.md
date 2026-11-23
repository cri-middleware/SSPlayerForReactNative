[**English**](./README.md) | [**日本語**](./README.ja.md)

# react-native-spritestudio-ui

**SpriteStudio のアニメーションを React Native アプリのボタンにします。**

[SpriteStudio](https://www.webtech.co.jp/spritestudio/) は、手持ちのイラストにボーン・メッシュ・エフェクトを付けて動かす 2D アニメーションツールです。

`<SpriteStudioButton>` はボタンになった [`react-native-spritestudio`](https://www.npmjs.com/package/react-native-spritestudio) のビューです。押下・ホバー・キーボードのフォーカス・`disabled` のそれぞれで 1 つのアニメーションの区間を再生し、押下を一部のパーツの上だけに絞れ、reduced motion では各状態が止まります。

- 📖 **[UI ボタン](https://cri-middleware.github.io/SSPlayerForReactNative/ja/usage/ui)** — ガイド
- 📦 **[リポジトリ](https://github.com/cri-middleware/SSPlayerForReactNative)** — プレイヤー本体、ロードマップ、サンプルアプリ

## インストール

```bash
npx expo install react-native-spritestudio-ui
```

`react-native-spritestudio` を同じバージョンの peer として受け取ります。先にそちらを入れて設定してください（[インストール](https://cri-middleware.github.io/SSPlayerForReactNative/ja/setup/install)）。

## 使い方

1. **状態を作ります。** 1 つのアニメーションに、状態と同じ名前のラベル（`normal`・`hover`・`pressed`・`disabled`・`focused`）を、その状態のループが始まるフレームに置きます。各状態は次のラベルの 1 フレーム手前までです。ラベルの無い状態は落とし先を再生し（`pressed` は `hover`、ほかは `normal`）、ラベルが 1 つも無ければアニメーション全体を再生します。
2. **ボタンを作ります。**

   ```tsx
   import { SpriteStudioButton } from 'react-native-spritestudio-ui'

   <SpriteStudioButton
     source="ss/ui/start.ssab"
     accessibilityLabel="Start"
     hitParts={['face']}
     onPress={start}
     style={{ width: 240, height: 96 }}
   />
   ```

OS の動きを減らす設定（iOS の「視差効果を減らす」、Android の「アニメーションを削除」）が有効なら、各状態は先頭フレームで止まります。ただしアニメーションに `reduced_motion` ラベルがあれば、`normal` と `normal` に落ちてくる状態は代わりにその区間を再生します。`accessibilityLabel` が無ければ、ボタンはスクリーンリーダーにとって装飾です。

## ライセンス

BSD-3-Clause — [LICENSE.md](./LICENSE.md)（参考訳: [LICENSE.ja.md](./LICENSE.ja.md)）を参照してください。
