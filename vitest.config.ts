import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    root: './tests/typings',
    typecheck: {
      enabled: true,
      only: true,
    },
  },
})
