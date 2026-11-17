import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  outputDir: '.artifacts/test-results',
  timeout: 30000,
  expect: {
    timeout: 5000,
  },
  fullyParallel: false,
  reporter: [
    ['list'],
    ['html', { outputFolder: '.artifacts/playwright-report', open: 'never' }],
  ],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    viewport: { width: 1280, height: 720 },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      command: 'pnpm --filter example-basic-scroll run preview --port 4173 --host 127.0.0.1',
      url: 'http://127.0.0.1:4173',
      reuseExistingServer: false,
      timeout: 30000,
    },
    {
      command: 'pnpm --filter example-layered-composition run preview --port 4174 --host 127.0.0.1',
      url: 'http://127.0.0.1:4174',
      reuseExistingServer: false,
      timeout: 30000,
    },
    {
      command: 'pnpm --filter example-nextjs run start -p 4175 -H 127.0.0.1',
      url: 'http://127.0.0.1:4175',
      reuseExistingServer: false,
      timeout: 30000,
    },
    {
      command: 'pnpm --filter example-astro run preview --port 4176 --host 127.0.0.1',
      url: 'http://127.0.0.1:4176',
      reuseExistingServer: false,
      timeout: 30000,
    },
  ],
});
