---
title: トラブルシューティング
description: 何も描かれない、パーツが欠ける、再生が止まった — 原因ごとに切り分ける。
---

# トラブルシューティング

ここでの失敗のほとんどは、外から見ると同じに見えます — **空白の矩形**です。このページはそれを原因ごとに切り分けます。まずコンソールを確認してください。いくつかはパッケージ自身が名指しで警告しますし、開発ビルドではテクスチャの警告が見つからなかったファイル名をそのまま出します。

## そもそも何も描かれない

### パックが読み込まれていない

ログを確認してください。何も指していない `source` はロードに失敗し、`onError` を渡していなければ、そのエラーはパックの名前付きで `console.error` に出ます（開発ビルドでは LogBox）。自分で扱うなら `onError` を渡します。

```tsx
<SpriteStudioView source={…} onError={(e) => setError(String(e))} />
```

最も多い原因は、ソースファイルからの相対パスとしては正しく、**アセットルート**からの相対パスとしては誤っているパスです。パックは、config plugin が同梱するディレクトリ内のパスで指定するものであって、プロジェクトツリー上の位置で指定するものではありません。

::: tip 文字列の手書きをやめる
`npx react-native-spritestudio assets --out src/ss-assets.ts` が型付きマニフェストを生成するので、キーの間違いが空白のキャンバスではなく**型エラー**になります。
:::

### パックが端末に届いていない

- **プラグインを追加した後に `npx expo prebuild` を実行しましたか。** プラグインはパックのディレクトリをネイティブアセットとしてコピーします。prebuild なしではコピー元がありません。
- **Expo Go を使っていませんか。** Expo Go はこのパッケージをまったく実行できません —
  ネイティブコードが含まれるためです。`npx expo run:ios` / `run:android` を使います。
- **パックを `require()` していませんか。** それは有効な source ではありません。パックは*ディレクトリ*で、Metro が運ぶのは依存グラフでありディレクトリではありません。
- **`assetExts` に `ssab` を追加していませんか。** 削除してください。Metro にこの拡張子を教えると、まさに動作しない「平坦化され、兄弟ファイルを失ったコピー」ができあがります。

### パックを変更したのに何も変わらない

**アセットは Fast Refresh されません。** パックはバンドルのエントリではなくアプリのアセットなので、再変換した `.ssab` にはネイティブビルドが必要です。プラグインはビルドのたびに再コピーするので、リビルドで十分です — `prebuild` のやり直しは不要です。

## パーツが欠けるか、何も描かれない {#a-part-is-missing-or-nothing-draws}

どちらも規模が違うだけで同じ原因です — **テクスチャが解決できなかった**のです。テクスチャの無いバッチはスキップされるので、アトラスが 1 つ欠ければパーツが
1 つ欠け、テクスチャを 1 つも解決できなかったパックは何も描きません。

開発ビルドでは、パッケージが既に警告を出しています。

```
react-native-spritestudio: 'ss/Ringo/Ringo.ssab' resolved 1/2 textures.
Missing: characters/effects.png. Those parts will not draw.
```

本番では自分で読みます。

```tsx
player.lastTextureReport?.unresolved   // ['characters/effects.png']
```

原因はほぼ常に、`.png` が `.ssab` の隣に一緒に運ばれなかったことです。すべての
`image_path` は **`.ssab` からの相対パス**で解決されるので、コンバータの出力ディレクトリ全体がそのまま端末に届く必要があります。**Embedded** パック（`--embedded`、または **Embedded Assets** チェックボックス）に変換すれば、アトラスをファイルの中に入れることでこれを回避できます。

## Instance パーツの子が出てこない

これもパッケージが警告します。

```
react-native-spritestudio: instance pack 'Enemy' referenced by '…' could not be
loaded — those parts will not draw.
```

Instance パーツは**外部パックを名前で**参照します。テクスチャと同じ規則で、それを名指ししている `.ssab` の隣、出力ディレクトリの中に無ければなりません。

## スプライトが何も描かず警告する

```
<SpriteStudioSprite> must be inside a <SpriteStudioScene>.
```

シーンのキャンバスを通して描画するので、その外には描き込む先がありません。[複数アニメーション: シーン](/ja/usage/scene)を参照してください。

## パーツのオーバーライドが効かない

名前は**現在のアニメーション**に対して照合され、外れると警告が出ます。

```
react-native-spritestudio: no part called 'hatt' in 'walk' — its override is ignored.
```

名前が正しいのに少し経つと元に戻ってしまう場合は `priority` です —
[パーツの上書き](/ja/usage/parts#how-long-an-override-lasts)を参照してください。

## 再生が途中で固まった {#the-animation-froze-mid-play}

**ハンドラ内の例外はクロックを止めます。** イベントは `advance()` の中から配送され、それはフレームループの中で走ります。つまり `onUserData` / `onAudio` / `onSignal`
ハンドラからの throw はアニメーションを止めます — シーンの中であれば、そのすべてのスプライトを止めます。

これは意図的です。その例外はあなたのものであり、ここで握りつぶされるのではなく、あなたのエラー処理へ届きます。そうしたくない場合はハンドラの中身を try で包んでください。

## シークしたら全部消えた

`seek(NaN)` は検査されないままコアに届きます。NaN はあらゆる比較に失敗するので、クランプはそれを素通しさせ、生成されるフレームにはパーツが 1 つも入りません。症状は引数の誤りではなくレンダラの不具合のように見えます。`seek` に渡している計算を確認してください。

## 追従表示が左上の隅に居座る

`useSsPartTransform` は原点から始まり、パーツが解決されるまで `valid` は false です。存在しない名前は永久に true になりません。これで判定してください。

```tsx
opacity: transform.value.valid ? 1 : 0
```

## ビルドが失敗する、または起動時にクラッシュする

### ネイティブモジュールが 2 つある

**peer 依存はそれぞれ 1 つだけ**にします。`npm ls react-native-skia` で確認し、モノレポではすべての peer をルートで固定してください。

### Android を x86 エミュレータで動かしている

Rust コアは 32 ビット `x86` スライスを提供していません。config plugin が
`reactNativeArchitectures` を絞ってくれ、その際 prebuild が
`dropped x86 from reactNativeArchitectures` とログに出します。`x86_64` または
`arm64-v8a` のエミュレータイメージを使ってください。`abiFilters` を直接書かないこと。

### ネイティブ側を修正したのに何も変わらない

Android には、ソースの修正後も生き残るキャッシュが 2 つあります。
`android/build/generated/autolinking/` と
`android/app/build/generated/autolinking/` です。両方削除してください。

## web バンドルが throw する

react-native-web の下でプレイヤーを描画するとこのパッケージ名を含むエラーが投げられますが、これは正しい挙動です — **このパッケージは web ではアニメーションを再生しません**。web 用のエントリが存在するのは、native に*加えて* web も出荷するアプリが
web バンドルをビルドできるようにするためです。web 上の SpriteStudio には
[SpriteStudio Player for Web](https://github.com/cri-middleware/SSPlayerForWeb) を使ってください。

## 音が出ない

`onAudio` は何を再生すべきかを通知するだけで、再生は一切しません。[オーディオは通知されるだけで、再生はされません](/ja/usage/events#audio-is-reported-not-played)を参照してください。
