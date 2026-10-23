---
title: プレイヤーの構成
description: 4 つのレイヤー、ネイティブ側、この作りになっている理由。
---

# プレイヤーの構成

SpriteStudio Player for React Native を開発する人と、自分のアプリのために改造する人に向けたページです。部品をその役割で説明します。チェックアウトを動かす手順、変更したパッケージをアプリで使う方法、シミュレータや実機での確かめ方は[ビルドガイド](/ja/development/build)に、制約は [CONTRIBUTING](https://github.com/cri-middleware/SSPlayerForReactNative/blob/HEAD/CONTRIBUTING.md) にあります。

SpriteStudio の Player に共通すること（再生・モーションブレンド・サウンドキー・パーツトラッキングの振る舞い）は、SDK の [Player Porting Guide](https://github.com/cri-middleware/SpriteStudio-SDK/blob/HEAD/libs/ssruntime/docs/README.md) に一度だけ書いてあります。

## 層 {#layers}

**Brain** は SpriteStudio-SDK の再生ランタイム `libssruntime` で、Rust で書かれ、`SpriteStudio-SDK/` サブモジュールにあります。タイムラインを進め、全パーツの姿勢を計算し、各フレームを描画計画として返します。`react-native-spritestudio` パッケージが、その計画を 4 つのレイヤーで Skia の描画に変えます。レイヤーはパッケージの入口の冒頭に上から順に並んでいます。

| レイヤー | 役割 |
|---|---|
| **L4** | `<SpriteStudioView>`（Skia の canvas、props、ref）、`<SpriteStudioScene>` と `<SpriteStudioSprite>`（多数のアニメに canvas とクロックを 1 つずつ）、`<SpriteStudioPartAnchor>` と `useSsPartTransform`（パーツへの追従） |
| **L3** | `SpriteStudioPlayer`。トランスポート・クロック・イベント、プリロードとリークチェック |
| **L2** | `SsInternalPlayer`。ネイティブの寿命と、1 フレームに 1 回の描画呼び出し。テクスチャレジストリと共有キャッシュ。`react` / `react-native` から何も import しない |
| **L1** | `SsRuntimeModule`。Brain への Nitro の接点で、最後の手段としてそのまま公開している。バインディングは nitrogen が仕様から生成し、その裏の C++ がネイティブ側 |

### ネイティブ側 {#the-native-side}

ネイティブ側は C++ です。自動リンクされる Nitro の Hybrid Object が 1 つあり、それがほかのすべてを作ります。Brain のリソースハンドルを持つ読み込み済みの `.ssab` と、再生中のアニメ 1 つごとのコンテキストです。コンテキストは Brain を動かし、そのバッファを JS に渡し、描画を実行します。コンテキストの下には次のものがあります。

- **組み立て**は、フレームのバッファを頂点ごとのジオメトリに変えます。Nitro にも JSI にも依存しないので、ホストのツールが ASan の下で動かせます。
- **描画の経路**は、組み立てたフレームを Skia の描画呼び出しに変えます。使うのは Skia の公開 API だけです。RN Skia の JSI オブジェクトモデルに触れるのは、そこから切り離した 1 つの橋渡しだけです。
- **マスクとクリッピング**はカバレッジのビットマップです。PartColor、`ss-*` シェーダー、ブレンドモード、インスタンスパーツ、パーティクルエフェクトがその横にあります。
- **tick の判断**は、プレイヤーの更新が描くものを変えうるか、つまり tick を続けるかを決めます。
- **`.ssab` の読み取り**は、描画に要るのに Brain が渡さないものを読みます。**アセットの探索**は、パックが変換時の配置を保つ、アプリのネイティブアセットのディレクトリを見つけます。

**周辺:** Expo の config plugin が、パックのディレクトリをネイティブアセットとして同梱し、アーキテクチャを絞ります。Brain とそのヘッダーは `download-sdk` か `build-runtime` が置くもので、git には無いものです。ホスト側のチェックは、組み立て・マスク・tick の判断をホストの Brain とリンクして確かめます（[ビルドガイド](/ja/development/build#checks)の `check-*` コマンド）。

## この作りになっている理由 {#why-it-is-built-the-way-it-is}

ここに挙げる理由はどれも複数のファイルにまたがります。詳細は、関わるコードのコメントにあります。

**頂点ごとのものは JSI を越えません。** JS が呼ぶのは、頂点数に関係なく、プレイヤーごと・フレームごとに同じ数回だけです。コンテキストが Brain を動かし、組み立てが C++ で頂点を書き、描画の経路が RN Skia から渡された canvas に描きます。頂点を JS に通す方法は計測して、フレームレートの頭打ちになると分かりました。JS に渡すバッファがどれも `generation` を持ち、次の `update()` までしか有効でないのも、このためです。

**ネイティブモジュールはどれも 1 つだけにします。** React Native・Nitro Modules・RN Skia・Reanimated は peer dependency で、アプリにどれかが 2 つ入ると、同じ JSI オブジェクトを 2 つのネイティブモジュールが登録することになります（iOS では、自動リンクされた 2 つの pod）。サンプルアプリがネイティブのものを、パッケージがビルドされる版に完全一致で固定し、pnpm がパッケージの peer をその固定に解決します。上げるときは手で、まとめて上げてください。

**RN Skia との結び付きは 1 か所に閉じ込めます。** RN Skia の JSI オブジェクトモデルへの橋渡しを切り離しているのは、そのモデルに互換性の約束が無く、一度壊れたことがあるからです。描画の経路が使うのは Skia の公開 API だけです。RN Skia を上げたときに壊れうるものは `grep -rl 'RNSkia::' cpp/` で並びます。RN Skia が自分のビルドにだけ付けて利用側に伝えない定義（`SK_GRAPHITE` など）は、podspec・Android の CMake のビルド・ホストのチェックでこちらでも付けています。

**レイヤー 2 は React に依存しません。** `SsInternalPlayer` とそれが使うものは `react` / `react-native` から何も import しないので、コアはヘッドレスでも react-native-web でも動きます。`pnpm run check-layers` がそれを守ります。

**パックはファイルではなくディレクトリです。** Metro が配るのは依存のグラフです。`require()` は 1 つのファイルを名指し、Android のリリースビルドは名指されたものを平らにして小文字にするので、`.ssab` は横にあるテクスチャを見つけられません。そのためパックは config plugin でネイティブアセットとして同梱し、ネイティブ側がアプリのネイティブアセットのディレクトリから解決します。

**トランスポートは Brain にそのまま渡します。** `SpriteStudioPlayer` が設定を持つのは、新しく設定したアニメに再適用するためだけです。報告する値は Brain のものです。アニメを設定すると、Brain ではループ回数・再生区間・`permanent` ではないオーバーライドがリセットされ、速度・フレームレートの上書き・フレームスキップ・方向とスタイルは保たれます。

**変わりようのないプレイヤーは tick を止めます。** ネイティブ側は、ルートのプレイヤーの次の更新が描くものを変えうるかを Brain に尋ねます。見るのはトラック 0 ではなくキャラクターのクロックです。トラック 0 が終わっても、トラックのスタックが姿勢を動かし続けることがあるためです。変わりようのないプレイヤーはフレームを求めなくなります。この判断をこちら側で写しておいた版は、動くはずの姿勢を止めてしまいました。`pnpm run check-motion` が、この判断をホストの Brain で確かめます。
