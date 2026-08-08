import { NitroModules } from 'react-native-nitro-modules'

import type { SsRuntime } from './specs/SsRuntime.nitro'

/**
 * Layer 1, the module root. One instance per app.
 *
 * Its own module rather than a member of `index.ts` so `core/` can reach it
 * without importing the package barrel, which would be a cycle.
 */
export const SsRuntimeModule =
  NitroModules.createHybridObject<SsRuntime>('SsRuntime')
