# Windows cannot cut a release, and this says so rather than producing a broken
# one. The tarball carries the Brain's iOS xcframework; only Xcode builds it, so
# a release from here would ship an Android-only package that installs and then
# fails to link on iOS. `build-runtime.ps1` draws the same line for the same
# reason.
#
# The `.js` shim next to this file picks between the two by host OS, so this
# exists to make the refusal explicit — without it, `npm run release` on Windows
# would fail with "script not found", which reads as a broken repository rather
# than a deliberate limit.

Write-Error @"
release: macOS only.

The published tarball bundles the Brain's iOS xcframework, and only Xcode can
build one. Releasing from Windows would ship a package that installs and then
fails to link on iOS, with nothing in it to say why.

Run `npm run release` on macOS. Everything else in this repository — including
`build-runtime` for the Android slices — works here.
"@
exit 1
