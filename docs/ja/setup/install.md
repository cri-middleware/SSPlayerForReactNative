---
title: インストール
description: このパッケージが自分のアプリに合うか、入れ方、そしてネイティブビルドの準備。
---

# インストール

**あなた自身のアプリ**にプレイヤーを追加するためのページです。`<SpriteStudioView>` しか使わない場合も、イベント・パーツ上書き・独自テクスチャまで使う場合も、インストール手順は同じです。プレイヤー本体や Rust コアに手を入れる場合は[ビルドガイド](/ja/development/build)を参照してください。

**あなたのアプリにはネイティブビルドが必要です。** このページではパッケージを入れてビルドの準備をし、パックを置いたあとの[クイックスタート](/ja/setup/quickstart)でアプリをビルドします。

## 1. 使えるか確認する

| | |
|---|---|
| React Native | `0.88` 系（`0.88.0` 以上）、**New Architecture** |
| React | `19` 系（`19.3.0` 以上） |
| React Native Skia | `3` 系（`3.6.1` 以上） |
| Reanimated | `4` 系（`4.6.0` 以上） |
| Expo | SDK 58 |
| iOS | 15.1+ |
| Android | API 26+、Vulkan |
| SpriteStudio | 7.6 以上で作成したプロジェクト |

対象外：**Expo Go**（手順 3 を参照）と Windows / tvOS / visionOS。

**web では何も描画されません** — ただしこのパッケージを追加しても web ビルドは壊れないので、native に加えて web も出荷するアプリで問題は起きません。web 上の SpriteStudio には代わりに [SpriteStudio Player for Web](https://github.com/cri-middleware/SSPlayerForWeb) を使ってください。詳細は[制約と適用範囲](/ja/limitations)にあります。

## 2. インストールする

```bash
npx expo install react-native-spritestudio react-native-skia react-native-nitro-modules react-native-reanimated react-native-worklets
```

残りの 4 つは、パッケージと一緒に入れるものです — 描画バックエンド、JSI バインディング、Reanimated、そして Reanimated 自身が peer として必要とする worklets パッケージ。`npm install` ではなく `expo install` を使うのは、Reanimated と worklets について Expo が確認したバージョンを選んでくれるためです。

公開される tarball は**ネイティブコアを同梱している**ので、追加で取得するものも、インストールが必要な Rust ツールチェーンもありません。npm から入れてください。ネイティブコアとビルド済みの JavaScript は公開パッケージに入っていて、git リポジトリにはありません。

## 3. ビルドの準備をする

**Expo Go では実行できません。** Expo Go に含まれるネイティブモジュールは固定されており、このパッケージはその中にありません。したがって **development build** が必要です。
Fast Refresh も開発メニューもそのまま使えます。失うのは、QR コードを読んで他人のバイナリで動かせる手軽さです。

**Android の `minSdkVersion` は 26 にします。** React Native Skia 3 の下限で、React Native のプロジェクトの既定値はこれより低いためです。最初のビルドの前に、`app.json` の `plugins` 配列へ次の項目を追加してください（`npx expo install expo-build-properties`）。

```json
{
  "expo": {
    "plugins": [
      ["expo-build-properties", { "android": { "minSdkVersion": 26 } }]
    ]
  }
}
```

最初のビルドは、パックを置いてからです。[クイックスタート](/ja/setup/quickstart)でパックを同梱し、アプリをビルドして再生します。autolinking が両プラットフォームでパッケージを拾います。変換の仕組みは[アセットの準備](/ja/setup/assets)にあります。

## インストール時のトラブルシューティング

::: details ビルドが失敗する、または起動時にクラッシュする

**ネイティブモジュールが 2 つある。** これがよくある原因です。peer 依存はそれぞれ 1 つだけにします。`npm ls react-native-skia` で確認してください。モノレポではすべての peer をルートで固定します。

**`react-native-worklets` が入っていない。** Reanimated 4 が依存ではなく*自身の* peer
として宣言しているため、インストールするのはアプリ側の役目です。手順 2 のコマンドには既に含まれています。

:::

::: details どの Skia と Nitro Modules を使うか

`react-native-skia` は React Native Skia 3（`3.6.1` 以上）です。`@shopify/react-native-skia`（v2）は代わりにならず、同時に入れることもできません。先に削除してください。`react-native-nitro-modules` は `0.37` 系（`0.37.0` 以上）にします。

:::
