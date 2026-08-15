---
title: インストール
description: このパッケージが自分のアプリに合うか、入れ方、そして必要になるビルド。
---

# インストール

**あなた自身のアプリ**にプレイヤーを追加するためのページです。`<SpriteStudioView>` しか
使わない場合も、イベント・パーツ上書き・独自テクスチャまで使う場合も、インストール手順は
同じです。プレイヤー本体や Rust コアに手を入れる場合は
[チェックアウトから動かす](/ja/development/from-source)を参照してください。

**このパッケージの利用者は全員がネイティブコードをコンパイルします。** プロジェクトに
放り込める JavaScript だけの成果物はありません — CDN バンドルも、そのまま同梱できる
ビルド済み `.js` もありません。したがってここでの「インストール」は、パッケージを入れる
ことと、それを含むアプリのネイティブビルドを作ることの両方を指します。以下がその両方です。

## 1. 使えるか確認する

| | |
|---|---|
| React Native | `0.86.2` 以上、**New Architecture** |
| React | `19.2.8` 以上 |
| Expo | SDK 57、または bare React Native |
| iOS | 15.1+ |
| Android | API 24+ |

対象外：**Expo Go**（手順 3 を参照）、**web**（代わりに
[SSPlayerForWeb](https://github.com/cri-middleware/SSPlayerForWeb) を使ってください）、
Windows / tvOS / visionOS。詳細は[制約と適用範囲](/ja/limitations)にあります。

## 2. インストールする

```bash
npx expo install react-native-spritestudio @shopify/react-native-skia react-native-nitro-modules react-native-reanimated react-native-worklets
```

5 つのうち 4 つは、パッケージと一緒に入れる peer 依存です — 描画バックエンド、JSI
バインディング、そして Reanimated と、Reanimated 自身が必要とする worklets パッケージ。
`npm install` ではなく `expo install` を使うのは、こちらが Expo SDK に合うバージョンを
選んでくれるためです。

公開される tarball は**ネイティブコアを同梱している**ので、追加で取得するものも、
インストールが必要な Rust ツールチェーンもありません。

::: warning git URL は代用になりません
`npm install github:cri-middleware/…` は**動きません**。ネイティブコアもビルド済みの
`lib/` も git で追跡されていないため、`main` が存在しないファイルを指し、ネイティブ側は
リンクする相手を持たないパッケージが入るだけです。ソースツリーから作業したい場合は
[チェックアウトから動かす](/ja/development/from-source)を参照してください — それはこの
ページとは別の作業で、依存関係ではなくリポジトリが必要です。
:::

## 3. アプリをビルドする

::: info これは*あなたのアプリの*ビルドで、このパッケージのビルドではありません
ここであなたが別途コンパイルするものはありません — ネイティブコアは npm からビルド済みで
届くか、チェックアウト経路なら `download-sdk` が持ってきます。この手順が生み出すのは、
パッケージがリンクされたあなた自身のアプリバイナリです。
:::

**Expo Go では実行できません。** Expo Go に含まれるネイティブモジュールは固定されており、
このパッケージはその中にありません。したがって **development build** が必要です。
Fast Refresh も開発メニューもそのまま使えます。失うのは、QR コードを読んで他人のバイナリで
動かせる手軽さです。

::: code-group

```bash [managed]
# リポジトリに ios/ や android/ が無い場合
npx expo prebuild
npx expo run:ios     # または run:android
```

```bash [bare]
# ios/ と android/ が既にある場合 — prebuild は実行しない
npx pod-install
npx react-native run-ios     # または run-android
```

:::

どちらの場合も、autolinking が両プラットフォームでパッケージを拾います。

::: warning bare のルートは未完成です
Expo config plugin が bare アプリでは代わりにやってくれない仕事が 2 つあります。
**パックのディレクトリをネイティブアセットとして同梱すること**、そしてネイティブコアが
提供しない 32 ビット `x86` スライスをビルドが要求しなくなるよう
**`reactNativeArchitectures` を絞ること**です。どちらも文書化と検証が
[ROADMAP](https://github.com/cri-middleware/SSPlayerForReactNative/blob/main/ROADMAP.md)
の未着手項目として残っています。それまでは自力で解決する必要があると考えてください。
:::

次は[アセットの準備](/ja/setup/assets)です。何かを再生する前に、パックが端末に届いて
いる必要があります。

## インストール時のトラブルシューティング

::: details ビルドが失敗する、または起動時にクラッシュする

**ネイティブモジュールが 2 つある。** これがよくある原因で、依存の重複ではありません。
**1 つの JSI 登録を 2 つの autolink された pod が奪い合っている**状態です。
`npm ls @shopify/react-native-skia` で確認してください。モノレポではすべての peer を
ルートで固定します。

**`react-native-worklets` が入っていない。** Reanimated 4 が依存ではなく*自身の* peer
として宣言しているため、インストールするのはアプリ側の役目です。手順 2 のコマンドには
既に含まれています。

:::

::: details バージョン下限の理由

`@shopify/react-native-skia` の `2.11` は、API オブジェクトが `jsi::NativeState`
パターンへ移ったバージョンで、このパッケージは新しい方法でそれを取り出します。これより
古い Skia ではリンクできません。

`react-native-nitro-modules` の `0.36.5` は、リポジトリにコミットされている生成済み
バインディングと対応するバージョンです。

:::
