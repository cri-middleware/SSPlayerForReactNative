---
title: クイックスタート
description: 変換したパックを Expo の config plugin で同梱し、そのパスを SpriteStudioView に渡して再生するまで。パック名に型を付ける方法も。
---

# クイックスタート

満たすべき条件は 2 つです。パックが端末に届いていること、そしてコンポーネントがそれを名指ししていることです。

## 1. パックを同梱する

`.sspj` は、ブラウザで開く [ssconverter-web](https://cri-middleware.github.io/SSPlayerForWeb/ssconverter/) で変換します。プロジェクト名のフォルダが ZIP に入って出力され、その中に `.ssab` とテクスチャがあります。ほかのコンバータと、パックがディレクトリである理由は [アセットの準備](./assets.md) にあります。

::: tip SpriteStudio のデータが手元に無くても始められます
[公式のサンプルデータ](https://www.webtech.co.jp/help/ja/spritestudio7/download/sample/)がそのまま使えます。キャラクターなら
[Ringo](https://www.webtech.co.jp/help/ja/spritestudio7/download/sample/#ringo)、エフェクトを含むものなら[パーティクル](https://www.webtech.co.jp/help/ja/spritestudio7/download/sample/#Perticle_sample)が手頃です。
:::

コンバータが書き出したフォルダを、このパッケージの Expo config plugin が同梱するディレクトリ（ここでは `assets/ss/`）に置きます。

```
my-app/
├── app.json
├── App.tsx               ← source="ss/Ringo/Ringo.ssab"
└── assets/
    └── ss/               ← アプリに ss/ として入る
        └── Ringo/        ← コンバータが書き出したフォルダ
            ├── Ringo.ssab
            ├── Ringo.png
            └── …
```

そして、`app.json` の `plugins` 配列にプラグインのこの項目を追加し、ディレクトリを指定します。

```json
{
  "expo": {
    "plugins": [["react-native-spritestudio", { "assets": ["./assets/ss"] }]]
  }
}
```

プラグインはネイティブプロジェクトを変えるので、ここでアプリをビルドします。`npx expo prebuild` の後に `npx expo run:ios` か `run:android` を実行してください。

## 2. 再生する

パックは、同梱したフォルダの中のパスで指定します。パスはそのフォルダの名前から始まり、`assets/ss/Ringo/Ringo.ssab` なら `ss/Ringo/Ringo.ssab` です。

```tsx
import { SpriteStudioView } from 'react-native-spritestudio'

export function Character() {
  return (
    <SpriteStudioView
      source="ss/Ringo/Ringo.ssab"
      animation="wait1"
      fit="contain"
      style={{ width: '100%' }}
    />
  )
}
```

統合はこれで全部です。テクスチャは付いてきます。**Reference** パックならローダーが各
`image_path` を `.ssab` の隣で解決し、**Embedded** パックならファイル内から読み出します。[アセットの準備](./assets.md#reference-and-embedded-packs)を参照してください。

再生はロード時に始まり、既定では無限にループします。`playing`・`speed`・`loop` は prop
で、`loop={1}` なら 1 回だけ再生します。

## パック名に型を付ける

パスの間違いはパックのロードが失敗するまで分かりません。アプリが同梱するパックのマニフェストを生成して、名前をコンパイラに検査させましょう。

```bash
npx react-native-spritestudio assets --out src/ss-assets.ts
```

```tsx
import { SsAssets } from './ss-assets' // src/ の中のファイルから

<SpriteStudioView source={SsAssets['Ringo/Ringo']} />
```

`--check` はマニフェストが古い場合に失敗します。CI が求めるのはこちらです。マニフェストを書き出したときと同じ `--out` を渡してください: `npx react-native-spritestudio assets --check --out src/ss-assets.ts`。
