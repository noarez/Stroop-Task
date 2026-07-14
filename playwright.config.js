// @ts-check
const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',

  /* Run tests in sequence — experiment state is session-based */
  fullyParallel: false,
  workers: 1,

  /* Retry once on CI */
  retries: process.env.CI ? 1 : 0,

  /* Reporter */
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
  ],

  use: {
    /* The app is already served by `npx serve` */
    baseURL: 'http://localhost:52630',

    /* Collect traces and screenshots on failure */
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',

    /* Hebrew keyboard layout support */
    locale: 'he-IL',

    /* Generous timeout for animated transitions */
    actionTimeout: 5_000,
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  /* Shared timeout per test */
  timeout: 60_000,
  expect: { timeout: 5_000 },
});
