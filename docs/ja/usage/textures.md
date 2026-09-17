---
title: テクスチャとリソース
description: アトラスがどこから来るか、実行時の差し替え、そしてマウント前にロードコストを払う方法。
---

# テクスチャとリソース

パックは自身のアトラスを読み込むので、このページを完全に無視しても構いません。ここが
扱うのは、無視できない 3 つの場合です — テクスチャを差し替えたいとき、複数のプレイヤーで
共有したいとき、そしてロードをマウント中ではなくマウント前に済ませたいときです。

## パックのアトラスがどこから来るか

パックは 2 種類のどちらかです — **Reference** か **Embedded**、SDK 側の呼称です。
Reference パックならローダーが各 `image_path` を **`.ssab` 自身からの相対パス**で解決し、
Embedded パックならファイル内からアトラスを読み出します。テクスチャ単位で Embedded が
優先されるので、両方が混在したパックでも問題ありません。

| 種類 | 同梱される形 | トレードオフ |
|---|---|---|
| **Reference** | `.ssab` と、その隣に並ぶ `.png` 群 | テクスチャごとに 1 ファイル。同じセルマップを名指しするパック間で共有されます |
| **Embedded** | 自己完結した `.ssab` 1 つ | 運搬中に失うものがない。エンコードされたバイト列はリソースの生存期間中ずっと常駐します |

## テクスチャを差し替える {#replacing-a-texture}

`textures` prop は、パック自身のものより手前に自分のアトラスを置きます — パレット
スワップ、スキン、書き出し直さずに色を変えたキャラクターなど。

```tsx
<SpriteStudioView
  source={SsAssets['Ringo/Ringo']}
  textures={require('./ringo-winter.png')}
/>
```

単体のソースを渡す形は、セルマップが**1 つ**のパックに対する短縮記法です。これが一般的な
ケースであり、また `.ssab` しか知らない名前を呼び出し側が知らなければならなくなる唯一の
ケースでもあります。複数ある場合はセルマップ名をキーにします。パックが持っている名前を
そのまま、`.ssce` 拡張子は**付けずに**使います。

```tsx
textures={{
  Ringo: require('./ringo-winter.png'),
  Effects: { uri: 'https://cdn.example.com/effects.png' },
}}
```

::: info `require()` が許されるのはここだけです
*パック*を `require()` で名指しすることはできません — ディレクトリであり、Metro は
ディレクトリを運ばないからです。差し替え用の*テクスチャ*は、解決すべき兄弟ファイルを
持たない単独の画像 1 枚であり、これはまさに Metro が得意とするものです。
:::

`useSsTextures` はこの prop の背後にあるフックで、デコード済みの `SkImage` が欲しい
呼び出し側のために公開されています。すべてのテクスチャがデコードされるまで `null` を
返すので、アトラスが欠けたフレームを一瞬見せる代わりに描画を保留できます。

### コードから、実行時に {#from-code-at-runtime}

`textures` prop は宣言的で、効いているアトラスを記述するものです。そうではなく**命令的に**
差し替えたいとき — シーン途中で手に入れる衣装、ゲーム状態で切り替える表情など — は、ref
経由でプレイヤーに到達して `setCellmapTexture` を呼びます。

```tsx
const ref = useRef<SpriteStudioViewRef>(null)
// ...
ref.current?.player?.setCellmapTexture('Ringo', winterAtlas)   // 差し替え
ref.current?.player?.setCellmapTexture('Ringo', null)          // パック本来のものへ復元
```

アバターシステムはこれを土台にできます — 衣装ごとに書き出しを分けるのではなく、1 つの
アニメーションと、切り替えるアトラスの一式を持つだけです。`null` を渡すとパック本来の
アトラスへ**復元**されます — 自分で読み込みを管理する必要はありません。`getCellmapTexture(name)` は効いている差し替え（上書き値のみで、パック本来の
ものは返しません）を読み出し、`getReplaceableTextureNames()` は渡せる名前一覧 — セルマップ名
と、オーサリングされたテクスチャ変更が指すテクスチャ*ファイル*名の両方 — を返します。

