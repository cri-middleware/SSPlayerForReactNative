# Contributing to SSPlayerForReactNative

> [!IMPORTANT]
> We are not accepting pull requests until a Contributor License Agreement
> (CLA) is in place. Issues remain open for bug reports and requests.

Thank you for your interest in contributing. This player draws SpriteStudio
animations through Skia, driven by a native runtime shared with every other
official player, so a change here usually touches TypeScript, C++, or both.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [How Can I Contribute?](#how-can-i-contribute)
- [Development Environment](#development-environment)
- [Coding Standards](#coding-standards)

## Code of Conduct
Please refer to [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md).

## How Can I Contribute?

### Technical Constraints & Guiding Principles

Most of this player's rules exist because the obvious implementation was tried
and did not work, and the reasoning behind each is written in the code, at the
site the rule binds — read it there before changing anything in `cpp/` or in the
buffer handling. Five are worth knowing before you start:

- **Every buffer handed to JS is valid only until the next `update()`.** Structs
  carry a `generation`; compare it before reading.
- **Nothing per-vertex crosses the JSI boundary.** JS makes the same few calls
  per player per frame, whatever the vertex count. Routing vertices through JS
  was measured and caps the frame rate.
- **No per-frame allocations in the playback hot path**, on either side of JSI.
  A per-frame buffer is a member resized in place, like `SsBaker`'s, never a
  fresh vector or JS array.
- **Layer 2 imports nothing from `react` / `react-native`**, so headless use and
  react-native-web stay possible. `pnpm run check-layers` holds it to that,
  across this package's own import graph.
- **A pack is a directory, not a file**, so `require()` is not a source and
  `assetExts` stays clean of `ssab` / `ssqb`.

### Reporting Bugs

Open an issue with the [bug report form](https://github.com/cri-middleware/SSPlayerForReactNative/issues/new/choose).
Do not attach proprietary `.sspj` files to a public issue — the form says where
to send those privately. Questions about how to use the player belong in the
community forum rather than the tracker; see [SUPPORT.md](./SUPPORT.md).

### Pull Requests

1. Branch from `develop`, and open the pull request into `develop`.
2. Match the style of the file you are touching.
3. Run what CI cannot — see [Development Environment](#development-environment).
4. Keep the change scoped to one thing.
5. Describe what you verified, and on which platform. iOS and Android diverge:
   the only platform-specific defect the example's Player screen has ever caught
   was iOS-only.

### Branching & releases

This repository follows **git-flow**: `develop` integrates, and a pull request goes
into it; `main` holds released commits only, and moves only through a
maintainer's release branch.

The package version is **lockstep with the SDK** — `scripts/SDK_VERSION.txt` pins
the Brain release the package is built against, and the package carries the
matching version — so there is one version line. That differs from
SSPlayerForWeb, whose packages are versioned independently and released from
`main`: the branch model follows the versioning model.

Cutting a release is maintainer work — see [RELEASING.md](./RELEASING.md).

## Development Environment

Prerequisites and the full first-run steps are in the
**[Quick Start](./README.md#-quick-start)** section of the README. Node 20 or
newer, and pnpm at the version `packageManager` in `package.json` names
(`corepack enable` picks it up).

```bash
pnpm install
pnpm run download-sdk    # installs the pinned Brain into native/ -- no Rust needed
pnpm run build           # bob build, the same step prepack runs
```

`download-sdk` is the normal path. `pnpm run build-runtime build=release` builds
the Brain from the `SpriteStudio-SDK` submodule instead, which is what you want
only when changing the Brain itself; it needs Rust, and on Windows produces the
Android slice alone.

### What to run before opening a PR

| Task | Command |
|---|---|
| Typecheck (package + example) | `pnpm run typecheck` |
| Unit tests over `core/`, `player/`, `view/` | `pnpm test` (any OS, no Brain) |
| The package compiles to `lib/` | `pnpm run build` — `bob build`, the step `prepack` runs |
| FlatBuffers accessors current + read path sound | `pnpm run check-framedata` (needs `flatc`) |
| Mask drawing, and a mask crossing into an instance child | `pnpm run check-mask` (macOS). The instance half **reports itself skipped** without the optional `MaskInstance` sample |
| Instance and effect slots keep stepping while out of the draw plan, and a hidden effect builds no particles | `pnpm run check-hidden` |
| `ss-*` shaders compile, and their arithmetic | `pnpm run check-shader` (macOS) |
| The Nitro glue compiles: `HybridSs*.cpp`, `SsAssets.cpp`, `SsRNSkiaInterop.cpp`, `SsPlayerJni.cpp`, `nitrogen/generated/` | `pnpm run check-glue` — a syntax check for iOS (macOS, Xcode) and Android (the NDK). Each half **reports itself skipped** without its toolchain, and the JNI units without the fbjni headers a Gradle build unpacks |
| The web stub barrel imports clean, matches `index.ts` and throws | `pnpm run check-web-barrel` (any OS, no Brain) |
| Layer 2 imports nothing from `react` / `react-native`, directly or through another layer | `pnpm run check-layers` (any OS, no install) |
| No line break between two Japanese characters in the Markdown | `pnpm run check-ja-breaks` (any OS, no install) |
| The Skia-guarded draw path compiles on Windows | `tools/check-skia-compile.ps1` — `check-mask`'s stand-in where RN Skia ships no host libskia: it compiles with the NDK's clang, and links and runs nothing |
| Nitro codegen is current | `pnpm run generate-nitro-code`, then `git diff --exit-code packages/*/nitrogen` |
| Bake / mask plan / effect / instance / shader geometry | `tools/.build/ssbake_check <pack.ssab> <animation> 120` (ASan) |
| Native build | `pnpm run run-ios` / `pnpm run run-android` — prebuild, a Release build and a launch on a simulator or device. The Android prebuild must log `dropped x86 from reactNativeArchitectures` |
| Asset manifest | (in `example/`) `pnpm exec react-native-spritestudio assets --check --out src/ss-assets.ts`. **`--check` calls it stale if you deployed anything from `example/SpriteStudio_Source/`** (the optional `MaskInstance` sample, or a project of your own) — the committed manifest is the without-them state, so do not commit that change |

**Two host checks report a clean bill when they did nothing**, and each says so in its own header:
`ssbake_check`, where zeroes mean the path never ran, and `ssshader_check`, where a broken `ss-*`
body and an unported one look identical — so port a body and its row in `ssshader_check.cpp`
together. **Measure in release, and check the animation is actually playing**: `setup_animation`
leaves the transport stopped.

`pnpm test` covers all three layers above Layer 1 on any machine. `vitest.config.mts` aliases
`react-native`, `@shopify/react-native-skia` and `react-native-reanimated` to stubs under
`test/support/stubs/`, because they are reached transitively and a Layer 3 test that never mentions
Skia could not otherwise import. The behaviour under test is faked one layer in, at the package's
own modules, and the rule the files follow is **fake the layer below, keep the layer under test
real** — `leakCheck.test.ts` leaves `player/source` alone precisely because the leases are what it
measures. Drawing is not covered by any of it.

Tests live in `test/` rather than beside the source **because `files` ships `src` recursively**, so
a `src/**/*.test.ts` would land in the tarball. `typecheck` passes them through
`tsconfig.test.json` with `--project`; widening the base config's `include` instead would break
`check-web-barrel`, which runs a bare `tsc --rootDir src`.

**A green CI is not a substitute for running these.** On a pull request CI checks
out no submodules, so it runs typecheck, the unit tests, the Nitro bindings
check, `bob build`, the web barrel, `check-layers`, `check-ja-breaks`, script
parsing and the `files` guard — none of the host checks, and not `prepack`. A
pull request touching only Markdown runs none of it. The weekly run, a dispatch
and the release pull request also run `check-shader` on macOS, build the example
app for Android and iOS on the Brain built from the submodule, and run
`check-hidden`, `check-mask`, `check-glue` and the asset manifest check on that
Brain. `check-framedata` and `prepack` run in none of them.

Rendering is verified by hand on the example's Player screen, one feature card per
capability; [`example/README.md`](./example/README.md) says what each subject
proves.

### Editing the toolchain scripts

Every entry point in `scripts/` is a `.js` shim that picks the `.sh` or `.ps1`
implementation for the host. **Change both halves together** — naming only one
would shut out contributors on the other platform, and CI checks that both parse.

| Script | Does | When |
|---|---|---|
| `download-sdk` | Install the release pinned in `scripts/SDK_VERSION.txt` into `native/`. **No Rust needed**, and skips when what is installed already matches. | Normal setup |
| `build-runtime` | Build the Brain from the submodule into the same layout. Writes no version, so it is always replaced and never published. Windows: Android slice only. | Changing the Brain |
| `deploy-examples` | `.sspj` → `.ssab` for `example/` via `ssconverter-cli` (needs Rust), then refreshes `example/src/ss-assets.ts`. Every project under `example/SpriteStudio_Source/` is converted too and shows up as a `local/<folder>` subject ([example/README.md](./example/README.md#looking-at-a-project-of-your-own)); the optional `MaskInstance` sample is reported and skipped when absent. | Refresh example assets |
| `generate-assets` | Rewrites `example/src/ss-assets.ts` from the packs under `example/assets/ss/`: the last step of `deploy-examples`, on its own. An app runs the same command as `npx react-native-spritestudio assets`. | After adding packs to `example/assets/ss/` by hand |
| `run-ios` | Prebuild the example, build it in Release (the JS bundle embedded, so no Metro) and launch it on a simulator or a connected iPhone, picked with `device=<name\|udid>`; a simulator is booted when none is named. `config=debug` serves the JS from Metro instead. macOS only, so there is no `.ps1`. | Looking at drawing on a device |
| `run-android` | The same for an Android device or emulator, picked with `device=<name>`. | Looking at drawing on a device |
| `generate-nitro-code` | `nitrogen` → `nitrogen/generated/`. Commit the result. | After a spec change |
| `generate-fbs-code` | `flatc -c` over the three schemas → `cpp/format/`. Commit the result. | After a schema change |
| `build-release` / `release` | See [RELEASING.md](./RELEASING.md). | Maintainers |
| `prepare-docs` / `build-docs` | See [Documentation](#documentation) below. | Working on the docs |

### Documentation

```bash
pnpm run prepare-docs   # pnpm install
pnpm run build-docs     # TypeDoc + VitePress into docs/.vitepress/dist
```

`scripts/build-pages.sh` is the two together, and is what `pages.yml` runs. Neither needs the
Brain or Rust — TypeDoc reads TypeScript and VitePress reads Markdown — which is why that workflow
checks out without submodules. The build fails on a dead page link but **does not check
`#anchors`**: a link to a heading that does not exist still builds green, so verify those by hand.

The English pages also ship in the package's `docs/`: `build` and `prepack` run
`packages/react-native-spritestudio/scripts/copy-docs.mjs`, which turns the site paths between pages
into relative links and adds `scripts/docs-README.md` beside it as the folder's front door. Renaming a
page the front door links to means editing it too; `build-release` refuses a link that goes nowhere.

## Coding Standards

### TypeScript

- Strict typing; avoid `any`.
- Match the existing style of the file you touch — naming, control flow, error
  handling.
- Generated output (`nitrogen/generated/`, `cpp/format/`) is committed. Regenerate
  it with the script that owns it rather than editing it by hand.

### Native (C++ / Nitro)

- The spec in `src/specs/*.nitro.ts` is the source of truth for the bridge; change
  it and regenerate, never the generated bindings.
- Do not alter the `SpriteStudio-SDK` submodule structure without explicit
  agreement. Changes to playback behaviour usually belong in the shared runtime
  rather than here — if the same problem reproduces on another SpriteStudio
  player, it is not this repository's.

---
By contributing to this project, you agree that your contributions will be
licensed under the project's [LICENSE.md](./LICENSE.md).

<br>
<br>

---

# SSPlayerForReactNative への貢献について

> [!IMPORTANT]
> コントリビューターライセンス契約（CLA）の準備が整うまで、プルリクエストは受け付けていません。バグ報告や要望は引き続き Issue で受け付けています。

ご興味をお持ちいただきありがとうございます。この Player は、他の公式 Player と共通のネイティブランタイムを Skia 経由で描画します。そのため変更は TypeScript と C++ のどちらか、あるいは両方に及ぶことが多くなります。

## 目次

- [行動規範](#行動規範)
- [貢献する方法](#貢献する方法)
- [開発環境のセットアップ](#開発環境のセットアップ)
- [コーディング規約](#コーディング規約)

## 行動規範
[CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md) を参照してください。

## 貢献する方法

### 技術的制約と設計原則

この Player の規則の多くは「素直な実装を試した結果うまくいかなかった」ことの記録で、それぞれの根拠はその規則が縛るコードの箇所に書いてあります。`cpp/` やバッファの扱いに手を入れる前に、そこを読んでください。着手前に知っておきたいものを 5 つ挙げます。

- **JS に渡されるバッファは次の `update()` までしか有効ではありません。** 各構造体は
  `generation` を持つので、読む前に比較してください。
- **頂点単位のデータは JSI 境界を越えません。** JS が 1 フレームに呼ぶ回数は Player
  ごとに決まっていて、頂点数によりません。頂点を JS 経由にする案は計測済みで、フレームレートの上限を作ります。
- **再生中は毎フレームのヒープ確保をしません。** JSI のどちら側でも同じです。毎フレーム使うバッファは `SsBaker` のようにメンバーに持ってその場でサイズを変え、vector や JS の配列を毎フレーム新しく作らないでください。
- **レイヤ 2 は `react` / `react-native` を一切 import しません。** ヘッドレス利用と
  react-native-web を残すためです。`pnpm run check-layers` が、このパッケージ自身の import のつながり全体でこれを確かめます。
- **パックはファイルではなくディレクトリです。** そのため `require()` はソースになり得ず、
  `assetExts` に `ssab` / `ssqb` を足してはいけません。

### バグの報告

[不具合の報告フォーム](https://github.com/cri-middleware/SSPlayerForReactNative/issues/new/choose)から Issue を作成してください。**業務データの `.sspj` は公開の場である Issue に添付しないでください** — 送付先はフォームに記載しています。使い方に関するご質問は Issue ではなくコミュニティへお願いします（[SUPPORT.md](./SUPPORT.md)）。

### プルリクエスト

1. `develop` からブランチを切り、`develop` へプルリクエストを出してください。
2. 変更するファイルの既存のスタイルに合わせてください。
3. CI が回せない検証を手元で実行してください（[開発環境](#開発環境のセットアップ)）。
4. 変更は 1 つの目的に絞ってください。
5. **何を、どのプラットフォームで確認したか**を書いてください。iOS と Android は挙動が分かれます。example の Player 画面がこれまでに捕まえたプラットフォーム固有の不具合は 1 件だけで、それは iOS のみで発生するものでした。

### ブランチとリリース

このリポジトリは **git-flow** です。`develop` が統合ブランチで、プルリクエストはそこへ出します。`main` にはリリース済みのコミットだけが入り、メンテナーのリリースブランチを通してだけ進みます。

パッケージのバージョンは **SDK とロックステップ**です。`scripts/SDK_VERSION.txt` がビルド対象の Brain のリリースを固定し、パッケージ側も同じバージョンを名乗るので、バージョンの系統は 1 つです。パッケージを個別にバージョニングし `main` から出す SSPlayerForWeb とは異なります。ブランチモデルはバージョニングモデルに従います。

リリース作業はメンテナーが行います（[RELEASING.md](./RELEASING.md) を参照）。

## 開発環境のセットアップ

前提条件と初回の手順は README の[**クイックスタート**](./README.ja.md#-クイックスタート)にあります。Node 20 以上と、`package.json` の `packageManager` が指す版の pnpm を使用します（`corepack enable` で入ります）。

```bash
pnpm install
pnpm run download-sdk    # 固定された Brain を native/ へ導入。Rust は不要
pnpm run build           # bob build。publish 時に prepack が走らせるのと同じ手順
```

通常は `download-sdk` を使ってください。`pnpm run build-runtime build=release` は
`SpriteStudio-SDK` サブモジュールから Brain をビルドしますが、これが必要なのは Brain
自体を変更するときだけです。Rust が必要で、Windows では Android 用のみが生成されます。

### PR を出す前に実行するもの

全体の表は英語版の [What to run before opening a PR](#what-to-run-before-opening-a-pr) にあります（各チェックが何を保証するかもそこに書いてあります）。最低限は次の 7 つです。

| | |
|---|---|
| `pnpm run typecheck` | パッケージと example |
| `pnpm test` | `core/`・`player/`・`view/` のユニットテスト（OS 不問・Brain 不要） |
| `pnpm run build` | パッケージが `lib/` にコンパイルされること |
| `pnpm run check-web-barrel` | web スタブの barrel が import 可能なこと（OS 不問・Brain 不要） |
| `pnpm run check-layers` | レイヤ 2 が、直接にも他のレイヤ経由でも `react` / `react-native` を import していないこと（OS 不問・インストール不要） |
| `pnpm run check-ja-breaks` | Markdown で日本語の文字と文字の間に改行が無いこと（OS 不問・インストール不要） |
| `pnpm run generate-nitro-code` の後 `git diff --exit-code packages/*/nitrogen` | Nitro バインディングが最新であること |

**CI が緑であることは、これらを実行した代わりにはなりません。** プルリクエストの CI はサブモジュールをチェックアウトしないため、typecheck・ユニットテスト・Nitro バインディング・`bob build`・web barrel・`check-layers`・`check-ja-breaks`・スクリプトの構文・`files` ガードまでしか実行せず、ホスト側のチェックと `prepack` は動きません。Markdown だけのプルリクエストでは何も走りません。週次・手動実行・リリースのプルリクエストでは、さらに macOS で `check-shader` を実行し、submodule からビルドした Brain で example アプリを Android と iOS 向けにビルドして、その Brain で `check-hidden`・`check-mask`・`check-glue` とアセットマニフェストのチェックを実行します。`check-framedata` と `prepack` は、どの run でも実行しません。

描画の確認は example の Player 画面で手動で行います。機能ごとにカードが 1 枚あり、それぞれが何を証明するかは [`example/README.md`](./example/README.md) に記載しています。

### ツールチェインスクリプトを変更する場合

`scripts/` の各エントリポイントは `.js` の shim で、ホストに応じて `.sh` か `.ps1` の実装を選びます。**必ず両方を揃えて変更してください** — 片方だけにすると、もう一方のプラットフォームの貢献者を締め出すことになります。CI は両方が構文として通ることを確認しています。

| スクリプト | 内容 | 使う場面 |
|---|---|---|
| `download-sdk` | `scripts/SDK_VERSION.txt` で固定したリリースを `native/` に導入します。**Rust は不要**で、導入済みのものが一致していれば何もしません。 | 通常のセットアップ |
| `build-runtime` | submodule から Brain をビルドし、同じ配置に置きます。バージョンを書き込まないため、常に置き換えられ、publish されることもありません。Windows では Android 向けのみです。 | Brain を変更するとき |
| `deploy-examples` | `ssconverter-cli`（Rust が必要）で `example/` 用に `.sspj` を `.ssab` へ変換し、`example/src/ss-assets.ts` を更新します。`example/SpriteStudio_Source/` 以下のプロジェクトもすべて変換され、`local/<folder>` の Subject として表示されます（[example/README.md](./example/README.md#looking-at-a-project-of-your-own)）。任意の `MaskInstance` サンプルは、無ければその旨を表示して飛ばします。 | example のアセットを更新するとき |
| `generate-assets` | `example/assets/ss/` 以下のパックから `example/src/ss-assets.ts` を書き直します。`deploy-examples` の最後の手順だけを単独で行うものです。アプリでは同じコマンドを `npx react-native-spritestudio assets` として実行します。 | `example/assets/ss/` にパックを手で足したとき |
| `run-ios` | example を prebuild し、Release でビルドして（JS バンドルを埋め込むので Metro は不要）、シミュレータか接続した iPhone で起動します。端末は `device=<名前\|UDID>` で選び、指定がなければシミュレータを起動します。`config=debug` にすると JS を Metro から配信します。macOS 専用のため `.ps1` はありません。 | 端末で描画を確かめるとき |
| `run-android` | 同じことを Android の端末かエミュレータで行います。端末は `device=<名前>` で選びます。 | 端末で描画を確かめるとき |
| `generate-nitro-code` | `nitrogen` → `nitrogen/generated/`。生成物はコミットしてください。 | spec を変更した後 |
| `generate-fbs-code` | 3 つのスキーマに `flatc -c` → `cpp/format/`。生成物はコミットしてください。 | スキーマを変更した後 |
| `build-release` / `release` | [RELEASING.md](./RELEASING.md) を参照してください。 | メンテナー |
| `prepare-docs` / `build-docs` | 下の[ドキュメント](#ドキュメント)を参照してください。 | docs を編集するとき |

### ドキュメント

```bash
pnpm run prepare-docs   # pnpm install
pnpm run build-docs     # TypeDoc + VitePress を docs/.vitepress/dist へ
```

`scripts/build-pages.sh` はこの 2 つをまとめたもので、`pages.yml` が実行するのもこれです。どちらも
Brain も Rust も必要としません（TypeDoc は TypeScript を、VitePress は Markdown を読むだけです）。そのためこのワークフローは submodule 無しでチェックアウトします。リンク切れではビルドが失敗しますが、
**`#anchor` は検査しません**。存在しない見出しへのリンクは緑のまま通るので、手で確認してください。

英語のページはパッケージの `docs/` にも入ります。`build` と `prepack` が `packages/react-native-spritestudio/scripts/copy-docs.mjs` を実行し、ページ間のサイトのパスを相対リンクに書き換え、隣の `scripts/docs-README.md` を入口ページとして加えます。入口ページが指すページを改名したら入口ページも直してください（行き先の無いリンクは `build-release` が拒否します）。

## コーディング規約

### TypeScript

- 厳密な型付けを行い、`any` は避けてください。
- 変更するファイルの既存のスタイル（命名・制御フロー・エラー処理）に合わせてください。
- 生成物（`nitrogen/generated/`、`cpp/format/`）はコミット対象です。手で編集せず、担当のスクリプトで再生成してください。

### ネイティブ (C++ / Nitro)

- ブリッジの正は `src/specs/*.nitro.ts` の spec です。spec を変更して再生成してください。生成されたバインディングを直接編集しないでください。
- `SpriteStudio-SDK` サブモジュールの構造は、合意なく変更しないでください。再生の挙動に関する変更は、このリポジトリではなく共通ランタイム側に属することが多いです —
  **他の SpriteStudio Player でも同じ問題が再現するなら、それはこのリポジトリの問題ではありません。**

---
本プロジェクトに貢献することで、あなたの貢献がプロジェクトの [LICENSE.md](./LICENSE.md)（参考訳: [LICENSE.ja.md](./LICENSE.ja.md)）の下でライセンスされることに同意したものとみなされます。
