import { expect, test } from '@playwright/test';

/**
 * US-010: /history lists completed routes from GET /v1/routes?limit=&cursor= (mocked, no network).
 * Runs at 360 px (NFR-008) and drives load-more and the route link by keyboard (NFR-007).
 */

const API = 'http://localhost:4010';
const TX = 'E3FE6EA3D48F0C2B14E4B4F5C3A6B2D5E7F8091A2B3C4D5E6F708192A3B4C5D6';

const page1 = {
  routes: [
    {
      routeId: 'route_h1',
      createdAt: '2026-09-05T00:00:00.000Z',
      state: 'SUCCEEDED',
      taskType: 'coding',
      mode: 'balanced',
      sellerName: 'Fast Code',
      quotedCost: '0.006200',
      settledAmount: '0.006200',
      asset: 'RLUSD',
      transactionHash: TX,
      explorerUrl: `https://testnet.xrpl.org/transactions/${TX}`,
    },
    {
      routeId: 'route_h2',
      createdAt: '2026-09-04T23:00:00.000Z',
      state: 'POLICY_REJECTED',
      sellerName: 'Deep Reasoning',
      quotedCost: '0.025000',
      settledAmount: null,
      asset: 'RLUSD',
      transactionHash: null,
      explorerUrl: null,
    },
  ],
  nextCursor: 'cursor_2',
};
const page2 = {
  routes: [
    {
      routeId: 'route_h4',
      createdAt: '2026-09-04T22:30:00.000Z',
      state: 'PAID_EXECUTION_FAILED',
      taskType: 'coding',
      mode: 'fastest',
      sellerName: 'Fast Code',
      quotedCost: '0.006200',
      settledAmount: '0.006200',
      asset: 'RLUSD',
      transactionHash: TX,
      explorerUrl: `https://testnet.xrpl.org/transactions/${TX}`,
    },
    {
      routeId: 'route_h3',
      createdAt: '2026-09-04T22:00:00.000Z',
      state: 'NO_ELIGIBLE_OFFER',
      sellerName: null,
      quotedCost: null,
      settledAmount: null,
      asset: null,
      transactionHash: null,
      explorerUrl: null,
    },
  ],
  nextCursor: null,
};

test.use({ viewport: { width: 360, height: 740 } });

test('lists completed routes with quoted vs settled amounts, explorer links, and load-more', async ({
  page,
}) => {
  const queries: string[] = [];
  // Predicate, not a glob: `?` is a wildcard in Playwright globs and would swallow /v1/routes/:id too.
  await page.route(
    (url) => url.origin === API && url.pathname === '/v1/routes',
    (r) => {
      const url = new URL(r.request().url());
      queries.push(url.search);
      return r.fulfill({ json: url.searchParams.get('cursor') === 'cursor_2' ? page2 : page1 });
    },
  );
  await page.route(`${API}/v1/wallet`, (r) =>
    r.fulfill({
      json: { address: 'rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe', network: 'xrpl:1', balances: [] },
    }),
  );
  await page.route(`${API}/v1/offers`, (r) =>
    r.fulfill({ json: { registryVersion: 'v1', offers: [], hubStatus: { available: false } } }),
  );

  await page.goto('/');
  // Linked from the main page (US-010) and the hub notice is non-blocking (FR-021).
  await expect(page.getByTestId('hub-notice')).toContainText('Hub discovery unavailable');
  await expect(page.getByRole('button', { name: 'Route and Run' })).toBeEnabled();
  await page.getByRole('link', { name: 'History' }).click();
  await expect(page).toHaveURL(/\/history$/);

  const list = page.getByTestId('history');
  await expect(list.getByRole('listitem')).toHaveCount(2);
  expect(queries[0]).toBe('?limit=20');

  const first = list.getByRole('listitem').first();
  await expect(first.getByTestId('history-state')).toHaveText('SUCCEEDED');
  await expect(first).toContainText('Fast Code');
  await expect(first.getByTestId('history-task')).toHaveText('coding · balanced mode');
  await expect(first).toContainText('0.006200 quoted');
  await expect(first).toContainText('0.006200 RLUSD settled');
  const tx = first.getByTestId('history-tx');
  await expect(tx).toHaveText(`${TX.slice(0, 8)}…${TX.slice(-6)}`);
  await expect(tx).toHaveAttribute('href', `https://testnet.xrpl.org/transactions/${TX}`);

  const second = list.getByRole('listitem').nth(1);
  await expect(second.getByTestId('history-state')).toHaveText('POLICY_REJECTED');
  await expect(second).toContainText('0.025000 quoted');
  await expect(second).toContainText('nothing settled');
  await expect(second.getByTestId('history-tx')).toHaveCount(0);
  await expect(second.getByTestId('history-task')).toHaveCount(0); // fields absent: label hidden

  // Load more by keyboard (NFR-007); the cursor from page 1 is sent back.
  await page.getByRole('button', { name: 'Load more' }).focus();
  await page.keyboard.press('Enter');
  await expect(list.getByRole('listitem')).toHaveCount(4);
  // FR-081 / §13.4: a paid-execution failure is flagged and says payment succeeded but delivery did not.
  const paidFailed = list.getByRole('listitem').nth(2);
  await expect(paidFailed.getByTestId('history-state')).toHaveText('⚠ PAID_EXECUTION_FAILED');
  await expect(paidFailed.getByTestId('history-task')).toHaveText('coding · fastest mode');
  await expect(paidFailed.getByTestId('history-warning')).toContainText(
    'Payment was validated, but the seller could not complete inference. No second provider was purchased.',
  );
  await expect(first.getByTestId('history-warning')).toHaveCount(0);
  // dev-mode StrictMode may run the initial effect twice; only the latest request matters.
  expect(queries.at(-1)).toBe('?limit=20&cursor=cursor_2');
  await expect(page.getByRole('button', { name: 'Load more' })).toHaveCount(0);

  // Usable at 360 px (NFR-008): no horizontal page scroll.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);

  // Each row links to the read-only route view (US-010).
  await first.getByRole('link', { name: 'Fast Code' }).focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/\?route=route_h1$/);
});
