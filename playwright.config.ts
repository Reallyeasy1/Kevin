import { defineConfig } from '@playwright/test';

// Mocked e2e only (PRD §18.3). Live Testnet smoke tests are manual and never run here.
export default defineConfig({
  testDir: './tests/e2e',
  reporter: 'list',
  use: { baseURL: process.env.WEB_BASE_URL ?? 'http://localhost:3000' },
});
