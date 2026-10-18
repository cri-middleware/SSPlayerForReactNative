[**English**](./README.md) | [**日本語**](./README.ja.md)

# SpriteStudio Player for React Native

**アーティストが作った 2D アニメーションを React Native アプリへ — コンポーネント 1 つ、アニメーションのコードなし、動画ファイルなし。**

**[SpriteStudio](https://www.webtech.co.jp/spritestudio/)** のアニメーション（`.ssab`）を [React Native](https://reactnative.dev/) の New Architecture 上で描画するプレイヤーです。SpriteStudio はプロ向けの 2D **ラスター**（スプライト）アニメーションエディタで、アーティストが手持ちの PNG 素材にボーン・メッシュ変形・マスク・パーティクルエフェクトを組み込み、1 つのファイルとして書き出します。このパッケージはそのファイルを再生し、[React Native Skia](https://shopify.github.io/react-native-skia/) でネイティブに描画します。スプライトシートの切り出しも、手書きのタイムラインも、動画のデコードも不要です。

## ✨ SpriteStudio を React Native で使うメリット

- **キャラクターも、画面全体も“生きる”。** 呼吸・まばたき、なびく髪や衣装、斬撃・魔法のエフェクト、さらに動く HUD まで——動きは専用エディタ（SpriteStudio）でビジュアルに作り込み、`<SpriteStudioView>` はそれを再生するだけ。ボーン・メッシュ変形・マスク・パーティクルにも対応し、パーツごとに `Animated` や Reanimated のタイムラインを組む必要はありません。
- **手描きの絵を、ネイティブ描画で。** ラスターのスプライト素材を動かすので、描き込んだキャラクターが描いたとおりに動きます（Lottie のようなベクター系ツールとは得意分野が異なります）。`.gif` や `.mp4` と違って自由に拡大縮小でき、シームレスにループし、アプリの操作にも反応します。
- **普通のビューとして使え、描画はネイティブコードで。** 他のビューと同じように配置・クリップ・アニメーションできます。タイムライン・ジオメトリ・描画は [Nitro Modules](https://nitro.margelo.com/) 越しのネイティブコードが担うので、頂点が JavaScript を通ることも、フレームごとに React が再レンダーすることもありません。多数を同時に出すなら、`<SpriteStudioScene>` がキャンバス 1 枚とクロック 1 つでまとめて描画します。
- **フレームレートに縛られない滑らかな動き。** フレームは描画の瞬間に組み立てられるので、作成時の fps ではなく、ディスプレイのリフレッシュレートと再生速度に追従します。
- **アニメーションからアプリへ合図を送れる。** アーティストがタイムラインに置いたユーザーデータ・シグナル・オーディオキューがコールバックで届くので、足音や被弾リアクションのタイミングを、横で回すタイマーではなくアニメーション自身が決められます。パーツ単位のオーバーライドで、実行時に色変え・非表示・差し替えもできます。
- **アニメーションをカットせずに混ぜられる。** 歩きから走りへのクロスフェード、再生中の動きに照準やまばたきを重ねる、2 つのアニメーションを weight で混ぜる——どれもアーティストが別々に作ったアニメーションのままでできます。`transitionMs` を指定すれば、`animation` を変えたときにクロスフェードします。

## 📚 ドキュメント

- [**ドキュメントサイト**](https://cri-middleware.github.io/SSPlayerForReactNative/ja/) — セットアップ、使い方、生成された API リファレンス。
- [**AI アシスタント向け**](https://cri-middleware.github.io/SSPlayerForReactNative/llms.txt) — このドキュメントを Markdown で提供します。`llms.txt`（ページの目次）と `llms-full.txt`（全ページを 1 ファイルに）は英語版のページを集めたもので、日本語の各ページは `ja/` 配下の `.md` で取れます。
- [**SpriteStudio Docs（ポータル）**](https://cri-middleware.github.io/SpriteStudio-Docs/ja/) — SDK と全公式 Player の入口

---

## 🚀 クイックスタート

**アプリで使う場合**はこのまま下へ。入れる → 変換する → 再生する、の順です。その先（イベント、パーツ上書き、テクスチャ差し替え）も同じ道の続きで、[ドキュメントサイト](https://cri-middleware.github.io/SSPlayerForReactNative/ja/)にあります。**プレイヤー自体や、その下の Rust コアを変更する場合**は下の[プレイヤーを開発する場合](#%EF%B8%8F-プレイヤーを開発する場合)、変更前に読む作業ガイドが [CONTRIBUTING.md](CONTRIBUTING.md) です（何がいつ入るかは [ROADMAP.md](ROADMAP.md)）。

**New Architecture** の React Native アプリを **development build** で動かす必要があります（Expo Go はネイティブコードを読み込めません）。SpriteStudio のプロジェクトは **7.5 以上**で作成したものです。バージョンは[要件](#-要件)にあります。

1. **導入**: パッケージと peer をインストールします。

   ```bash
   npx expo install react-native-spritestudio react-native-skia react-native-nitro-modules react-native-reanimated react-native-worklets
   ```

   Android の `minSdkVersion` は 26 にします。`expo-build-properties` の書き方は [インストール](docs/ja/setup/install.md#3-アプリをビルドする) にあります。
2. **変換**: `.sspj` を、Chrome か Edge で開く [ssconverter-web](https://cri-middleware.github.io/SSPlayerForWeb/ssconverter/)、デスクトップの [SSConverterGUI](https://github.com/cri-middleware/SSConverterGUI)、または SDK の `ssconverter-cli` で変換します。どれもプロジェクト名のフォルダを書き出し、その中に `.ssab` とテクスチャが入ります。そのフォルダを `assets/ss/` に置き、`app.json` で config plugin に `assets/ss` を指定します。

   ```
   my-app/
   ├── app.json
   ├── App.tsx               ← source="ss/Ringo/Ringo.ssab"
   └── assets/
       └── ss/               ← アプリに ss/ として入る
           └── Ringo/        ← コンバータが書き出したフォルダ
               ├── Ringo.ssab
               ├── Ringo.png
               └── …
   ```

   ```json
   {
     "expo": {
       "plugins": [["react-native-spritestudio", { "assets": ["./assets/ss"] }]]
     }
   }
   ```

   このフォルダは Metro ではなくネイティブのアプリアセットとして運ばれるので、パックを変えたらネイティブビルドが必要です。理由は [アセットの準備](docs/ja/setup/assets.md) にあります。
3. **再生**: アプリをビルドし（`npx expo prebuild` の後に `npx expo run:ios` か `run:android`）、同梱したフォルダの中のパスでパックを指定します。

   ```tsx
   import { SpriteStudioView } from 'react-native-spritestudio'

   export function Character() {
     return (
       <SpriteStudioView
         source="ss/Ringo/Ringo.ssab"
         animation="wait1"
         fit="contain"
         style={{ flex: 1 }}
       />
     )
   }
   ```

   再生はロード時に始まり、既定では無限にループします。`loop={1}` なら 1 回だけ再生します。

bare のアプリには `prebuild` がありません。ネイティブプロジェクトをリビルドし、config plugin が担う 2 つの作業（パックのフォルダを同梱すること、32 ビット `x86` の ABI を外すこと）を自分で行います（[インストール](docs/ja/setup/install.md#3-アプリをビルドする)）。

SpriteStudio のデータが手元に無くても始められます。[公式のサンプルデータ](https://www.webtech.co.jp/help/ja/spritestudio7/download/sample/)がそのまま使えます。キャラクターなら [Ringo](https://www.webtech.co.jp/help/ja/spritestudio7/download/sample/#ringo) が手頃です。

**次に読む:** [基本的な再生](docs/ja/usage/basic.md) · [コンポーネント早見](docs/ja/components.md) ·
[制約と適用範囲](docs/ja/limitations.md) · [トラブルシューティング](docs/ja/troubleshooting.md)

## 📋 要件

| | |
|---|---|
| React Native | **New Architecture 専用** |
| iOS | 15.1+ |
| Android | API 26+、Vulkan |
| Peer deps | `react-native`、`react`、`react-native-skia`、`react-native-nitro-modules`、`react-native-reanimated` — および `react-native-worklets`（Reanimated 4 が依存ではなく自身の peer として要求するもの）。それぞれ必要なバージョンは [`peerDependencies`](packages/react-native-spritestudio/package.json) にあり、インストール時にパッケージマネージャが検証します |
| SpriteStudio-SDK | [`scripts/SDK_VERSION.txt`](scripts/SDK_VERSION.txt) で固定 |

描画は React Native Skia 3（パッケージ名 `react-native-skia`）を通ります。Skia Graphite で描画し、Android の下限もこれで決まります。`@shopify/react-native-skia`（v2）は代わりにならず、同時にも入れられません。Windows・tvOS・visionOS は対象外です — 理由は [ROADMAP.md](ROADMAP.md#distribution--verification)（Windows）と [ROADMAP.md](ROADMAP.md#needs-sdk)（tvOS・visionOS）を参照してください。

### Web について

**このパッケージを追加しても web ビルドは壊れません。** react-native-web の下で `react-native-spritestudio` を import しても安全で、そのバンドルはビルドできます。web が解決するエントリポイントが*スタブ*だからです — native に**加えて** web も出荷し、SpriteStudio は native 側でだけ再生するアプリのために持っています。配置の計算、パスのヘルパー、語彙の enum は両プラットフォームで実装そのものであり、スタブになっているのは Skia かネイティブランタイムを必要とする部分だけです。そこでプレイヤーを描画しようとしたときだけ、このパッケージ名を含むエラーが投げられます。

**行わないのは、web でのアニメーション再生です。** web 上の SpriteStudio に対する答えは [SpriteStudio Player for Web](https://github.com/cri-middleware/SSPlayerForWeb) です — `@spritestudio/ssplayer-webgl` が同じ `.ssab` を、React Native を挟まずに描画します。

## ⚙️ プレイヤーを開発する場合

このリポジトリのサンプルアプリは、`SpriteStudio-SDK` サブモジュールから変換した SDK 自身のテストアニメーションを再生します。クローンから起動までの手順は [チェックアウトから動かす](docs/ja/development/from-source.md) に、画面の各 subject が何を示しているかは [サンプルアプリ](example/README.md) にあります。このパックの変換には Rust ツールチェーンが必要です（`deploy-examples` が SDK の `ssconverter-cli` をソースからビルドするため）。

## 🔗 関連リポジトリ

同じ `.ssab` が以下のすべてで動きます。

- [SpriteStudio-SDK](https://github.com/cri-middleware/SpriteStudio-SDK) — Rust コア（`libssruntime` / `libssconverter`）と `.fbs` スキーマ
- [SSConverterGUI](https://github.com/cri-middleware/SSConverterGUI) — `.sspj` → `.ssab` 変換のデスクトップ GUI
- [SSPlayerForWeb](https://github.com/cri-middleware/SSPlayerForWeb)

## 📄 ライセンス

本プロジェクトは BSD-3-Clause ライセンスの下で提供されます — [LICENSE.md](LICENSE.md) を参照してください。参考訳は [LICENSE.ja.md](LICENSE.ja.md) にあります。

また、FlatBuffers と `libssruntime` を公開するアプリにコンパイルして組み込むため、*あなたの*バイナリに義務が生じます。謝辞に何を含めるべきかは [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) を参照してください。
