import { defineConfig } from 'vitest/config'

// Separate config from `vite.config.ts` on purpose. The CF Vite plugin
// configures the SSR environment in a way that vitest can't load (it's not
// running a Worker — it's a node-side test runner). Keeping vitest's
// pipeline plain keeps tests fast and predictable.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    globals: false,
  },
  resolve: {
    alias: {
      '#': new URL('./src', import.meta.url).pathname,
    },
  },
})
