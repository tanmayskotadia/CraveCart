import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: ['tests/money/workflows.test.ts'],
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 120000,
    env: { NODE_ENV: 'test', LOG_LEVEL: 'silent', MONEY_GATEWAY_MODE: 'test' },
  },
});
