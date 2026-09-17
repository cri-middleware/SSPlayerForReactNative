---
layout: home
title: SSPlayerForReactNative
description: SpriteStudio のアニメーションを React Native で — コンポーネント 1 つ、アニメーションのコードなし。

hero:
  name: SpriteStudio Player
  text: for React Native
  tagline: アーティストが作った 2D アニメーションをアプリへ。コンポーネント 1 つ、アニメーションのコードなし、動画ファイルなし。
  actions:
    - theme: brand
      text: クイックスタート
      link: /ja/setup/quickstart
    - theme: alt
      text: インストール
      link: /ja/setup/install
    - theme: alt
      text: GitHub
      link: https://github.com/cri-middleware/SSPlayerForReactNative

features:
  - title: アニメーションのコードは書かない
    details: 動きは SpriteStudio で視覚的に作られます — ボーンリグ、メッシュ変形、マスク、パーティクル。プレイヤーは書き出されたファイルを再生するだけです。パーツごとの Animated / Reanimated タイムラインも、切り出すスプライトシートもありません。
  - title: ラスター素材を、ネイティブ描画で
    details: ラスターのスプライト素材にリグを入れて変形させるので、手描きのキャラクターが作られたとおりに動きます。ベクターツールとは適性が異なり、.gif や .mp4 を同梱するより軽量です。
  - title: フレームレートに縛られない滑らかさ
    details: 再生ヘッドは浮動小数で、フレームは描画される瞬間に組み立てられます。動きはディスプレイのリフレッシュレートと指定した速度に追従します。
  - title: 1 フレームあたり、プレイヤー 1 つにつき 1 回の呼び出し
    details: タイムライン、ジオメトリ、Skia の描画呼び出しは、Nitro Modules（JSI）越しの Rust コアと C++ で行われます。賑やかなシーンでも 60 fps を保てるのはこのためです。
  - title: 動的な着せ替え
    details: セルマップが描画に使うアトラスを実行時に差し替えられます — カラーバリエーション、装備変更、パーツから組み立てるアバターなど。アニメーションを書き出し直す必要はありません。`player.setCellmapTexture(name, image)`、`null` で元へ復元します。
---

## 関連リポジトリ

- [SpriteStudio Docs](https://cri-middleware.github.io/SpriteStudio-Docs/ja/) — SDK と公式 Player のドキュメントポータル。
- [SpriteStudio-SDK](https://github.com/cri-middleware/SpriteStudio-SDK) — `libssruntime` / `libssconverter` を提供する SDK 本体。
- [SSConverterGUI](https://github.com/cri-middleware/SSConverterGUI) — Player を介さず `.sspj` を変換するデスクトップ GUI。
