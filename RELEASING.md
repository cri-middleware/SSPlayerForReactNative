# Releasing SpriteStudio Player for React Native

Maintainers only. Contributors do not run any of this — see [CONTRIBUTING.md](./CONTRIBUTING.md).

## Cutting a release

Anyone with the Write role on this repository can cut a release: every step is a branch, a pull request, a tag, a workflow run or a Release, so nothing depends on whose machine runs it beyond looking at the drawing on a device. You need `git`, `gh` (run `gh auth login` once), Node.js and pnpm, and for step 6, `npm` signed in to an account that can publish `react-native-spritestudio` and `react-native-spritestudio-ui`. The repository needs GitHub Pages enabled with GitHub Actions as its source, and a `v*` tag rule on its `github-pages` environment, or publishing a Release deploys nothing; both are settings a repository admin makes. Each package on npm needs a trusted publisher for this repository's `release.yml`, allowed to stage. npm sets one up only for a package it already has, so each package's first version goes out by hand (step 6). The commands are bash: in zsh, run `setopt interactive_comments` first, so that the `#` comments are not taken as arguments; on Windows, use Git Bash.

Both workflow runs, the QA build in step 3 and the Release in step 5, can run on a Mac instead: besides converting the example packs, the workflow runs nothing but the scripts those steps name. They run the host checks, so that route needs what those need besides: Rust, to build a host Brain, `flatc`, and the example packs `pnpm run deploy-examples` converts ([CONTRIBUTING.md](./CONTRIBUTING.md) lists the checks).

A release is a tag on `main`, pushed first and built second. The version is `version` in `packages/react-native-spritestudio/package.json`. `packages/react-native-spritestudio-ui/package.json` carries the same version and takes `react-native-spritestudio` at it as a peer, and the release build refuses a pair that disagrees. The SDK it ships is pinned on its own, in `scripts/SDK_VERSION.txt`. The tag is `v` followed by the version, and the release build refuses a tag that disagrees. Branches follow git-flow: `develop` integrates, `main` holds released commits only, and `release/X.Y` lives for one release — cut from `develop` when the release ships `develop`'s work, or from the line's latest tag when it ships only fixes on top of it, and deleted once the release is out.

Every block runs as written in a new shell: it works out what it needs from the checkout, git and GitHub. One value is set by hand: the version being released, written `<version>` in steps 1 and 2 — fill it in, as in `7.0.1`. Left as it is, the line stops with a syntax error. A value that would not stop a command by itself when empty is read as `${VAR:?}`: an empty `TAG` would have `gh release download` fetch the latest Release instead.

### 1. Branch

A release that ships `develop`'s work is cut from `develop`: a new `X.Y`, or `7.0.0` after `7.0.0-beta.1`. A patch release ships only fixes: it is cut from the line's latest tag, and its fixes are committed or cherry-picked onto it. Either way, an earlier `release/X.Y` that is still there is replaced. Run the block that fits.

For `develop`'s work:

```bash
VERSION=<version>
BRANCH=release/$(echo "${VERSION:?}" | cut -d. -f1,2)
git fetch origin &&
  git switch -C "$BRANCH" origin/develop
```

For a patch:

```bash
VERSION=<version>
BRANCH=release/$(echo "${VERSION:?}" | cut -d. -f1,2)
git fetch origin --tags &&
  BASE=$(git -c versionsort.suffix=- tag --list "v${BRANCH#release/}.*" --sort=-v:refname | head -n 1) &&   # the line's latest tag
  git switch -C "$BRANCH" "${BASE:?}"
```

Either way, the release ships the SpriteStudio-SDK release that `scripts/SDK_VERSION.txt` names on the branch; `cat scripts/SDK_VERSION.txt` prints it. To ship another, change the file in a commit of its own on the branch: step 3's QA build installs the Brain by it.

Then bring the dependencies up to date, in a commit of its own: `pnpm update -r` moves every workspace package to the newest versions its ranges allow, the ones a new install resolves, and the checks in step 3 run on them. A new major version changes code, and goes in an ordinary pull request into `develop` of its own rather than here.

```bash
pnpm update -r                                    # the newest versions the ranges allow
git commit -m "chore(deps): update within their ranges" -- pnpm-lock.yaml pnpm-workspace.yaml '*package.json'   # nothing to commit when nothing moved
```

### 2. Version and changelog

In one commit. Set `version` in both packages, and the UI package's `react-native-spritestudio` peer, to `<version>`, and date the version's heading in `CHANGELOG.md` as `## [X.Y.Z] - YYYY-MM-DD`, adding the heading on a patch release.

```bash
# set "version" in both packages' package.json and the -ui's react-native-spritestudio peer to <version>, and date the heading in CHANGELOG.md, then:
git add packages/react-native-spritestudio packages/react-native-spritestudio-ui CHANGELOG.md
git commit -m "chore(release): v$(node -p "require('./packages/react-native-spritestudio/package.json').version")"
```

