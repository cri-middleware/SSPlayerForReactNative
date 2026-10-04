# Releasing SpriteStudio Player for React Native

Maintainers only. Contributors do not run any of this — see [CONTRIBUTING.md](./CONTRIBUTING.md).

## Cutting a release

Anyone with the Write role on this repository can cut a release: every step is a branch, a pull request, a tag, a workflow run or a Release, so nothing depends on whose machine runs it beyond looking at the drawing on a device. You need `git`, `gh` (run `gh auth login` once), Node.js and pnpm. The commands are bash; on Windows, run them in Git Bash.

A release is a tag on `main`, pushed first and built second. The version is `version` in `packages/react-native-spritestudio/package.json`, and it is **lockstep with the SDK**: `scripts/SDK_VERSION.txt` pins the SpriteStudio-SDK release the package is built against, and the package carries the same version. The tag is `v` followed by it, and the release build refuses a tag that disagrees. Branches follow git-flow: `develop` integrates, `main` holds released commits only, and `release/X.Y` lives for one release — cut from `develop` for a new `X.Y`, or from the line's latest tag for a patch, and deleted once the release is out.

```bash
VERSION=7.0.1                                       # what is being released: the SDK release it ships
BRANCH=release/$(echo "$VERSION" | cut -d. -f1,2)   # release/7.0
```

### 1. Branch

A new `X.Y` is cut from `develop`. A patch release is cut from the line's latest tag, whether or not an earlier `release/X.Y` is still there, and its fixes are committed or cherry-picked onto it.

```bash
git fetch origin
git switch -c "$BRANCH" origin/develop           # a new X.Y
git switch -C "$BRANCH" v7.0.0                   # a patch release: the line's latest tag
```

### 2. SDK, version and changelog

In one commit. Pin the SDK release in both places it is read from: `scripts/SDK_VERSION.txt`, the tag `download-sdk` installs the Brain by, and the `SpriteStudio-SDK` submodule, which the host checks build against. When the SDK's `.fbs` schemas changed, regenerate `cpp/format/`. Then set the package's `version` to the same release, and date the version's heading in `CHANGELOG.md` as `## [X.Y.Z] - YYYY-MM-DD`, adding the heading on a patch release.

```bash
printf 'v%s\n' "$VERSION" > scripts/SDK_VERSION.txt
git -C SpriteStudio-SDK fetch --tags origin && git -C SpriteStudio-SDK checkout "v$VERSION"
pnpm run generate-fbs-code                       # only when the SDK's schema changed
# set "version" in packages/react-native-spritestudio/package.json and date the heading in CHANGELOG.md, then:
git add scripts/SDK_VERSION.txt SpriteStudio-SDK packages/react-native-spritestudio CHANGELOG.md
git commit -m "chore(release): v$VERSION"
```

### 3. Pull request, QA build and a look on a device

Open the pull request into `main`, then dispatch the release workflow from the branch. With `upload_release` left false it runs `scripts/build-release.sh` on macOS — the pinned Brain, the generated code, the typecheck and the host checks, `prepack`, and the tarball opened and checked again — keeps the result on the run (`react-native-spritestudio-release-dist`), and uploads nothing. Fix anything on the branch and repeat until it is green.

```bash
git push -u origin "$BRANCH"
gh pr create -B main --title "Release v$VERSION" --body ""
gh workflow run release.yml --ref "$BRANCH"
gh run watch                                      # the run takes a few seconds to appear
```

Drawing on a device has no check in CI. Look at it on the branch, on iOS and on Android — the two diverge — with the example app ([CONTRIBUTING.md](./CONTRIBUTING.md) sets it up):

```bash
pnpm run run-ios && pnpm run run-android
```

### 4. Merge and tag

Merge with a merge commit, never a squash or a rebase, so that `main` keeps the commits the QA build built rather than copies of them. Tag `main` only when its tree is the one the QA build built. It differs only when `main` held commits the branch did not; merge `main` into the branch and go back to step 3.

