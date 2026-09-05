import { expect, test, type Page } from '@playwright/test';

/**
 * NFR-003 / FR-093 / INV-009: when the execute response is lost, the UI shows the payment outcome as
 * pending and resolves it by polling GET /v1/routes/:id. The payment badge must never read "Validated"
 * before the receipt says SETTLED. Mocked API, no network to XRPL (PRD §18.3).
 */

const API = 'http://localhost:4010';
const TX = 'E3FE6EA3D48F0C2B14E4B4F5C3A6B2D5E7F8091A2B3C4D5E6F708192A3B4C5D6';
const ROUTE_ID = 'route_e2e_unknown';
const NOW = '2026-09-05T00:00:00.000Z';

const wallet = {
  address: 'rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe',
  network: 'xrpl:1',
  balances: [{ asset: 'RLUSD', amount: '5.000000' }],
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
];

const taskProfile = {
  taskType: 'coding',
  reasoningLevel: 'medium',
  inputModality: 'text',
  estimatedInputTokens: 15,
  requiredContextTokens: 4096,
  toolCallingRequired: false,
  confidence: 0.94,
};

const routeResponse = {
  routeId: ROUTE_ID,
  state: 'QUOTED',
  expiresAt: '2026-09-05T00:05:00.000Z',
  taskProfile,
  classifierSource: 'llm',
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

const payment = (status: string, settled: boolean) => ({
  status,
  payerAddress: wallet.address,
  destination: 'rQhWct2fv4Vc4KRjRgMrxa8xPN9Zx9iLKV',
  amount: '0.006200',
  assetCode: 'RLUSD',
  transactionHash: TX,
  explorerUrl: `https://testnet.xrpl.org/transactions/${TX}`,
  ledgerIndex: settled ? 1234567 : null,
  validatedAt: settled ? NOW : null,
  failureCode: null,
});

const detailBase = {
  routeId: ROUTE_ID,
  promptHash: 'a'.repeat(64),
  taskProfile,
  mode: 'balanced',
  candidates,
  selectedOfferId: 'fast-code-v1',
  selected: routeResponse.selected,
  estimatedCost: '0.006000',
  quotedCost: '0.006200',
  policyDecision: { approved: true, checks: [{ name: 'within_max_cost', passed: true }] },
  expiresAt: '2026-09-05T00:05:00.000Z',
  createdAt: NOW,
  updatedAt: NOW,
};

/** Receipt snapshots in the order the poller sees them: OUTCOME_UNKNOWN -> SETTLED (VERIFYING) -> SUCCEEDED. */
const snapshots = [
  {
    ...detailBase,
    state: 'OUTCOME_UNKNOWN',
    payment: payment('OUTCOME_UNKNOWN', false),
    execution: {
      status: 'pending',
      modelId: null,
      latencyMs: null,
      inputTokens: null,
      outputTokens: null,
      failureCode: null,
    },
    result: null,
  },
  {
    ...detailBase,
    state: 'VERIFYING',
    payment: payment('SETTLED', true),
    execution: {
      status: 'running',
      modelId: 'provider/model-b',
      latencyMs: null,
      inputTokens: null,
      outputTokens: null,
      failureCode: null,
    },
    result: null,
  },
  {
    ...detailBase,
    state: 'SUCCEEDED',
    payment: payment('SETTLED', true),
    execution: {
      status: 'succeeded',
      modelId: 'provider/model-b',
      latencyMs: 1830,
      inputTokens: 15,
      outputTokens: 220,
      failureCode: null,
    },
    result: 'Dijkstra runs in O((V + E) log V) with a binary heap.',
  },
];

async function mockApi(page: Page, served: string[]) {
  await page.route(`${API}/v1/wallet`, (r) => r.fulfill({ json: wallet }));
  await page.route(`${API}/v1/offers`, (r) =>
    r.fulfill({ json: { registryVersion: 'v1', offers: [] } }),
  );
  await page.route(`${API}/v1/routes`, (r) => r.fulfill({ status: 201, json: routeResponse }));
  // The execute call is lost after the server may have paid: a 5xx, not a 4xx, so the UI must not claim failure.
  await page.route(`${API}/v1/routes/${ROUTE_ID}/execute`, (r) =>
    r.fulfill({
      status: 502,
      json: { error: { code: 'INTERNAL_ERROR', message: 'upstream reset', retryable: true } },
    }),
  );
  let polls = 0;
  await page.route(`${API}/v1/routes/${ROUTE_ID}`, (r) => {
    const snap = snapshots[Math.min(polls++, snapshots.length - 1)] as (typeof snapshots)[number];
    served.push(snap.payment.status);
    return r.fulfill({ json: snap });
  });
}

test('shows the payment as pending through OUTCOME_UNKNOWN and validates only once SETTLED', async ({
  page,
}) => {
  const served: string[] = [];
  await mockApi(page, served);
  await page.goto('/');

  // Record every text the payment badge ever shows, in order, so a transient "Validated" cannot slip by.
  await page.evaluate(() => {
    const w = window as unknown as { __badges: string[] };
    w.__badges = [];
    const seen = new Set<Element>();
    const observe = () => {
      for (const el of Array.from(document.querySelectorAll('[data-testid="payment-status"]'))) {
        if (!seen.has(el)) {
          seen.add(el);
          new MutationObserver(() => w.__badges.push(el.textContent ?? '')).observe(el, {
            childList: true,
            characterData: true,
            subtree: true,
          });
        }
        const last = w.__badges[w.__badges.length - 1];
        if (last !== el.textContent) w.__badges.push(el.textContent ?? '');
      }
    };
    new MutationObserver(observe).observe(document.body, { childList: true, subtree: true });
  });

  await page.getByLabel('Prompt', { exact: true }).fill('Implement Dijkstra.');
  await page.getByRole('button', { name: 'Route and Run' }).click();

  const status = page.getByTestId('status');
  const badge = page.getByTestId('payment-status');

  // Lost execute response -> OUTCOME_UNKNOWN, resolved by hash; the badge is Pending, not Validated.
  await expect(status).toContainText('Outcome unknown', { timeout: 10_000 });
  await expect(badge).toHaveText('Pending');
  await expect(page.getByTestId('tx-hash')).toHaveText(`${TX.slice(0, 8)}…${TX.slice(-6)}`);
  await expect(status).toHaveAttribute('data-ui-state', 'payment_pending');
  expect(served).toEqual(['OUTCOME_UNKNOWN']);

  // Second poll returns SETTLED: only now may the UI read Validated (INV-009).
  await expect(badge).toHaveText('Validated', { timeout: 10_000 });
  expect(served.slice(0, 2)).toEqual(['OUTCOME_UNKNOWN', 'SETTLED']);

  // Terminal: SUCCEEDED with the answer, usage, and provider latency (US-005, #90).
  await expect(status).toHaveAttribute('data-ui-state', 'succeeded', { timeout: 15_000 });
  await expect(page.getByTestId('answer')).toContainText('O((V + E) log V)');
  await expect(page.getByTestId('usage')).toHaveText(
    '15 input tokens · 220 output tokens · 1830 ms provider latency',
  );

  // Routing mode and classifier source on the selected-offer card (#88, FR-010).
  await expect(page.getByTestId('routing-mode')).toHaveText('balanced mode');
  await expect(page.getByTestId('classifier-source')).toContainText('classified by LLM');

  // The badge never read Validated before the SETTLED receipt was served.
  const badges = await page.evaluate(() => (window as unknown as { __badges: string[] }).__badges);
  const firstValidated = badges.indexOf('Validated');
  expect(firstValidated).toBeGreaterThan(0);
  expect(badges.slice(0, firstValidated).every((b) => b === 'Pending')).toBe(true);
  expect(served[1]).toBe('SETTLED');
});
