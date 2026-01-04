import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@dependent-ts/core/js-clustering': resolve(__dirname, 'packages/core/src/js-clustering.ts'),
      '@dependent-ts/core': resolve(__dirname, 'packages/core/src/index.ts'),
    },
  },
})