```bash
gh pr merge "$BRANCH" --merge
git switch main && git pull --ff-only
git diff --stat HEAD^2 HEAD                       # must print nothing
TAG="v$(node -p "require('./packages/react-native-spritestudio/package.json').version")" && echo "$TAG"
git tag -a "$TAG" -m "$TAG" && git push origin "$TAG"
```

### 5. Build the Release

Dispatch from the tag. The run builds and checks again, publishes the tarball it checked to npm — under `publishConfig.tag`, which keeps `latest` off a beta — and creates a **draft** Release carrying the tarball, `SHA256SUMS` and generated notes. **The npm publish is permanent the moment it runs.** Until npm can take the package, add `-f publish_npm=false`: the Release is drafted alone, and a later dispatch from the same tag without it publishes to npm.

```bash
gh workflow run release.yml --ref "$TAG" -f upload_release=true
gh run watch
```

`upload_release=true` from anything but a `v*` tag, or from a tag that does not match the package version, fails the run rather than skipping the Release quietly.

### 6. Publish

Open the draft on the [Releases](https://github.com/cri-middleware/SSPlayerForReactNative/releases) page and check the attachments: `react-native-spritestudio-X.Y.Z.tgz` and `SHA256SUMS`. Edit the notes, choose **Set as a pre-release** or **Set as the latest release** (a tag with a `-` can be either), and **Publish release**. Publishing also starts `pages.yml`, which deploys the [documentation site](https://cri-middleware.github.io/SSPlayerForReactNative/). Watch the run through, then open the site: a failed run leaves the Release published and the site as it was. Once the cause is fixed, re-run it; a re-run builds the same tag.

```bash
gh run watch                                      # pages.yml; the run takes a few seconds to appear
```

### 7. Merge back

Merge `main` into `develop`. After a patch release this conflicts where `develop` has moved on: keep `develop`'s version and its `Unreleased` heading, with the patch's section below it.

```bash
git switch develop && git pull --ff-only
git merge --no-ff main && git push origin develop
git push origin --delete "$BRANCH"
```

If the button on its pull request already deleted the release branch, the last line only reports that the branch does not exist. Nothing needs it afterwards: a patch release cuts it again from the tag.

## Undoing a release

**A version on npm is permanent**, so once step 5 has published, a fault is fixed by a new patch version. Before that — or when step 5 ran with `publish_npm=false` — it can be undone: delete the draft, run `git push origin ":refs/tags/$TAG" && git tag -d "$TAG"`, fix it on the branch — restore it from its pull request if it was deleted — and go back to step 3. A run that failed for a transient reason is dispatched again from the same tag; it skips what npm and the Releases already have.

## Building the release locally

`scripts/build-release.sh` is the release build, and `release.yml` runs exactly this script: the tarball into `release-dist/npm/`, opened and checked, with `SHA256SUMS` over it. It publishes nothing.

```bash
pnpm run build-release
```

It runs anywhere, but off macOS it skips `check-mask` and `check-shader`, which link the macOS-only host `libskia`. **`sdk=build` cannot pack**: `prepack` refuses a Brain that is not the pinned release, so that mode rehearses everything and reports the file list instead of producing a tarball. `pnpm run release` publishes from this machine and is not part of this procedure: it tags nothing and drafts no Release.

<br>

---

# SpriteStudio Player for React Native のリリース手順

維持者向けです。コントリビューターがこの手順を実行することはありません（[CONTRIBUTING.md](./CONTRIBUTING.md) を参照してください）。

## リリースの手順

このリポジトリの Write ロールを持つ人なら誰でもリリースできます。どの手順もブランチ・プルリクエスト・タグ・ワークフローの実行・Release のいずれかで、端末で描画を見る部分を除けば、誰の手元で実行しても結果は変わりません。必要なのは `git`、`gh`（最初に一度 `gh auth login`）、Node.js、pnpm です。コマンドは bash で書いています。Windows では Git Bash で実行してください。

リリースは `main` 上のタグです。先にタグを push し、ビルドはその後です。バージョンは `packages/react-native-spritestudio/package.json` の `version` で、**SDK とロックステップ**です。`scripts/SDK_VERSION.txt` がビルド対象の SpriteStudio-SDK のリリースを固定し、パッケージも同じバージョンを名乗ります。タグはその頭に `v` を付けたもので、食い違うタグはリリースビルドが拒否します。ブランチは git-flow です。`develop` が統合ブランチで、`main` にはリリース済みのコミットだけが入ります。`release/X.Y` は 1 回のリリースの間だけ使います。新しい `X.Y` なら `develop` から、パッチならその系統の最新のタグから切り、リリースが済んだら消します。

```bash
VERSION=7.0.1                                       # リリースするバージョン（同梱する SDK のリリース）
BRANCH=release/$(echo "$VERSION" | cut -d. -f1,2)   # release/7.0
```

### 1. ブランチ

新しい `X.Y` は `develop` から切ります。パッチリリースは、以前の `release/X.Y` が残っているかどうかに関係なく、その系統の最新のタグから切り、修正をそこへコミットするか cherry-pick します。

```bash
git fetch origin
git switch -c "$BRANCH" origin/develop           # 新しい X.Y
git switch -C "$BRANCH" v7.0.0                   # パッチリリース: その系統の最新のタグ
```

### 2. SDK、バージョン、CHANGELOG

1 コミットで行います。SDK のリリースを、読まれる 2 か所の両方で固定します。`download-sdk` が Brain を導入するときに使うタグ `scripts/SDK_VERSION.txt` と、ホストチェックがビルドに使う `SpriteStudio-SDK` submodule です。SDK の `.fbs` スキーマが変わったときは `cpp/format/` を生成し直します。続けてパッケージの `version` を同じリリースに合わせ、`CHANGELOG.md` のそのバージョンの見出しに日付を入れて `## [X.Y.Z] - YYYY-MM-DD` とします。パッチリリースでは見出しを足します。

```bash
printf 'v%s\n' "$VERSION" > scripts/SDK_VERSION.txt
git -C SpriteStudio-SDK fetch --tags origin && git -C SpriteStudio-SDK checkout "v$VERSION"
pnpm run generate-fbs-code                       # SDK のスキーマが変わったときだけ
# packages/react-native-spritestudio/package.json の "version" を設定し、CHANGELOG.md の見出しに日付を入れてから:
git add scripts/SDK_VERSION.txt SpriteStudio-SDK packages/react-native-spritestudio CHANGELOG.md
git commit -m "chore(release): v$VERSION"
```

### 3. プルリクエスト、QA ビルド、端末での確認

`main` へのプルリクエストを作り、ブランチからリリースワークフローを実行します。`upload_release` を false のままにすると、macOS で `scripts/build-release.sh` を実行し（ピンした Brain、生成コード、型チェックとホストチェック、`prepack`、そして完成した tarball を開き直しての検査）、結果を run に残して（`react-native-spritestudio-release-dist`）、何もアップロードしません。問題があればブランチで直し、緑になるまで繰り返します。

```bash
git push -u origin "$BRANCH"
gh pr create -B main --title "Release v$VERSION" --body ""
gh workflow run release.yml --ref "$BRANCH"
gh run watch                                      # run が一覧に出るまで数秒かかる
```

端末での描画には CI の検査がありません。ブランチ上で、iOS と Android の両方で確かめます（両者は挙動が分かれます）。使うのは example アプリです（準備は [CONTRIBUTING.md](./CONTRIBUTING.md)）。

```bash
pnpm run run-ios && pnpm run run-android
```

### 4. マージとタグ

マージはマージコミットで行い、squash や rebase は使いません。QA ビルドしたコミットの写しではなく、そのものを `main` に残すためです。タグは、`main` のツリーが QA ビルドしたものと同じときにだけ打ちます。違うのは `main` にブランチが持たないコミットがあった場合だけで、そのときは `main` をブランチへマージして手順 3 に戻ります。

```bash
gh pr merge "$BRANCH" --merge
git switch main && git pull --ff-only
git diff --stat HEAD^2 HEAD                       # 何も出力されないこと
TAG="v$(node -p "require('./packages/react-native-spritestudio/package.json').version")" && echo "$TAG"
git tag -a "$TAG" -m "$TAG" && git push origin "$TAG"
```

### 5. Release のビルド

タグからワークフローを実行します。もう一度ビルドして検査し、検査した tarball を npm へ publish し（`publishConfig.tag` に従うので、ベータに `latest` は付きません）、tarball と `SHA256SUMS`、自動生成のリリースノート付きで**下書き**の Release を作ります。**npm への publish は、走った時点で恒久的です。** npm に出せるようになるまでは `-f publish_npm=false` を付けます。Release の下書きだけが作られ、あとで同じタグからこれを付けずに実行すれば npm にも出ます。

```bash
gh workflow run release.yml --ref "$TAG" -f upload_release=true
gh run watch
```

`v*` タグ以外からの `upload_release=true` と、パッケージのバージョンと食い違うタグからの実行は、Release を黙って飛ばさずに実行を失敗させます。

### 6. 公開

[Releases](https://github.com/cri-middleware/SSPlayerForReactNative/releases) ページで下書きを開き、添付を確かめます。`react-native-spritestudio-X.Y.Z.tgz` と `SHA256SUMS` です。リリースノートを編集し、**Set as a pre-release** か **Set as the latest release** を選んで（`-` を含むタグはどちらも選べます）、**Publish release** を押します。公開すると `pages.yml` が動き、[ドキュメントサイト](https://cri-middleware.github.io/SSPlayerForReactNative/) をデプロイします。run を最後まで見届けてから、サイトを開いて確かめます。run が失敗しても Release は公開されたままで、サイトは元のまま残ります。原因を直したら run を再実行します。再実行は同じタグをビルドします。

```bash
gh run watch                                      # pages.yml。run が一覧に出るまで数秒かかる
```

### 7. develop へ戻す

`main` を `develop` へマージします。パッチリリースの後は、`develop` が先へ進んだ箇所で衝突します。`develop` のバージョンと `Unreleased` の見出しを残し、パッチの節をその下に置いてください。

```bash
git switch develop && git pull --ff-only
git merge --no-ff main && git push origin develop
git push origin --delete "$BRANCH"
```

プルリクエストのページのボタンでリリースブランチを消してあれば、最後の行は「ブランチが無い」と出るだけです。パッチリリースはタグから切り直すので、この後ブランチが要ることはありません。

## リリースの取り消し

**npm のバージョンは恒久的です。** 手順 5 で publish した後に見つかった不具合は、新しいパッチバージョンで直します。それより前なら（あるいは手順 5 を `publish_npm=false` で実行したなら）取り消せます。下書きを消し、`git push origin ":refs/tags/$TAG" && git tag -d "$TAG"` を実行し、ブランチで直して（消していたらプルリクエストのページから復元して）手順 3 に戻ります。一時的な理由で失敗した run は、同じタグでもう一度実行します。npm と Release にすでにあるものは飛ばします。

## リリースのローカルビルド

`scripts/build-release.sh` がリリースのビルドそのもので、`release.yml` はこのスクリプトを実行しているだけです。tarball を `release-dist/npm/` に作り、開き直して検査し、`SHA256SUMS` を付けます。何も publish しません。

```bash
pnpm run build-release
```

どの OS でも動きますが、macOS 以外では `check-mask` と `check-shader` を飛ばします（macOS 専用のホスト `libskia` をリンクするため）。**`sdk=build` では pack できません。** `prepack` がピンしたリリース以外の Brain を拒否するため、このモードは一通りリハーサルしてファイル一覧を報告するだけになります。`pnpm run release` は手元から publish するもので、この手順には含まれません。タグも打たず、Release の下書きも作りません。
