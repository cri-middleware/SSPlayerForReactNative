import { afterEach, beforeEach, vi } from 'vitest'

import { installFrameClock } from './frameClock'

// Metro defines `__DEV__` and node does not. Left on, because the dev-only
// warnings — an unresolved atlas, a skinned mesh under a follower — are among
// the things worth asserting.
;(globalThis as { __DEV__?: boolean }).__DEV__ = true

// What `act()` checks before it will batch anything. Without it every render in
// `render.tsx` warns that the environment does not support act.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// react-test-renderer's own escape hatch: with this off it announces its
// deprecation through `console.error` on every render, which would land in
// whichever test happens to be spying on `console.error`. It also turns
// concurrent rendering off, so `render.tsx` asks for it back explicitly.
;(globalThis as { IS_REACT_NATIVE_TEST_ENVIRONMENT?: boolean }).IS_REACT_NATIVE_TEST_ENVIRONMENT =
  true

beforeEach(installFrameClock)

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
