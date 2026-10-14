---
title: クイックスタート
description: インストール済みの状態から、画面にアニメーションが出るまで。
---

# クイックスタート

満たすべき条件は 2 つです。パックが端末に届いていること、そしてコンポーネントがそれを名指ししていることです。

::: tip SpriteStudio のデータが手元に無くても始められます
[公式のサンプルデータ](https://www.webtech.co.jp/help/ja/spritestudio7/download/sample/)がそのまま使えます。キャラクターなら
[Ringo](https://www.webtech.co.jp/help/ja/spritestudio7/download/sample/#ringo)、エフェクトを含むものなら[パーティクル](https://www.webtech.co.jp/help/ja/spritestudio7/download/sample/#Perticle_sample)が手頃です。
:::

## 1. パックを同梱する

アニメーションは SpriteStudio で作成し、手元のマシンで `.ssab` の**ディレクトリ**へ変換します — [アセットの準備](/ja/setup/assets)を参照してください。ここがつまずきやすいところです。パックを置いたディレクトリを config plugin に指定します。

```json
{
  "expo": {
    "plugins": [["react-native-spritestudio", { "assets": ["./assets/ss"] }]]
  }
}
```

## 2. 再生する

```tsx
import { SpriteStudioView } from 'react-native-spritestudio'

export function Character() {
  return (
    <SpriteStudioView
      source="ss/overall/Basic.ssab"
      animation="anime_1"
      fit="contain"
      style={{ flex: 1 }}
    />
  )
}
```

統合はこれで全部です。テクスチャは付いてきます。**Reference** パックならローダーが各
`image_path` を `.ssab` の隣で解決し、**Embedded** パックならファイル内から読み出します。[アセットの準備](/ja/setup/assets#reference-and-embedded-packs)を参照してください。

再生はロード時に始まり、既定では無限にループします。`playing`・`speed`・`loop` は prop
で、`loop={1}` なら 1 回だけ再生します。

## パック名に型を付ける

パスの間違いはパックのロードが失敗するまで分かりません。アプリが同梱するパックのマニフェストを生成して、名前をコンパイラに検査させましょう。

```bash
npx react-native-spritestudio assets --out src/ss-assets.ts
```

```tsx
import { SsAssets } from './ss-assets'

<SpriteStudioView source={SsAssets['overall/Basic']} />
```

`--check` はマニフェストが古い場合に失敗します。CI が求めるのはこちらです。
