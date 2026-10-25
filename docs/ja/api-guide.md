---
title: API リファレンス — どこから見るか
description: 公開されている名前のうち実際に必要なものと、必要になる順番。
---

# どこから見るか

[生成リファレンス](/api/)にはすべてが載っています。このページは、そのうちどれが必要かを、およそ必要になる順に示します。

## 実際に使う 4 つ

| | |
|---|---|
| [`SpriteStudioView`](/api/) | アニメーション 1 つ、自前のキャンバスとフレームループ。既定の選択肢です。 |
| [`SpriteStudioScene`](/api/) + `SpriteStudioSprite` | 複数のアニメーション、キャンバス 1 枚とクロック 1 つ。 |
| `SsPlayerProps` | *どのアニメーションをどう再生するか*のすべて。両コンポーネントで共有されるので、両者がずれることはありません。 |
| `SsPlacement` | *どこに描画するか*のすべて — `fit`・`align`・`frame`・`offset`・`scale`。 |

## プレイヤー自体が必要になったら

`SpriteStudioPlayer` は描画バックエンドを持たないトランスポートです。ref
（`ref.current.player`）から到達して、シーク、アニメーションの切り替え、コンテンツボックスの読み取りを命令的に行えます。

prop を持たない、命令的にしか呼べない操作もここにあります。ランタイムのテクスチャ差し替えはその 1 つです。`setCellmapTexture(name, image)` はセルマップが描画に使うアトラスを差し替え（`null` でパック本来のものへ復元）、`getCellmapTexture(name)` は差し替え値を読み出し、
`getReplaceableTextureNames()` は渡せる名前を列挙します。[テクスチャ](/ja/usage/textures#from-code-at-runtime)を参照してください。

## ボタン・ラベル・輪郭 {#buttons-labels-and-outlines}

`react-native-spritestudio-ui` の `SpriteStudioButton` は、状態ごとにラベルの区間を再生するボタンにビューを変えます（[UI ボタン](/ja/usage/ui)）。コンポーネントを使わない状態の規則は `SsUiStateDriver` です。これらは、どのアプリからも使えるプレイヤーの呼び出しの上に作られています。ラベルで区間を指定する `getLabelTable(animation?)` と `setAnimationSectionByLabel(startLabel, endLabel)`、パーツが描かれた位置を読む `getPartQuad(part)` と `hitTestPart(x, y, parts?)` です（[パーツの輪郭と当たり判定](/ja/usage/parts#part-outline)）。

## 事前に読み込む

`ssPreload(source)` は使い捨てのプレイヤーを読み込むことでリソースとアトラスのキャッシュを温めるので、温まったキャッシュに対してマウントされたビューは最初のフレームから描画されます。
`ssUnload(source)` はそれを返却し、`ssClearCaches()` はすべてを破棄します。

## 診断

- `ssCheckForLeaks(source)` — N 回ロードと破棄を行い、ネイティブハンドルのカウントが戻ったかを報告します。自分のアプリの中で実行できるリーク検査です。
- `SsRuntimeModule.liveHandles` — カウントそのもの。
- `player.lastTextureReport` — 直近のロードで解決できなかったもの。テクスチャの欠落はそうでなければ無言です。バッチがスキップされるため、症状は「あるパーツが単に存在しない」ことになります。

## テクスチャ

`SsTextureRegistry` は、セルマップ名のハッシュを、そのバッチが描画に使うペイントへ対応づけます。パックは自身のものを読み込むので普段触ることはありませんが、これを渡すと複数のプレイヤーでアトラスを共有でき、`register(name, image)` で実行時にテクスチャを差し替えられます。
