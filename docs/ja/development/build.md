---
title: ビルドガイド
description: SpriteStudio Player for React Native をチェックアウトからビルドし、変更したパッケージをアプリで使い、シミュレータや実機で確かめる。
---

# ビルドガイド

SpriteStudio Player for React Native を開発する人と、自分のアプリのために改造する人に向けたページです。このパッケージや、その下の Rust コアを変更する人が対象です。層の組み合わせと、この作りになっている理由は[プレイヤーの構成](./architecture.md)にあります。

自分のアプリでパッケージを*使う*だけなら、必要なのは[インストール](../setup/install.md)の方です。このページの内容はそこには一切含まれません。

## clone する

git、Node 24 以上、`package.json` の `packageManager` が指す版の pnpm が要ります。`deploy-examples`・`build-runtime`・ホスト側のチェックには Rust も要ります。

```bash
git clone https://github.com/cri-middleware/SSPlayerForReactNative.git
cd SSPlayerForReactNative
git submodule update --init --recursive
pnpm install
```

submodule は `SpriteStudio-SDK/` — リポジトリ全体で **Brain** と呼んでいる Rust コアです。ワークスペースは pnpm で、版は `package.json` の `packageManager` が決めます（Node 24 では `corepack enable` で入ります。Corepack を同梱しない Node 25 以降では、その版の pnpm を自分で入れてください）。

## Brain を用意する

`packages/react-native-spritestudio/native/` は gitignore 対象なので、clone 直後にはネイティブコアが一切ありません。

```bash
pnpm run download-sdk
```

`scripts/SDK_VERSION.txt` で固定されたリリースをインストールします。**Rust ツールチェーンは不要**です。既にインストール済みのものが固定内容と一致していれば処理を飛ばすので、再実行しても安全です。

**Brain 自体を変更するときにだけ**もう一方が必要になります。

```bash
pnpm run build-runtime build=release
```

`build-runtime` は `SpriteStudio-SDK/` submodule から同じレイアウトへビルドしますが、`VERSION` と `BUILD_MODE` は書かず（あれば消し）、そのため両者が混同されることはありません。ビルドする各プラットフォーム向けのターゲットを入れた Rust が必要で、iOS には Xcode、Android には NDK と `cargo-ndk` が要ります。`platform` を省くと `all` になるので、ツールチェーンが片方だけなら `platform=ios` か `platform=android` を指定してください。Windows では Android スライスのみを対象とします（iOS の xcframework には Xcode が必要）ので、そこでの完全な答えは `download-sdk` です。

`build-runtime` は `key=value` 形式の引数を取り、submodule 以外の SDK チェックアウトを指す `$SSSDK` を尊重します。`download-sdk` はチェックアウトを読まず、オプションは `--force` だけです。

```bash
pnpm run build-runtime platform=ios build=release
pnpm run download-sdk --force
```

::: warning 計測の前に release でビルドしてください
`build=debug` の Brain は他のすべてのコストを覆い隠し、ベンチマークが見つけようとしている差を平坦にします。

2 つのインストールは意図的に区別されています。`download-sdk` はインストールしたものの横にリリースの版とビルドモードを記録し、`build-runtime` はどちらも記録せず、ビルドモードの記録を消します。これにより `prepack` が、ローカルビルドや debug ビルドの Brain に対して作られた tarball の公開を拒否できます。
:::

## サンプルパックを変換する

```bash
pnpm run deploy-examples
```

サンプルアプリ向けに `.sspj` → `.ssab` を、`ssconverter-cli` 経由で行います（Rust が必要）。併せて、サンプルのサブジェクト一覧が読まれる生成マニフェストも更新します。

素材は SDK 自身の `tests/` と、`example/SpriteStudio_Source/` に置かれたものから取られます。後者はこのリポジトリが同梱しない置き場所で、実機で見たいプロジェクトを置けばそれが 1 つのサブジェクトとして現れます。任意のサードパーティ素材 `MaskInstance` もここに置きます。

## サンプルを動かす

```bash
pnpm run run-ios         # または: pnpm run run-android
```

