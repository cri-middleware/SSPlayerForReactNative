[**English**](./README.md) | [**日本語**](./README.ja.md)

# react-native-spritestudio

**アーティストが作った 2D アニメーションを React Native アプリへ — コンポーネント 1 つ、アニメーションのコードなし、動画ファイルなし。**

**[SpriteStudio](https://www.webtech.co.jp/spritestudio/)** のアニメーション（`.ssab`）を React Native の New Architecture 上で再生します。描画は [React Native Skia](https://shopify.github.io/react-native-skia/) によるネイティブ描画で、タイムラインとジオメトリは [Nitro Modules](https://nitro.margelo.com/)（JSI）越しの Rust コアが担います。

- 📖 **[ドキュメント](https://cri-middleware.github.io/SSPlayerForReactNative/)** — セットアップ、使い方、生成された API リファレンス。このバージョンの同じページ（英語の Markdown）がパッケージの `docs/` にあり、オフラインで読めます（入口は `docs/README.md`）
- 📦 **[リポジトリ](https://github.com/cri-middleware/SSPlayerForReactNative)** — 詳細版 README、ロードマップ、サンプルアプリ
- 🌐 **[SpriteStudio Docs（ポータル）](https://cri-middleware.github.io/SpriteStudio-Docs/ja/)** — SDK と各公式プレイヤーの総合案内

## インストール

```bash
npx expo install react-native-spritestudio react-native-skia react-native-nitro-modules react-native-reanimated react-native-worklets
```

**Expo Go では動きません** — ネイティブコードを含むため prebuild（CNG）が必要です。`npx expo prebuild` の後に `npx expo run:ios` / `run:android` を実行してください。素の React Native アプリでも autolinking が両プラットフォームで拾いますが、config plugin が担う 2 つの作業（パックのディレクトリをネイティブアセットとして同梱すること、32 ビット `x86` の ABI を外すこと）は自分で行います。Android の `minSdkVersion` は 26 にします（[インストール](https://cri-middleware.github.io/SSPlayerForReactNative/ja/setup/install)）。

## パックを配置する

`.ssab` はテクスチャや外部パックを**自身からの相対パス**で参照します。つまり**パックはファイルではなくディレクトリ**であり、Metro が運ぶのは依存グラフであってディレクトリではありません。そのためパックのディレクトリは、Expo config plugin を通じてネイティブのアプリアセットとして同梱します。

```json
{
  "expo": {
    "plugins": [["react-native-spritestudio", { "assets": ["./assets/ss"] }]]
  }
}
```

`.sspj` → `.ssab` の変換は手元のマシンで、SDK の `ssconverter-cli` またはデスクトップ版 [SSConverterGUI](https://github.com/cri-middleware/SSConverterGUI) で行います。コンバータは同梱していません。

## 再生する

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

統合はこれで全部です。テクスチャは付いてきますし、再生はロード時に始まり、既定では無限にループします。

複数のアニメーションを同時に扱うなら、`<SpriteStudioScene>` + `<SpriteStudioSprite>` が**キャンバス 1 枚とクロック 1 つ**でキャスト全体を描画します。タイムラインに置かれたキーは `onUserData` / `onAudio` / `onSignal` コールバックとして届き、`parts` prop はパーツの色変え・非表示・差し替えを宣言的に行います。`transitionMs` を指定すると `animation` の変更がクロスフェードになり、プレイヤーはトラックでアニメーションを重ねられます — ドキュメントのモーションブレンディングを参照してください。

## 要件

| | |
|---|---|
| React Native | `^0.88.0` — **New Architecture 専用** |
| React | `^19.3.0` |
| Peer deps | `react-native-skia` `^3.6.1`, `react-native-nitro-modules` `^0.37.0`, `react-native-reanimated` `^4.6.0` — および `react-native-worklets` `^0.12.2`（Reanimated 4 が自身の peer として要求するもの） |
| iOS | 15.1+ |
| Android | API 26+、Vulkan |

React Native Skia は `react-native-skia` の 3 です。Skia Graphite で描画し、Android の下限もこれで決まります。`@shopify/react-native-skia`（v2）は代わりにならず、同時にも入れられません。**peer 依存は必ず単一コピーに保ってください** — ネイティブモジュールが 2 つあるのは依存の重複ではなく、**1 つの JSI 登録を 2 つの autolink された pod が奪い合っている**状態です。

Windows・tvOS・visionOS は対象外です。**このパッケージは web ではアニメーションを再生しません**。web 上の SpriteStudio には [SSPlayerForWeb](https://github.com/cri-middleware/SSPlayerForWeb) を使ってください。ここに含まれるのは web 用の*スタブ*で、native に**加えて** web も対象とするアプリが web バンドルをビルドできるようにするためのものです。

## ライセンス

BSD-3-Clause — [LICENSE.md](./LICENSE.md) を参照してください。

また、FlatBuffers と `libssruntime` を公開するアプリにコンパイルして組み込むため、*あなたの*バイナリに義務が生じます。謝辞に何を含めるべきかは [THIRD_PARTY_NOTICES.md](https://github.com/cri-middleware/SSPlayerForReactNative/blob/HEAD/THIRD_PARTY_NOTICES.md) を参照してください。
