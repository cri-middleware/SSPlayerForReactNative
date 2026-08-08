# Phase 0 — 描画コスト spike

設計書第8章 Phase 0 の計測記録。**L1 と L2 の境界を実測で決める**のが目的。

## 結論

**設計書が想定した 2 方式 (a)/(b) に有意差はなく、どちらも不足。
第3の方式 (c)（C++ から `SkCanvas` に直接描く）が唯一 60 fps を保つ。**

- **(a) と (b) の差はノイズ**。毎頂点の演算を JS から C++ に降ろしても速くならない。
  ベイクは最初から律速ではなかった。
- **(c) は最大負荷で 5.1 倍速く、唯一 60 fps を維持**（(a)/(b) は 33 fps へ落ちる）。

→ **L1 の責務は「ベイク」ではなく「描画」まで**。JS の毎フレームの仕事は
**プレイヤー 1 体につき 1 コール**にする。設計書第1章の狙い
（「JS 側の毎フレーム仕事をバッチ配列の走査と描画コール発行だけにする」）よりも
さらに JS を薄くする必要がある。

## なぜ (b) が効かないのか

`Skia.MakeVertices(mode, positions, texs, colors, indices)` は
`SkPoint[]` — **JSI ホストオブジェクトの配列**を取る。RN Skia の実装
（`node_modules/@shopify/react-native-skia/cpp/api/JsiSkVertices.h`）は頂点ごとに
`getValueAtIndex` → `asObject` → `JsiSkPoint::fromValue` を回す。
`SkColor` に至っては 1 色が `Float32Array` のホストオブジェクト。

(a) も (b) も **`SkPoint` の実体化と `MakeVertices` の unmarshalling は共通**で、
そこが律速。(b) がベイクを C++ に移しても、この部分は 1 バイトも減らない。
(c) はここを丸ごと消す。

## 計測結果

- 端末: iPhone 17 Pro シミュレータ / iOS 26.5 / Apple Silicon ホスト
- **libssruntime: release ビルド**（`scripts/build-runtime.sh platform=all build=release`）
- RN / Hermes / アプリ: debug ビルド
- アセット: `Ringo.ssab` の `dance`（Normal パーツのみ描画）
- 負荷スケール: プレイヤーインスタンス数
- 各ステップ: 700 ms のウォームアップを捨てて 1800 ms 計測

| variant | inst | fps | cpu_ms | draw_ms | **total_ms** | verts |
|---|---:|---:|---:|---:|---:|---:|
| (a) js-bake | 1 | 60.0 | 0.88 | 0.86 | 1.74 | 68 |
| (a) js-bake | 4 | 60.0 | 2.85 | 1.12 | 3.97 | 272 |
| (a) js-bake | 16 | 60.0 | 4.63 | 1.00 | 5.63 | 1088 |
| (a) js-bake | 48 | 60.0 | 11.08 | 0.46 | 11.54 | 3264 |
| (a) js-bake | 128 | **33.5** | 27.94 | 1.79 | **29.73** | 8704 |
| (b) native-bake | 1 | 60.0 | 1.26 | 1.04 | 2.30 | 68 |
| (b) native-bake | 4 | 60.0 | 2.64 | 0.93 | 3.57 | 272 |
| (b) native-bake | 16 | 60.0 | 4.88 | 1.01 | 5.89 | 1088 |
| (b) native-bake | 48 | 60.0 | 11.14 | 0.69 | 11.83 | 3264 |
| (b) native-bake | 128 | **32.9** | 28.57 | 1.73 | **30.30** | 8704 |
| (c) native-draw | 1 | 60.0 | — | 0.85 | **0.85** | 68 |
| (c) native-draw | 4 | 60.0 | — | 1.52 | **1.52** | 272 |
| (c) native-draw | 16 | 60.0 | — | 3.12 | **3.12** | 1088 |
| (c) native-draw | 48 | 60.0 | — | 4.65 | **4.65** | 3264 |
| (c) native-draw | 128 | **60.0** | — | 5.80 | **5.80** | 8704 |

