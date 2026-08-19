import { defineConfig } from 'vitest/config'

// Web e2e lane (harness layer 3): a REAL dsh web composition with the
// packed market installed, driven by real Chromium (playwright as a
// library). Serial and slow; runs as its own CI job (`npm run test:web`).
// Specs skip when no dsh CLI is reachable (see tests/web/scaffold.ts).
export default defineConfig({
  test: {
    include: ['tests/web/**/*.e2e.ts'],
    testTimeout: 180_000,
    hookTimeout: 300_000,
    fileParallelism: false,
  },
})
