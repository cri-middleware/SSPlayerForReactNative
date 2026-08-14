import type { SsRuntime } from './specs/SsRuntime.nitro'
import { unavailableObjectOnWeb } from './web/unavailable'

/**
 * Layer 1 on web — the module that is not there.
 *
 * A platform twin of `runtime.ts` rather than something only `index.web.ts`
 * reaches, so that anything resolving `./runtime` on web gets this package's
 * message instead of Nitro's `Native NitroModules are not available on web!`.
 */
export const SsRuntimeModule = unavailableObjectOnWeb<SsRuntime>('SsRuntimeModule')
