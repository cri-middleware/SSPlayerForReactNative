# Windows cannot cut a release, and this says so rather than producing a broken
# one. A release has to pass check-mask and check-shader, which link the host
# libskia RN Skia ships with a macOS slice and no other, so build-release skips
# them here — and a release cut without them is one nobody checked the drawing
# of.
#
# The `.js` shim next to this file picks between the two by host OS, so this
# exists to make the refusal explicit — without it, `pnpm run release` on Windows
# would fail with "script not found", which reads as a broken repository rather
# than a deliberate limit.

Write-Error @"
release: macOS only.

A release has to pass check-mask and check-shader, and both link a libskia
that RN Skia ships for macOS alone. Releasing from Windows would skip them.

Run `pnpm run release` on macOS, or dispatch release.yml (RELEASING.md, step 5).
Everything else in this repository — including `build-release`, to look at the
tarball — works here.
"@
exit 1