`cpu_ms` = `update()` + ジオメトリ生成 + `MakeVertices`。
`draw_ms` = `SkPicture` への記録。
(c) はベイクと描画が同じ C++ コールの中なので分離できず、すべて `draw_ms` に入る。
**方式間の比較は `total_ms` で見ること。**

倍率（total_ms、(a) / (c)）: 1体 2.0x / 4体 2.6x / 16体 1.8x / 48体 2.5x / **128体 5.1x**

## 計測上の落とし穴（重要）

**最初は `build=debug` の libssruntime で測ってしまい、結論を誤りかけた。**
最適化なしの Rust ランタイムが全方式のコストを支配し、
(a)/(b)/(c) がどれも遅く、(c) の優位はわずか 1.4 倍にしか見えなかった。

| | debug Brain | release Brain |
|---|---:|---:|
| (a) 128体 total_ms | 88.65 | 29.73 |
| (c) 128体 total_ms | 63.03 | 5.80 |
| (c) の倍率 | 1.4x | **5.1x** |

**Brain は必ず release でビルドして測ること。** debug の数字は方式間の差を潰す。

### 上の数字は「ほぼ静止したポーズ」で取られている

Phase 1 で判明：**このハーネスは `ss_runtime_update` に秒を渡していた。
C-API が取るのはミリ秒**（`30_core/20_playback_control.md`）なので、
アニメーションは 1000 分の 1 の速度でしか進んでいなかった。

3 方式とも同じ delta を渡しており、頂点を JS に渡す構造的コストは
ポーズに依存しない。だから **(a)/(b)/(c) の比較と「(c) を採る」という結論は動かない。**
一方で **絶対値（8704 頂点、fps、ms）は 1 つのポーズの値**であって、
アニメーション全域の平均でも最悪値でもない。パーツの表示 / 非表示が動けば
バッチ数と頂点数は変わる。Phase 1 の実機 / release 再計測では、単位を直した上で
取り直すこと。

## 残っている限界

- **RN / Hermes 側は debug ビルド**。(a)/(b) は release でいくらか改善するはずだが、
  `MakeVertices` の JSI 往復はネイティブ側のコストなので構造は変わらない。
- **iOS シミュレータ**。実機の絶対値は別途取ること。
- **絶対値は静止ポーズ由来**（上記）。
- 実機 / release での再計測は Phase 1 の入口で行う。

## 次にやること

1. **L2 を「(c) 前提」で設計する。** `RenderBackend` の seam は
   Flutter 版の `render_backend.dart` を写すが、**実装は C++ 側に置く**。
   TypeScript 側に残るのは transport（play / pause / seek）とイベントだけ。
2. **Android の (c) を通す。** 現状 `SSPLAYER_ENABLE_SKIA_DIRECT=0`。
   RN Skia の Android ビルドが libskia の prefab を publish していないため、
   `libSsPlayer.so` から Skia のシンボルを解決できない。要調査。
3. 実機 + release での再計測。

## 計測方法（再現手順）

```bash
node scripts/download-sdk.js          # または build-runtime.js platform=all build=release
node scripts/deploy-examples.js
cd example && npx expo prebuild --platform ios && npx expo run:ios
```

`example/App.tsx` の `AUTO_SWEEP` が `true` なら起動後に自動で全構成を回し、
結果表を画面に出す。手で触りたいときは `false` にする。

## この spike が測っていないもの

- **Effect / パーティクル**: ベイカは Normal バッチのみ。設計書第8章は
  「パーティクル込みの最悪ケースで測れ」と指定しているが、頂点数は
  **インスタンス数で代替**した。Normal は全バッチ種で**最も頂点あたりの演算が重い**
  （角ごとにワールド行列積。Effect / Mesh はワールド空間で来る）ため、
  同じ頂点数なら Normal のほうが厳しい＝保守的な方向。
  Effect 固有のコスト（`EffectDrawPlan` の走査）は全方式が等しく払うので
  境界の判断を動かさない。
- **PartColor / 頂点カラー**: 未実装。`SkColor` は 1 色が `Float32Array` なので、
  実装すると (a)/(b) はさらに不利になる。(c) には影響しない。
- **Mask / ブレンド / Mesh / Shape / Instance**: Phase 1-2。
