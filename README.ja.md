[**English**](./README.md) | [**日本語**](./README.ja.md)

# SpriteStudio Player for React Native

**アーティストが作った 2D アニメーションを React Native アプリへ — コンポーネント 1 つ、アニメーションのコードなし、動画ファイルなし。**

**[SpriteStudio](https://www.webtech.co.jp/spritestudio/)** のアニメーション（`.ssab`）を [React Native](https://reactnative.dev/) の New Architecture 上で描画するプレイヤーです。SpriteStudio はプロ向けの 2D **ラスター**（スプライト）アニメーションエディタで、アーティストが手持ちの PNG 素材にボーン・メッシュ変形・マスク・パーティクルエフェクトを組み込み、1 つのファイルとして書き出します。このパッケージはそのファイルを再生し、[React Native Skia](https://shopify.github.io/react-native-skia/) でネイティブに描画します。スプライトシートの切り出しも、手書きのタイムラインも、動画のデコードも不要です。

> [!WARNING]
> **未リリースです。** npm パッケージは未公開で、**実機での動作確認もまだありません** — iOS シミュレータと Android エミュレータのみです。現時点で何が描けるかは [docs/ja/limitations.md](docs/ja/limitations.md) を、何がいつ入るかは [ROADMAP.md](ROADMAP.md) を参照してください。

## ✨ SpriteStudio を React Native で使うメリット

- **キャラクターも、画面全体も“生きる”。** 呼吸・まばたき、なびく髪や衣装、斬撃・魔法のエフェクト、さらに動く HUD まで——動きは専用エディタ（SpriteStudio）でビジュアルに作り込み、`<SpriteStudioView>` はそれを再生するだけ。ボーン・メッシュ変形・マスク・パーティクルにも対応し、パーツごとに `Animated` や Reanimated のタイムラインを組む必要はありません。
- **手描きの絵を、ネイティブ描画で。** ラスターのスプライト素材を動かすので、描き込んだキャラクターが描いたとおりに動きます（Lottie のようなベクター系ツールとは得意分野が異なります）。`.gif` や `.mp4` と違って自由に拡大縮小でき、シームレスにループし、アプリの操作にも反応します。
- **普通のビューとして使え、JS スレッドは空いたまま。** 他のビューと同じように配置・クリップ・アニメーションできます。1 フレームに JavaScript が呼ぶのはプレイヤー 1 つにつき 1 回だけで、タイムライン・ジオメトリ・描画は [Nitro Modules](https://nitro.margelo.com/) 越しのネイティブコードが担います。多数を同時に出すなら、`<SpriteStudioScene>` がキャンバス 1 枚とクロック 1 つでまとめて描画します。
- **フレームレートに縛られない滑らかな動き。** フレームは描画の瞬間に組み立てられるので、作成時の fps ではなく、ディスプレイのリフレッシュレートと再生速度に追従します。
- **アニメーションからアプリへ合図を送れる。** アーティストがタイムラインに置いたユーザーデータ・シグナル・オーディオキューがコールバックで届くので、足音や被弾リアクションのタイミングを、横で回すタイマーではなくアニメーション自身が決められます。パーツ単位のオーバーライドで、実行時に色変え・非表示・差し替えもできます。

## 📚 ドキュメント

- [**ドキュメントサイト**](https://cri-middleware.github.io/SSPlayerForReactNative/ja/) — セットアップ、使い方、生成された API リファレンス。🚧 初回リリース後に公開されます。
- [**AI アシスタント向け**](https://cri-middleware.github.io/SSPlayerForReactNative/llms.txt) — このドキュメントを Markdown で提供します。`llms.txt`（ページの目次）と `llms-full.txt`（全ページを 1 ファイルに）は英語版のページを集めたもので、日本語の各ページは `ja/` 配下の `.md` で取れます — 🚧 初回リリース後に公開
- [**SpriteStudio Docs（ポータル）**](https://cri-middleware.github.io/SpriteStudio-Docs/ja/) — SDK と全公式 Player の入口 — 🚧 初回リリース後に公開

---

## 🚀 クイックスタート

**アプリで使う場合**はこのまま下へ。入れる → アセットを準備する → 再生する。その先（イベント、パーツ上書き、テクスチャ差し替え）も同じ道の続きで、[ドキュメントサイト](https://cri-middleware.github.io/SSPlayerForReactNative/ja/)にあります。**プレイヤー自体や、その下の Rust コアを変更する場合**は[チェックアウトから動かす](docs/ja/development/from-source.md)、変更前に読む作業ガイドが
[CONTRIBUTING.md](CONTRIBUTING.md) です（何がいつ入るかは [ROADMAP.md](ROADMAP.md)）。

### インストール

> 🚧 パッケージは**まだ npm に公開されていません** — この手順は初回リリース後に使えるようになります。それまでは[チェックアウトから動かす](docs/ja/development/from-source.md)を参照してください。

```bash
npx expo install react-native-spritestudio @shopify/react-native-skia react-native-nitro-modules react-native-reanimated react-native-worklets
```

**Expo Go はこのパッケージを実行できません。** あなたのアプリには **development build** — このパッケージをコンパイルして組み込んだ自前のバイナリ — が必要です。managed なら `npx expo prebuild` の後に `npx expo run:ios` / `run:android`、bare なら既にネイティブプロジェクトがあるのでリビルドします。どちらでも autolinking がパッケージを拾います。詳細は [インストール](docs/ja/setup/install.md) にあります。

### まず動くところを見る

自分の素材は要りません。このリポジトリのサンプルアプリが、`SpriteStudio-SDK` サブモジュールから変換した SDK 自身のテストアニメーションを再生します。クローンから起動までの手順は [チェックアウトから動かす](docs/ja/development/from-source.md) に、画面の各 subject が何を示しているかは [サンプルアプリ](example/README.md) にあります。

> このパックの変換には、現状 Rust ツールチェーンが必要です（`deploy-examples` が SDK の `ssconverter-cli` をソースからビルドするため）。`ssconverter-core` の公開後は不要になります。

### アセットの準備（`.sspj` → `.ssab`）

アニメーションは SpriteStudio で作成します（対応するのは **7.5 以上**で作成されたプロジェクトです）。変換は手元のマシンで SDK の `ssconverter-cli`（またはデスクトップ版 [SSConverterGUI](https://github.com/cri-middleware/SSConverterGUI)）を使って変換します。コンバータは同梱しておらず、実行時に変換されることもありません — アセットを同梱する前に自分で実行する手順です。ツールの選び方とビルドパイプラインへの組み込みは[スタンドアロンツールでの変換](https://cri-middleware.github.io/SpriteStudio-Docs/ja/overview/convert-with-a-standalone-tool/)にあります。

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
| アニメーションの開始・変更・ループ・終了を知る | `onAnimationStarted`、`onAnimationChanged`、`onAnimationLooped`、`onAnimationFinished` |
| 実行時にパーツを色変え・非表示・差し替えする | `parts` prop — 宣言的なので、エントリを外せば元に戻ります |
| キャスト全体をキャンバス 1 枚・クロック 1 つで描く | `<SpriteStudioScene>` + `<SpriteStudioSprite>` |
| React のビューをパーツに追従させる（頭の上の HP バーなど） | ビューの children に置いた `<SpriteStudioPartAnchor>` — 自前のスタイルなら `useSsPartTransform` |
| ロードのコストをマウント前に払う | `ssPreload` / `ssUnload` |
| トランスポートを命令的に操作する | ref の `player`（`SpriteStudioPlayer`） |

どれが使えるかは `.ssab` が決めます。この移植版が対応するパーツ種別とキーは追加の配線なしですべて扱われます — 一覧は [docs/ja/limitations.md](docs/ja/limitations.md) にあります。

## 📋 要件

| | |
|---|---|
| React Native | **New Architecture 専用** |
| iOS | 15.1+ |
| Android | API 24+ |
| Peer deps | `react-native`、`react`、`@shopify/react-native-skia`、`react-native-nitro-modules`、`react-native-reanimated` — および `react-native-worklets`（Reanimated 4 が依存ではなく自身の peer として要求するもの）。それぞれ必要なバージョンは [`peerDependencies`](packages/react-native-spritestudio/package.json) にあり、インストール時にパッケージマネージャが検証します |
| SpriteStudio-SDK | [`scripts/SDK_VERSION.txt`](scripts/SDK_VERSION.txt) で固定 |

Skia の下限は実質的な制約です。2.11 で API オブジェクトが `jsi::NativeState` パターンへ移り、このパッケージは新しい方法で取り出しています。Windows・tvOS・visionOS は対象外です — 理由は [ROADMAP.md](ROADMAP.md#distribution--verification)（Windows）と [ROADMAP.md](ROADMAP.md#needs-sdk)（tvOS・visionOS）を参照してください。

### Web について

**このパッケージを追加しても web ビルドは壊れません。** react-native-web の下で `react-native-spritestudio` を import しても安全で、そのバンドルはビルドできます。web が解決するエントリポイントが*スタブ*だからです — native に**加えて** web も出荷し、SpriteStudio は native 側でだけ再生するアプリのために持っています。配置の計算、パスのヘルパー、語彙の enum は両プラットフォームで実装そのものであり、スタブになっているのは Skia かネイティブランタイムを必要とする部分だけです。そこでプレイヤーを描画しようとしたときだけ、このパッケージ名を含むエラーが投げられます。

**行わないのは、web でのアニメーション再生です。** web 上の SpriteStudio に対する答えは [SpriteStudio Player for Web](https://github.com/cri-middleware/SSPlayerForWeb) です — `@spritestudio/ssplayer-webgl` が同じ `.ssab` を、React Native を挟まずに描画します。

## 🔗 関連リポジトリ

同じ `.ssab` が以下のすべてで動きます。

- [SpriteStudio-SDK](https://github.com/cri-middleware/SpriteStudio-SDK) — Rust コア（`libssruntime` / `libssconverter`）と `.fbs` スキーマ
- [SSConverterGUI](https://github.com/cri-middleware/SSConverterGUI) — `.sspj` → `.ssab` 変換のデスクトップ GUI
- [SSPlayerForWeb](https://github.com/cri-middleware/SSPlayerForWeb)

## 📄 ライセンス

本プロジェクトは BSD-3-Clause ライセンスの下で提供されます — [LICENSE.md](LICENSE.md) を参照してください。参考訳は [LICENSE.ja.md](LICENSE.ja.md) にあります。

また、FlatBuffers と `libssruntime` を公開するアプリにコンパイルして組み込むため、*あなたの*バイナリに義務が生じます。謝辞に何を含めるべきかは [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) を参照してください。
