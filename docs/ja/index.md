---
layout: home
title: SSPlayerForReactNative
description: SpriteStudio 7 のアニメーションを React Native で — コンポーネント 1 つ、アニメーションのコードなし。

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
    details: 動きは SpriteStudio 7 で視覚的に作られます — ボーンリグ、メッシュ変形、マスク、パーティクル。プレイヤーは書き出されたファイルを再生するだけです。パーツごとの Animated / Reanimated タイムラインも、切り出すスプライトシートもありません。
  - title: ラスター素材を、ネイティブ描画で
    details: ラスターのスプライト素材にリグを入れて変形させるので、手描きのキャラクターが作られたとおりに動きます。ベクターツールとは適性が異なり、.gif や .mp4 を同梱するより軽量です。
  - title: フレームレートに縛られない滑らかさ
    details: 再生ヘッドは浮動小数で、フレームは描画される瞬間に組み立てられます。動きはディスプレイのリフレッシュレートと指定した速度に追従します。
  - title: 1 フレームあたり、プレイヤー 1 つにつき 1 回の呼び出し
    details: タイムライン、ジオメトリ、Skia の描画呼び出しは、Nitro Modules（JSI）越しの Rust コアと C++ で行われます。賑やかなシーンでも 60 fps を保てるのはこのためです。
---

::: warning まだリリースされていません
npm パッケージは未公開で、**実機での動作確認もまだありません** — iOS シミュレータと
Android エミュレータのみです。現時点で何が描けるかは
[制約と適用範囲](/ja/limitations)を参照してください。
:::

## `.sspj` から画面まで {#pipeline}

変換は**ビルド時に一度だけ**、手元のマシンで行います。エディタ連携はなく、実行時に
変換されるものもありません。そのぶん見落とされやすいのが下図の中段です。パックは
*ディレクトリ*で、**ネイティブのアプリアセット**として運ばれ、変更するたびにアプリの
ビルドが必要になります。

```mermaid
graph LR
    SS[".sspj / 画像"]

    subgraph Convert ["① 変換 — 手元で一度だけ"]
        WEB["ssconverter-web<br>ブラウザ"]
        GUI["SSConverterGUI<br>デスクトップ"]
        CLI["ssconverter-cli<br>CLI / CI"]
    end

    PACK["パックのディレクトリ<br>.ssab + .png / .ssqb"]

    subgraph Ship ["② 同梱 — ネイティブのアプリアセットとして"]
        PLUGIN["Expo config plugin"]
        BUILD["ネイティブビルド"]
    end

    subgraph Run ["③ 実行"]
        VIEW["SpriteStudioView"]
        RT("libssruntime<br>JSI 越しの Rust + C++") -. "更新 · ベイク" .-> VIEW
    end

    CANVAS{{"Skia キャンバス"}}

    SS --> WEB
    SS --> GUI
    SS --> CLI
    WEB --> PACK
    GUI --> PACK
    CLI --> PACK
    PACK --> PLUGIN
    PLUGIN --> BUILD
    BUILD --> VIEW
    VIEW -->|"描画"| CANVAS
    VIEW -. "パックを変更したら ② からやり直し" .-> PLUGIN

    classDef gen stroke-dasharray:5 5;
    class PACK gen;
    classDef tool fill:#eef2ff,stroke:#818cf8,color:#1e1b4b;
    class WEB,GUI,CLI tool;
    classDef ship fill:#fef9c3,stroke:#eab308,color:#422006;
    class PLUGIN,BUILD ship;
```

コンバータの選び方と、パックのディレクトリが保たなければならないものは
[アセットの準備](/ja/setup/assets)にあります。
