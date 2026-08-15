[**English**](./README.md) | [**日本語**](./README.ja.md)

# SpriteStudio Player for React Native

**アーティストが作った 2D アニメーションを React Native アプリへ — コンポーネント 1 つ、アニメーションのコードなし、動画ファイルなし。**

▶️ **[サンプルアプリを動かす](#動作確認)** — SDK のサンプルアニメーションが、実際の API を通して iOS と Android で動きます。

**[OPTPiX SpriteStudio 7](https://www.webtech.co.jp/spritestudio/)** のアニメーション（`.ssab`）を [React Native](https://reactnative.dev/) の New Architecture 上で描画するプレイヤーです。SpriteStudio 7 はプロ向けの 2D **ラスター**（スプライト）アニメーションエディタで、アーティストが手持ちの PNG 素材にボーン・メッシュ変形・マスク・パーティクルエフェクトを組み込み、1 つのファイルとして書き出します。このパッケージはそのファイルを再生し、[React Native Skia](https://shopify.github.io/react-native-skia/) でネイティブに描画します。スプライトシートの切り出しも、手書きのタイムラインも、動画のデコードも不要です。

> [!WARNING]
> **未リリースです。** npm パッケージは未公開で、**実機での動作確認もまだありません** — iOS シミュレータと Android エミュレータのみです。現時点で何が描けるかは[ステータス](#-ステータス)を、何がいつ入るかは [ROADMAP.md](ROADMAP.md) を参照してください。

## ✨ なぜ SpriteStudio Player か

- **スプライトも、シーン全体も、アニメーションのコードなしで動かせます。** 呼吸やまばたき、髪や衣服の揺れ、派手な斬撃や魔法エフェクト。パーツごとに `Animated` や Reanimated のタイムラインを手で組んだり、スプライトシートを切って `<Image>` でめくったりする代わりに、動きは専用エディタで視覚的に作られ、プレイヤーはそれを再生するだけです — ボーンリグ、メッシュ変形、マスク、パーティクルまで含めて。対象はマスコット 1 体に限りません。アニメーションする **UI や HUD、シーン全体**をエディタ上で構成し、まとめて 1 つとして描画できます。
- **ラスタースプライトのアニメーションを、ネイティブ描画で — ベクターでも動画でもなく。** **ラスターのスプライト素材**にリグを入れて変形させるので、手描きのキャラクターやゲームスプライトが作られたとおりに動きます。Lottie のようなベクターツールとは適性が異なり、`.gif` や `.mp4` を同梱するよりはるかに軽量です。実行時に自由にスケールし、継ぎ目なくループし、単に再生するのではなくアプリに反応します。タイムラインとジオメトリは、SpriteStudio の各公式プレイヤーが共通して使う Rust コアそのものであって再実装ではないため、アーティストが書き出したものがどのプラットフォームにも同じように渡ります — ただし*この*移植版がそこから何を描けるかは所によりまだ追いついておらず、それは下の **ステータス** に挙げてあります。
- **フレームレートに縛られない滑らかな動き。** 再生ヘッドは浮動小数で、フレームは描画される瞬間に組み立てられます。したがって動きは、作成時の fps によるパラパラ漫画でも 30 fps で焼かれた動画でもなく、ディスプレイのリフレッシュレートと指定した速度に追従します。
- **アニメーションが 1 フレームのコストにならないように作られています。** 重い処理 — タイムライン、ジオメトリ、Skia の描画呼び出し — はすべて [Nitro Modules](https://nitro.margelo.com/)（JSI）越しの Rust コアと C++ で行われます。JavaScript の 1 フレームあたりの仕事は**プレイヤー 1 つにつき 1 回の呼び出し**で、これが賑やかなシーンでも 60 fps を保てる理由です（[計測結果](docs/phase0-spike.md)）。
- **React Native のツリーに馴染みます。** `<SpriteStudioView>` はごく普通のビューです — 他のビューと同じように配置し、サイズを決め、クリップし、アニメーションさせられます。多数のアニメーションを同時に？ `<SpriteStudioScene>` は N 個ずつではなく、**キャンバス 1 枚とクロック 1 つ**でキャスト全体を描画します。
- **アニメーションからアプリへ話しかけられます。** アーティストがタイムラインに置いたキーはコールバックとして届きます — ユーザーデータ、オーディオキュー、シグナル。足音や当たりフレームは、横で維持しているタイマーではなくアニメーション自身から発生します。パーツ単位のオーバーライドにより、実行時にパーツを宣言的に色変え・非表示・差し替えできます。

## 🚧 ステータス

**両プラットフォームで現在描けるもの：** **Normal / Mesh / Shape / Instance / Effect** の各パーツ、**マスクとクリッピング**（Normal と Shape のターゲットに対して。下記参照、および Instance の子へまたがるマスクを含む）、フレームバッファの**ブレンドテーブル**全種、**PartColor**、13 個の **`ss-*` 統合シェーダー** — さらに**オーバーライドレイヤー**（色 / セル / 表示）、**ユーザーデータ・オーディオ・シグナルのイベント**、**アニメーションライフサイクル**のコールバック（開始 / 変更 / ループ / 完了）、`fit`/`align` による配置、リソースとアトラスのキャッシュ、`<SpriteStudioScene>`、Expo config plugin、型付きアセットマニフェスト。

**未対応：** **Nines と Text** パーツ。**マスクされた Mesh と Effect**（現在はどちらも*マスクなし*で描画されます）。**呼び出し元のマスクが届いている間の、子自身のマスク writer** — 呼び出し元のカバレッジが引き渡され、そのフレームでは子自身の writer は何も書きません。**Instance パーツ自身の PartColor**（参照実装の 2 つはこれをサブツリー全体の色味として適用しますが、この移植版は未実装です）。そして **Reanimated ティック** — パーツのトランスフォームは既に shared value として公開されていますが、フレームループはまだ JS スレッド上の `requestAnimationFrame` です。それぞれの詳細は [ROADMAP.md](ROADMAP.md) にあります。

**オーディオは通知されるだけで、再生はされません。** `onAudio` は何を・何回・どのファイルを再生すべきかを伝えます。実際の再生はアプリ自身のオーディオスタックの仕事です。React Native には標準のオーディオ API がなく、パッケージ側でライブラリを 1 つ選んでしまうと、音を一切使わないプロジェクトにまでそれを背負わせることになります。[`example/src/player/audio.ts`](example/src/player/audio.ts) が参照実装で、`expo-audio` は*サンプルアプリの*依存として使っています。

## 📚 ドキュメント

- [**ドキュメントサイト**](https://cri-middleware.github.io/SSPlayerForReactNative/) — セットアップ、使い方、生成された API リファレンス。🚧 初回リリース後に公開されます。
- [**SpriteStudio Docs（ポータル）**](https://cri-middleware.github.io/SpriteStudio-Docs/) — SDK と各公式プレイヤーの総合案内。

この README は短い版です。残りは以下のファイルが扱います。

- [**AGENTS.md**](AGENTS.md) — 作業ガイド：アーキテクチャ、不変条件、**ハード制約**、検証方法。何かを変更する前にまずここを読んでください。
- [**ROADMAP.md**](ROADMAP.md) — フェーズ、達成条件、意図的な非目標
- [**docs/phase0-spike.md**](docs/phase0-spike.md) — アーキテクチャを決定づけた計測、その手法と落とし穴

### 目的別・どこまで読めばよいか

自分の目的に必要なところまで読めば十分です。

| あなたは… | 目的 | 読む場所 |
|---|---|---|
| **一般の利用者** | アプリでアニメーションを再生する | [クイックスタート](#-1-クイックスタート) |
| **カスタマイズする利用者** | タイムラインに反応する、パーツを上書きする、シーン全体を配置する | 上記 + [さらに進む](#さらに進む) |
| **SDK / プレイヤー開発者** | プレイヤーやコアを拡張・貢献する | 上記 + [フルビルド環境](#-2-フルビルド環境) + [AGENTS.md](AGENTS.md) |

---

## 🚀 1. クイックスタート

### セットアップ

> 🚧 パッケージは**まだ npm に公開されていません** — この手順は初回リリース後に使えるようになります。それまでは[動作確認](#動作確認)でローカルに試してください。

```bash
npx expo install react-native-spritestudio @shopify/react-native-skia react-native-nitro-modules react-native-reanimated react-native-worklets
```

**Expo Go では動きません。** ネイティブコードを含むため prebuild（CNG）が必要です — `npx expo prebuild` の後に `npx expo run:ios` / `run:android`。素の React Native アプリでも動作し、autolinking が両プラットフォームでパッケージを拾います。

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

統合はこれで全部です。テクスチャは付いてきます — ローダーは各 `image_path` を `.ssab` の隣で解決し、パックが `--embedded` で変換されている場合は埋め込みアトラスの方を使います。再生はロード時に始まり、既定では無限にループします（`playing`・`speed`・`loop` は prop で、`loop={1}` なら 1 回だけ再生します）。

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

どれが使えるかは `.ssab` が決めます。[ステータス](#-ステータス)に挙げたパーツ種別とキーは、追加の配線なしですべて扱われます。

### 動作確認

サンプルアプリを実行すると、プレイヤーが端から端まで動くのを確認できます。**Rust ツールチェーンは不要です** — `download-sdk` が固定された SDK リリースからビルド済みのネイティブコアを取得します。各エントリポイントはホスト OS に応じて `.sh` か `.ps1` に振り分ける `.js` シムなので、macOS・Linux・Windows のいずれでも動作します。

```bash
git clone https://github.com/cri-middleware/SSPlayerForReactNative.git
cd SSPlayerForReactNative
git submodule update --init --recursive

npm install
npm run download-sdk        # ネイティブコア（固定された SDK リリースから）
npm run deploy-examples     # サンプルアプリ用に .sspj -> .ssab

cd example
npx expo prebuild --platform ios
npx expo run:ios            # または: npx expo prebuild --platform android && npx expo run:android
```

サンプルは 1 画面です。**Subject** で機能カード（`Basic`、`BlendMode`、`PartsColor`、`Mask`、`Mesh`、`Shape`、`Shader`、`Effect`、`Instance`、`UserData`、`Sound`、`Signal`）、実在のキャラクター（`Ringo`、および同じキャストをインスタンスパーツとしてマウントした `RingoInstances`）、SDK の 40 パックからなるパーティクルショーケース（`ParticleEffect`）を選びます。**Pack file** はサブジェクトが複数の `.ssab` を持つときに現れ、**Animation** は読み込んだパックから取得されます。**Textures** トグルは、アトラスが `.ssab` に埋め込まれたパックと兄弟ファイルとして保持するパックを切り替えるので、両方のテクスチャ経路を 1 か所で確認できます。ステージの下の表示は、発火したタイムラインキーと、ネイティブハンドルの現在数を示します。

各サブジェクトは `deploy-examples` が実際に生成したものから来ています — 一覧は生成されたマニフェストから読まれるので、変換されなかったパックは、何も読み込まないカードを残すのではなく画面から消えます。

### オプションのサブジェクト MaskInstance

上の一覧に含まれないサブジェクトが 1 つあります。その元データが**このリポジトリに含まれない**ためです — `MaskInstance`、ステージをマスクし、キャラクターをインスタンスパーツとしてマウントする 3 つのシーンです。マスクがインスタンスの子へまたがる状況を実際に踏む唯一のアセットで（SDK 自身のサンプルはマスクとインスタンスパーツを別ファイルに分けています）、`npm run check-mask` の 4 番目のチェックが対象とするものです。これが無い場合、そのチェックは自身をスキップとして報告します。

サードパーティのサンプル素材であり、再配布の許諾は当方にありません。追加するには、[SpriteStudio のサイト](https://www.webtech.co.jp/spritestudio/)から **OPTPiX SpriteStudio Basic Samples** をダウンロードし、その `Mask` プロジェクトを次の場所にコピーしてください。

```
example/SpriteStudio_Source/Mask/        <- Mask.sspj とその隣にあるすべて
```

あとは `npm run deploy-examples` が拾います — マニフェストも自身で更新するので、次のリロードでサブジェクトが現れます。そのマニフェストは**オプションのパックを含まない**状態でコミットされているため、追加すると `example/src/ss-assets.ts` が意図的に変更された状態になります。コミットしないでください。`assets --check` が「古い」と判定するのも同じ理由です。

## ⚙ 2. フルビルド環境

SDK / プレイヤー開発者向け — プレイヤー自体、または Rust コア（「Brain」）に手を入れる場合です。

### リポジトリ構成

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
├── example/                            <- Expo アプリ: プレイヤー画面
├── tools/                              <- ホスト側チェック（FrameData、ベイカー、マスク、hidden、シェーダー）
└── docs/                               <- VitePress サイト
    └── phase0-spike.md                 <- 計測記録
```

### Brain のビルド

`download-sdk` に **Rust ツールチェーンは不要**です。`build-runtime` を使うのは Brain 自体を変更しているときだけにしてください — submodule から同じレイアウトへビルドし、`<tag>+submodule-<sha>` と刻印されるので両者が混同されることはありません。Windows では Android スライスのみを対象とします（iOS の xcframework には Xcode が必要）。Windows での完全な答えは `download-sdk` です。

各スクリプトは `key=value` 形式の引数を取り、submodule 以外の SDK チェックアウトを指す `$SSSDK` を尊重します。これは各兄弟プレイヤーと同じ作法です。

```bash
npm run build-runtime -- platform=ios build=release
npm run download-sdk -- --force
npm run deploy-examples -- --embedded
```

> [!IMPORTANT]
> **計測の前に Brain を release でビルドしてください。** `build=debug` の `libssruntime` は他のすべてのコストを覆い隠し、ベンチマークが見つけようとしている差を平坦にしてしまいます — spike の最中に実際に 1 つ誤った結論を生みました。

### チェック

| チェック | コマンド |
|---|---|
| 型チェック（パッケージ + サンプル） | `npm run typecheck` |
| FlatBuffers アクセサが最新かつ読み取りパスが健全（`flatc` が必要） | `npm run check-framedata` |
| マスク描画、およびインスタンスの子へまたがるマスク（macOS） | `npm run check-mask` |
| 描画プランから外れている間もインスタンススロットが進み続けること | `npm run check-hidden` |
| `ss-*` シェーダーがコンパイルでき、その演算が正しいこと（macOS） | `npm run check-shader` |
| web スタブバレルが import 可能・`index.ts` と一致・throw すること（OS 不問、Brain 不要） | `npm run check-web-barrel` |
| Nitro のコード生成が最新であること | `npm run generate-nitro-code` → `git diff --exit-code packages/*/nitrogen` |

残りは [AGENTS.md](AGENTS.md) が扱います。4 層アーキテクチャ、**ハード制約**（`update()` のデルタがミリ秒であること、`ss_runtime_pause` がトグルであることなど、痛い目を見て学んだもの）、そしてどのサンプルサブジェクトが何を証明するかを示す機能別の検証表です。[docs/phase0-spike.md](docs/phase0-spike.md) は、そもそも描画をレイヤー 1 に置く判断の根拠となった計測です。

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
