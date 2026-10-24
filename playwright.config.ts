import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser', fullyParallel: true, workers: 3, reporter: 'list',
  use: {baseURL: 'http://127.0.0.1:4173', trace: 'retain-on-failure'},
  projects: [{name: 'desktop', use: {...devices['Desktop Chrome']}}, {name: 'mobile', use: {...devices['Pixel 7']}}],
  webServer: {command: 'npm run preview --workspace @cravecart/web', url: 'http://127.0.0.1:4173', reuseExistingServer: !process.env.CI},
});
