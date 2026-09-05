import { expect, test, type Page } from '@playwright/test';

/**
 * PRD §18.3: one mocked, no-payment route test. The buyer API is intercepted with page.route(); nothing
 * touches XRPL Testnet. Runs at 360 px (NFR-008) and drives the core flow by keyboard (NFR-007).
 */

const API = 'http://localhost:4010';
const TX = 'E3FE6EA3D48F0C2B14E4B4F5C3A6B2D5E7F8091A2B3C4D5E6F708192A3B4C5D6';
const ROUTE_ID = 'route_e2e_1';
const NOW = '2026-09-05T00:00:00.000Z';

const wallet = {
  address: 'rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe',
  network: 'xrpl:1',
  balances: [
    { asset: 'RLUSD', amount: '5.000000' },
    { asset: 'XRP', amount: '25.000000' },
  ],
};

const candidates = [
  {
    offerId: 'fast-code-v1',
    sellerId: 'seller-b',
    displayName: 'Fast Code',
    eligibility: 'selected',
    rejectionReasons: [],
    qualityScore: '0.9000',
    costScore: '0.8000',
    latencyScore: '0.9500',
    reliabilityScore: '0.9800',
    finalScore: '0.8612',
    estimatedCost: '0.006000',
    quotedCost: '0.006200',
    source: 'curated',
  },
  {
    offerId: 'deep-reasoning-v1',
    sellerId: 'seller-c',
    displayName: 'Deep Reasoning',
    eligibility: 'not_quoted',
    rejectionReasons: [],
    qualityScore: '0.9700',
    costScore: '0.4000',
    latencyScore: '0.6000',
    reliabilityScore: '0.9900',
    finalScore: '0.8021',
    estimatedCost: '0.018000',
    quotedCost: null,
    source: 'curated',
  },
  {
    offerId: 'cheap-text-v1',
    sellerId: 'seller-a',
    displayName: 'Cheap Text',
    eligibility: 'ineligible',
    rejectionReasons: ['capability_mismatch'],
    qualityScore: null,
    costScore: null,
    latencyScore: null,
    reliabilityScore: null,
    finalScore: null,
    estimatedCost: '0.002000',
    quotedCost: null,
    source: 'curated',
  },
];

const routeResponse = {
  routeId: ROUTE_ID,
  state: 'QUOTED',
  expiresAt: '2026-09-05T00:05:00.000Z',
  taskProfile: {
    taskType: 'coding',
    reasoningLevel: 'medium',
    inputModality: 'text',
    estimatedInputTokens: 15,
    requiredContextTokens: 4096,
    toolCallingRequired: false,
    confidence: 0.94,
  },
  selected: {
    offerId: 'fast-code-v1',
    sellerName: 'Fast Code',
    modelId: 'provider/model-b',
    score: '0.8612',
    estimatedCost: '0.006000',
    quotedCost: '0.006200',
    asset: 'RLUSD',
    reason: 'Highest Balanced score for a coding task within the request budget.',
  },
  candidates,
  mandate: {
    maxCost: '0.020000',
    network: 'xrpl:1',
    asset: 'RLUSD',
    expiresAt: '2026-09-05T00:05:00.000Z',
  },
};

function sse(type: string, state: string, payload: Record<string, unknown> = {}) {
  const ev = { eventId: `${type}-1`, routeId: ROUTE_ID, type, timestamp: NOW, state, payload };
  return `event: ${type}\ndata: ${JSON.stringify(ev)}\n\n`;
}

const detail = {
  routeId: ROUTE_ID,
  promptHash: 'a'.repeat(64),
  taskProfile: routeResponse.taskProfile,
  mode: 'quality',
  state: 'SUCCEEDED',
  candidates,
  selectedOfferId: 'fast-code-v1',
  estimatedCost: '0.006000',
  quotedCost: '0.006200',
  policyDecision: { approved: true, checks: [{ name: 'within_max_cost', passed: true }] },
  payment: {
    status: 'SETTLED',
    payerAddress: wallet.address,
    destination: 'rQhWct2fv4Vc4KRjRgMrxa8xPN9Zx9iLKV',
    amount: '0.006200',
    assetCode: 'RLUSD',
    transactionHash: TX,
    explorerUrl: `https://testnet.xrpl.org/transactions/${TX}`,
    ledgerIndex: 1234567,
    validatedAt: NOW,
    failureCode: null,
  },
  execution: {
    status: 'succeeded',
    modelId: 'provider/model-b',
    latencyMs: 1830,
    inputTokens: 15,
    outputTokens: 220,
    failureCode: null,
  },
  createdAt: NOW,
  updatedAt: NOW,
  result: 'Dijkstra runs in O((V + E) log V) with a binary heap.',
};

