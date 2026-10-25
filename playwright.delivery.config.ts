import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests/delivery-browser',
  outputDir: 'test-results/delivery',
  workers: 1,
  timeout: 240000,
  reporter: 'list',
  use: {
    baseURL: process.env.BROWSER_BASE_URL,
    actionTimeout: 20000,
    navigationTimeout: 25000,
    screenshot: 'only-on-failure',
    trace: 'off',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
});
