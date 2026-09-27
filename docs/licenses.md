---
title: License and notices
description: What this package puts inside the app you publish, and what you have to say about it.
---

# License and notices

`react-native-spritestudio` is distributed under the **BSD-3-Clause** license,
following the license of SpriteStudio-SDK. Copyright © CRI Middleware Co., Ltd.

- Full text: [`LICENSE.md`](https://github.com/cri-middleware/SSPlayerForReactNative/blob/main/LICENSE.md)
- The authoritative notice list:
  [`THIRD_PARTY_NOTICES.md`](https://github.com/cri-middleware/SSPlayerForReactNative/blob/main/THIRD_PARTY_NOTICES.md)

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

::: tip Working from a checkout rather than npm
The two `native/` files are **not in the repository**. They arrive with the
runtime, so they exist only after `pnpm run download-sdk` or
`pnpm run build-runtime` has run — which is the one thing that makes them easy to
miss. See [Working from a checkout](/development/from-source).
:::

## What this page does not speak for

`@shopify/react-native-skia`, `react-native-nitro-modules`,
`react-native-reanimated` and `react-native-worklets` are **peer dependencies**:
your application installs them itself, and each carries its own license and
notices. They are named here only so it is clear that this list does not cover
them.
