---
title: チェックアウトから動かす
description: リポジトリを動かす — ネイティブコア、サンプルパック、そしてサンプルアプリ。
---

# チェックアウトから動かす

**SDK / プレイヤー開発者向け**です。このパッケージや、その下の Rust コアを変更する人が対象です。

自分のアプリでパッケージを*使う*だけなら、必要なのは[インストール](/ja/setup/install)の方です。このページの内容はそこには一切含まれません。

## clone する

```bash
git clone https://github.com/cri-middleware/SSPlayerForReactNative.git
cd SSPlayerForReactNative
git submodule update --init --recursive
pnpm install
```

submodule は `SpriteStudio-SDK/` — リポジトリ全体で **Brain** と呼んでいる Rust コアです。ワークスペースは pnpm で、版は `package.json` の `packageManager` が決めます（`corepack enable` で入ります）。

## clone した中身

```
SSPlayerForReactNative/
├── SpriteStudio-SDK/                   <- [submodule] Rust コア（「Brain」）
├── scripts/                            <- .js シム -> ホスト OS ごとの .sh / .ps1
│   ├── SDK_VERSION.txt                 <- 固定された SDK リリースタグ
│   ├── download-sdk.*                  <- 固定リリースをインストール（Rust 不要）
│   ├── build-runtime.*                 <- 代わりに submodule から Brain をビルド
│   ├── deploy-examples.*               <- SDK のテストプロジェクトを .ssab に変換
│   ├── generate-nitro-code.*           <- レイヤー 1 の spec に nitrogen を実行
│   └── generate-fbs-code.*             <- .fbs スキーマに flatc を実行
├── packages/react-native-spritestudio/ <- npm パッケージ
│   ├── src/specs/SsRuntime.nitro.ts    <- レイヤー 1 の spec（nitrogen の入力）
│   ├── src/core/ src/player/ src/view/ <- レイヤー 2・3・4
│   ├── cpp/                            <- Nitro 実装、ベイカー、Skia 描画パス
│   ├── plugin/                         <- Expo config plugin: パックディレクトリを同梱
│   ├── bin/                            <- npx react-native-spritestudio assets
│   ├── nitrogen/                       <- [生成物・コミット対象・手で編集しない]
│   └── native/                         <- [gitignore] libssruntime とヘッダ
├── example/                            <- Expo アプリ: Viewer・Part follow・Blending の 3 画面
├── tools/                              <- ホスト側チェック（FrameData、ベイカー、マスク、hidden、シェーダー）
└── docs/                               <- このサイト
```

## Brain を用意する

`native/` は gitignore 対象なので、clone 直後にはネイティブコアが一切ありません。

```bash
pnpm run download-sdk
```

`scripts/SDK_VERSION.txt` で固定されたリリースをインストールします。**Rust ツールチェーンは不要**です。既にインストール済みのものが固定内容と一致していれば処理を飛ばすので、再実行しても安全です。

**Brain 自体を変更するときにだけ**もう一方が必要になります。

```bash
pnpm run build-runtime build=release
```

`build-runtime` は `SpriteStudio-SDK/` submodule から同じレイアウトへビルドし、
`<tag>+submodule-<sha>` と刻印するので両者が混同されることはありません。Rust が必要です。
Windows では Android スライスのみを対象とします（iOS の xcframework には Xcode が必要）ので、そこでの完全な答えは `download-sdk` です。

`build-runtime` は `key=value` 形式の引数を取り、submodule 以外の SDK チェックアウトを指す `$SSSDK` を尊重します。`download-sdk` はチェックアウトを読まず、オプションは `--force` だけです。

```bash
pnpm run build-runtime platform=ios build=release
pnpm run download-sdk --force
```

::: warning 計測の前に release でビルドしてください
`build=debug` の Brain は他のすべてのコストを覆い隠し、ベンチマークが見つけようとしている差を平坦にします。

2 つのインストールは意図的に区別されています。`download-sdk` は `native/VERSION` と
`native/BUILD_MODE` を書き、`build-runtime` はどちらも書かず後者を削除します。これにより
`prepack` が、ローカルビルドや debug ビルドの Brain に対して作られた tarball の公開を拒否できます。
:::

## サンプルパックを変換する

```bash
pnpm run deploy-examples
```

サンプルアプリ向けに `.sspj` → `.ssab` を、`ssconverter-cli` 経由で行います（Rust が必要）。併せて `example/src/ss-assets.ts` — サンプルのサブジェクト一覧が読まれる生成マニフェスト —
も更新します。

素材は SDK 自身の `tests/` と、`example/SpriteStudio_Source/` に置かれたものから取られます。後者はこのリポジトリが同梱しない置き場所で、実機で見たいプロジェクトを置けばそれが 1 つのサブジェクトとして現れます。任意のサードパーティ素材 `MaskInstance` もここに置きます。

## サンプルを動かす

```bash
pnpm run run-ios         # または: pnpm run run-android
```

どちらも `example/` を prebuild し、Release でビルドして（JS バンドルを埋め込むので Metro は不要）、シミュレータか接続した端末で起動します。`device=<名前>` で端末を選び、`config=debug` にすると JS を Metro から配信します。中身は `example/` での `expo prebuild` と `expo run:ios|android` です。

サンプルアプリは描画の検証面です — Viewer 画面に、機能ごとのカードが 1 枚ずつ。各サブジェクトが何を証明するか、自分のプロジェクトを見る方法、および任意の `MaskInstance` サンプルについては
[`example/README.md`](https://github.com/cri-middleware/SSPlayerForReactNative/tree/HEAD/example)
が扱います。

## チェック

| 対象 | コマンド |
|---|---|
| 型チェック（パッケージ + サンプル） | `pnpm run typecheck` |
| FlatBuffers アクセサが最新かつ読み取りパスが健全（`flatc` が必要） | `pnpm run check-framedata` |
| マスク描画、およびインスタンスの子へまたがるマスク（macOS） | `pnpm run check-mask` |
| 描画プランから外れている間もインスタンスとエフェクトのスロットが進み続け、非表示のエフェクトはパーティクルを作らないこと | `pnpm run check-hidden` |
| `ss-*` シェーダーがコンパイルでき、その演算が正しいこと（macOS） | `pnpm run check-shader` |
| Nitro まわりの C++ が iOS（macOS・Xcode）と Android（NDK）向けにコンパイルできること | `pnpm run check-glue` |
| web スタブバレルが import 可能で throw すること（OS 不問、Brain 不要） | `pnpm run check-web-barrel` |
| レイヤ 2 が `react` / `react-native` を import していないこと（OS 不問、インストール不要） | `pnpm run check-layers` |
| Markdown で日本語の文字と文字の間に改行が無いこと（OS 不問、インストール不要） | `pnpm run check-ja-breaks` |
| Skia を使う描画パスがコンパイルできること。リンクはしない（Windows、NDK） | `tools/check-skia-compile.ps1` |
| Nitro のコード生成が最新であること | `pnpm run generate-nitro-code` → `git diff --exit-code packages/*/nitrogen` |
