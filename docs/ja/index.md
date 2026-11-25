---
layout: home
title: SpriteStudio Player for React Native
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

# See the English index.md for why the details are written in HTML.
features:
  - title: アニメーションのコードは書かない
    details: 動きは SpriteStudio で視覚的に作られます — ボーンリグ、メッシュ変形、マスク、パーティクル。プレイヤーは書き出されたファイルを再生するだけです。パーツごとの Animated / Reanimated タイムラインも、切り出すスプライトシートもありません。
    link: /ja/setup/quickstart
    linkText: クイックスタート
  - title: 描いたイラストを、どのリフレッシュレートでも滑らかに
    details: 手描きのラスター（PNG 等のビットマップ）素材を動かすため、ベクター系のアニメーションツールとは得意分野が異なり、.gif や .mp4 を同梱するより軽量です。再生ヘッドは浮動小数で描画の瞬間に評価されるため、ディスプレイのリフレッシュレートと指定した速度に追従します。
    link: /ja/usage/transport
    linkText: 再生の制御
  - title: 頂点は JavaScript を通らない
    details: タイムライン、ジオメトリ、Skia の描画呼び出しは、Nitro Modules（JSI）越しの Rust コアと C++ で行われ、フレームごとの React の再レンダーもありません。JavaScript がフレームごとに呼ぶネイティブの関数の数は、アニメーションの複雑さによらず同じです。
    link: /ja/usage/performance
    linkText: パフォーマンス
  - title: イベント通知・パーツ上書き・動的な着せ替え
    details: タイムライン上のイベントを JavaScript で受け取る、特定パーツの色・表示・セルを実行時に上書きする、<code>player.setCellmapTexture(name, image)</code>（<code>null</code> で復元）でアトラスを差し替えてカラーバリエーションや装備変更を行うといった制御が、再書き出しなしで可能です。
    link: /ja/usage/events
    linkText: イベント
  - title: アニメーションをカットせずに混ぜられる
    details: <code>transitionMs</code> によるクロスフェード遷移や、待機ループの上に表情変化・ヒット演出を重ねるマルチトラック再生とウェイト合成に対応しています。
    link: /ja/usage/motion-blending
    linkText: モーションブレンド
  - title: アニメーションで描くボタン
    details: <code>react-native-spritestudio-ui</code> の <code>&lt;SpriteStudioButton&gt;</code> は、ボタンになるビューです。押下・ホバー・フォーカスがそれぞれ 1 つのアニメーションの区間を再生し、押下を選んだパーツの上でだけ受けられ、OS の動きを減らす設定（reduced motion）と読み上げにも対応します。
    link: /ja/usage/ui
    linkText: UI ボタン
---

[SpriteStudio](https://www.webtech.co.jp/spritestudio/) は、手持ちのイラストにボーン・メッシュ・エフェクトを付けて動かす 2D アニメーションツールです。このプレイヤーは、その結果をアプリで再生します。

::: tip SpriteStudio のデータが手元に無くても始められます
[公式のサンプルデータ](https://www.webtech.co.jp/help/ja/spritestudio7/download/sample/)がそのまま使えます。キャラクターなら [Ringo](https://www.webtech.co.jp/help/ja/spritestudio7/download/sample/#ringo)、エフェクトを含むものなら [パーティクル](https://www.webtech.co.jp/help/ja/spritestudio7/download/sample/#Perticle_sample) が手頃です。自分のアニメーションを作るには SpriteStudio 本体を使います（[製品サイト](https://www.webtech.co.jp/spritestudio/)）。
:::

## 関連リポジトリ

- [SpriteStudio Docs](https://cri-middleware.github.io/SpriteStudio-Docs/ja/) — SDK と公式 Player のドキュメントポータル。
- [SpriteStudio-SDK](https://github.com/cri-middleware/SpriteStudio-SDK) — `libssruntime` / `libssconverter` を提供する SDK 本体。
- [SSConverterGUI](https://github.com/cri-middleware/SSConverterGUI) — Player を介さず `.sspj` を変換するデスクトップ GUI。
