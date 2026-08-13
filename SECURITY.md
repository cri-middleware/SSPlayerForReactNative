# Security Policy

## Supported Versions

SSPlayerForReactNative is pre-release: nothing is published to npm yet, and fixes
are issued against `main`. Once there are releases, this becomes "the latest one".

| Version | Supported |
|---|---|
| `main` | ✅ |
| Anything else | ❌ |

## Reporting a Vulnerability

**Please do not open a public GitHub Issue for a security problem.** Report it
privately through the Help Center, which accepts file attachments if you need to
send a reproduction:

👉 [**CRI Middleware Help Center (Inquiry Form)**](https://www.webtech.co.jp/help/en/spritestudio7/inquiries/ssplayer_tool/)

Please include:

- What the impact is — crash, out-of-bounds read, arbitrary code execution,
  information disclosure.
- Steps to reproduce, ideally with a minimal `.ssab` and the smallest amount of
  TypeScript needed.
- The player commit, the SpriteStudio SDK version (`scripts/SDK_VERSION.txt`),
  your React Native and Expo SDK versions, and the platform.
- Whether the input that triggers it comes from a trusted source in your project
  or from somewhere untrusted — a `source` may be an `http(s)` URL, so this
  distinction is real here.

We will confirm receipt, tell you whether we can reproduce it, and let you know
when a fix ships. Please give us a chance to release that fix before disclosing
publicly.

### Which repository to report to

Playback is driven by a native Rust runtime shared with the other SpriteStudio
players. If the same problem reproduces on a different SpriteStudio player, it is
most likely in that shared core — see
[SpriteStudio-SDK](https://github.com/cri-middleware/SpriteStudio-SDK). Reporting
here is still fine; we will route it.

## Scope Notes

The player loads binary animation data (`.ssab`) and hands it to native code.
Two things are worth knowing before you decide how much to trust a pack.

**The buffer is verified before the runtime sees it.** `HybridSsResource::adopt()`
runs FlatBuffers' generated verifier over the whole `.ssab` and throws if it
fails, so a truncated download, a half-written cache or a deliberately malformed
file is rejected rather than parsed. This matters because `libssruntime` parses
with `root_as_..._unchecked` and states that invalid input is undefined
behaviour; the gate is what stands between the two. It is exercised by a host
check against every pack in `example/`, fourteen corruption cases and 4,096
single-bit flips under ASan and UBSan.

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

SSPlayerForReactNative はリリース前です。npm への公開はまだ行われておらず、修正は
`main` に対して提供されます。リリースが始まった時点で「最新リリース」に切り替わります。

| バージョン | サポート |
|---|---|
| `main` | ✅ |
| それ以外 | ❌ |

## 脆弱性の報告

**セキュリティに関する問題は、公開の GitHub Issue に投稿しないでください。**
再現データの添付も可能なヘルプセンターより、非公開でご報告ください。

👉 [**ヘルプセンター（お問い合わせフォーム）**](https://www.webtech.co.jp/help/ja/spritestudio7/inquiries/ssplayer_tool/)

ご報告には以下を含めてください。

- 影響の内容（クラッシュ、境界外読み取り、任意コード実行、情報漏洩など）
- 再現手順。可能であれば最小限の `.ssab` と、必要最小限の TypeScript
- プレイヤーのコミット、SpriteStudio SDK のバージョン（`scripts/SDK_VERSION.txt`）、
  React Native と Expo SDK のバージョン、対象プラットフォーム
- 引き金となる入力が、プロジェクト内の信頼できるものか、信頼できない経路から
  来たものか。`source` は `http(s)` URL を受け付けるため、この区別は実際に意味を持ちます

受領の確認、再現可否、修正の出荷時期をご連絡します。公開の前に、修正をリリースする
機会をいただけますようお願いします。

### どのリポジトリに報告するか

再生は、他の SpriteStudio プレイヤーと共通のネイティブ Rust ランタイムが担っています。
同じ問題が別のプレイヤーでも再現する場合、原因は共通コア側である可能性が高いため
[SpriteStudio-SDK](https://github.com/cri-middleware/SpriteStudio-SDK) をご覧ください。
こちらにご報告いただいても構いません。適切な側へ回送します。

## 適用範囲について

このプレイヤーはバイナリのアニメーションデータ（`.ssab`）を読み込み、ネイティブコードへ
渡します。パックをどこまで信頼するかを判断する前に、2点を把握してください。

**バッファはランタイムに渡す前に検証されます。** `HybridSsResource::adopt()` が
FlatBuffers の生成する verifier を `.ssab` 全体に対して実行し、失敗すれば例外を投げます。
途中で切れたダウンロード、書きかけのキャッシュ、意図的に壊されたファイルは、解析される
前に弾かれます。`libssruntime` は `root_as_..._unchecked` で解析し、不正な入力は未定義動作
であると明記しているため、このゲートがその間に立っています。`example/` の全パック、14種の
破壊ケース、4,096通りの単一ビット反転を ASan / UBSan 付きで検査しています。

**参照グラフは意図的に制限していません。** 自分のアニメーションをマウントする Instance
部品には有限の展開が存在せず、スタックが尽きるまで再帰します。これは意図的な非目標です
（[ROADMAP.md](ROADMAP.md#deliberate-non-goals)）。どのパックを再生するかはアプリ側の
責任であり、循環参照はエディタ上で作者が確認できるコンテンツ側の不具合である、という
判断によります。

自分で作っていないパックを読み込むアプリにとっての帰結は、**構造は検査されるが内容は
検査されない**、ということです。実行時に `.ssab` をダウンロードする場合は、管理下の
経路で配信し、内容を保証できるコンテンツとして扱ってください。
