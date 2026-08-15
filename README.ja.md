[**English**](./README.md) | [**日本語**](./README.ja.md)

# SpriteStudio Player for React Native

**アーティストが作った 2D アニメーションを React Native アプリへ — コンポーネント 1 つ、アニメーションのコードなし、動画ファイルなし。**

▶️ **[サンプルアプリを動かす](example/README.md)** — SDK のサンプルアニメーションが、実際の API を通して iOS と Android で動きます。

**[OPTPiX SpriteStudio 7](https://www.webtech.co.jp/spritestudio/)** のアニメーション（`.ssab`）を [React Native](https://reactnative.dev/) の New Architecture 上で描画するプレイヤーです。SpriteStudio 7 はプロ向けの 2D **ラスター**（スプライト）アニメーションエディタで、アーティストが手持ちの PNG 素材にボーン・メッシュ変形・マスク・パーティクルエフェクトを組み込み、1 つのファイルとして書き出します。このパッケージはそのファイルを再生し、[React Native Skia](https://shopify.github.io/react-native-skia/) でネイティブに描画します。スプライトシートの切り出しも、手書きのタイムラインも、動画のデコードも不要です。

> [!WARNING]
> **未リリースです。** npm パッケージは未公開で、**実機での動作確認もまだありません** — iOS シミュレータと Android エミュレータのみです。現時点で何が描けるかは [docs/limitations.md](docs/limitations.md) を、何がいつ入るかは [ROADMAP.md](ROADMAP.md) を参照してください。

## ✨ なぜ SpriteStudio Player か

- **スプライトも、シーン全体も、アニメーションのコードなしで動かせます。** 呼吸やまばたき、髪や衣服の揺れ、派手な斬撃や魔法エフェクト。パーツごとに `Animated` や Reanimated のタイムラインを手で組んだり、スプライトシートを切って `<Image>` でめくったりする代わりに、動きは専用エディタで視覚的に作られ、プレイヤーはそれを再生するだけです — ボーンリグ、メッシュ変形、マスク、パーティクルまで含めて。対象はマスコット 1 体に限りません。アニメーションする **UI や HUD、シーン全体**をエディタ上で構成し、まとめて 1 つとして描画できます。
- **ラスタースプライトのアニメーションを、ネイティブ描画で — ベクターでも動画でもなく。** **ラスターのスプライト素材**にリグを入れて変形させるので、手描きのキャラクターやゲームスプライトが作られたとおりに動きます。Lottie のようなベクターツールとは適性が異なり、`.gif` や `.mp4` を同梱するよりはるかに軽量です。実行時に自由にスケールし、継ぎ目なくループし、単に再生するのではなくアプリに反応します。タイムラインとジオメトリは、SpriteStudio の各公式プレイヤーが共通して使う Rust コアそのものであって再実装ではないため、アーティストが書き出したものがどのプラットフォームにも同じように渡ります — ただし*この*移植版がそこから何を描けるかは所によりまだ追いついておらず、それは下の **ステータス** に挙げてあります。
- **フレームレートに縛られない滑らかな動き。** 再生ヘッドは浮動小数で、フレームは描画される瞬間に組み立てられます。したがって動きは、作成時の fps によるパラパラ漫画でも 30 fps で焼かれた動画でもなく、ディスプレイのリフレッシュレートと指定した速度に追従します。
- **アニメーションが 1 フレームのコストにならないように作られています。** 重い処理 — タイムライン、ジオメトリ、Skia の描画呼び出し — はすべて [Nitro Modules](https://nitro.margelo.com/)（JSI）越しの Rust コアと C++ で行われます。JavaScript の 1 フレームあたりの仕事は**プレイヤー 1 つにつき 1 回の呼び出し**で、これが賑やかなシーンでも 60 fps を保てる理由です。
- **React Native のツリーに馴染みます。** `<SpriteStudioView>` はごく普通のビューです — 他のビューと同じように配置し、サイズを決め、クリップし、アニメーションさせられます。多数のアニメーションを同時に？ `<SpriteStudioScene>` は N 個ずつではなく、**キャンバス 1 枚とクロック 1 つ**でキャスト全体を描画します。
- **アニメーションからアプリへ話しかけられます。** アーティストがタイムラインに置いたキーはコールバックとして届きます — ユーザーデータ、オーディオキュー、シグナル。足音や当たりフレームは、横で維持しているタイマーではなくアニメーション自身から発生します。**オーディオは通知されるだけで再生はされません** — イベントは何をどこのファイルで再生すべきかを伝え、実際の再生はアプリ自身のオーディオスタックの仕事です（参照実装は [`example/src/player/audio.ts`](example/src/player/audio.ts)）。パーツ単位のオーバーライドにより、実行時にパーツを宣言的に色変え・非表示・差し替えできます。

## 📚 ドキュメント

- [**ドキュメントサイト**](https://cri-middleware.github.io/SSPlayerForReactNative/) — セットアップ、使い方、生成された API リファレンス。🚧 初回リリース後に公開されます。
- [**SpriteStudio Docs（ポータル）**](https://cri-middleware.github.io/SpriteStudio-Docs/) — SDK と各公式プレイヤーの総合案内。

### 目的別・どこまで読めばよいか

読者は 2 種類で、その境界は明確です。プレイヤーを**使う**人と、プレイヤーを**変える**
人です。設定でどうにかなる中間はありません — 描画は 1 フレームあたり 1 回の呼び出しの
奥、C++ 側にあるので、*何が描かれるか*を変えるならオプションを渡すのではなくパッケージ
自体に手を入れることになります。

**アプリで使う場合**は下の[クイックスタート](#-クイックスタート)、その後はドキュメント
サイトへ。最初の 1 体も、その先（イベント、パーツ上書き、テクスチャ差し替え）も、
同じ読者層の深さ違いであって別の層ではありません。

**プレイヤー自体や、その下の Rust コアを変更する場合**は、まず
[チェックアウトから動かす](docs/development/from-source.md)でリポジトリを動かし、
検証用アプリについては [`example/README.md`](example/README.md)、変更前に読む作業ガイド
が [AGENTS.md](AGENTS.md) です。何がいつ入るかは [ROADMAP.md](ROADMAP.md)。

---

## 🚀 クイックスタート

### インストール

> 🚧 パッケージは**まだ npm に公開されていません** — この手順は初回リリース後に使えるようになります。それまでは[チェックアウトから動かす](docs/development/from-source.md)を参照してください。

```bash
npx expo install react-native-spritestudio @shopify/react-native-skia react-native-nitro-modules react-native-reanimated react-native-worklets
```

**Expo Go はこのパッケージを実行できません。** あなたのアプリには **development build** — このパッケージをコンパイルして組み込んだ自前のバイナリ — が必要です。managed なら `npx expo prebuild` の後に `npx expo run:ios` / `run:android`、bare なら既にネイティブプロジェクトがあるのでリビルドします。どちらでも autolinking がパッケージを拾います。詳細は [インストール](docs/setup/install.md) にあります。

### アセットの準備（`.sspj` → `.ssab`）

アニメーションは SpriteStudio 7 で作成し、手元のマシンで SDK の `ssconverter-cli`（またはデスクトップ版 [SSConverterGUI](https://github.com/cri-middleware/SSConverterGUI)）を使って変換します。コンバータは同梱していません — React Native にはインポータを載せるエディタが存在しないためです。

**パックはファイルではなくディレクトリです。** `.ssab` は、テクスチャ、Instance パーツが参照する外部パック、そして `.ssqb` を通じてシーケンスするパックを、すべて自身からの相対パスで指定します。したがって `ssconverter-cli` の**出力ディレクトリ**がそのまま端末に届く必要があります。

Metro はこれを運べません。`require()` が名指ししたものだけをバンドルし、ディレクトリを走査することはなく、さらに Android のパッケージャが名指しされたものを `res/` に平坦化してしまいます。そこでパックのディレクトリは代わりに**ネイティブのアプリアセット**として同梱します。Expo config plugin に自分のディレクトリを指定してください。

```json
{
  "expo": {
    "plugins": [["react-native-spritestudio", { "assets": ["./assets/ss"] }]]
  }
}
```

プラグインはビルドのたびに再コピーするので、コンバータを再実行した後はリビルドだけで済み、`prebuild` のやり直しは不要です。ただしアセットの変更にはネイティブビルドが必要です — アセットは Fast Refresh されません。

### 再生する

パックは、そのアセットルート内のパスで指定します。

```tsx
import { SpriteStudioView } from 'react-native-spritestudio'

export function Character() {
  return (
    <SpriteStudioView
      source="ss/overall/Basic.ssab"
      animation="anime_1"
      fit="contain"
      style={{ flex: 1 }}
    />
  )
}
```

統合はこれで全部です。テクスチャは付いてきます — Reference パックならローダーが各 `image_path` を `.ssab` の隣で解決し、`--embedded` で変換された Embedded パックならファイル内から読み出します。再生はロード時に始まり、既定では無限にループします（`playing`・`speed`・`loop` は prop で、`loop={1}` なら 1 回だけ再生します）。

`source` にはファイルシステムのパスや `file://` URI（ダウンロード、展開済みバンドル）、`http(s)` URL（開発サーバー、CDN）も指定できます。兄弟ファイルの解決はいずれの形式でも同じです。`require()` したモジュールは source としては**使えません** — 背後にディレクトリを持たない唯一の形式だからです。

これらの文字列を手書きしたくない場合は、`npx react-native-spritestudio assets` がアプリの同梱するパックの型付きマニフェストを書き出します。キーの間違いが空白のキャンバスではなく**型エラー**になります。

### さらに進む

| やりたいこと | 使うもの |
|---|---|
| アーティストがタイムラインに置いたキーに反応する | `onUserData`、`onAudio`、`onSignal` |
| アニメーションの開始・変更・ループ・終了を知る | `onAnimationStart`、`onAnimationChange`、`onLoop`、`onComplete` |
| 実行時にパーツを色変え・非表示・差し替えする | `parts` prop — 宣言的なので、エントリを外せば元に戻ります |
| キャスト全体をキャンバス 1 枚・クロック 1 つで描く | `<SpriteStudioScene>` + `<SpriteStudioSprite>` |
| React のビューをパーツに追従させる（頭の上の HP バーなど） | `useSsPartTransform` — Reanimated の shared value 経由で公開されます |
| ロードのコストをマウント前に払う | `ssPreload` / `ssUnload` |
| トランスポートを命令的に操作する | ref の `player` — レイヤー 3 の `SpriteStudioPlayer` |

どれが使えるかは `.ssab` が決めます。この移植版が対応するパーツ種別とキーは追加の配線なしですべて扱われます — 一覧は [docs/limitations.md](docs/limitations.md) にあります。

## 📋 要件

| | |
|---|---|
| React Native | `^0.86.2` — **New Architecture 専用** |
| React | `^19.2.8` |
| Peer deps | `@shopify/react-native-skia` `^2.11.0`、`react-native-nitro-modules` `^0.36.5`、`react-native-reanimated` `^4.5.3` — および `react-native-worklets` `^0.11.3`（Reanimated 4 が依存ではなく自身の peer として要求するもの） |
| iOS | 15.1+ |
| Android | API 24+ |
| SpriteStudio-SDK | [`scripts/SDK_VERSION.txt`](scripts/SDK_VERSION.txt) で固定 |

Skia の下限は実質的な制約です。2.11 で API オブジェクトが `jsi::NativeState` パターンへ移り、このパッケージは新しい方法で取り出しています。Windows・tvOS・visionOS は対象外です — 理由は [ROADMAP.md](ROADMAP.md#platform-and-verification) を参照してください。

### Web について

**このパッケージは web ではアニメーションを再生しません。** web 上の SpriteStudio に対する答えは [SSPlayerForWeb](https://github.com/cri-middleware/SSPlayerForWeb) です — `@spritestudio/ssplayer-webgl` が同じ `.ssab` を、React Native を挟まずに描画します。

このパッケージが持っているのは web 用の*スタブ*で、native に**加えて** web も出荷し、SpriteStudio は native 側でだけ再生するアプリのためのものです。react-native-web の下で `react-native-spritestudio` を import しても安全なので、そうしたアプリの web バンドルはビルドできます。そこでプレイヤーを描画しようとすると、このパッケージ名を含むエラーが投げられます。配置の計算、パスのヘルパー、語彙の enum は両プラットフォームで実装そのものであり、スタブになっているのは Skia かネイティブランタイムを必要とする部分だけです。

## 🔗 関連リポジトリ

同じ `.ssab` が以下のすべてで動きます。

- [SpriteStudio-SDK](https://github.com/cri-middleware/SpriteStudio-SDK) — Rust コア（`libssruntime` / `libssconverter`）と `.fbs` スキーマ
- [SSConverterGUI](https://github.com/cri-middleware/SSConverterGUI) — `.sspj` → `.ssab` 変換のデスクトップ GUI
- [SSPlayerForWeb](https://github.com/cri-middleware/SSPlayerForWeb)

## 📄 ライセンス

本プロジェクトは BSD-3-Clause ライセンスの下で提供されます — [LICENSE.md](LICENSE.md) を参照してください。

また、FlatBuffers と `libssruntime` を公開するアプリにコンパイルして組み込むため、*あなたの*バイナリに義務が生じます。謝辞に何を含めるべきかは [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) を参照してください。
