# Releasing SpriteStudio Player for React Native

Maintainers only. Contributors do not run any of this — see [CONTRIBUTING.md](./CONTRIBUTING.md).

## Cutting a release

Anyone with the Write role on this repository can cut a release: every step is a branch, a pull request, a tag, a workflow run or a Release, so nothing depends on whose machine runs it beyond looking at the drawing on a device. You need `git`, `gh` (run `gh auth login` once), Node.js and pnpm, and for step 6, `npm` signed in to an account that can publish `react-native-spritestudio`. The repository needs GitHub Pages enabled with GitHub Actions as its source, and a `v*` tag rule on its `github-pages` environment, or publishing a Release deploys nothing; both are settings a repository admin makes. The package on npm needs a trusted publisher for this repository's `release.yml`, allowed to stage. npm sets one up only for a package it already has, so the package's first version goes out by hand (step 6). The commands are bash: in zsh, run `setopt interactive_comments` first, so that the `#` comments are not taken as arguments; on Windows, use Git Bash.

Both workflow runs, the QA build in step 3 and the Release in step 5, can run on a Mac instead: besides converting the example packs, the workflow runs nothing but the scripts those steps name. They run the host checks, so that route needs what those need besides: Rust, to build a host Brain, `flatc`, and the example packs `pnpm run deploy-examples` converts ([CONTRIBUTING.md](./CONTRIBUTING.md) lists the checks).

A release is a tag on `main`, pushed first and built second. The version is `version` in `packages/react-native-spritestudio/package.json`, and it is **lockstep with the SDK**: `scripts/SDK_VERSION.txt` pins the SpriteStudio-SDK release the package is built against, and the package carries the same version. The tag is `v` followed by it, and the release build refuses a tag that disagrees. Branches follow git-flow: `develop` integrates, `main` holds released commits only, and `release/X.Y` lives for one release — cut from `develop` for a new `X.Y`, or from the line's latest tag for a patch, and deleted once the release is out.

```bash
VERSION=<version>
BRANCH=release/$(echo "${VERSION:?}" | cut -d. -f1,2)
```

`<version>` is the version being released, which is the SDK release it ships, as in `7.0.1`: fill it in. Left as it is, the line stops with a syntax error. Later blocks read these two and the `TAG` step 4 sets, so a new shell needs them set again. Where an empty variable would not stop a command by itself, the command refuses one: an empty `VERSION` in step 2 writes a bare `v` into `scripts/SDK_VERSION.txt`.

### 1. Branch

A new `X.Y` is cut from `develop`. A patch release is cut from the line's latest tag, whether or not an earlier `release/X.Y` is still there, and its fixes are committed or cherry-picked onto it.

For a new `X.Y`:

```bash
git fetch origin
git switch -c "${BRANCH:?}" origin/develop
```

For a patch:

```bash
git fetch origin --tags
BASE=$(git -c versionsort.suffix=- tag --list "v${BRANCH#release/}.*" --sort=-v:refname | head -n 1)   # the line's latest tag
git switch -C "${BRANCH:?}" "${BASE:?}"
```

### 2. SDK, version and changelog

In one commit. Pin the SDK release in both places it is read from: `scripts/SDK_VERSION.txt`, the tag `download-sdk` installs the Brain by, and the `SpriteStudio-SDK` submodule, which the host checks build against. When the SDK's `.fbs` schemas changed, regenerate `cpp/format/`. Then set the package's `version` to the same release, and date the version's heading in `CHANGELOG.md` as `## [X.Y.Z] - YYYY-MM-DD`, adding the heading on a patch release.

```bash
printf 'v%s\n' "${VERSION:?}" > scripts/SDK_VERSION.txt
git -C SpriteStudio-SDK fetch --tags origin && git -C SpriteStudio-SDK checkout "v$VERSION"
pnpm run generate-fbs-code                       # only when the SDK's schema changed
# set "version" in packages/react-native-spritestudio/package.json and date the heading in CHANGELOG.md, then:
git add scripts/SDK_VERSION.txt SpriteStudio-SDK packages/react-native-spritestudio CHANGELOG.md
git commit -m "chore(release): v${VERSION:?}"
```

### 3. Pull request, QA build and a look on a device