知っておく価値のある 3 点。いずれも SDK 自身の
[Runtime texture replacement](https://github.com/cri-middleware/SpriteStudio-SDK/blob/develop/libs/ssruntime/docs/40_components/70_external_resources.md)
仕様に由来します。

- **インスタンスの子にも効きます。** ここではプレイヤーツリー全体が 1 つのテクスチャ表を
  通して描画されるので、同じセルマップを参照する子パートも差し替えを拾います — 子に別途
  設定するものはありません。（ここが、子が自分の表を持つ Godot 版プレイヤーとの違いです。）
- **`source` の変更をまたいで残ります。** 名前をキーに新しいパックへ再適用されます。`null`
  で消すか、`dispose` に任せて落とします。
- **テクスチャ変更（`TCHG`）が効くフレームでは、そちらが勝ちます。** そのフレームはセルマップ名
  ではなくテクスチャ*ファイル*名でバインドするので、そこに効かせたいならその名前を差し替えます
  — `getReplaceableTextureNames()` に出ています。また差し替え先は元と**同じサイズ・同じ
  レイアウト**が前提です。セル矩形は元アトラスのピクセル空間のまま返ります。

## レジストリ

`SsTextureRegistry` は、セルマップ名のハッシュを、そのバッチが描画に使うペイントへ
対応づけます。各プレイヤーが 1 つ所有していて、`player.textures` から到達できます。

```tsx
player.textures.register('Ringo', someSkImage)
```

`SpriteStudioPlayerOptions` を通じて共有レジストリを渡すと、複数のプレイヤーが**1 組**の
アトラスから描画できるようになります。`register` はセルマップ名を受け取って Brain 側で
ハッシュ化し、`registerByHash` は既に手元にあるハッシュを受け取ります。

::: warning 名前を自分でハッシュしないでください
Rust コアが渡してくるキーはすべて、コア自身の FNV-1a で事前に計算されており、
`SsRuntimeModule.hashString` がまさにその関数を公開しています。2 つ目の実装は、整合を保てる
数より 1 つ多いものです。
:::

## プリロード {#preloading}

`.ssab` のパースは、JS ヒープに一切入らないバイト列に対して C++ で行われます。アトラスの
デコードはそうではありません — **テクスチャはすべて PNG デコード**であり、こちらが遅い
方の半分です。キャッシュが冷えた状態でマウントされたビューは、アトラスが届くまで
`placeholder` を表示します。

```tsx
import { ssPreload, ssUnload } from 'react-native-spritestudio'

await ssPreload(SsAssets['Ringo/Ringo'])   // 画面遷移の前に
ssUnload(SsAssets['Ringo/Ringo'])          // その画面が無くなったら
```

`ssPreload` はプレイヤーを丸ごと読み込んで捨てることで両方のキャッシュを温めます。
これより短い経路はありません。テクスチャの一覧は**コンテキスト**が `.ssab` から読み出す
ものであり、コンテキストとは*すなわちプレイヤー*だからです。残るのはキャッシュの
エントリだけです。1 つのソースに対して 2 回呼んでも安全で、処理は 1 回だけ行われます。

`ssUnload` が手放すのはプリロード自身のリースであって、全員のものではありません。どこか
でまだマウントされているパックは読み込まれたままです。`ssClearCaches()` はすべてを
破棄します。メモリ逼迫下のアプリが求めるのはこちらです。

::: warning 既知の落とし穴が 1 つあります
2 つのパックがセルマップ名を共有している場合、`ssUnload` が別のプリロードがまだ保持して
いるアトラスを破棄してしまうことがあります — リースが参照カウントではなくブール値で
あるためです。パックはプリロード済みとして列挙されたまま、そのアトラスは失われます。
[ROADMAP](https://github.com/cri-middleware/SSPlayerForReactNative/blob/main/ROADMAP.md)
で追跡されています。
:::

## テクスチャが解決できなかったとき

テクスチャの欠落は**構造上、無言です**。`drawInto` はペイントの無いバッチをスキップする
ので、症状は「あるパーツが単に存在しない」ことになります。それを声に出して言うのが
`player.lastTextureReport` です。

```tsx
console.log(player.lastTextureReport?.unresolved)
// ['characters/ringo.png']
```

[トラブルシューティング](/ja/troubleshooting#a-part-is-missing-or-nothing-draws)を
参照してください。

## リークを確認する

ネイティブハンドルは GC されません。`ssCheckForLeaks(source)` は N 回（既定 8 回）
ロードと破棄を繰り返し、カウントが戻ったかどうかを報告します。

```tsx
const result = await ssCheckForLeaks(SsAssets['Ringo/Ringo'])
```

`ssLiveHandles()` は生のカウントです。どちらもこのリポジトリのサンプルアプリではなく
パッケージ側に同梱されています。ハンドルのリークが実際にコストになるのは実機であり、
このリポジトリにしか存在しないチェックは実機で走らせられないからです。
