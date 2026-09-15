import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vitest/config'

/**
 * The three packages that make `player/` and `view/` unimportable in node.
 *
 * Aliased rather than `vi.mock`ed because they are reached *transitively* —
 * `SsTextureLoader` pulls Skia in at module scope, so a test of Layer 3 that
 * never mentions Skia still fails to import without this. The behaviour under
 * test is stubbed one layer in, at the package's own modules; these three only
 * have to be importable and inspectable.
 */
const stub = (name: string): string =>
  fileURLToPath(new URL(`./test/support/stubs/${name}.ts`, import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      'react-native': stub('react-native'),
      '@shopify/react-native-skia': stub('skia'),
      'react-native-reanimated': stub('reanimated'),
    },
  },
  test: {
    setupFiles: ['./test/support/setup.ts'],
  },
})
