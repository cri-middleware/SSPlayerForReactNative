<!--
Thanks for contributing! See CONTRIBUTING.md for the constraints this project works under
(Layer 2 imports nothing from React, nothing per-vertex crosses JSI, generated code is regenerated).
CONTRIBUTING.md に本プロジェクトの制約が記載されています。日本語でも英語でも構いません。
-->

## What does this change? / 変更内容

<!-- What it does and why. Link any related issue: Fixes #123 -->

## How was it verified? / 検証方法

<!--
Which checks ran, and on what. If you could not run them, say so —
that is useful information, not a problem.
実行した確認と環境。実行できなかった場合はその旨をお書きください。
-->

- [ ] `npm run typecheck`, `npm test`, `npm run build`
- [ ] `npm run generate-nitro-code`, then `git diff --exit-code packages/*/nitrogen`
- [ ] The `check-*` scripts CONTRIBUTING lists for what you touched
- [ ] Ran the example on iOS and Android (`npx expo run:ios` / `run:android`) — no test covers drawing
- [ ] Not run — see notes below / 未実行（理由は下記）

**Environment / 環境:** iOS / Android, device or simulator and OS version, React Native version, host OS

## Checklist

- [ ] Scoped to one thing. Unrelated fixes are easier to review as their own PR.
- [ ] Follows the style of the files it touches.
- [ ] Docs updated if behaviour changed.
- [ ] Anything that exists twice changed twice — a page and its translation, a `.sh` and its `.ps1`.
- [ ] Layer 2 imports nothing from `react` / `react-native` — nothing enforces this.
- [ ] Nothing per-vertex crosses JSI, and a buffer handed to JS is read only until the next `update()`.
- [ ] `nitrogen/generated/` and `cpp/format/` regenerated, never hand-edited; the source is `src/specs/*.nitro.ts`.

## Anything reviewers should know? / レビュー時の注意点

<!-- Trade-offs you made, alternatives you rejected, parts you are unsure about. -->
