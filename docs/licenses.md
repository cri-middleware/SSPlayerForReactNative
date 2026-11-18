---
title: License and notices
description: What this package puts inside the app you publish, and what you have to say about it.
---

# License and notices

`react-native-spritestudio` is distributed under the **BSD-3-Clause** license,
following the license of SpriteStudio-SDK. Copyright © CRI Middleware Co., Ltd.

- Full text: [`LICENSE.md`](https://github.com/cri-middleware/SSPlayerForReactNative/blob/HEAD/LICENSE.md)
- The authoritative notice list:
  [`THIRD_PARTY_NOTICES.md`](https://github.com/cri-middleware/SSPlayerForReactNative/blob/HEAD/THIRD_PARTY_NOTICES.md)

## Why this is not only our problem

Unlike a plugin that ships as a downloadable add-on beside your app, **this
package is compiled into it**. The SpriteStudio runtime is a static library and
the FlatBuffers headers are header-only, so both end up inside the `.ipa` and
`.aab` you publish. The obligations land on the binary **you** distribute, not
only on this repository — which is the whole reason this page exists rather than
a link to a license file.

## What to put in your acknowledgements screen

Three files, all of them inside the installed package:

| File, under `node_modules/react-native-spritestudio/` | Covers |
|---|---|
| `native/LICENSE.md` | the SpriteStudio runtime itself (BSD-3-Clause) |
| `native/THIRD-PARTY-LICENSES.ssruntime.md` | the Rust crates it is built from — 20 under Apache-2.0, 3 under BSD-3-Clause, 1 under MIT, 1 under the Unicode License v3 |
| `third_party/flatbuffers/LICENSE` | FlatBuffers (Apache-2.0), whose headers are compiled into your binary |

Copy their text into whatever licenses screen or acknowledgements file your app
already ships. Nothing generates that screen for you.

::: tip Building from a checkout rather than npm
The two `native/` files are **not in the repository**. `pnpm run download-sdk` brings both.
`pnpm run build-runtime` copies `LICENSE.md` and picks up the crate list only if the SDK's
`scripts/generate-licenses.sh` has produced it, so after a local build `THIRD-PARTY-LICENSES.ssruntime.md`
can be missing — easy to miss, and `prepack` refuses to pack without it. See the [Build Guide](/development/build).
:::

## What this page does not speak for

`react-native-skia`, `react-native-nitro-modules`,
`react-native-reanimated` and `react-native-worklets` are **peer dependencies**:
your application installs them itself, and each carries its own license and
notices. They are named here only so it is clear that this list does not cover
them.