### 3. Pull request, QA build and a look on a device

Open the pull request into `main`:

```bash
BRANCH=$(git branch --show-current | grep '^release/')
git push -u origin "${BRANCH:?}" &&
  gh pr create -B main -H "${BRANCH:?}" --title "Release v$(node -p "require('./packages/react-native-spritestudio/package.json').version")" --body ""
```

Then dispatch the release workflow from the branch. From a branch it runs `scripts/build-release.sh` on macOS — the pinned Brain, the generated code, the typecheck and the host checks, `prepack`, and the two tarballs opened and checked again — keeps the result on the run (`react-native-spritestudio-release-dist`), and uploads nothing. Fix anything on the branch and run this block again, until it is green.

```bash
BRANCH=$(git branch --show-current | grep '^release/')
git push origin "${BRANCH:?}" &&
  RUN=$(gh workflow run release.yml --ref "${BRANCH:?}" | sed 's|.*/||') &&
  gh run watch "${RUN:?}" --exit-status
```

On a Mac, `pnpm run build-release` on the branch is the same build, into `release-dist/` ([Building the release locally](#building-the-release-locally)).

Drawing on a device has no check in CI. Look at it on the branch, on iOS and on Android — the two diverge — with the example app ([CONTRIBUTING.md](./CONTRIBUTING.md) sets it up):

```bash
pnpm run run-ios && pnpm run run-android
```

Last, scan the branch for code that carries someone else's copyright or license. `provenance.yml` runs ScanCode, which finds copyright and license notices, and keeps its report and a summary on the run (`provenance`); the block downloads them into `qa/<run ID>` and prints the summary. **A person sorts what the summary lists.** A notice of the earlier SpriteStudio Players and SDK marks our own code. A notice of a library this repository bundles must be listed in `THIRD_PARTY_NOTICES.md`. Anything else is rewritten, unless its license, read at its source, is compatible with BSD-3-Clause and the code keeps the notice that license asks for. After any change on the branch, run the block again.

```bash
BRANCH=$(git branch --show-current | grep '^release/')
git push origin "${BRANCH:?}" &&
  RUN=$(gh workflow run provenance.yml --ref "${BRANCH:?}" | sed 's|.*/||') &&
  gh run watch "${RUN:?}" --exit-status &&
  gh run download "$RUN" -n provenance -D "qa/$RUN" &&
  cat "qa/$RUN/summary.md"
```

### 4. Merge and tag

Merge with a merge commit, never a squash or a rebase, so that `main` keeps the commits the QA build built rather than copies of them. Tag `main` only when its tree is the one the QA build built. It differs only when `main` held commits the branch did not; merge `main` into the branch and go back to step 3.

```bash
BRANCH=$(git branch --show-current | grep '^release/')
gh pr merge "${BRANCH:?}" --merge &&
  git switch main && git pull --ff-only &&
  git diff --exit-code --stat HEAD^2 HEAD &&   # must print nothing
  TAG="v$(node -p "require('./packages/react-native-spritestudio/package.json').version")" && echo "$TAG" &&
  git tag -a "$TAG" -m "$TAG" && git push origin "$TAG"
```

### 5. Build the Release

Dispatch from the tag. The run builds and checks again with `scripts/release.sh`, and creates a **draft** Release carrying the two tarballs it checked, `SHA256SUMS` and generated notes; nothing is public yet. Run the block that fits: npm cannot stage a package's first version, so its run adds `-f publish_npm=false`, and step 6 publishes it by hand.

For a version npm can stage:

```bash
git fetch origin --tags
TAG=$(git describe --exact-match --tags --match 'v[0-9]*' origin/main)
RUN=$(gh workflow run release.yml --ref "${TAG:?}" -f upload_release=true | sed 's|.*/||')
gh run watch "${RUN:?}" --exit-status
```

For a package's first version:

```bash
git fetch origin --tags
TAG=$(git describe --exact-match --tags --match 'v[0-9]*' origin/main)
RUN=$(gh workflow run release.yml --ref "${TAG:?}" -f upload_release=true -f publish_npm=false | sed 's|.*/||')
gh run watch "${RUN:?}" --exit-status
```

A tag that does not match the package version fails the run. A tag that already has a Release, draft or published, keeps it as it is, so delete a draft before dispatching again ([Undoing a release](#undoing-a-release)). The run then stages both tarballs on npm, the core first, under the dist-tag `scripts/npm-dist-tag.sh` picks, where they wait for step 6. The two inputs are independent: `-f upload_release=false` stages on npm without touching the Release, and with both off a run from the tag only builds.

On a Mac, the same script makes the same draft without the workflow, and stages nothing: step 6 publishes by hand. It refuses anything but a clean checkout of the tag that `origin` has, and requires `flatc`, so that no check is skipped.

```bash
git fetch origin --tags
TAG=$(git describe --exact-match --tags --match 'v[0-9]*' origin/main)
git switch --detach "${TAG:?}" && pnpm run release
```

### 6. Approve on npm

Open the draft on the [Releases](https://github.com/cri-middleware/SSPlayerForReactNative/releases) page and check the attachments: `react-native-spritestudio-X.Y.Z.tgz`, `react-native-spritestudio-ui-X.Y.Z.tgz` and `SHA256SUMS`. Look inside the tarballs first: until npm makes the version public, a fault is undone by deleting the draft and rejecting what was staged (see [Undoing a release](#undoing-a-release)), and after it, only a new version fixes it. Approve both before the Release is published, the core first, so that by the time the Release announces the version, `npm install` finds it; approving applies the dist-tag it was staged under. `npm stage approve` runs once per package. Approving asks for a 2FA code, and `npm login` and that code take a person at the terminal: an AI agent cutting the release hands this step over. The blocks read the tag at `HEAD`, the commit just tagged.

```bash
npm login                                         # once
git fetch origin --tags
TAG=$(git describe --exact-match --tags --match 'v[0-9]*' HEAD)
dir=$(mktemp -d) && gh release download "${TAG:?}" -D "$dir"
for f in "$dir"/*.tgz; do tar -tzf "$f"; done     # what npm will carry
npm stage list react-native-spritestudio          # the staged version, with its stage id
npm stage list react-native-spritestudio-ui
npm stage approve <stage-id>
npm view react-native-spritestudio dist-tags      # the version just approved, under its dist-tag
npm view react-native-spritestudio-ui dist-tags
```

A release the run did not stage — a package's first, one dispatched with `publish_npm=false`, one cut on a Mac, or one whose **Stage on npm** failed — is published by hand instead, from the same tarball. `scripts/npm-dist-tag.sh` picks the dist-tag: `latest` for a full release, and for a prerelease while the package's `latest` is not yet a full release; the prerelease's word (`beta`, `rc`) after that. The loop publishes the core first, and stops at the first failure.

```bash
git fetch origin --tags
TAG=$(git describe --exact-match --tags --match 'v[0-9]*' HEAD)
dir=$(mktemp -d) && gh release download "${TAG:?}" -D "$dir"
for package in react-native-spritestudio react-native-spritestudio-ui; do
  dist=$(scripts/npm-dist-tag.sh "$package" "${TAG#v}") &&
    npm publish "$dir/$package-${TAG#v}.tgz" --tag "${dist:?}" &&
    npm view "$package" dist-tags || break          # the version just published, under its dist-tag
done
```

### 7. Publish the Release

Edit the notes and **Publish release** as the draft is marked: `scripts/release-channel.sh` made it a pre-release when a full release is already tagged, and left it to become Latest otherwise. Publishing also starts `pages.yml`, which, for a Release that becomes Latest, deploys the [documentation site](https://cri-middleware.github.io/SSPlayerForReactNative/). Watch the run through, then open the site; the block waits up to a minute for the run, which appears a few seconds after the Release is published. A failed run leaves the Release published and the site as it was. Once the cause is fixed, re-run it with `gh run rerun <run-id>`, the run the block watched; a re-run builds the same tag.

```bash
git fetch origin --tags
TAG=$(git describe --exact-match --tags --match 'v[0-9]*' origin/main)
for i in 1 2 3 4 5 6 7 8 9 10 11 12; do
  RUN=$(gh run list -w pages.yml -b "${TAG:?}" -L 1 --json databaseId -q '.[0].databaseId')
  [ -n "$RUN" ] && break
  sleep 5
done
gh run watch "${RUN:?}" --exit-status
```

### 8. Merge back

Merge `main` into `develop`. After a patch release this conflicts where `develop` has moved on: keep `develop`'s version and its `Unreleased` heading, with the patch's section below it. The block merges on a detached `origin/develop`, so it runs in a worktree whichever branch the other checkouts hold, and a conflict stops it there: resolve it, `git commit`, and run the block's two `git push` lines.

```bash
git fetch origin --tags
TAG=$(git describe --exact-match --tags --match 'v[0-9]*' origin/main)
git switch --detach origin/develop &&
  git merge --no-ff -m "Merge branch 'main' into develop" origin/main &&
  git push origin HEAD:develop &&
  git push origin --delete "release/$(echo "${TAG:?}" | sed 's/^v//' | cut -d. -f1,2)"
```

If the button on its pull request already deleted the release branch, the last line only reports that the branch does not exist. Nothing needs it afterwards: a patch release cuts it again from the tag.

## Patching an earlier line

Fixes go to the latest release (SECURITY.md). When one has to reach an earlier line on request, as 7.0.2 after 7.1.0, `main` and `develop` carry the newer line, so the release differs from the one above in four places, and the blocks below run on the release branch.

1. **Steps 1 to 3, without the pull request.** Step 1's patch block cuts `release/X.Y` from the line's latest tag. Commit or cherry-pick the fix onto it, set the version and date its changelog section as step 2 does, and run step 3 but leave out its `gh pr create`: nothing of this line goes into `main`.
2. **The tag goes on the branch.** Once step 3's runs are green, the first block below tags the head of `release/X.Y`.
3. **Build it, and publish it as an earlier line.** `scripts/release-channel.sh` calls the release `old`: the draft is not a pre-release, its generated notes start from the full release before it in that line, and `pages.yml` deploys nothing for it. The run stages it on npm under `latest-X.Y`, which `scripts/npm-dist-tag.sh` picks since npm's `latest` is a newer full release, so a bare `npm install` keeps getting the newest; approve it as step 6 does. Publish the Release with the last block, not from the Releases page, whose default would make it Latest.
4. **No merge back.** Cherry-pick the fix onto `develop` if it still needs it; the last block deletes `release/X.Y`.

```bash
BRANCH=$(git branch --show-current | grep '^release/')
git pull --ff-only origin "${BRANCH:?}" &&
  TAG="v$(node -p "require('./packages/react-native-spritestudio/package.json').version")" &&
  git tag -a "$TAG" -m "$TAG" && git push origin "$TAG"
```

```bash
TAG=$(git describe --exact-match --tags --match 'v[0-9]*' HEAD)
RUN=$(gh workflow run release.yml --ref "${TAG:?}" -f upload_release=true | sed 's|.*/||')
gh run watch "${RUN:?}" --exit-status
```

```bash
git fetch origin --tags
TAG=$(git describe --exact-match --tags --match 'v[0-9]*' HEAD)
BRANCH=$(git branch --show-current | grep '^release/')
gh release edit "${TAG:?}" --draft=false --latest=false &&
  git push origin --delete "${BRANCH:?}"
```

## Undoing a release

Until step 6 makes the version public on npm, a release can be undone. A run that failed for a transient reason is run again from the same tag — the workflow or `pnpm run release` — once any draft it left is deleted; a version it had already staged is skipped. A fault that needs new commits takes the tag down too: delete the draft, reject what was staged with `npm stage reject <stage-id>`, once per package (a person, with 2FA), run `git push origin ":refs/tags/$TAG" && git tag -d "$TAG"`, fix it on the branch — restore it from its pull request if it was deleted — and go back to step 3.

**A version npm has made public is permanent**, whether approved or published by hand: it cannot be withdrawn, only superseded. So is a published Release, whose file users have downloaded by its tag. A fault found after either is fixed by a new patch version. A version that is only staged is not public yet, and rejecting it removes it.

## Building the release locally

`scripts/build-release.sh` is the release build: the two tarballs into `release-dist/npm/`, opened and checked, with `SHA256SUMS` over them. It publishes nothing. `release.yml` runs it for the QA build, and `pnpm run release` (step 5) is the same run with the draft Release on the end.

```bash
pnpm run build-release
```

It runs anywhere, but off macOS it skips `check-mask` and `check-shader`, which link the macOS-only host `libskia`, and without `flatc` it skips what needs it — which is why `pnpm run release` runs only on macOS, and only with `flatc`. **`sdk=build` cannot pack**: `prepack` refuses a Brain that is not the pinned release, so that mode rehearses everything and reports the file list instead of producing a tarball.

<br>

---

# SpriteStudio Player for React Native のリリース手順

維持者向けです。コントリビューターがこの手順を実行することはありません（[CONTRIBUTING.md](./CONTRIBUTING.md) を参照してください）。

## リリースの手順

このリポジトリの Write ロールを持つ人なら誰でもリリースできます。どの手順もブランチ・プルリクエスト・タグ・ワークフローの実行・Release のいずれかで、端末で描画を見る部分を除けば、誰の手元で実行しても結果は変わりません。必要なのは `git`、`gh`（最初に一度 `gh auth login`）、Node.js、pnpm、それに手順 6 のための `npm` で、`react-native-spritestudio` と `react-native-spritestudio-ui` に publish できるアカウントでログインしておきます。リポジトリ側では、GitHub Pages を有効にしてソースを GitHub Actions にし、`github-pages` environment に `v*` のタグのルールを足しておく必要があります。どちらかが欠けると、Release を公開しても何もデプロイされません。どちらもリポジトリの admin が行う設定です。npm 側では、それぞれのパッケージに、このリポジトリの `release.yml` を trusted publisher として登録し、stage を許可しておきます。npm はすでにあるパッケージにしか trusted publisher を設定できないので、各パッケージの最初のバージョンは手作業で出します（手順 6）。コマンドは bash です。zsh では、`#` のコメントが引数として渡されないよう、先に `setopt interactive_comments` を実行します。Windows では Git Bash を使います。

ワークフローの 2 つの実行、手順 3 の QA ビルドと手順 5 の Release は、どちらも代わりに Mac の手元で実行できます。ワークフローが実行するのは、サンプルパックの変換を除けば、その手順が名前を挙げるスクリプトだけだからです。それらのスクリプトはホストチェックを実行するので、この経路にはその検査に要るもの、つまりホスト用の Brain をビルドする Rust と `flatc`、それに `pnpm run deploy-examples` で変換したサンプルパックも必要です（検査の一覧は [CONTRIBUTING.md](./CONTRIBUTING.md) にあります）。

リリースは `main` 上のタグです。先にタグを push し、ビルドはその後です。バージョンは `packages/react-native-spritestudio/package.json` の `version` です。`packages/react-native-spritestudio-ui/package.json` も同じバージョンを持ち、そのバージョンの `react-native-spritestudio` を peer として受け取ります。食い違う組はリリースビルドが拒否します。同梱する SDK は、それとは別に `scripts/SDK_VERSION.txt` で固定します。タグはバージョンの頭に `v` を付けたもので、食い違うタグはリリースビルドが拒否します。ブランチは git-flow です。`develop` が統合ブランチで、`main` にはリリース済みのコミットだけが入ります。`release/X.Y` は 1 回のリリースの間だけ使います。`develop` の作業を出すリリースなら `develop` から、タグの上に修正だけを載せるリリースならその系統の最新のタグから切り、リリースが済んだら消します。

どのブロックも、新しいシェルで書かれたとおりに実行できます。必要なものはチェックアウト・git・GitHub から求めます。手で設定する値は 1 つで、リリースするバージョンを手順 1 と 2 の `<version>` に `7.0.1` のように埋めます。埋めずに実行すると、その行は構文エラーで止まります。空でもそれだけでは止まらない値は `${VAR:?}` で読みます。`TAG` が空だと、`gh release download` が最新の Release を取ってきてしまうためです。

### 1. ブランチ

`develop` の作業を出すリリースは `develop` から切ります。新しい `X.Y` や、`7.0.0-beta.1` の後の `7.0.0` がこれに当たります。パッチリリースは修正だけを出すもので、その系統の最新のタグから切り、修正をそこへコミットするか cherry-pick します。どちらの場合も、以前の `release/X.Y` が残っていれば置き換えます。当てはまる方のブロックを実行します。

`develop` の作業を出すとき:

```bash
VERSION=<version>
BRANCH=release/$(echo "${VERSION:?}" | cut -d. -f1,2)
git fetch origin &&
  git switch -C "$BRANCH" origin/develop
```

パッチのとき:

```bash
VERSION=<version>
BRANCH=release/$(echo "${VERSION:?}" | cut -d. -f1,2)
git fetch origin --tags &&
  BASE=$(git -c versionsort.suffix=- tag --list "v${BRANCH#release/}.*" --sort=-v:refname | head -n 1) &&   # その系統の最新のタグ
  git switch -C "$BRANCH" "${BASE:?}"
```

どちらの場合も、リリースが同梱するのは、ブランチの `scripts/SDK_VERSION.txt` が指す SpriteStudio-SDK のリリースです。`cat scripts/SDK_VERSION.txt` で出力できます。別のリリースを同梱するときは、ブランチ上でこのファイルを書き換えて単独のコミットにします。手順 3 の QA ビルドが、そのタグで Brain を導入します。

続けて依存を最新にし、単独のコミットにします。`pnpm update -r` は、ワークスペースの各パッケージを、範囲が許すいちばん新しい版に上げます。新しくインストールしたときに解決される版で、手順 3 の検査はこの版で回ります。メジャーバージョンを上げるのはコードの変更なので、ここではなく`develop` への通常のプルリクエストで行います。

```bash
pnpm update -r                                    # 範囲が許すいちばん新しい版
git commit -m "chore(deps): update within their ranges" -- pnpm-lock.yaml pnpm-workspace.yaml '*package.json'   # 何も動かなければコミットするものは無い
```

### 2. バージョン、CHANGELOG

1 コミットで行います。両パッケージの `version` と、UI パッケージの `react-native-spritestudio` の peer を `<version>` にし、`CHANGELOG.md` のそのバージョンの見出しに日付を入れて `## [X.Y.Z] - YYYY-MM-DD` とします。パッチリリースでは見出しを足します。

```bash
# 両パッケージの package.json の "version" と、-ui の react-native-spritestudio の peer を <version> にし、CHANGELOG.md の見出しに日付を入れてから:
git add packages/react-native-spritestudio packages/react-native-spritestudio-ui CHANGELOG.md
git commit -m "chore(release): v$(node -p "require('./packages/react-native-spritestudio/package.json').version")"
```

### 3. プルリクエスト、QA ビルド、端末での確認

`main` へのプルリクエストを作ります。

```bash
BRANCH=$(git branch --show-current | grep '^release/')
git push -u origin "${BRANCH:?}" &&
  gh pr create -B main -H "${BRANCH:?}" --title "Release v$(node -p "require('./packages/react-native-spritestudio/package.json').version")" --body ""
```

続けて、ブランチからリリースワークフローを実行します。ブランチからの実行では、macOS で `scripts/build-release.sh` を実行し（ピンした Brain、生成コード、型チェックとホストチェック、`prepack`、そして完成した 2 つの tarball を開き直しての検査）、結果を run に残して（`react-native-spritestudio-release-dist`）、何もアップロードしません。問題があればブランチで直し、緑になるまでこのブロックを繰り返します。

```bash
BRANCH=$(git branch --show-current | grep '^release/')
git push origin "${BRANCH:?}" &&
  RUN=$(gh workflow run release.yml --ref "${BRANCH:?}" | sed 's|.*/||') &&
  gh run watch "${RUN:?}" --exit-status
```

Mac では、ブランチ上で `pnpm run build-release` を実行すれば同じビルドが `release-dist/` にできます（[リリースのローカルビルド](#リリースのローカルビルド)）。

端末での描画には CI の検査がありません。ブランチ上で、iOS と Android の両方で確かめます（両者は挙動が分かれます）。使うのは example アプリです（準備は [CONTRIBUTING.md](./CONTRIBUTING.md)）。

```bash
pnpm run run-ios && pnpm run run-android
```

最後に、他者の著作権やライセンスの付いたコードが無いかを、ブランチで検査します。`provenance.yml` は ScanCode で著作権表示とライセンスの記述を見つけ、報告と一覧を run に残します（`provenance`）。ブロックはそれを `qa/<run ID>` にダウンロードし、一覧を表示します。**一覧は人が仕分けます。** 以前の SpriteStudio の Player・SDK の表示が付いたコードは、自社のコードです。このリポジトリが同梱するライブラリの表示は、`THIRD_PARTY_NOTICES.md` に載っていなければなりません。それ以外は書き直します。残せるのは、出所で確かめたライセンスが BSD-3-Clause と両立し、そのライセンスが求める表示をコードに残すときだけです。ブランチを変えたら、このブロックをもう一度実行します。

```bash
BRANCH=$(git branch --show-current | grep '^release/')
git push origin "${BRANCH:?}" &&
  RUN=$(gh workflow run provenance.yml --ref "${BRANCH:?}" | sed 's|.*/||') &&
  gh run watch "${RUN:?}" --exit-status &&
  gh run download "$RUN" -n provenance -D "qa/$RUN" &&
  cat "qa/$RUN/summary.md"
```

### 4. マージとタグ

マージはマージコミットで行い、squash や rebase は使いません。QA ビルドしたコミットの写しではなく、そのものを `main` に残すためです。タグは、`main` のツリーが QA ビルドしたものと同じときにだけ打ちます。違うのは `main` にブランチが持たないコミットがあった場合だけで、そのときは `main` をブランチへマージして手順 3 に戻ります。

```bash
BRANCH=$(git branch --show-current | grep '^release/')
gh pr merge "${BRANCH:?}" --merge &&
  git switch main && git pull --ff-only &&
  git diff --exit-code --stat HEAD^2 HEAD &&   # 何も出力されないこと
  TAG="v$(node -p "require('./packages/react-native-spritestudio/package.json').version")" && echo "$TAG" &&
  git tag -a "$TAG" -m "$TAG" && git push origin "$TAG"
```

### 5. Release のビルド

タグからワークフローを実行します。run は `scripts/release.sh` でもう一度ビルドして検査し、検査した 2 つの tarball と `SHA256SUMS`、自動生成のリリースノート付きで**下書き**の Release を作ります。まだ何も公開されていません。当てはまる方のブロックを実行します。npm はパッケージの最初のバージョンを stage できないので、その run には `-f publish_npm=false` を足し、手順 6 で手作業で publish します。

npm が stage できるバージョンのとき:

```bash
git fetch origin --tags
TAG=$(git describe --exact-match --tags --match 'v[0-9]*' origin/main)
RUN=$(gh workflow run release.yml --ref "${TAG:?}" -f upload_release=true | sed 's|.*/||')
gh run watch "${RUN:?}" --exit-status
```

パッケージの最初のバージョンのとき:

```bash
git fetch origin --tags
TAG=$(git describe --exact-match --tags --match 'v[0-9]*' origin/main)
RUN=$(gh workflow run release.yml --ref "${TAG:?}" -f upload_release=true -f publish_npm=false | sed 's|.*/||')
gh run watch "${RUN:?}" --exit-status
```

パッケージのバージョンと食い違うタグからの実行は失敗します。Release がすでにあるタグでは、下書きでも公開済みでも、その Release に触れないので、もう一度実行するときは先に下書きを消します（[リリースの取り消し](#リリースの取り消し)）。run は続けて、`scripts/npm-dist-tag.sh` が決める dist-tag で、2 つの tarball を core から順に npm に stage します。stage したものは手順 6 を待ちます。2 つの入力は独立しています。`-f upload_release=false` なら Release に触れずに npm にだけ stage し、両方を外せばタグからの実行でもビルドだけを行います。

Mac では、同じスクリプトがワークフロー無しで同じ下書きを作ります。npm には何も stage しないので、手順 6 で手作業で publish します。`origin` にあるタグをそのままチェックアウトした、変更の無い作業ツリーでしか動きません。検査を 1 つも飛ばさないよう、`flatc` も必須です。

```bash
git fetch origin --tags
TAG=$(git describe --exact-match --tags --match 'v[0-9]*' origin/main)
git switch --detach "${TAG:?}" && pnpm run release
```

### 6. npm で承認する

[Releases](https://github.com/cri-middleware/SSPlayerForReactNative/releases) ページで下書きを開き、添付を確かめます。`react-native-spritestudio-X.Y.Z.tgz`、`react-native-spritestudio-ui-X.Y.Z.tgz`、`SHA256SUMS` です。先に tarball の中身を確かめます。npm でバージョンが公開されるまでなら、下書きを消して stage したものを取り下げれば取り消せますが（「[リリースの取り消し](#リリースの取り消し)」を参照）、公開した後は新しいバージョンでしか直せません。Release を公開するよりも先に、core から順に両方を承認し、Release がバージョンを告知する時点で、`npm install` がそのバージョンを見つけられるようにします。承認すると、stage したときの dist-tag が付きます。`npm stage approve` はパッケージごとに実行します。承認には 2FA のコードが要ります。`npm login` とこのコードの入力は人が端末で行うもので、AI エージェントにリリースさせているときは、この手順を人に引き継ぎます。ブロックは、タグを打ったばかりのコミット（`HEAD`）からタグを求めます。

```bash
npm login                                         # 最初に一度
git fetch origin --tags
TAG=$(git describe --exact-match --tags --match 'v[0-9]*' HEAD)
dir=$(mktemp -d) && gh release download "${TAG:?}" -D "$dir"
for f in "$dir"/*.tgz; do tar -tzf "$f"; done     # npm に出る中身
npm stage list react-native-spritestudio          # stage されたバージョンと、その stage id
npm stage list react-native-spritestudio-ui
npm stage approve <stage-id>
npm view react-native-spritestudio dist-tags      # いま承認したバージョンと、その dist-tag
npm view react-native-spritestudio-ui dist-tags
```

run が stage しなかったリリースは、同じ tarball を手作業で publish します。そのパッケージの最初のバージョン、`publish_npm=false` で実行したもの、Mac で切ったもの、**Stage on npm** が失敗したものがこれにあたります。dist-tag は `scripts/npm-dist-tag.sh` が決めます。正式版は `latest` です。プレリリースも、パッケージの `latest` がまだ正式版でなければ `latest`、正式版になった後はその語（`beta`・`rc`）です。ループは core から順に publish し、最初の失敗で止まります。

```bash
git fetch origin --tags
TAG=$(git describe --exact-match --tags --match 'v[0-9]*' HEAD)
dir=$(mktemp -d) && gh release download "${TAG:?}" -D "$dir"
for package in react-native-spritestudio react-native-spritestudio-ui; do
  dist=$(scripts/npm-dist-tag.sh "$package" "${TAG#v}") &&
    npm publish "$dir/$package-${TAG#v}.tgz" --tag "${dist:?}" &&
    npm view "$package" dist-tags || break          # いま出したバージョンと、その dist-tag
done
```

### 7. Release を公開する

リリースノートを編集し、下書きの印のまま **Publish release** を押します。`scripts/release-channel.sh` が、正式版のタグがすでにあれば pre-release にし、なければ Latest になるようにしてあります。公開すると `pages.yml` が動き、Latest になる Release なら [ドキュメントサイト](https://cri-middleware.github.io/SSPlayerForReactNative/) をデプロイします。run を最後まで見届けてから、サイトを開いて確かめます。run は Release の公開から数秒遅れて出るので、ブロックは最大 1 分待ちます。run が失敗しても Release は公開されたままで、サイトは元のまま残ります。原因を直したら、ブロックが見届けた run を `gh run rerun <run-id>` で再実行します。再実行は同じタグをビルドします。

```bash
git fetch origin --tags
TAG=$(git describe --exact-match --tags --match 'v[0-9]*' origin/main)
for i in 1 2 3 4 5 6 7 8 9 10 11 12; do
  RUN=$(gh run list -w pages.yml -b "${TAG:?}" -L 1 --json databaseId -q '.[0].databaseId')
  [ -n "$RUN" ] && break
  sleep 5
done
gh run watch "${RUN:?}" --exit-status
```

### 8. develop へ戻す

`main` を `develop` へマージします。パッチリリースの後は、`develop` が先へ進んだ箇所で衝突します。`develop` のバージョンと `Unreleased` の見出しを残し、パッチの節をその下に置いてください。ブロックは切り離した `origin/develop` の上でマージするので、ほかのチェックアウトがどのブランチにあっても worktree で実行できます。衝突したらそこで止まります。解決して `git commit` し、ブロックの 2 つの `git push` を実行してください。

```bash
git fetch origin --tags
TAG=$(git describe --exact-match --tags --match 'v[0-9]*' origin/main)
git switch --detach origin/develop &&
  git merge --no-ff -m "Merge branch 'main' into develop" origin/main &&
  git push origin HEAD:develop &&
  git push origin --delete "release/$(echo "${TAG:?}" | sed 's/^v//' | cut -d. -f1,2)"
```

プルリクエストのページのボタンでリリースブランチを消してあれば、最後の行は「ブランチが無い」と出るだけです。パッチリリースはタグから切り直すので、この後ブランチが要ることはありません。

## 古い系統へのパッチ

修正は最新のリリースにだけ出します（SECURITY.md）。依頼を受けて古い系統を直すとき（7.1.0 の後の 7.0.2 など）は、`main` と `develop` が新しい系統を持っているので、上の手順と 4 か所が違います。下のブロックはリリースブランチで実行します。

1. **手順 1〜3 を、プルリクエストなしで。** 手順 1 のパッチのブロックで、その系統の最新のタグから `release/X.Y` を切ります。修正をコミットするか cherry-pick し、手順 2 のとおりにバージョンを設定して CHANGELOG の節に日付を入れ、手順 3 を `gh pr create` を除いて実行します。この系統のものは `main` に入れません。
2. **タグはブランチに打つ。** 手順 3 の run が通ったら、最初のブロックで `release/X.Y` の先頭にタグを打ちます。
3. **ビルドして、古い系統として公開する。** `scripts/release-channel.sh` がこのリリースを `old` と判定します。下書きは pre-release にならず、自動生成のノートはその系統の 1 つ前の正式版から比べ、`pages.yml` は何もデプロイしません。run は npm に `latest-X.Y` で stage します。npm の `latest` がより新しい正式版なので、`scripts/npm-dist-tag.sh` がそれを選び、素の `npm install` では最新の版が入り続けます。承認は手順 6 のとおりです。公開は Releases ページではなく最後のブロックで行います。ページの既定のままだと Latest になるためです。
4. **develop へは戻さない。** `develop` にも要る修正なら cherry-pick します。最後のブロックが `release/X.Y` を消します。

```bash
BRANCH=$(git branch --show-current | grep '^release/')
git pull --ff-only origin "${BRANCH:?}" &&
  TAG="v$(node -p "require('./packages/react-native-spritestudio/package.json').version")" &&
  git tag -a "$TAG" -m "$TAG" && git push origin "$TAG"
```

```bash
TAG=$(git describe --exact-match --tags --match 'v[0-9]*' HEAD)
RUN=$(gh workflow run release.yml --ref "${TAG:?}" -f upload_release=true | sed 's|.*/||')
gh run watch "${RUN:?}" --exit-status
```

```bash
git fetch origin --tags
TAG=$(git describe --exact-match --tags --match 'v[0-9]*' HEAD)
BRANCH=$(git branch --show-current | grep '^release/')
gh release edit "${TAG:?}" --draft=false --latest=false &&
  git push origin --delete "${BRANCH:?}"
```

## リリースの取り消し

手順 6 で npm にバージョンが公開されるまでは取り消せます。一時的な理由で失敗した run は、残った下書きがあれば消してから、同じタグでもう一度実行します（ワークフローでも `pnpm run release` でも構いません）。stage 済みのバージョンは飛ばされます。新しいコミットが要る不具合ならタグも取り下げます。下書きを消し、stage したものをパッケージごとに `npm stage reject <stage-id>` で取り下げ（人が 2FA で行います）、`git push origin ":refs/tags/$TAG" && git tag -d "$TAG"` を実行し、ブランチで直して（消していたらプルリクエストのページから復元して）手順 3 に戻ります。

**npm で公開されたバージョンは恒久的です。** 承認したものも手作業で publish したものも、取り下げられず、新しいバージョンで置き換えるしかありません。公開した Release も同じで、利用者はそのタグでファイルを取得しています。どちらかの後に見つかった不具合は、新しいパッチバージョンで直します。stage しただけのバージョンはまだ公開されておらず、取り下げれば消えます。

## リリースのローカルビルド

`scripts/build-release.sh` がリリースのビルドそのものです。2 つの tarball を `release-dist/npm/` に作り、開き直して検査し、`SHA256SUMS` を付けます。何も publish しません。`release.yml` は QA ビルドでこれを実行し、`pnpm run release`（手順 5）はこれと同じ実行の最後に Release の下書きを付けたものです。

```bash
pnpm run build-release
```

どの OS でも動きますが、macOS 以外では `check-mask` と `check-shader` を飛ばし（macOS 専用のホスト `libskia` をリンクするため）、`flatc` が無ければそれを使う検査を飛ばします。`pnpm run release` が macOS でしか動かず、`flatc` を必須にしているのはこのためです。**`sdk=build` では pack できません。** `prepack` がピンしたリリース以外の Brain を拒否するため、このモードは一通りリハーサルしてファイル一覧を報告するだけになります。
