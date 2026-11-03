---
title: イベントとユーザーデータ
description: アーティストがタイムラインに置いたキーに反応する。
---

# イベントとユーザーデータ

タイムライン上に作成されたキーはコールバックとして届きます。足音や当たりフレームは、横で維持しているタイマーではなくアニメーション自身から発生します。

```tsx
const SOURCE = SsAssets['overall/UserData']

<SpriteStudioView
  source={SOURCE}
  onUserData={(e) => console.log(e.partName, e.frameNo, e.integer)}
  onAudio={(e) => playAudioEvent(SOURCE, e)}
  onSignal={(e) => console.log(e.commandId, e.params)}
/>
```

3 つとも `partIndex`・`partName`・`frameNo` を持ちます。`frameNo` は**キーが置かれているフレームであって、それに気づいたフレームではありません**。ユーザーデータのキーは
4 つの省略可能なスロットを持ち、それぞれに `has…` フラグが付きます — `integer`、
`pointX`/`pointY`、`rect`、`text` です。まずフラグを読んでください。フラグが false のときの値は「作成された 0」ではなく、単にゼロ相当の何かです。

シグナルの `params` は `{ id, type, boolValue, intValue, floatValue, textValue }` のリストです。値が入っているフィールドは `type`（`SsSignalParamType`：`bool`・`index`・`integer`・`floating`・`text`・`none`）で決まり、`index` と `integer` はどちらも `intValue` に入ります。

どのイベントも `source` も持ちます。発火したアニメーションのソースのハンドルです。[モーションブレンディング](/ja/usage/motion-blending#events)を使わなければ常にトラック 0 の主アニメーションで、`frameNo` は発火したアニメーションのフレームです。トラック 0 をクロスフェードすると、フェードを始めた時点から入ってくる側のキーが発火し、出ていく側は止まります。

ハンドラが受け取るのは、設置されている間に再生ヘッドが通ったキーです。あとからハンドラを渡しても、それ以前のキーは再送されません。インラインのアロー関数を渡しても問題ありません — ロードをやり直したりはしません。

## オーディオは通知されるだけで、再生はされません {#audio-is-reported-not-played}

`onAudio` は*何を*・何回・どのファイルを再生すべきかを伝えます。再生はしません。
React Native には標準のオーディオ API がなく、パッケージ側でライブラリを 1 つ選んでしまうと、音を一切使わないプロジェクトにまでそれを背負わせることになります。

**Embedded** パックでは、イベントの `embedded` が `true` になり、`filePath` はディスク上に無い兄弟ファイルを指します。このパッケージは埋め込まれた音声データを公開しないので、音声を含むパックは **Reference** パックとして配ってください。

参照実装はリポジトリの [`example/src/player/audio.ts`](https://github.com/cri-middleware/SSPlayerForReactNative/blob/HEAD/example/src/player/audio.ts) です（`playAudioEvent(baseUri, event)` は `.ssab` 自身の URI を取ります。音声の `filePath` がそれからの相対パスだからです）。自分で書く人が必ずぶつかる 3 点を解決しています — `asset` スキームの兄弟ファイルにはオーディオライブラリが開けるパスが無いこと、`loopNum` は多くの API がブール値を取るところで*回数*であること、そして iOS は `expo-audio` の `setAudioModeAsync({ playsInSilentMode: true })` が無いとサイレントスイッチで無音になることです。

## ライフサイクル

`onAnimationStarted`・`onAnimationChanged`・`onAnimationLooped`・`onAnimationFinished` はいずれもアニメーション名を運びます。1 つのプレイヤーは、その上に載るアニメーションより長生きするからです。

知っておく価値のある挙動が 2 つあります。**start は再開では発火しません**（`playing` が
false → true になったときは、やり直しではなく継続します）。そして**change は別のアニメーションに替わったときだけ発火します** — 設定済みのものを選び直しても何も起きず、`play()` でのやり直しは start として報告されます。

::: warning ハンドラ内の例外はクロックを止めます
ユーザーデータ・オーディオ・シグナル・ループ・終了のハンドラは `advance()` の中で配送され、それはフレームループの中で走ります。つまりそれらのハンドラからの throw はアニメーションを止めます — シーンの中であれば、そのすべてのスプライトを止めます。これは意図的です。その例外はあなたのものであり、ここで握りつぶされるのではなく、あなたのエラー処理へ届きます。`onAnimationStarted` と `onAnimationChanged` は代わりに `play()`・`setAnimation()`・`crossfade()` の中で配送されるので、そこでの throw は呼び出し元に届き、クロックは止まりません。
:::
