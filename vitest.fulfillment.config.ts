import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: ['tests/fulfillment/**/*.test.ts', 'tests/assistant/**/*.test.ts'],
    fileParallelism: false,
    testTimeout: 60000,
    hookTimeout: 120000,
    env: { NODE_ENV: 'test', LOG_LEVEL: 'silent' },
  },
});
