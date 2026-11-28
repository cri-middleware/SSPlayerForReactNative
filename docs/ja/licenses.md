---
title: ライセンスと表記
description: このパッケージが、あなたの公開するアプリの中に何を入れるのか。そして何を表記する必要があるのか。
---

# ライセンスと表記

`react-native-spritestudio` は、SpriteStudio-SDK のライセンスに従い
**BSD-3-Clause** で配布されています。Copyright © CRI Middleware Co., Ltd.

- 全文: [`LICENSE.md`](https://github.com/cri-middleware/SSPlayerForReactNative/blob/HEAD/LICENSE.md)（参考訳: [`LICENSE.ja.md`](https://github.com/cri-middleware/SSPlayerForReactNative/blob/HEAD/LICENSE.ja.md)）
- 表記の正本:
  [`THIRD_PARTY_NOTICES.md`](https://github.com/cri-middleware/SSPlayerForReactNative/blob/HEAD/THIRD_PARTY_NOTICES.md)

## これがこちら側だけの話ではない理由

アプリの隣に配布されるアドオンとは違い、**このパッケージはアプリの中にコンパイルされます**。SpriteStudio ランタイムは静的ライブラリで、FlatBuffers はヘッダオンリーなので、どちらもあなたが公開する `.ipa` / `.aab` の中に入ります。義務が生じるのは**あなたが配布するバイナリ**であって、このリポジトリだけではありません。ライセンスファイルへのリンクではなく、このページがある理由がそれです。

## 謝辞画面に何を載せるか

3 つのファイルです。いずれもインストール済みのパッケージの中にあります。

| ファイル（`node_modules/react-native-spritestudio/` 以下） | 対象 |
|---|---|
| `native/LICENSE.md` | SpriteStudio ランタイム本体（BSD-3-Clause） |
| `native/THIRD-PARTY-LICENSES.ssruntime.md` | その構成元の Rust クレート群 — Apache-2.0 が 20、BSD-3-Clause が 3、MIT が 1、Unicode License v3 が 1 |
| `third_party/flatbuffers/LICENSE` | FlatBuffers（Apache-2.0）。ヘッダがあなたのバイナリにコンパイルされます |

これらの本文を、アプリが既に持っているライセンス画面や謝辞ファイルに転記してください。その画面を自動生成する仕組みはありません。

::: tip npm ではなくチェックアウトから作業している場合
`native/` の 2 ファイルは**リポジトリには入っていません**。`pnpm run download-sdk` は両方を置きます。`pnpm run build-runtime` がコピーするのは `LICENSE.md` で、クレート一覧は SDK の `scripts/generate-licenses.sh` が先に生成していた場合にだけ取り込みます。そのためローカルビルドのあとは `THIRD-PARTY-LICENSES.ssruntime.md` が無いことがあり、見落としやすい点です（無いと `prepack` はパックを拒否します）。[ビルドガイド](./development/build.md)を参照してください。
:::

## このページが代弁しないもの

`react-native-skia`、`react-native-nitro-modules`、
`react-native-reanimated`、`react-native-worklets` は **peer 依存**です。あなたのアプリケーションが自分でインストールするものであり、それぞれが独自のライセンスと表記を持っています。ここに名前を挙げているのは、この一覧がそれらを含まないことを明確にするためだけです。
