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

Most of this player's rules exist because the obvious implementation was tried
and did not work, and the reasoning behind each is written in the code, at the
site the rule binds — read it there before changing anything in `cpp/` or in the
buffer handling. Four are worth knowing before you start:

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

Cutting a release is maintainer work — see [RELEASING.md](./RELEASING.md).

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

| Task | Command |
|---|---|
| Typecheck (package + example) | `npm run typecheck` |
| Unit tests over `core/`, `player/`, `view/` | `npm test` (any OS, no Brain) |
| The package compiles to `lib/` | `npm run build` — `bob build`, the step `prepack` runs |
| FlatBuffers accessors current + read path sound | `npm run check-framedata` (needs `flatc`) |
| Mask drawing, and a mask crossing into an instance child | `npm run check-mask` (macOS). The instance half **reports itself skipped** without the optional `MaskInstance` sample |
| Instance slots keep stepping while out of the draw plan | `npm run check-hidden` |
| `ss-*` shaders compile, and their arithmetic | `npm run check-shader` (macOS) |
| The web stub barrel imports clean, matches `index.ts` and throws | `npm run check-web-barrel` (any OS, no Brain) |
| Nitro codegen is current | `npm run generate-nitro-code`, then `git diff --exit-code packages/*/nitrogen` |
| Bake / mask plan / effect / instance / shader geometry | `tools/.build/ssbake_check <pack.ssab> <animation> 120` (ASan) |
| Native build | (in `example/`) `npx expo prebuild --platform ios\|android && npx expo run:ios\|android`. The Android prebuild must log `dropped x86 from reactNativeArchitectures` |
| Asset manifest | (in `example/`) `npx react-native-spritestudio assets --check --out src/ss-assets.ts`. **`--check` calls it stale if you deployed the optional `MaskInstance` sample** — the committed manifest is the without-it state, so do not commit that change |

**Two host checks report a clean bill when they did nothing**, and each says so in its own header:
`ssbake_check`, where zeroes mean the path never ran, and `ssshader_check`, where a broken `ss-*`
body and an unported one look identical — so port a body and its row in `ssshader_check.cpp`
together. **Measure in release, and check the animation is actually playing**: `setup_animation`
leaves the transport stopped.

`npm test` covers all three layers above Layer 1 on any machine. `vitest.config.mts` aliases
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

| Script | Does | When |
|---|---|---|
| `download-sdk` | Install the release pinned in `scripts/SDK_VERSION.txt` into `native/`. **No Rust needed**, and skips when what is installed already matches. | Normal setup |
| `build-runtime` | Build the Brain from the submodule into the same layout. Writes no version, so it is always replaced and never published. Windows: Android slice only. | Changing the Brain |
| `deploy-examples` | `.sspj` → `.ssab` for `example/` via `ssconverter-cli` (needs Rust), then refreshes `example/src/ss-assets.ts`. Optional third-party art under `example/SpriteStudio_Source/` is reported and skipped when absent. | Refresh example assets |
| `generate-nitro-code` | `nitrogen` → `nitrogen/generated/`. Commit the result. | After a spec change |
| `generate-fbs-code` | `flatc -c` over the three schemas → `cpp/format/`. Commit the result. | After a schema change |
| `build-release` / `release` | See [RELEASING.md](./RELEASING.md). | Maintainers |
| `prepare-docs` / `build-docs` | See [RELEASING.md](./RELEASING.md). | Working on the docs |

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

ご興味をお持ちいただきありがとうございます。この Player は、他の公式 Player と共通のネイティブランタイムを Skia 経由で描画します。そのため変更は TypeScript と C++ のどちらか、あるいは両方に及ぶことが多くなります。

## 目次

