---
title: アセットの準備
description: .sspj から .ssab への変換と、パックがファイルではなくディレクトリである理由。
---

# アセットの準備（`.sspj` → `.ssab`）

SpriteStudio が保存するのは `.sspj` プロジェクトで、このパッケージが再生するのは
`.ssab` です。その間の変換は**あなた自身が**手元のマシンで、**ビルド時に一度だけ**実行する手順です。React Native にはインポータを載せるエディタが無いので、自動の経路はなく、実行時に変換されるものもありません。変換はあなたが持つ手順です。

```mermaid
graph LR
    SS[".sspj / 画像"]

    subgraph Convert ["① 変換 — 手元で一度だけ"]
        WEB["ssconverter-web<br>ブラウザ"]
        GUI["SSConverter GUI<br>デスクトップ"]
        CLI["ssconverter-cli<br>CLI / CI"]
    end

    PACK["パックのディレクトリ<br>.ssab + .png / .ssqb"]

    subgraph Ship ["② 同梱 — ネイティブのアプリアセットとして"]
        PLUGIN["Expo config plugin"]
        BUILD["ネイティブビルド"]
    end

    subgraph Run ["③ 実行 — あなたのアプリで"]
        VIEW["SpriteStudioView<br>source · animation"]
    end

    CANVAS{{"画面"}}

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

見落とされやすいのは中段で、このページの残りはその中段の詳細です。パックは*ディレクトリ*で、**ネイティブのアプリアセット**として運ばれ、変更するたびにアプリのビルドが必要になります。

## コンバータを選ぶ

ツールは 3 つ、背後のコンバータは 1 つです。能力ではなく**作業スタイル**で選んでください
— 出力は同じです。

::: tip 手元に `.sspj` がまだ無いときは
[SpriteStudio 公式のサンプルデータ](https://www.webtech.co.jp/help/ja/spritestudio7/download/sample/)がそのまま使えます。キャラクターなら
[Ringo](https://www.webtech.co.jp/help/ja/spritestudio7/download/sample/#ringo)、エフェクトを含むものなら[パーティクル](https://www.webtech.co.jp/help/ja/spritestudio7/download/sample/#Perticle_sample)が手頃です。ダウンロードしたプロジェクトは、下のどのコンバータにもそのまま渡せます。
:::

| ツール | 向いている場面 | 入手方法 |
|---|---|---|
| `ssconverter-web` | 数個を手作業で変換。インストール不要 | <a href="https://cri-middleware.github.io/SSPlayerForWeb/ssconverter/" target="_blank" rel="noreferrer">ホスト版のコンバータ</a>を開く（ZIP でダウンロードされるので展開します） |
| SSConverter GUI | デスクトップ GUI（macOS・Windows）で繰り返し変換 | [Releases](https://github.com/cri-middleware/SSConverterGUI/releases) のバイナリ |
| `ssconverter-cli` | CI、バッチ、再現性 | [SpriteStudio-SDK の Releases](https://github.com/cri-middleware/SpriteStudio-SDK/releases) のバイナリ |

::: info `ssconverter-web` へのフォルダのドロップには Chromium 系ブラウザが必要です
ドロップされたフォルダは **File System Access API** で読むため、ドロップは Chrome や Edge で動作します。Firefox と Safari では **Browse...** でフォルダを選択してください。パックは出口だけでなく、入口でもディレクトリです。
:::

::: tip 変換そのものは、全プレイヤー共通で 1 か所に書かれています
[スタンドアロンツールでの変換](https://cri-middleware.github.io/SpriteStudio-Docs/ja/overview/convert-with-a-standalone-tool/)がこのパッケージの取る経路で、ツールの選び方とビルドや CI パイプラインへの組み込みを扱っています。[アセットの変換](https://cri-middleware.github.io/SpriteStudio-Docs/ja/overview/conversion/)は変換経路の全体像です。
:::

## パックはファイルではなくディレクトリです

`.ssab` は、テクスチャ、Instance パーツが参照する外部パック、そして `.ssqb` を通じてシーケンスするパックを、**すべて自身からの相対パス**で指定します。したがってコンバータの*出力ディレクトリ*がそのまま端末に届く必要があります。

Metro はこれを運べません。`require()` が名指ししたものだけをバンドルし、ディレクトリを走査することはなく、さらに Android のパッケージャが名指しされたものを `res/` に平坦化してしまいます。ここから 2 つの帰結が出てきますが、どちらも重要です。

- **`require()` したモジュールは `source` として使えません。** 背後にディレクトリを持たない唯一の形式です。
- **`assetExts` に `ssab` / `ssqb` を入れてはいけません。** Metro にこれらの拡張子を教えると、まさに動作しない「平坦化され、参照先のファイルを失ったコピー」ができあがります。

パックのディレクトリは代わりに**ネイティブのアプリアセット**として同梱します。

```json
{
  "expo": {
    "plugins": [["react-native-spritestudio", { "assets": ["./assets/ss"] }]]
  }
}
```

プラグインはビルドのたびに再コピーするので、コンバータを再実行した後はリビルドだけで済み、`prebuild` のやり直しは不要です。

::: warning アセットは Fast Refresh されません
同梱したパックを変更したらネイティブビルドが必要です。このファイルはバンドルのエントリではなくアプリのアセットだからです。`http(s)` URL で配信するパックは例外で、そこから読み込むのでビルドし直す必要はありません（[基本的な再生](../usage/basic.md)）。
:::

## Reference パックと Embedded パック {#reference-and-embedded-packs}

コンバータは 2 種類のどちらかを出力します。これは SDK 側の呼称です。
`ssconverter-cli --embedded`、または ssconverter-web と SSConverter GUI の **Embedded Assets** チェックボックスで Embedded パックを `<project>_emb/` フォルダに生成し、指定しなければ Reference パックを生成します。

| 種類 | 同梱される形 | トレードオフ |
|---|---|---|
| **Reference** | `.ssab` と、その隣に並ぶ `.png` 群 | テクスチャごとに 1 ファイル。同じセルマップを名指しするパック間で共有されます |
| **Embedded** | 自己完結した `.ssab` 1 つ | 運搬中に失うものがない。エンコードされたバイト列はリソースの生存期間中ずっと常駐します |

どちらもここで動作します。ローダーはテクスチャ単位で選択し Embedded を優先するので、両方が混在したパックでも問題ありません。