どちらも `example/` を prebuild し、Release でビルドして（JS バンドルを埋め込むので Metro は不要）、シミュレータか接続した端末で起動します。`device=<名前>` で端末を選び、`config=debug` にすると JS を Metro から配信します。中身は `example/` での `expo prebuild` と `expo run:ios|android` です。

サンプルアプリは描画の検証面です — Viewer 画面に、機能ごとのカードが 1 枚ずつ。各サブジェクトが何を証明するか、自分のプロジェクトを見る方法、および任意の `MaskInstance` サンプルについては [`example/README.md`](https://github.com/cri-middleware/SSPlayerForReactNative/tree/HEAD/example) が扱います。

**Blending** タブでは、モーションブレンディングを手で動かせます。トラック 0 のクロスフェードとカット、トラック 1 のオーバーレイ（alpha・ブレンド・ループ回数）、トラック 0 の速度とループ回数、両方のトラックの同期、出ていく側が発火するかどうかです。状態の表示には、トラック 0 のアニメーション（クロスフェードを始めた瞬間に替わる）と、直近のイベント（発火したソース付き）が出ます。

## チェック {#checks}

| 対象 | コマンド |
|---|---|
| 型チェック（パッケージ + サンプル） | `pnpm run typecheck` |
| FlatBuffers アクセサが最新かつ読み取りパスが健全（`flatc` が必要） | `pnpm run check-framedata` |
| マスク描画、およびインスタンスの子へまたがるマスク（macOS） | `pnpm run check-mask` |
| 描画プランから外れている間もインスタンスとエフェクトのスロットが進み続け、非表示のエフェクトはパーティクルを作らないこと | `pnpm run check-hidden` |
| トラックスタックが姿勢を動かしているあいだはプレイヤーが tick を続け、それ以外では止まること | `pnpm run check-motion` |
| `ss-*` シェーダーがコンパイルでき、その演算が正しいこと（macOS） | `pnpm run check-shader` |
| Nitro まわりの C++ が iOS（macOS・Xcode）と Android（NDK）向けにコンパイルできること | `pnpm run check-glue` |
| web スタブバレルが import 可能で throw すること（OS 不問、Brain 不要） | `pnpm run check-web-barrel` |
| レイヤ 2 が `react` / `react-native` を import していないこと（OS 不問、インストール不要） | `pnpm run check-layers` |
| Markdown で日本語の文字と文字の間に改行が無いこと（OS 不問、インストール不要） | `pnpm run check-ja-breaks` |
| Skia を使う描画パスがコンパイルできること。リンクはしない（Windows、NDK） | `tools/check-skia-compile.ps1` |
| Nitro のコード生成が最新であること | `pnpm run generate-nitro-code` → `git diff --exit-code packages/*/nitrogen` |

`check-framedata`・`check-hidden`・`check-motion`・`check-mask` は `SpriteStudio-SDK/` submodule からホスト用の Brain をビルドするので Rust が要り、`pnpm run deploy-examples` が `example/assets/ss/` に変換したパックを読みます。先にそれを実行してください。`tools/.build/ssbake_check` は `check-framedata` がビルドするバイナリです。

## 変更したプレイヤーを使う {#using-a-changed-player}

git の URL ではこのパッケージを入れられません。ネイティブコアもビルド済みの `lib/` も git に無いので、入れても `main` が存在しないファイルを指し、ネイティブ側にはリンクするものがないパッケージになります。代わりに、固定した Brain から、リリースが公開する tarball を作ります。

```bash
pnpm run download-sdk
pnpm run deploy-examples
pnpm run build-release        # -> release-dist/npm/ に、パッケージごとに 1 つ
```

`build-release` は固定した Brain の導入に続いて、Nitro バインディングを再生成してコミット済みのものと一致することを確かめ、パックする前にホスト側のチェックを実行します（`check-hidden`、`check-motion`、macOS では `check-mask` と `check-shader`、`flatc` があれば `check-framedata` も）。これらには Rust と、`deploy-examples` が変換したサンプルパックが要ります。`skip=codegen,checks` を付ければ、それらを省いてパックします。パックするのは `scripts/SDK_VERSION.txt` が固定した Brain だけで、`prepack` は手元でビルドした Brain や debug ビルド（`build-runtime` で作ったものなど）を拒むので、tarball には必ずリリースのネイティブコアが入ります。自分でビルドした Brain をアプリで動かすには、サンプルアプリを使ってください。サンプルアプリはパッケージを、ネイティブコアも含めてワークスペースから取ります。

アプリには、[インストール](../setup/install.md)がパッケージと一緒に挙げる依存を、パッケージ自身は除いて入れます（`expo install` に含めると npm から取ってきます）。続けて tarball を入れ、`react-native-spritestudio-ui` を使うなら、その隣にある UI パッケージの tarball も入れます。その先は、そのページの手順 3 からと同じようにビルドします。

```bash
npx expo install react-native-skia react-native-nitro-modules react-native-reanimated react-native-worklets
npm install <checkout>/release-dist/npm/react-native-spritestudio-<version>.tgz
npm install <checkout>/release-dist/npm/react-native-spritestudio-ui-<version>.tgz   # UI パッケージを使うときだけ
```

## 実際のホストで確かめる {#checking-against-the-real-host}

`run-ios` と `run-android` はバンドルを埋め込んだ Release でビルドするので、Metro も dev launcher も通りません。残るのは画面を見ることです。

- **サブジェクトはコードで選びます。** スクリプトからはシミュレータをタップできないので、サンプルのプレイヤー画面が最初に出すサブジェクト（`useState('Basic')` の初期値）を書き換え（`config=debug` なら Metro の fast refresh で反映されます）、`xcrun simctl io <udid> screenshot` で撮ります。
- **`config=debug` のときだけ**、expo-dev-menu のオンボーディングのシートが画面の半分を覆います。`xcrun simctl spawn <udid> defaults write jp.co.cri-mw.spritestudio.ssplayer.example EXDevMenuIsOnboardingFinished -bool YES` で以後は出なくなります。
- **Release ビルドの `console.log` は iOS のログに出ません。** 結果は `Text` で画面に出し、スクリーンショットで読みます。Android では logcat に `ReactNativeJS` として出ます。
- **計測。** ビルド直後の 1 回目の起動は外れ値です。終了と起動を 3 回繰り返して中央値を取ります。CPU 時間は同じビルドの中でだけ比べてください。軽いビルドほどスレッドが efficiency コアに寄せられ、同じ仕事が 1.6〜2 倍のサンプルに見えます。ビルドをまたいで比べるのは、回数で数えられるもの（レンダーパス）、ホストでの交互のマイクロベンチ、GPU の完了を待つホストの Metal のベンチです。UI スレッドのコストを比べる前に、UI が実際に描いたフレーム数をそろえます。数えるのは、公開したフレームの picture の数ではなく、UI スレッドが新しい picture を受け取った回数です。UI スレッドの番が来る前に 2 つ公開されると、届くのは後の 1 つだけです。
- **Android エミュレータはソフトウェアで描画します**（`emulator -avd <avd> -no-window -no-audio -gpu swiftshader_indirect`）。そのため UI スレッドは実機よりずっと重くなります。アプリは `adb shell am start -n jp.co.crimw.spritestudio.ssplayer.example/.MainActivity` で起動し、終わったらエミュレータを止めてください（`adb emu kill`）。CPU を使い続けます。
- **iOS は広色域の画面で Display P3 で合成します。** シミュレータも同じで、RN Skia が画面から面を選ぶためです。そのため純粋な赤と青を加算で重ねると、iOS では白に寄り、Android ではマゼンタのままです。sRGB の結果は Android の方です。
- **ビルドが通っても、Skia が入ったとは限りません。** RN Skia が見つからないと、ビルドは何も言わずに `SSPLAYER_ENABLE_SKIA_DIRECT=0` にします。RN Skia を上げたら、Android は `.cxx/**/compile_commands.json` に、iOS は DerivedData の `SsPlayer.build/**/*-common-args.resp` に `SSPLAYER_ENABLE_SKIA_DIRECT=1` があるかを見てください。
- **ホストのチェックが「`.ssab` failed verification」で落ちたら、データが古いのです。** Skia のせいではなく、サンプルのパックが Brain より古くなっています。サブモジュールを固定の版にそろえて `deploy-examples` を実行してください。

層、ネイティブ側、それらをまたぐ設計の理由は[プレイヤーの構成](./architecture.md)にあります。
