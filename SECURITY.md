# Security Policy

## Supported Versions

Fixes are issued against the latest release only — if you
are on an older one, please reproduce on the current release before reporting.

| Version | Supported |
|---|---|
| The latest release | ✅ |
| Anything older | ❌ |

## Reporting a Vulnerability

**Please do not open a public GitHub Issue for a security problem.** Report it privately through the
official inquiry form:

👉 [**CRI Middleware Inquiry Form (English)**](https://www.webtech.co.jp/contact/en.html)

The English form has no file upload. If you need to send a reproduction, use the
[Japanese Help Center form](https://www.webtech.co.jp/help/ja/spritestudio7/inquiries/ssplayer_tool/),
which takes a zip of up to 8 MB.

Please include:

- What the impact is — crash, out-of-bounds read, arbitrary code execution,
  information disclosure.
- Steps to reproduce, ideally with a minimal `.ssab` and the smallest amount of
  TypeScript needed.
- The player version (or commit), the SpriteStudio SDK version (`native/VERSION`
  in the installed package, `scripts/SDK_VERSION.txt` in a checkout), your React
  Native and Expo SDK versions, and the platform.
- Whether the input that triggers it comes from a trusted source in your project
  or from somewhere untrusted — a `source` may be an `http(s)` URL, so this
  distinction is real here.

We will confirm receipt, tell you whether we can reproduce it, and let you know when a fix ships.
Please give us a chance to release that fix before disclosing publicly.

### Which repository to report to

Playback is driven by the runtime shared with the other SpriteStudio players, which lives in
SpriteStudio-SDK. If the same problem reproduces on a different SpriteStudio player, it is most likely
in that shared core. Report it here all the same and say so; we will route it.

## Scope Notes

The player loads binary animation data (`.ssab`) and hands it to native code.
Two things are worth knowing before you decide how much to trust a pack.

**The buffer is verified before the runtime sees it.** `HybridSsResource::adopt()`
runs FlatBuffers' generated verifier over the whole `.ssab` and throws if it
fails, so a truncated download, a half-written cache or a deliberately malformed
file is rejected rather than parsed. This matters because `libssruntime` parses
with `root_as_..._unchecked` and states that invalid input is undefined
behaviour; the gate is what stands between the two.

**The reference graph is not bounded, on purpose.** An Instance part that mounts
its own animation has no finite expansion, and nothing here stops the load
recursing until the stack gives out. That is a deliberate non-goal — see
[ROADMAP.md](ROADMAP.md#deliberate-non-goals) — on the reasoning that which pack
an app plays is the app's own business, and a cyclic reference is a content bug
its author can see in the editor.

The consequence for an app that loads packs it did not author: **the structure is
checked, the content is not**. If your app downloads `.ssab` at runtime, serve it
over a channel you control and treat it as content you vouch for.

---

# セキュリティポリシー

## サポート対象バージョン

修正は最新リリースに対してのみ提供されます。古いバージョンをご利用の場合は、最新リリースで再現することをご確認のうえご報告ください。

| バージョン | サポート |
|---|---|
| 最新のリリース | ✅ |
| それ以前 | ❌ |

## 脆弱性の報告

**セキュリティに関する問題は、公開の GitHub Issue に投稿しないでください。** 再現データ（8 MB までの zip ファイル）の添付も可能なヘルプセンターより、非公開でご報告ください。

👉 [**ヘルプセンター（お問い合わせフォーム）**](https://www.webtech.co.jp/help/ja/spritestudio7/inquiries/ssplayer_tool/)

ご報告には以下を含めてください。

- 影響の内容（クラッシュ、境界外読み取り、任意コード実行、情報漏洩など）
- 再現手順。可能であれば最小限の `.ssab` と、必要最小限の TypeScript
- プレイヤーのバージョン（またはコミット）、SpriteStudio SDK のバージョン（インストール済みパッケージの `native/VERSION`、チェックアウトでは `scripts/SDK_VERSION.txt`）、React Native と Expo SDK のバージョン、対象プラットフォーム
- 引き金となる入力が、プロジェクト内の信頼できるものか、信頼できない経路から来たものか。`source` は `http(s)` URL を受け付けるため、この区別は実際に意味を持ちます

受領の確認、再現可否、修正版の公開時期についてご連絡します。修正を公開するまでの間、公表をお待ちいただけますようお願いします。

### 報告先リポジトリの判断

再生処理は、他の SpriteStudio Player と共通のランタイムが担っており、SpriteStudio-SDK で開発されています。他の SpriteStudio Player でも同じ問題が再現する場合、共通コア側の問題である可能性が高いため、その旨を添えて本リポジトリへご報告ください。こちらで振り分けます。

## 既知の注意点

このプレイヤーはバイナリのアニメーションデータ（`.ssab`）を読み込み、ネイティブコードへ渡します。パックをどこまで信頼するかを判断する前に、2 点を把握してください。

**バッファはランタイムに渡す前に検証されます。** `HybridSsResource::adopt()` が
FlatBuffers の生成する verifier を `.ssab` 全体に対して実行し、失敗すれば例外を投げます。途中で切れたダウンロード、書きかけのキャッシュ、意図的に壊されたファイルは、解析される前に弾かれます。`libssruntime` は `root_as_..._unchecked` で解析し、不正な入力は未定義動作であると明記しているため、このゲートがその間に立っています。

**参照グラフは意図的に制限していません。** 自分のアニメーションをマウントする Instance
部品には有限の展開が存在せず、スタックが尽きるまで再帰します。これは意図的な非目標です（[ROADMAP.md](ROADMAP.md#deliberate-non-goals)）。どのパックを再生するかはアプリ側の責任であり、循環参照はエディタ上で作者が確認できるコンテンツ側の不具合である、という判断によります。

自分で作っていないパックを読み込むアプリにとっての帰結は、**構造は検査されるが内容は検査されない**、ということです。実行時に `.ssab` をダウンロードする場合は、管理下の経路で配信し、内容を保証できるコンテンツとして扱ってください。