async function mockApi(
  page: Page,
  seen: { routeBody?: Record<string, unknown>; authHeaders: string[] },
) {
  await page.route(`${API}/v1/wallet`, (r) => r.fulfill({ json: wallet }));
  await page.route(`${API}/v1/routes`, async (r) => {
    seen.routeBody = r.request().postDataJSON() as Record<string, unknown>;
    seen.authHeaders.push(r.request().headers()['authorization'] ?? '');
    await new Promise((res) => setTimeout(res, 700)); // long enough to observe the optimistic state
    await r.fulfill({ status: 201, json: routeResponse });
  });
  await page.route(`${API}/v1/routes/${ROUTE_ID}/execute`, (r) =>
    r.fulfill({
      status: 202,
      json: {
        routeId: ROUTE_ID,
        state: 'POLICY_APPROVED',
        statusUrl: `/v1/routes/${ROUTE_ID}`,
        eventsUrl: `/v1/routes/${ROUTE_ID}/events`,
      },
    }),
  );
  await page.route(`${API}/v1/routes/${ROUTE_ID}/events`, (r) =>
    r.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body:
        sse('route.state_changed', 'SIGNED') +
        sse('payment.submitted', 'PAID_REQUEST_SENT', { transactionHash: TX }) +
        sse('payment.validated', 'VERIFYING', { transactionHash: TX, ledgerIndex: 1234567 }) +
        sse('execution.started', 'VERIFYING', { modelId: 'provider/model-b' }) +
        sse('execution.completed', 'VERIFYING') +
        sse('route.state_changed', 'SUCCEEDED'),
    }),
  );
  await page.route(`${API}/v1/routes/${ROUTE_ID}`, (r) => r.fulfill({ json: detail }));
}

test.use({ viewport: { width: 360, height: 740 } });

test('routes, pays (mocked), and shows answer plus XRPL evidence at 360px by keyboard', async ({
  page,
}) => {
  const seen: { routeBody?: Record<string, unknown>; authHeaders: string[] } = { authHeaders: [] };
  await mockApi(page, seen);
  await page.goto('/');

  // Wallet bar (FR-091, §13.1).
  await expect(page.getByTestId('wallet-address')).toHaveText(wallet.address);
  await expect(page.getByTestId('network-badge')).toHaveText('XRPL Testnet');
  await expect(page.getByLabel('Balances')).toContainText('5.000000');

  // Composer by keyboard (NFR-007): type prompt, arrow to the Quality mode, Enter on the button.
  await page
    .getByLabel('Prompt', { exact: true })
    .fill('Implement Dijkstra and explain its complexity.');
  await page.getByRole('radio', { name: /^balanced/ }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('radio', { name: /^quality/ })).toBeChecked();
  await expect(page.getByLabel('Max cost')).toHaveValue('0.020000');
  await expect(page.getByText('RLUSD', { exact: true }).first()).toBeVisible();

  const status = page.getByTestId('status');
  await expect(status).toHaveAttribute('data-ui-state', 'idle');
  await page.getByRole('button', { name: 'Route and Run' }).focus();
  await page.keyboard.press('Enter');
  // First state update within 300 ms of the action (NFR-002).
  await expect(status).toHaveAttribute('data-ui-state', 'classifying', { timeout: 300 });

  // Terminal state with the answer (US-005) and receipt (FR-090).
  await expect(status).toHaveAttribute('data-ui-state', 'succeeded', { timeout: 15_000 });
  await expect(page.getByTestId('answer')).toContainText('O((V + E) log V)');
  await expect(page.getByTestId('receipt')).toContainText('Economic receipt');

  // Request shape (FR-001, SEC-011): decimal string budget, chosen mode, bearer key.
  expect(seen.routeBody).toMatchObject({ mode: 'quality', maxCost: '0.020000' });
  expect(seen.authHeaders[0]).toBe('Bearer e2e-demo-key');

  // Selected offer card shows estimate vs quote and the rationale (US-003, FR-041).
  const selected = page.getByTestId('selected-offer');
  await expect(selected).toContainText('Fast Code');
  await expect(page.getByTestId('quoted-cost')).toHaveText('0.006200 RLUSD');
  await expect(selected).toContainText('Highest Balanced score');

  // Payment evidence (FR-093, US-006): validated, amount, seller, short hash, copy, explorer link.
  const evidence = page.getByTestId('payment-evidence');
  await expect(page.getByTestId('payment-status')).toHaveText('Validated');
  await expect(evidence).toContainText('0.006200 RLUSD');
  await expect(evidence).toContainText('Fast Code');
  await expect(page.getByTestId('tx-hash')).toHaveText(`${TX.slice(0, 8)}…${TX.slice(-6)}`);
  await expect(page.getByRole('button', { name: 'Copy transaction hash' })).toBeVisible();
  await expect(page.getByTestId('explorer-link')).toHaveAttribute(
    'href',
    `https://testnet.xrpl.org/transactions/${TX}`,
  );
  await expect(evidence).not.toContainText(/fee/i);

  // Candidate table (FR-092, §13.3): estimated vs quoted labels and all statuses.
  const table = page.getByTestId('candidates');
  const fastCode = table.getByRole('row').filter({ hasText: 'Fast Code' });
  await expect(fastCode).toContainText('0.006000 estimated');
  await expect(fastCode).toContainText('0.006200 quoted');
  await expect(fastCode).toContainText('Selected');
  const deep = table.getByRole('row').filter({ hasText: 'Deep Reasoning' });
  await expect(deep).toContainText('0.018000 estimated');
  await expect(deep).not.toContainText(/[0-9] quoted/);
  await expect(deep).toContainText('Not quoted');
  await expect(table.getByRole('row').filter({ hasText: 'Cheap Text' })).toContainText(
    'Ineligible',
  );

  // Usable at 360 px (NFR-008): the page body never scrolls horizontally.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
