import { defineConfig } from '@playwright/test';

// Mocked e2e only (PRD §18.3). Live Testnet smoke tests are manual and never run here.
// WEB_PORT picks the port the server is started on (default 3000). The server is always started by
// Playwright so an unrelated app already listening on that port is never mistaken for SubBuddy.
const port = process.env.WEB_PORT ?? '3000';
const baseURL = `http://localhost:${port}`;
const web = 'pnpm --filter @subbuddy/web exec next';

export default defineConfig({
  testDir: './tests/e2e',
  reporter: 'list',
  use: { baseURL, trace: 'retain-on-failure' },
  webServer: {
    // Production build, not `next dev`: with workers running in parallel, one test's first visit to /history
    // makes the dev server compile that page and Fast Refresh then full-reloads every other open page,
    // wiping the in-flight route the outcome-unknown spec is asserting on (seen on CI, not on warm local runs).
    command: `${web} build --webpack && ${web} start --port ${port}`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 300_000,
    // The API is mocked by page.route(); this only fixes the origin the page will call (inlined at build time).
    env: {
      // Own distDir so the e2e build never collides with a running `next dev` in .next.
      NEXT_DIST_DIR: process.env.NEXT_DIST_DIR ?? '.next-e2e',
      NEXT_PUBLIC_API_BASE_URL: 'http://localhost:4010',
      NEXT_PUBLIC_DEMO_API_KEY: 'e2e-demo-key',
    },
  },
});
