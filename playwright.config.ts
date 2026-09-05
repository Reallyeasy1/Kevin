import { defineConfig } from '@playwright/test';

// Mocked e2e only (PRD §18.3). Live Testnet smoke tests are manual and never run here.
const baseURL = process.env.WEB_BASE_URL ?? 'http://localhost:3000';

export default defineConfig({
  testDir: './tests/e2e',
  reporter: 'list',
  use: { baseURL },
  webServer: {
    command: 'pnpm --filter @subbuddy/web dev',
    url: `${baseURL}/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    // The API is mocked by page.route(); this only fixes the origin the page will call.
    env: {
      NEXT_PUBLIC_API_BASE_URL: 'http://localhost:4010',
      NEXT_PUBLIC_DEMO_API_KEY: 'e2e-demo-key',
    },
  },
});
