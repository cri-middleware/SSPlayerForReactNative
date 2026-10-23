---
title: プレイヤーの構成
description: 4 つのレイヤーとそれを持つファイル、ネイティブ側、ファイルをまたぐ設計の理由。
---

# プレイヤーの構成

このパッケージを開発する人と、自分のアプリのために改造する人に向けたページです。ファイル名を挙げて説明し、チェックアウトがある前提で書いています。チェックアウトを動かすまでは[チェックアウトから動かす](/ja/development/from-source)に、制約は [CONTRIBUTING](https://github.com/cri-middleware/SSPlayerForReactNative/blob/HEAD/CONTRIBUTING.md) にあります。このページは、それらをまたぐ地図です。

SpriteStudio の Player に共通すること（再生・モーションブレンド・サウンドキー・パーツトラッキングの振る舞い）は、SDK の [Player Porting Guide](https://github.com/cri-middleware/SpriteStudio-SDK/blob/HEAD/libs/ssruntime/docs/README.md) に一度だけ書いてあります。

## 4 つのレイヤー {#the-four-layers}

**Brain** は SpriteStudio-SDK の再生ランタイム `libssruntime` で、Rust で書かれ、`SpriteStudio-SDK/` サブモジュールにあります。タイムラインを進め、全パーツの姿勢を計算し、各フレームを描画計画として返します。`packages/react-native-spritestudio/` のすべてが、その計画を Skia の描画に変えます。レイヤーは `src/index.ts` の冒頭に上から順に並んでいます。

| レイヤー | 役割 | 場所 |
|---|---|---|
| **L4** | `<SpriteStudioView>`（Skia の canvas、props、ref）、`<SpriteStudioScene>` と `<SpriteStudioSprite>`（多数のアニメに canvas とクロックを 1 つずつ）、`<SpriteStudioPartAnchor>` と `useSsPartTransform`（パーツへの追従） | `src/view/` |
| **L3** | `SpriteStudioPlayer`。トランスポート・クロック・イベント、プリロードとリークチェック | `src/player/` |
| **L2** | `SsInternalPlayer`。ネイティブの寿命と、1 フレームに 1 回の描画呼び出し。テクスチャレジストリと共有キャッシュ。`react` / `react-native` から何も import しない | `src/core/` |
| **L1** | `SsRuntimeModule`。Brain への Nitro の接点で、最後の手段としてそのまま公開している | 仕様 `src/specs/SsRuntime.nitro.ts`、生成物 `nitrogen/`、実装 `cpp/` |

### ネイティブ側 {#the-native-side}

| ファイル | 役割 |
|---|---|
| `cpp/HybridSsRuntime.*` | 自動リンクされる唯一の Hybrid Object で、ほかのすべてを作るファクトリ |
| `cpp/HybridSsResource.*` | 読み込んだ `.ssab`。Brain のリソースハンドルを持つ |
| `cpp/HybridSsContext.*` | 再生中のアニメ 1 つ。Brain を動かし、そのバッファを JS に渡し、描画を実行する |
| `cpp/SsBaker.*` | 頂点ごとのジオメトリの組み立て。Nitro にも JSI にも依存しないので、ホストのツールが ASan の下で動かせる |
| `cpp/SsSkiaDraw.*` | 組み立てたフレームを Skia の描画呼び出しに変える。使うのは Skia の公開 API だけ |
| `cpp/SsRNSkiaInterop.*` | RN Skia の JSI オブジェクトモデル（`RNSkia::`）に触れる唯一の場所 |
| `cpp/SsMask.*`、`SsMaskShader.hpp` | カバレッジのビットマップによるマスクとクリッピング |
| `cpp/SsPartColor*.hpp`、`SsPartShader*.hpp`、`SsBlend.hpp` | PartColor、`ss-*` シェーダー、ブレンドモード |
| `cpp/SsInstance.*`、`SsEffect.*` | インスタンスパーツとパーティクルエフェクト |
| `cpp/SsTick.hpp` | プレイヤーの更新が描くものを変えうるか、つまり tick を続けるかの判断 |
| `cpp/SsAnimeBinary.hpp` | Brain が渡さない、描画に要るものを `.ssab` から読む |
| `cpp/SsAssets.*` | アプリのネイティブアセットのディレクトリ。パックが変換時の配置を保つ場所 |
| `cpp/SsPlayerJni.cpp` | Android の `JNI_OnLoad` |
| `plugin/withSpriteStudio.js` | Expo の config plugin。パックのディレクトリをネイティブアセットとして同梱し、アーキテクチャを絞る |
| `native/` | `download-sdk` か `build-runtime` が置く Brain とそのヘッダー。git には無い |
| `tools/` | 組み立て・マスク・tick の判断をホストの Brain とリンクして確かめるホスト側のチェック |

## この作りになっている理由 {#why-it-is-built-the-way-it-is}

ここに挙げる理由はどれも複数のファイルにまたがります。詳細は、それぞれが指すコードにあります。

**頂点ごとのものは JSI を越えません。** JS が呼ぶのは、頂点数に関係なく、プレイヤーごと・フレームごとに同じ数回だけです。`HybridSsContext` が Brain を動かし、`SsBaker` が C++ で頂点を組み立て、`SsSkiaDraw` が RN Skia から渡された canvas に描きます。頂点を JS に通す方法は計測して、フレームレートの頭打ちになると分かりました。JS に渡すバッファがどれも `generation` を持ち、次の `update()` までしか有効でないのも、このためです。

**ネイティブモジュールはどれも 1 つだけにします。** React Native・Nitro Modules・RN Skia・Reanimated は peer dependency で、アプリにどれかが 2 つ入ると、同じ JSI オブジェクトを 2 つのネイティブモジュールが登録することになります（iOS では、自動リンクされた 2 つの pod）。`example/package.json` がネイティブのものを、パッケージがビルドされる版に完全一致で固定し、pnpm がパッケージの peer をその固定に解決します。上げるときは手で、まとめて上げてください。

**RN Skia との結び付きは 1 つのファイルに閉じ込めます。** `SsRNSkiaInterop` が RN Skia の名前を持つのは、その JSI オブジェクトモデルに互換性の約束が無く、一度壊れたことがあるからです。`SsSkiaDraw` が使うのは Skia の公開 API だけです。RN Skia を上げたときに壊れうるものは `grep -rl 'RNSkia::' cpp/` で並びます。RN Skia が自分のビルドにだけ付けて利用側に伝えない定義（`SK_GRAPHITE` など）は、podspec・`android/CMakeLists.txt`・ホストのチェックでこちらでも付けています。

**レイヤー 2 は React に依存しません。** `SsInternalPlayer` とそれが使うものは `react` / `react-native` から何も import しないので、コアはヘッドレスでも react-native-web でも動きます。`pnpm run check-layers` がそれを守ります。

**パックはファイルではなくディレクトリです。** Metro が配るのは依存のグラフです。`require()` は 1 つのファイルを名指し、Android のリリースビルドは名指されたものを平らにして小文字にするので、`.ssab` は横にあるテクスチャを見つけられません。そのためパックは config plugin でネイティブアセットとして同梱し、`SsAssets` がアプリのネイティブアセットのディレクトリから解決します。

**トランスポートは Brain にそのまま渡します。** `SpriteStudioPlayer` が設定を持つのは、新しく設定したアニメに再適用するためだけです（`src/player/SpriteStudioPlayer.ts` の `applySettings`）。報告する値は Brain のものです。アニメを設定すると、Brain ではループ回数・再生区間・`permanent` ではないオーバーライドがリセットされ、速度・フレームレートの上書き・フレームスキップ・方向とスタイルは保たれます。

**変わりようのないプレイヤーは tick を止めます。** `SsTick.hpp` は、ルートのプレイヤーの次の更新が描くものを変えうるかを Brain に尋ねます。見るのはトラック 0 ではなくキャラクターのクロックです。トラック 0 が終わっても、トラックのスタックが姿勢を動かし続けることがあるためです。変わりようのないプレイヤーはフレームを求めなくなります。この判断をこちら側で写しておいた版は、動くはずの姿勢を止めてしまいました。`pnpm run check-motion` が、この判断をホストの Brain で確かめます。
