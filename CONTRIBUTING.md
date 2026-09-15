# Contributing to SSPlayerForReactNative

Thank you for your interest in contributing. This player draws SpriteStudio
animations through Skia, driven by a native runtime shared with every other
official player, so a change here usually touches TypeScript, C++, or both.

## Table of Contents

- [How Can I Contribute?](#how-can-i-contribute)
- [Development Environment](#development-environment)
- [Coding Standards](#coding-standards)

## How Can I Contribute?

### Technical Constraints & Guiding Principles

The rules that are not negotiable, and the reasoning behind each, are in
[AGENTS.md](./AGENTS.md#hard-constraints). Read that table before changing
anything in `cpp/` or in the buffer handling — most of its entries exist because
the obvious implementation was tried and did not work. Four are worth knowing
before you start:

- **Every buffer handed to JS is valid only until the next `update()`.** Structs
  carry a `generation`; compare it before reading.
- **Nothing per-vertex crosses the JSI boundary.** JS's per-frame job is one call
  per player. Routing vertices through JS was measured and caps the frame rate.
- **Layer 2 imports nothing from `react` / `react-native`**, so headless use and
  react-native-web stay possible. Nothing enforces this — no lint rule, no test.
- **A pack is a directory, not a file**, so `require()` is not a source and
  `assetExts` stays clean of `ssab` / `ssqb`.

### Reporting Bugs

Open an issue with the [bug report form](https://github.com/cri-middleware/SSPlayerForReactNative/issues/new/choose).
Do not attach proprietary `.sspj` files to a public issue — the form says where
to send those privately. Questions about how to use the player belong in the
community forum rather than the tracker; see [SUPPORT.md](./SUPPORT.md).

### Pull Requests

1. Branch from `main`.
2. Match the style of the file you are touching.
3. Run what CI cannot — see [Development Environment](#development-environment).
4. Keep the change scoped to one thing.
5. Describe what you verified, and on which platform. iOS and Android diverge:
   the only platform-specific defect the example's Player screen has ever caught
   was iOS-only.

### Branching & releases

This repository is **trunk-based**: `main` is the single long-lived branch. Use
short-lived branches off it.

The package version is **lockstep with the SDK** — `scripts/SDK_VERSION.txt` pins
the Brain release the package is built against, and the package carries the
matching version. There are no changesets here; that differs from SSPlayerForWeb,
where packages are versioned independently. The branch model follows the
versioning model.

`npm run build-release` builds the tarball into `release-dist/` and re-opens it,
publishing nothing, so the artifact can be looked at while it can still be fixed.
`npm run release` is the same run with the publish on the end, and is **macOS
only** — the tarball carries the Brain's iOS xcframework, which only Xcode can
build, so a release from anywhere else would ship an Android-only package that
installs and then fails.

## Development Environment

Prerequisites and the full first-run steps are in the
**[Quick Start](./README.md#-quick-start)** section of the README. Node 20 or
newer, and npm workspaces.

```bash
npm ci
npm run download-sdk    # installs the pinned Brain into native/ -- no Rust needed
npm run build           # bob build, the same step prepack runs
```

`download-sdk` is the normal path. `npm run build-runtime -- build=release` builds
the Brain from the `SpriteStudio-SDK` submodule instead, which is what you want
only when changing the Brain itself; it needs Rust, and on Windows produces the
Android slice alone.

### What to run before opening a PR

[AGENTS.md](./AGENTS.md#verification) has the full table, including the host
checks and what each one proves. The short version:

| | |
|---|---|
| `npm run typecheck` | package and example |
| `npm test` | the unit tests over `core/`, `player/` and `view/` (any OS, no Brain) |
| `npm run build` | the package compiles to `lib/` |
| `npm run check-web-barrel` | the web stub barrel still imports clean (any OS, no Brain) |
| `npm run generate-nitro-code` then `git diff --exit-code packages/*/nitrogen` | the Nitro bindings are current |

**A green CI is not a substitute for running these.** CI has no access to the
private SDK submodule and no macOS libskia, so it runs typecheck, the unit
tests, the Nitro bindings check, `bob build`, the web barrel, script parsing and
the `files` guard — and none of the host checks or `prepack`.

Rendering is verified by hand on the example's Player screen, one feature card per
capability; [`example/README.md`](./example/README.md) says what each subject
proves.

### Editing the toolchain scripts

Every entry point in `scripts/` is a `.js` shim that picks the `.sh` or `.ps1`
implementation for the host. **Change both halves together** — naming only one
would shut out contributors on the other platform, and CI checks that both parse.

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

ご興味をお持ちいただきありがとうございます。この Player は、他の公式 Player と共通の
ネイティブランタイムを Skia 経由で描画します。そのため変更は TypeScript と C++ の
どちらか、あるいは両方に及ぶことが多くなります。

## 目次

- [貢献する方法](#貢献する方法)
- [開発環境のセットアップ](#開発環境のセットアップ)
- [コーディング規約](#コーディング規約)

## 貢献する方法

### 技術的制約と設計原則

変更してはいけない規則と、その根拠は [AGENTS.md](./AGENTS.md#hard-constraints) の
表にあります。`cpp/` やバッファの扱いに手を入れる前に必ず目を通してください。表の
項目の多くは「素直な実装を試した結果うまくいかなかった」ことの記録です。着手前に
知っておきたいものを 4 つ挙げます。

- **JS に渡されるバッファは次の `update()` までしか有効ではありません。** 各構造体は
  `generation` を持つので、読む前に比較してください。
- **頂点単位のデータは JSI 境界を越えません。** JS の 1 フレームあたりの仕事は Player
  ごとに 1 回の呼び出しだけです。頂点を JS 経由にする案は計測済みで、フレームレートの
  上限を作ります。
- **レイヤ 2 は `react` / `react-native` を一切 import しません。** ヘッドレス利用と
  react-native-web を残すためです。**これを強制する仕組みはありません** — lint ルールも
  テストもありません。
- **パックはファイルではなくディレクトリです。** そのため `require()` はソースになり得ず、
  `assetExts` に `ssab` / `ssqb` を足してはいけません。

### バグの報告

[不具合の報告フォーム](https://github.com/cri-middleware/SSPlayerForReactNative/issues/new/choose)
から Issue を作成してください。**業務データの `.sspj` は公開の場である Issue に添付しないで
ください** — 送付先はフォームに記載しています。使い方に関するご質問は Issue ではなく
コミュニティへお願いします（[SUPPORT.md](./SUPPORT.md)）。

### プルリクエスト

1. `main` からブランチを切ってください。
2. 変更するファイルの既存のスタイルに合わせてください。
3. CI が回せない検証を手元で実行してください（[開発環境](#開発環境のセットアップ)）。
4. 変更は 1 つの目的に絞ってください。
5. **何を、どのプラットフォームで確認したか**を書いてください。iOS と Android は
   挙動が分かれます。example の Player 画面がこれまでに捕まえたプラットフォーム固有の
   不具合は、いずれも iOS のみで発生するものでした。

### ブランチとリリース

このリポジトリは **trunk-based** です。長期ブランチは `main` の 1 本だけで、そこから
短命なブランチを切ります。

パッケージのバージョンは **SDK とロックステップ**です。`scripts/SDK_VERSION.txt` が
ビルド対象の Brain のリリースを固定し、パッケージ側も同じバージョンを名乗ります。
changesets は使いません — パッケージを個別にバージョニングする SSPlayerForWeb とは
異なります。ブランチモデルはバージョニングモデルに従います。

`npm run build-release` は tarball を `release-dist/` に作って開き直すところまでを行い、
何も publish しません。修正がまだ効く段階で成果物を確認するためです。`npm run release`
はその最後に publish を足したもので、**macOS 専用**です。tarball には Xcode でしか
ビルドできない iOS 用 xcframework が含まれるため、他の環境から publish すると
Android でしか動かないパッケージが出てしまいます。

## 開発環境のセットアップ

前提条件と初回の手順は README の
**[クイックスタート](./README.ja.md#-クイックスタート)** にあります。Node 20 以上と
npm workspaces を使用します。

```bash
npm ci
npm run download-sdk    # 固定された Brain を native/ へ導入。Rust は不要
npm run build           # bob build。publish 時に prepack が走らせるのと同じ手順
```

通常は `download-sdk` を使ってください。`npm run build-runtime -- build=release` は
`SpriteStudio-SDK` サブモジュールから Brain をビルドしますが、これが必要なのは Brain
自体を変更するときだけです。Rust が必要で、Windows では Android 用のみが生成されます。

### PR を出す前に実行するもの

全体の表は [AGENTS.md](./AGENTS.md#verification) にあります（各チェックが何を保証するかも
そこに書いてあります）。最低限は次の 5 つです。

| | |
|---|---|
| `npm run typecheck` | パッケージと example |
| `npm test` | `core/`・`player/`・`view/` のユニットテスト（OS 不問・Brain 不要） |
| `npm run build` | パッケージが `lib/` にコンパイルされること |
| `npm run check-web-barrel` | web スタブの barrel が import 可能なこと（OS 不問・Brain 不要） |
| `npm run generate-nitro-code` の後 `git diff --exit-code packages/*/nitrogen` | Nitro バインディングが最新であること |

**CI が緑であることは、これらを実行した代わりにはなりません。** CI は private な SDK
サブモジュールにも macOS の libskia にもアクセスできないため、typecheck・ユニットテスト・Nitro
バインディング・`bob build`・web barrel・スクリプトの構文・`files` ガードまでしか
実行できず、ホスト側のチェックと `prepack` は動きません。

描画の確認は example の Player 画面で手動で行います。機能ごとにカードが 1 枚あり、
それぞれが何を証明するかは [`example/README.md`](./example/README.md) に記載しています。

### ツールチェインスクリプトを変更する場合

`scripts/` の各エントリポイントは `.js` の shim で、ホストに応じて `.sh` か `.ps1` の
実装を選びます。**必ず両方を揃えて変更してください** — 片方だけにすると、もう一方の
プラットフォームの貢献者を締め出すことになります。CI は両方が構文として通ることを
確認しています。

## コーディング規約

### TypeScript

- 厳密な型付けを行い、`any` は避けてください。
- 変更するファイルの既存のスタイル（命名・制御フロー・エラー処理）に合わせてください。
- 生成物（`nitrogen/generated/`、`cpp/format/`）はコミット対象です。手で編集せず、
  担当のスクリプトで再生成してください。

### ネイティブ (C++ / Nitro)

- ブリッジの正は `src/specs/*.nitro.ts` の spec です。spec を変更して再生成してください。
  生成されたバインディングを直接編集しないでください。
- `SpriteStudio-SDK` サブモジュールの構造は、合意なく変更しないでください。再生の挙動に
  関する変更は、このリポジトリではなく共通ランタイム側に属することが多いです —
  **他の SpriteStudio Player でも同じ問題が再現するなら、それはこのリポジトリの問題では
  ありません。**

---
本プロジェクトへの貢献は、プロジェクトの [LICENSE.md](./LICENSE.md)（参考訳:
[LICENSE.ja.md](./LICENSE.ja.md)）に同意したものとみなされます。