- [貢献する方法](#貢献する方法)
- [開発環境のセットアップ](#開発環境のセットアップ)
- [コーディング規約](#コーディング規約)

## 貢献する方法

### 技術的制約と設計原則

この Player の規則の多くは「素直な実装を試した結果うまくいかなかった」ことの記録で、それぞれの根拠はその規則が縛るコードの箇所に書いてあります。`cpp/` やバッファの扱いに手を入れる前に、そこを読んでください。着手前に知っておきたいものを 4 つ挙げます。

- **JS に渡されるバッファは次の `update()` までしか有効ではありません。** 各構造体は
  `generation` を持つので、読む前に比較してください。
- **頂点単位のデータは JSI 境界を越えません。** JS の 1 フレームあたりの仕事は Player
  ごとに 1 回の呼び出しだけです。頂点を JS 経由にする案は計測済みで、フレームレートの上限を作ります。
- **レイヤ 2 は `react` / `react-native` を一切 import しません。** ヘッドレス利用と
  react-native-web を残すためです。**これを強制する仕組みはありません** — lint ルールもテストもありません。
- **パックはファイルではなくディレクトリです。** そのため `require()` はソースになり得ず、
  `assetExts` に `ssab` / `ssqb` を足してはいけません。

### バグの報告

[不具合の報告フォーム](https://github.com/cri-middleware/SSPlayerForReactNative/issues/new/choose)
から Issue を作成してください。**業務データの `.sspj` は公開の場である Issue に添付しないでください** — 送付先はフォームに記載しています。使い方に関するご質問は Issue ではなくコミュニティへお願いします（[SUPPORT.md](./SUPPORT.md)）。

### プルリクエスト

1. `main` からブランチを切ってください。
2. 変更するファイルの既存のスタイルに合わせてください。
3. CI が回せない検証を手元で実行してください（[開発環境](#開発環境のセットアップ)）。
4. 変更は 1 つの目的に絞ってください。
5. **何を、どのプラットフォームで確認したか**を書いてください。iOS と Android は挙動が分かれます。example の Player 画面がこれまでに捕まえたプラットフォーム固有の不具合は、いずれも iOS のみで発生するものでした。

### ブランチとリリース

このリポジトリは **trunk-based** です。長期ブランチは `main` の 1 本だけで、そこから短命なブランチを切ります。

パッケージのバージョンは **SDK とロックステップ**です。`scripts/SDK_VERSION.txt` がビルド対象の Brain のリリースを固定し、パッケージ側も同じバージョンを名乗ります。
changesets は使いません — パッケージを個別にバージョニングする SSPlayerForWeb とは異なります。ブランチモデルはバージョニングモデルに従います。

`npm run build-release` は tarball を `release-dist/` に作って開き直すところまでを行い、何も publish しません。修正がまだ効く段階で成果物を確認するためです。`npm run release`
はその最後に publish を足したもので、**macOS 専用**です。tarball には Xcode でしかビルドできない iOS 用 xcframework が含まれるため、他の環境から publish すると
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

全体の表は英語版の [What to run before opening a PR](#what-to-run-before-opening-a-pr) にあります（各チェックが何を保証するかもそこに書いてあります）。最低限は次の 5 つです。

| | |
|---|---|
| `npm run typecheck` | パッケージと example |
| `npm test` | `core/`・`player/`・`view/` のユニットテスト（OS 不問・Brain 不要） |
| `npm run build` | パッケージが `lib/` にコンパイルされること |
| `npm run check-web-barrel` | web スタブの barrel が import 可能なこと（OS 不問・Brain 不要） |
| `npm run generate-nitro-code` の後 `git diff --exit-code packages/*/nitrogen` | Nitro バインディングが最新であること |

**CI が緑であることは、これらを実行した代わりにはなりません。** CI は private な SDK
サブモジュールにも macOS の libskia にもアクセスできないため、typecheck・ユニットテスト・Nitro
バインディング・`bob build`・web barrel・スクリプトの構文・`files` ガードまでしか実行できず、ホスト側のチェックと `prepack` は動きません。

描画の確認は example の Player 画面で手動で行います。機能ごとにカードが 1 枚あり、それぞれが何を証明するかは [`example/README.md`](./example/README.md) に記載しています。

### ツールチェインスクリプトを変更する場合

`scripts/` の各エントリポイントは `.js` の shim で、ホストに応じて `.sh` か `.ps1` の実装を選びます。**必ず両方を揃えて変更してください** — 片方だけにすると、もう一方のプラットフォームの貢献者を締め出すことになります。CI は両方が構文として通ることを確認しています。

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
本プロジェクトへの貢献は、プロジェクトの [LICENSE.md](./LICENSE.md)（参考訳:
[LICENSE.ja.md](./LICENSE.ja.md)）に同意したものとみなされます。
