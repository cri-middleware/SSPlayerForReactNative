# Releasing SSPlayerForReactNative

Maintainers only. Contributors do not run any of this — see [CONTRIBUTING.md](./CONTRIBUTING.md).

## Building the documentation site

```bash
pnpm run prepare-docs   # pnpm install
pnpm run build-docs     # TypeDoc + VitePress into docs/.vitepress/dist
```

`scripts/build-pages.sh` is the two together, and is what `pages.yml` runs. Neither needs the
Brain or Rust — TypeDoc reads TypeScript and VitePress reads Markdown — which is why that workflow
checks out without submodules. The build fails on a dead page link but **does not check
`#anchors`**: a link to a heading that does not exist still builds green, so verify those by hand.

## Cutting a release

The package version is **lockstep with the SDK**: `scripts/SDK_VERSION.txt` pins the Brain release
the package is built against, and the package carries the matching version.

```bash
pnpm run build-release   # the tarball into release-dist/, re-opened and checked. Publishes nothing.
pnpm run release         # the same run with the publish on the end
```

`release` is **macOS only** — the tarball carries the Brain's iOS xcframework, which only Xcode can
build, so a release from anywhere else would ship an Android-only package that installs and then
fails. `build-release` runs anywhere.

**`sdk=build` cannot pack.** `prepack` refuses a Brain that is not the pinned release, so that mode
rehearses everything and reports the file list instead of producing a tarball.

A green CI is not a substitute for the host checks in [CONTRIBUTING.md](./CONTRIBUTING.md): CI has
no access to the SDK submodule and no macOS libskia, so it cannot run them or `prepack`.

<br>

---

# SSPlayerForReactNative のリリース手順

維持者向けです。コントリビューターがこの手順を実行することはありません（[CONTRIBUTING.md](./CONTRIBUTING.md) を参照してください）。

## ドキュメントサイトのビルド

```bash
pnpm run prepare-docs   # pnpm install
pnpm run build-docs     # TypeDoc + VitePress を docs/.vitepress/dist へ
```

`scripts/build-pages.sh` はこの 2 つをまとめたもので、`pages.yml` が実行するのもこれです。どちらも
Brain も Rust も必要としません（TypeDoc は TypeScript を、VitePress は Markdown を読むだけです）。そのためこのワークフローは submodule 無しでチェックアウトします。リンク切れではビルドが失敗しますが、
**`#anchor` は検査しません**。存在しない見出しへのリンクは緑のまま通るので、手で確認してください。

## リリースの手順

パッケージのバージョンは **SDK とロックステップ**です。`scripts/SDK_VERSION.txt` がビルド対象の
Brain リリースをピンし、パッケージはそれに対応するバージョンを持ちます。

```bash
pnpm run build-release   # tarball を release-dist/ に作り、開き直して検査。publish はしません。
pnpm run release         # 同じ実行の最後に publish を付けたもの
```

`release` は **macOS 専用**です。tarball には Brain の iOS xcframework が入り、これを作れるのは
Xcode だけなので、他の環境からのリリースは「インストールできるが動かない Android 専用パッケージ」を出荷することになります。`build-release` はどの OS でも動きます。

**`sdk=build` では pack できません。** `prepack` がピンされたリリース以外の Brain を拒否するため、このモードは一通りリハーサルしてファイル一覧を報告するだけになります。

CI が緑でも [CONTRIBUTING.md](./CONTRIBUTING.md) のホストチェックの代わりにはなりません。CI は
SDK submodule にも macOS の libskia にもアクセスできないため、それらも `prepack` も実行できません。
