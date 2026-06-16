import { defineConfig } from 'vitest/config'

// Single Vitest project: jsdom for everything (cheap, works for both worker
// modules and React component tests). The worker bits don't depend on real
// Cloudflare runtime APIs (we mock fetch + AI binding + Supabase).
export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./test/setup.ts'],
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts', 'web/src/**/*.ts', 'web/src/**/*.tsx'],
      exclude: ['**/*.d.ts', 'web/src/main.tsx'],
    },
  },
  resolve: {
    alias: {
      // Match the tsconfig paths used by the worker so tests can import from src.
    },
  },
})
