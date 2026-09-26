# Third-Party Notices

This file contains the license notices for third-party libraries used in
**SpriteStudio Player for React Native**.

We would like to thank the authors and contributors of these open-source projects.

**Who this is for.** Unlike a plugin that ships as a downloadable add-on, this
package is compiled into *your* application: FlatBuffers and `libssruntime` end
up inside the `.ipa` / `.aab` you publish. The obligations below therefore fall
on the app you ship, not only on this repository — see the Distribution Note.

---

## FlatBuffers

This project depends on FlatBuffers for binary data serialization. It is
vendored as a submodule at `packages/react-native-spritestudio/third_party/flatbuffers`
and is header-only: `SsPlayer.podspec` and `android/CMakeLists.txt` put its
`include/` on the compiler's path, so the reachable code is compiled into the
application binary.

Copyright (c) 2014 Google Inc.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.

The complete Apache License 2.0 text is included in the submodule, at
`packages/react-native-spritestudio/third_party/flatbuffers/LICENSE`.

---

## SpriteStudio-SDK

This project integrates `SpriteStudio-SDK` (`libssruntime`) through Nitro
Modules (JSI). The runtime is a static library and is linked into the
application binary.

Copyright (c) CRI Middleware Co., Ltd. All rights reserved.

`SpriteStudio-SDK` is licensed under the BSD-3-Clause License.

### Rust Runtime Dependencies

`libssruntime` is written in Rust and depends on various third-party
open-source crates — 20 under Apache-2.0, 3 under BSD-3-Clause, 1 under MIT and
1 under the Unicode License v3.

**License Location:**
Because the runtime binaries are generated artifacts and are not checked into
this repository, the corresponding license documents arrive with the runtime
during setup. After running `npm run download-sdk` (or `npm run build-runtime`),
you will find them in `packages/react-native-spritestudio/native/`:

* `THIRD-PARTY-LICENSES.ssruntime.md` — the Rust crates
* `LICENSE.md` — the runtime itself

**Distribution Note:**
If you publish an application built with this package, `libssruntime` and the
FlatBuffers headers are inside the binary you distribute. Include these notices
in whatever licenses screen or acknowledgements file your app ships:

* `packages/react-native-spritestudio/native/LICENSE.md`
* `packages/react-native-spritestudio/native/THIRD-PARTY-LICENSES.ssruntime.md`
* `packages/react-native-spritestudio/third_party/flatbuffers/LICENSE`

The first two are not in this repository until setup has run, which is the one
thing that makes this easy to miss.

---

## Nitro Modules

The JSI bindings under `packages/react-native-spritestudio/nitrogen/generated/`
are produced by nitrogen, are committed to this repository, and carry their
generator's copyright header.

Copyright © Marc Rousavy @ Margelo

`react-native-nitro-modules` is licensed under the MIT License.

---

## Peer dependencies

`react-native-nitro-modules`, `@shopify/react-native-skia`,
`react-native-reanimated` and `react-native-worklets` are peer dependencies:
your application installs them itself, and each carries its own license and
notices. They are listed here only so it is clear that this file does not
speak for them.