Open the pull request into `main`, then dispatch the release workflow from the branch. From a branch it runs `scripts/build-release.sh` on macOS — the pinned Brain, the generated code, the typecheck and the host checks, `prepack`, and the tarball opened and checked again — keeps the result on the run (`react-native-spritestudio-release-dist`), and uploads nothing. Fix anything on the branch and repeat until it is green.

```bash
git push -u origin "$BRANCH"
gh pr create -B main --title "Release v${VERSION:?}" --body ""
gh workflow run release.yml --ref "${BRANCH:?}"
RUN=$(gh run list -w release.yml -c "$(git rev-parse HEAD)" -L 1 --json databaseId -q '.[0].databaseId')
gh run watch "$RUN" --exit-status                 # RUN is empty, or an earlier run, for the few seconds before the run appears
```

On a Mac, `pnpm run build-release` on the branch is the same build, into `release-dist/` ([Building the release locally](#building-the-release-locally)).

Drawing on a device has no check in CI. Look at it on the branch, on iOS and on Android — the two diverge — with the example app ([CONTRIBUTING.md](./CONTRIBUTING.md) sets it up):

```bash
pnpm run run-ios && pnpm run run-android
```

Last, scan the branch for code copied from others. `scripts/scan-snippets.sh` matches the files tracked at `HEAD` against public open-source code with SCANOSS, sending their fingerprints rather than the code; it writes its report to `qa/scanoss-<commit>.json` and prints the matches. It runs on this machine, and needs Python 3: SCANOSS's free service limits calls per address, and GitHub's runners share addresses it has often limited already. `provenance.yml` runs ScanCode, which finds copyright and license notices, and keeps its report and a summary on the run (`provenance`); the block downloads them into `qa/<run ID>` and prints the summary. **A person sorts the matches.** A match with the earlier SpriteStudio Players and SDK is our own code. A match with a library this repository bundles must be listed in `THIRD_PARTY_NOTICES.md`. Anything else is rewritten, unless its license, read at its source, is compatible with BSD-3-Clause and the code keeps the notice that license asks for. After any change on the branch, run the block again.

```bash
git push origin "$BRANCH" &&
  gh workflow run provenance.yml --ref "${BRANCH:?}" &&
  scripts/scan-snippets.sh &&
  RUN=$(gh run list -w provenance.yml -c "$(git rev-parse HEAD)" -L 1 --json databaseId -q '.[0].databaseId') &&
  gh run watch "${RUN:?}" --exit-status &&
  gh run download "$RUN" -n provenance -D "qa/$RUN" &&
  cat "qa/$RUN/summary.md"
```

### 4. Merge and tag

Merge with a merge commit, never a squash or a rebase, so that `main` keeps the commits the QA build built rather than copies of them. Tag `main` only when its tree is the one the QA build built. It differs only when `main` held commits the branch did not; merge `main` into the branch and go back to step 3.

```bash
gh pr merge "${BRANCH:?}" --merge
git switch main && git pull --ff-only
git diff --stat HEAD^2 HEAD                       # must print nothing
TAG="v$(node -p "require('./packages/react-native-spritestudio/package.json').version")" && echo "$TAG"
git tag -a "$TAG" -m "$TAG" && git push origin "$TAG"
```

### 5. Build the Release

Dispatch from the tag. The run builds and checks again with `scripts/release.sh`, and creates a **draft** Release carrying the tarball it checked, `SHA256SUMS` and generated notes; nothing is public yet.

```bash
gh workflow run release.yml --ref "${TAG:?}" -f upload_release=true
RUN=$(gh run list -w release.yml -c "$(git rev-parse "$TAG^{}")" -L 1 --json databaseId -q '.[0].databaseId')
gh run watch "$RUN" --exit-status                 # RUN is empty, or an earlier run, for the few seconds before the run appears
```

A tag that does not match the package version fails the run. A tag that already has a Release, draft or published, keeps it as it is, so delete a draft before dispatching again ([Undoing a release](#undoing-a-release)). The run then stages the tarball on npm, under the dist-tag `scripts/npm-dist-tag.sh` picks, where it waits for step 6. A version npm cannot stage yet — the package's first — is dispatched with `-f publish_npm=false` added, and step 6 publishes it by hand. The two inputs are independent: `-f upload_release=false` stages on npm without touching the Release, and with both off a run from the tag only builds.

On a Mac, the same script makes the same draft without the workflow, and stages nothing: step 6 publishes by hand. It refuses anything but a clean checkout of the tag that `origin` has, and requires `flatc`, so that no check is skipped.

```bash
git switch --detach "$TAG" && pnpm run release
```

### 6. Approve on npm

Open the draft on the [Releases](https://github.com/cri-middleware/SSPlayerForReactNative/releases) page and check the attachments: `react-native-spritestudio-X.Y.Z.tgz` and `SHA256SUMS`. Look inside the tarball first: until npm makes the version public, a fault is undone by deleting the draft and rejecting what was staged (see [Undoing a release](#undoing-a-release)), and after it, only a new version fixes it. Approve before the Release is published, so that by the time the Release announces the version, `npm install` finds it; approving applies the dist-tag it was staged under. Approving asks for a 2FA code, and `npm login` and that code take a person at the terminal: an AI agent cutting the release hands this step over.

```bash
npm login                                         # once
dir=$(mktemp -d) && gh release download "${TAG:?}" -D "$dir"
tar -tzf "$dir"/*.tgz                             # what npm will carry
npm stage list react-native-spritestudio          # the staged version, with its stage id
npm stage approve <stage-id>
npm view react-native-spritestudio dist-tags      # the version just approved, under its dist-tag
```

A release the run did not stage — the package's first, one dispatched with `publish_npm=false`, one cut on a Mac, or one whose **Stage on npm** failed — is published by hand instead, from the same tarball. `scripts/npm-dist-tag.sh` picks the dist-tag: `latest` for a full release, and for a prerelease while the package's `latest` is not yet a full release; the prerelease's word (`beta`, `rc`) after that. Until npm can take the package, skip this: the Release alone carries the tarball, and these lines publish it from there later.

```bash
dir=$(mktemp -d) && gh release download "${TAG:?}" -D "$dir"
dist=$(scripts/npm-dist-tag.sh react-native-spritestudio "${TAG#v}")
npm publish "$dir"/*.tgz --tag "${dist:?}"
npm view react-native-spritestudio dist-tags      # the version just published, under its dist-tag
```

### 7. Publish the Release

Edit the notes, choose **Set as a pre-release** or **Set as the latest release** (a tag with a `-` can be either), and **Publish release**. Publishing also starts `pages.yml`, which deploys the [documentation site](https://cri-middleware.github.io/SSPlayerForReactNative/). Watch the run through, then open the site: a failed run leaves the Release published and the site as it was. Once the cause is fixed, re-run it; a re-run builds the same tag.

```bash
RUN=$(gh run list -w pages.yml -c "$(git rev-parse "$TAG^{}")" -L 1 --json databaseId -q '.[0].databaseId')
gh run watch "$RUN" --exit-status                 # RUN is empty, or an earlier run, for the few seconds before the run appears
```

### 8. Merge back

Merge `main` into `develop`. After a patch release this conflicts where `develop` has moved on: keep `develop`'s version and its `Unreleased` heading, with the patch's section below it.

```bash
git switch develop && git pull --ff-only
git merge --no-ff main && git push origin develop
git push origin --delete "$BRANCH"
```

If the button on its pull request already deleted the release branch, the last line only reports that the branch does not exist. Nothing needs it afterwards: a patch release cuts it again from the tag.

## Undoing a release

Until step 6 makes the version public on npm, a release can be undone. A run that failed for a transient reason is run again from the same tag — the workflow or `pnpm run release` — once any draft it left is deleted; a version it had already staged is skipped. A fault that needs new commits takes the tag down too: delete the draft, reject what was staged with `npm stage reject <stage-id>` (a person, with 2FA), run `git push origin ":refs/tags/$TAG" && git tag -d "$TAG"`, fix it on the branch — restore it from its pull request if it was deleted — and go back to step 3.

**A version npm has made public is permanent**, whether approved or published by hand: it cannot be withdrawn, only superseded. So is a published Release, whose file users have downloaded by its tag. A fault found after either is fixed by a new patch version. A version that is only staged is not public yet, and rejecting it removes it.

## Building the release locally

`scripts/build-release.sh` is the release build: the tarball into `release-dist/npm/`, opened and checked, with `SHA256SUMS` over it. It publishes nothing. `release.yml` runs it for the QA build, and `pnpm run release` (step 5) is the same run with the draft Release on the end.

```bash
pnpm run build-release
```

It runs anywhere, but off macOS it skips `check-mask` and `check-shader`, which link the macOS-only host `libskia`, and without `flatc` it skips what needs it — which is why `pnpm run release` runs only on macOS, and only with `flatc`. **`sdk=build` cannot pack**: `prepack` refuses a Brain that is not the pinned release, so that mode rehearses everything and reports the file list instead of producing a tarball.

<br>

---

# SpriteStudio Player for React Native のリリース手順

維持者向けです。コントリビューターがこの手順を実行することはありません（[CONTRIBUTING.md](./CONTRIBUTING.md) を参照してください）。

## リリースの手順

このリポジトリの Write ロールを持つ人なら誰でもリリースできます。どの手順もブランチ・プルリクエスト・タグ・ワークフローの実行・Release のいずれかで、端末で描画を見る部分を除けば、誰の手元で実行しても結果は変わりません。必要なのは `git`、`gh`（最初に一度 `gh auth login`）、Node.js、pnpm、それに手順 6 のための `npm` で、`react-native-spritestudio` に publish できるアカウントでログインしておきます。リポジトリ側では、GitHub Pages を有効にしてソースを GitHub Actions にし、`github-pages` environment に `v*` のタグのルールを足しておく必要があります。どちらかが欠けると、Release を公開しても何もデプロイされません。どちらもリポジトリの admin が行う設定です。npm 側では、パッケージに、このリポジトリの `release.yml` を trusted publisher として登録し、stage を許可しておきます。npm はすでにあるパッケージにしか trusted publisher を設定できないので、パッケージの最初のバージョンは手作業で出します（手順 6）。コマンドは bash です。zsh では、`#` のコメントが引数として渡されないよう、先に `setopt interactive_comments` を実行します。Windows では Git Bash を使います。

ワークフローの 2 つの実行、手順 3 の QA ビルドと手順 5 の Release は、どちらも代わりに Mac の手元で実行できます。ワークフローが実行するのは、サンプルパックの変換を除けば、その手順が名前を挙げるスクリプトだけだからです。それらのスクリプトはホストチェックを実行するので、この経路にはその検査に要るもの、つまりホスト用の Brain をビルドする Rust と `flatc`、それに `pnpm run deploy-examples` で変換したサンプルパックも必要です（検査の一覧は [CONTRIBUTING.md](./CONTRIBUTING.md) にあります）。

リリースは `main` 上のタグです。先にタグを push し、ビルドはその後です。バージョンは `packages/react-native-spritestudio/package.json` の `version` で、**SDK とロックステップ**です。`scripts/SDK_VERSION.txt` がビルド対象の SpriteStudio-SDK のリリースを固定し、パッケージも同じバージョンを名乗ります。タグはその頭に `v` を付けたもので、食い違うタグはリリースビルドが拒否します。ブランチは git-flow です。`develop` が統合ブランチで、`main` にはリリース済みのコミットだけが入ります。`release/X.Y` は 1 回のリリースの間だけ使います。新しい `X.Y` なら `develop` から、パッチならその系統の最新のタグから切り、リリースが済んだら消します。

```bash
VERSION=<version>
BRANCH=release/$(echo "${VERSION:?}" | cut -d. -f1,2)
```

`<version>` にはリリースするバージョン、つまり同梱する SDK のリリース（`7.0.1` など）を入れます。そのままだと、その行は構文エラーで止まります。後のブロックはこの 2 つと、手順 4 で設定する `TAG` を使います。新しいシェルでは設定し直してください。変数が空でも止まらないコマンドは、空のときに実行を拒否します。手順 2 の `VERSION` が空だと `scripts/SDK_VERSION.txt` に `v` だけが書かれるためです。

### 1. ブランチ

新しい `X.Y` は `develop` から切ります。パッチリリースは、以前の `release/X.Y` が残っているかどうかに関係なく、その系統の最新のタグから切り、修正をそこへコミットするか cherry-pick します。

新しい `X.Y` のとき:

```bash
git fetch origin
git switch -c "${BRANCH:?}" origin/develop
```

パッチのとき:

```bash
git fetch origin --tags
BASE=$(git -c versionsort.suffix=- tag --list "v${BRANCH#release/}.*" --sort=-v:refname | head -n 1)   # その系統の最新のタグ
git switch -C "${BRANCH:?}" "${BASE:?}"
```

### 2. SDK、バージョン、CHANGELOG

1 コミットで行います。SDK のリリースを、読まれる 2 か所の両方で固定します。`download-sdk` が Brain を導入するときに使うタグ `scripts/SDK_VERSION.txt` と、ホストチェックがビルドに使う `SpriteStudio-SDK` submodule です。SDK の `.fbs` スキーマが変わったときは `cpp/format/` を生成し直します。続けてパッケージの `version` を同じリリースに合わせ、`CHANGELOG.md` のそのバージョンの見出しに日付を入れて `## [X.Y.Z] - YYYY-MM-DD` とします。パッチリリースでは見出しを足します。

```bash
printf 'v%s\n' "${VERSION:?}" > scripts/SDK_VERSION.txt
git -C SpriteStudio-SDK fetch --tags origin && git -C SpriteStudio-SDK checkout "v$VERSION"
pnpm run generate-fbs-code                       # SDK のスキーマが変わったときだけ
# packages/react-native-spritestudio/package.json の "version" を設定し、CHANGELOG.md の見出しに日付を入れてから:
git add scripts/SDK_VERSION.txt SpriteStudio-SDK packages/react-native-spritestudio CHANGELOG.md
git commit -m "chore(release): v${VERSION:?}"
```

### 3. プルリクエスト、QA ビルド、端末での確認

`main` へのプルリクエストを作り、ブランチからリリースワークフローを実行します。ブランチからの実行では、macOS で `scripts/build-release.sh` を実行し（ピンした Brain、生成コード、型チェックとホストチェック、`prepack`、そして完成した tarball を開き直しての検査）、結果を run に残して（`react-native-spritestudio-release-dist`）、何もアップロードしません。問題があればブランチで直し、緑になるまで繰り返します。

```bash
git push -u origin "$BRANCH"
gh pr create -B main --title "Release v${VERSION:?}" --body ""
gh workflow run release.yml --ref "${BRANCH:?}"
RUN=$(gh run list -w release.yml -c "$(git rev-parse HEAD)" -L 1 --json databaseId -q '.[0].databaseId')
gh run watch "$RUN" --exit-status                 # run が一覧に出るまでの数秒間は、RUN が空か前の run になる
```

Mac では、ブランチ上で `pnpm run build-release` を実行すれば同じビルドが `release-dist/` にできます（[リリースのローカルビルド](#リリースのローカルビルド)）。

端末での描画には CI の検査がありません。ブランチ上で、iOS と Android の両方で確かめます（両者は挙動が分かれます）。使うのは example アプリです（準備は [CONTRIBUTING.md](./CONTRIBUTING.md)）。

```bash
pnpm run run-ios && pnpm run run-android
```

最後に、他者のコードを写した箇所が無いかを、ブランチで照合します。`scripts/scan-snippets.sh` は、`HEAD` で追跡しているファイルを、SCANOSS で公開されているオープンソースのコードと照合します。送るのはコードではなく指紋です。報告を `qa/scanoss-<commit>.json` に書き、一致を表示します。このスクリプトは手元で実行し、Python 3 が要ります。SCANOSS の無料のサービスはアドレスごとに回数を制限していて、GitHub のランナーはすでに制限されたアドレスを共有していることが多いためです。`provenance.yml` は ScanCode で著作権表示とライセンスの記述を見つけ、報告と一覧を run に残します（`provenance`）。ブロックはそれを `qa/<run ID>` にダウンロードし、一覧を表示します。**一致は人が仕分けます。** 以前の SpriteStudio の Player・SDK との一致は、自社のコードです。このリポジトリが同梱するライブラリとの一致は、`THIRD_PARTY_NOTICES.md` に載っていなければなりません。それ以外は書き直します。残せるのは、出所で確かめたライセンスが BSD-3-Clause と両立し、そのライセンスが求める表示をコードに残すときだけです。ブランチを変えたら、このブロックをもう一度実行します。

```bash
git push origin "$BRANCH" &&
  gh workflow run provenance.yml --ref "${BRANCH:?}" &&
  scripts/scan-snippets.sh &&
  RUN=$(gh run list -w provenance.yml -c "$(git rev-parse HEAD)" -L 1 --json databaseId -q '.[0].databaseId') &&
  gh run watch "${RUN:?}" --exit-status &&
  gh run download "$RUN" -n provenance -D "qa/$RUN" &&
  cat "qa/$RUN/summary.md"
```

### 4. マージとタグ

マージはマージコミットで行い、squash や rebase は使いません。QA ビルドしたコミットの写しではなく、そのものを `main` に残すためです。タグは、`main` のツリーが QA ビルドしたものと同じときにだけ打ちます。違うのは `main` にブランチが持たないコミットがあった場合だけで、そのときは `main` をブランチへマージして手順 3 に戻ります。

```bash
gh pr merge "${BRANCH:?}" --merge
git switch main && git pull --ff-only
git diff --stat HEAD^2 HEAD                       # 何も出力されないこと
TAG="v$(node -p "require('./packages/react-native-spritestudio/package.json').version")" && echo "$TAG"
git tag -a "$TAG" -m "$TAG" && git push origin "$TAG"
```

### 5. Release のビルド

タグからワークフローを実行します。run は `scripts/release.sh` でもう一度ビルドして検査し、検査した tarball と `SHA256SUMS`、自動生成のリリースノート付きで**下書き**の Release を作ります。まだ何も公開されていません。

```bash
gh workflow run release.yml --ref "${TAG:?}" -f upload_release=true
RUN=$(gh run list -w release.yml -c "$(git rev-parse "$TAG^{}")" -L 1 --json databaseId -q '.[0].databaseId')
gh run watch "$RUN" --exit-status                 # run が一覧に出るまでの数秒間は、RUN が空か前の run になる
```

パッケージのバージョンと食い違うタグからの実行は失敗します。Release がすでにあるタグでは、下書きでも公開済みでも、その Release に触れないので、もう一度実行するときは先に下書きを消します（[リリースの取り消し](#リリースの取り消し)）。run は続けて、`scripts/npm-dist-tag.sh` が決める dist-tag で tarball を npm に stage します。stage したものは手順 6 を待ちます。npm がまだ stage できないバージョン（パッケージの最初のバージョン）は、`-f publish_npm=false` を足して実行し、手順 6 で手作業で publish します。2 つの入力は独立しています。`-f upload_release=false` なら Release に触れずに npm にだけ stage し、両方を外せばタグからの実行でもビルドだけを行います。

Mac では、同じスクリプトがワークフロー無しで同じ下書きを作ります。npm には何も stage しないので、手順 6 で手作業で publish します。`origin` にあるタグをそのままチェックアウトした、変更の無い作業ツリーでしか動きません。検査を 1 つも飛ばさないよう、`flatc` も必須です。

```bash
git switch --detach "$TAG" && pnpm run release
```

### 6. npm で承認する

[Releases](https://github.com/cri-middleware/SSPlayerForReactNative/releases) ページで下書きを開き、添付を確かめます。`react-native-spritestudio-X.Y.Z.tgz` と `SHA256SUMS` です。先に tarball の中身を確かめます。npm でバージョンが公開されるまでなら、下書きを消して stage したものを取り下げれば取り消せますが（「[リリースの取り消し](#リリースの取り消し)」を参照）、公開した後は新しいバージョンでしか直せません。Release を公開するよりも先に承認し、Release がバージョンを告知する時点で、`npm install` がそのバージョンを見つけられるようにします。承認すると、stage したときの dist-tag が付きます。承認には 2FA のコードが要ります。`npm login` とこのコードの入力は人が端末で行うもので、AI エージェントにリリースさせているときは、この手順を人に引き継ぎます。

```bash
npm login                                         # 最初に一度
dir=$(mktemp -d) && gh release download "${TAG:?}" -D "$dir"
tar -tzf "$dir"/*.tgz                             # npm に出る中身
npm stage list react-native-spritestudio          # stage されたバージョンと、その stage id
npm stage approve <stage-id>
npm view react-native-spritestudio dist-tags      # いま承認したバージョンと、その dist-tag
```

run が stage しなかったリリースは、同じ tarball を手作業で publish します。パッケージの最初のバージョン、`publish_npm=false` で実行したもの、Mac で切ったもの、**Stage on npm** が失敗したものがこれにあたります。dist-tag は `scripts/npm-dist-tag.sh` が決めます。正式版は `latest` です。プレリリースも、パッケージの `latest` がまだ正式版でなければ `latest`、正式版になった後はその語（`beta`・`rc`）です。npm に出せるようになるまでは、ここは飛ばします。tarball は Release だけが持ち、あとで同じコマンドでそこから publish できます。

```bash
dir=$(mktemp -d) && gh release download "${TAG:?}" -D "$dir"
dist=$(scripts/npm-dist-tag.sh react-native-spritestudio "${TAG#v}")
npm publish "$dir"/*.tgz --tag "${dist:?}"
npm view react-native-spritestudio dist-tags      # いま出したバージョンと、その dist-tag
```

### 7. Release を公開する

リリースノートを編集し、**Set as a pre-release** か **Set as the latest release** を選んで（`-` を含むタグはどちらも選べます）、**Publish release** を押します。公開すると `pages.yml` が動き、[ドキュメントサイト](https://cri-middleware.github.io/SSPlayerForReactNative/) をデプロイします。run を最後まで見届けてから、サイトを開いて確かめます。run が失敗しても Release は公開されたままで、サイトは元のまま残ります。原因を直したら run を再実行します。再実行は同じタグをビルドします。

```bash
RUN=$(gh run list -w pages.yml -c "$(git rev-parse "$TAG^{}")" -L 1 --json databaseId -q '.[0].databaseId')
gh run watch "$RUN" --exit-status                 # run が一覧に出るまでの数秒間は、RUN が空か前の run になる
```

### 8. develop へ戻す

`main` を `develop` へマージします。パッチリリースの後は、`develop` が先へ進んだ箇所で衝突します。`develop` のバージョンと `Unreleased` の見出しを残し、パッチの節をその下に置いてください。

```bash
git switch develop && git pull --ff-only
git merge --no-ff main && git push origin develop
git push origin --delete "$BRANCH"
```

プルリクエストのページのボタンでリリースブランチを消してあれば、最後の行は「ブランチが無い」と出るだけです。パッチリリースはタグから切り直すので、この後ブランチが要ることはありません。

## リリースの取り消し

手順 6 で npm にバージョンが公開されるまでは取り消せます。一時的な理由で失敗した run は、残った下書きがあれば消してから、同じタグでもう一度実行します（ワークフローでも `pnpm run release` でも構いません）。stage 済みのバージョンは飛ばされます。新しいコミットが要る不具合ならタグも取り下げます。下書きを消し、stage したものを `npm stage reject <stage-id>` で取り下げ（人が 2FA で行います）、`git push origin ":refs/tags/$TAG" && git tag -d "$TAG"` を実行し、ブランチで直して（消していたらプルリクエストのページから復元して）手順 3 に戻ります。

**npm で公開されたバージョンは恒久的です。** 承認したものも手作業で publish したものも、取り下げられず、新しいバージョンで置き換えるしかありません。公開した Release も同じで、利用者はそのタグでファイルを取得しています。どちらかの後に見つかった不具合は、新しいパッチバージョンで直します。stage しただけのバージョンはまだ公開されておらず、取り下げれば消えます。

## リリースのローカルビルド

`scripts/build-release.sh` がリリースのビルドそのものです。tarball を `release-dist/npm/` に作り、開き直して検査し、`SHA256SUMS` を付けます。何も publish しません。`release.yml` は QA ビルドでこれを実行し、`pnpm run release`（手順 5）はこれと同じ実行の最後に Release の下書きを付けたものです。

```bash
pnpm run build-release
```

どの OS でも動きますが、macOS 以外では `check-mask` と `check-shader` を飛ばし（macOS 専用のホスト `libskia` をリンクするため）、`flatc` が無ければそれを使う検査を飛ばします。`pnpm run release` が macOS でしか動かず、`flatc` を必須にしているのはこのためです。**`sdk=build` では pack できません。** `prepack` がピンしたリリース以外の Brain を拒否するため、このモードは一通りリハーサルしてファイル一覧を報告するだけになります。
