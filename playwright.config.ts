import { defineConfig } from '@playwright/test';

// Mocked e2e only (PRD §18.3). Live Testnet smoke tests are manual and never run here.
// WEB_PORT picks the port the dev server is started on (default 3000). The server is always started by
// Playwright so an unrelated app already listening on that port is never mistaken for SubBuddy.
const port = process.env.WEB_PORT ?? '3000';
const baseURL = `http://localhost:${port}`;

export default defineConfig({
  testDir: './tests/e2e',
  reporter: 'list',
  use: { baseURL },
  webServer: {
    command: `pnpm --filter @subbuddy/web exec next dev --webpack --port ${port}`,
    // Probing `/` (not /health) makes next dev compile the home page before the first test navigates to it.
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
    // The API is mocked by page.route(); this only fixes the origin the page will call.
    env: {
      NEXT_PUBLIC_API_BASE_URL: 'http://localhost:4010',
      NEXT_PUBLIC_DEMO_API_KEY: 'e2e-demo-key',
    },
  },
});
