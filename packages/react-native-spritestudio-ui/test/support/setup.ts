import { afterEach, vi } from 'vitest'

;(globalThis as { __DEV__?: boolean }).__DEV__ = true
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
;(globalThis as { IS_REACT_NATIVE_TEST_ENVIRONMENT?: boolean }).IS_REACT_NATIVE_TEST_ENVIRONMENT =
  true

afterEach(() => {
  vi.restoreAllMocks()
})
