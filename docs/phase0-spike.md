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

## 計測結果（Phase 1 で取り直し）

- 端末: iPhone 17 シミュレータ / iOS 26.5 / Apple Silicon ホスト
- **libssruntime: release ビルド**（`scripts/build-runtime.sh platform=ios build=release`）
- **RN / Hermes / アプリ: release ビルド**（`xcodebuild -configuration Release`）
- アセット: `Ringo.ssab` の `dance`（Normal パーツのみ描画）、**再生中**
- 負荷スケール: プレイヤーインスタンス数
- 各ステップ: 700 ms のウォームアップを捨てて 1800 ms 計測

| variant | inst | fps | cpu_ms | draw_ms | **total_ms** | verts |
|---|---:|---:|---:|---:|---:|---:|
| (a) js-bake | 128 | 60.0 | 12.46 | 0.41 | **12.87** | 8248 |
| (a) js-bake | 256 | **39.3** | 24.46 | 0.59 | **25.05** | 16488 |
| (a) js-bake | 512 | **20.0** | 48.97 | 1.12 | **50.09** | 32960 |
| (b) native-bake | 128 | 60.0 | 11.93 | 0.30 | **12.23** | 8248 |
| (b) native-bake | 256 | **39.8** | 24.09 | 0.63 | **24.72** | 16488 |
| (b) native-bake | 512 | **20.1** | 48.66 | 1.05 | **49.71** | 32952 |
| (c) native-draw | 128 | **60.0** | — | 4.76 | **4.76** | 8248 |
| (c) native-draw | 256 | **60.0** | — | 6.55 | **6.55** | 16488 |
| (c) native-draw | 512 | **60.0** | — | 10.15 | **10.15** | 32960 |

倍率（total_ms、(a) / (c)）: 128体 2.7x / 256体 3.8x / **512体 4.9x**。
**差は負荷とともに開く。** (a)/(b) の CPU はインスタンス数に厳密に線形（12.5 → 24.5 → 49 ms）
＝ JSI マーシャリングの量そのもの。(c) は劣線形（4.8 → 6.6 → 10.2 ms）＝ Skia の実仕事にしか
比例しない。(a)/(b) の差は全負荷で 1% 未満のままで、**「ベイクの置き場所は問題ではない」
という Phase 0 の中核はそのまま生き残っている。**

**(c) は 512 体 / 32960 頂点でも 60fps を維持。** (a)/(b) は 256 体で崩れる。

### Android（エミュレータ）

Android の (c) が通った直後に取ったもの。debug ビルド / Android エミュレータ
（Apple Silicon ホスト、arm64）なので、iOS の表とは**絶対値を比較できない**。
方式間の比較としてのみ読むこと。

| variant | inst | fps | cpu_ms | draw_ms | **total_ms** | verts |
|---|---:|---:|---:|---:|---:|---:|
| (a) js-bake | 128 | **35.5** | 27.20 | 0.97 | **28.17** | 8248 |
| (a) js-bake | 256 | **18.4** | 52.81 | 1.41 | **54.22** | 16488 |
| (a) js-bake | 512 | **9.6** | 102.05 | 2.49 | **104.54** | 32960 |
| (b) native-bake | 128 | **35.6** | 26.99 | 0.97 | **27.96** | 8248 |
| (b) native-bake | 256 | **18.9** | 51.39 | 1.39 | **52.78** | 16488 |
| (b) native-bake | 512 | **9.6** | 101.18 | 2.27 | **103.45** | 32960 |
| (c) native-draw | 128 | **60.0** | — | 4.86 | **4.86** | 8248 |
| (c) native-draw | 256 | **60.0** | — | 8.01 | **8.01** | 16488 |
| (c) native-draw | 512 | **60.1** | — | 14.90 | **14.90** | 32960 |

**構造は iOS と同じで、差はもっと大きい。** (a)/(b) は互いに 1% 前後、
インスタンス数に厳密に線形（27 → 52 → 102 ms）。(c) は劣線形（4.9 → 8.0 → 14.9 ms）
で 512 体でも 60fps。倍率は 128体 5.8x / 256体 6.6x / **512体 7.0x**。

iOS シミュレータより差が開くのは予想通りで、(a)/(b) を律速するのは CPU 側であり、
そこがエミュレータでは遅いため。**実機でも iOS より Android の方が (c) の優位が
大きい**と予想されるが、実機は未計測。

### 以下は Phase 0 当時の表（保存）

条件が 2 つ間違っていた（下記「計測上の落とし穴」参照）ので、絶対値は使えない。

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

### Phase 0 の表は「1 枚の静止フレーム」で取られていた

Phase 1 で 2 つ見つかった。

1. **ハーネスが `play()` を呼んでいなかった。** `setup_animation` は
   `is_playing = false; is_pausing = true` に**明示的にリセットする**
   （`playback_controller.rs:274`）。そして `update()` は
   `is_playing && !is_pausing` のときしか進まない。つまり再生が一度も
   始まっていなかった。
2. `ss_runtime_update` に**秒**を渡していた。C-API が取るのはミリ秒
   （`30_core/20_playback_control.md`）。仮に 1 を直しても 1000 分の 1 の
   速度にしかならなかった。

見分け方は簡単で、**`verts` が全ステップで完全に一定**だった（1体=68、128体=8704）。
再生していればパーツの表示 / 非表示でバッチ数も頂点数も動く。実際、直したあとは
128 体で 8248 に変わっている。

3 方式とも同じ静止フレームを描いており、頂点を JS に渡す構造的コストは
ポーズに依存しない。だから **「(c) を採る」という結論自体は動かなかった** ——
取り直しても (a)/(b) の差は 1% 未満で、(c) の優位はむしろ高負荷で広がる。
一方で **絶対値と「(c) だけが 128 体で 60fps を保つ」という主張は誤りだった**。
RN が debug だったことの寄与が大きく、release では (a) も 128 体で 60fps に届く。

## 残っている限界

- **iOS シミュレータ**。実機は未計測 —— 取り直し時点で端末が接続できなかった。
  実機の絶対値は別途取ること。シミュレータのホストは Apple Silicon の Mac なので、
  CPU 側（(a)/(b) が律速される側）は実機より**速い**方に振れているはず。
- **Android 未計測**。`SSPLAYER_ENABLE_SKIA_DIRECT=0` で (c) が存在しない。
- `fps` 列は 60 で頭打ちなので、方式の比較に使えるのは `ms` 列だけ。

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
