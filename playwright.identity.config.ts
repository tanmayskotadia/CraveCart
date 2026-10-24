import { defineConfig, devices } from '@playwright/test';

// Run against `npm run dev` and a local MongoDB replica set; no provider calls.
export default defineConfig({
  testDir: './tests/live',
  workers: 1,
  timeout: 90_000,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5173',
    actionTimeout: 15_000,
    navigationTimeout: 20_000,
    trace: 'off',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
});
