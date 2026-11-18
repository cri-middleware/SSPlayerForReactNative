import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vitest/config'

const stub = (name: string): string =>
  fileURLToPath(new URL(`./test/support/stubs/${name}`, import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      'react-native-spritestudio': stub('spritestudio.tsx'),
      'react-native': stub('react-native.ts'),
    },
  },
  test: {
    setupFiles: ['./test/support/setup.ts'],
  },
})
