---
title: ライセンスと表記
description: このパッケージが、あなたの公開するアプリの中に何を入れるのか。そして何を表記する必要があるのか。
---

# ライセンスと表記

`react-native-spritestudio` は、SpriteStudio-SDK のライセンスに従い
**BSD-3-Clause** で配布されています。Copyright © CRI Middleware Co., Ltd.

- 全文: [`LICENSE.md`](https://github.com/cri-middleware/SSPlayerForReactNative/blob/main/LICENSE.md)（参考訳: [`LICENSE.ja.md`](https://github.com/cri-middleware/SSPlayerForReactNative/blob/main/LICENSE.ja.md)）
- 表記の正本:
  [`THIRD_PARTY_NOTICES.md`](https://github.com/cri-middleware/SSPlayerForReactNative/blob/main/THIRD_PARTY_NOTICES.md)

## これがこちら側だけの話ではない理由

アプリの隣に配布されるアドオンとは違い、**このパッケージはアプリの中にコンパイルされ
ます**。SpriteStudio ランタイムは静的ライブラリで、FlatBuffers はヘッダオンリーなので、
どちらもあなたが公開する `.ipa` / `.aab` の中に入ります。義務が生じるのは**あなたが
配布するバイナリ**であって、このリポジトリだけではありません。ライセンスファイルへの
リンクではなく、このページがある理由がそれです。

## 謝辞画面に何を載せるか

3 つのファイルです。いずれもインストール済みのパッケージの中にあります。

| ファイル（`node_modules/react-native-spritestudio/` 以下） | 対象 |
|---|---|
| `native/LICENSE.md` | SpriteStudio ランタイム本体（BSD-3-Clause） |
| `native/THIRD-PARTY-LICENSES.ssruntime.md` | その構成元の Rust クレート群 — Apache-2.0 が 20、BSD-3-Clause が 3、MIT が 1、Unicode License v3 が 1 |
| `third_party/flatbuffers/LICENSE` | FlatBuffers（Apache-2.0）。ヘッダがあなたのバイナリにコンパイルされます |

これらの本文を、アプリが既に持っているライセンス画面や謝辞ファイルに転記してください。
その画面を自動生成する仕組みはありません。

::: tip npm ではなくチェックアウトから作業している場合
`native/` の 2 ファイルは**リポジトリには入っていません**。ランタイムと一緒に届くので、
`npm run download-sdk` か `npm run build-runtime` を実行した後にはじめて存在します。
見落としやすいのはこの一点です。
[チェックアウトから動かす](/ja/development/from-source)を参照してください。
:::

## このページが代弁しないもの

`@shopify/react-native-skia`、`react-native-nitro-modules`、
`react-native-reanimated`、`react-native-worklets` は **peer 依存**です。あなたの
アプリケーションが自分でインストールするものであり、それぞれが独自のライセンスと表記を
持っています。ここに名前を挙げているのは、この一覧がそれらを含まないことを明確にする
ためだけです。
