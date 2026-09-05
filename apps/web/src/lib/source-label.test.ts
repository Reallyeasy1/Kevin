import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SourceLabel } from '../../app/components/CandidateTable.js';
import { normalizeRouteList } from './api.js';

describe('SourceLabel (FR-021)', () => {
  it('labels curated offers without a link', () => {
    const html = renderToStaticMarkup(createElement(SourceLabel, { source: 'curated' }));
    expect(html).toContain('curated');
    expect(html).not.toContain('<a ');
  });

  it('labels hub offers and links to the hub listing', () => {
    const html = renderToStaticMarkup(
      createElement(SourceLabel, { source: 'xrpl-ai-hub', hubUrl: 'https://xrpl-ai.org/s/abc' }),
    );
    expect(html).toContain('xrpl-ai-hub');
    expect(html).toContain('href="https://xrpl-ai.org/s/abc"');
    expect(html).toContain('rel="noreferrer noopener"');
  });

  it('labels hub offers without a URL as plain text', () => {
    const html = renderToStaticMarkup(createElement(SourceLabel, { source: 'xrpl-ai-hub' }));
    expect(html).toContain('xrpl-ai-hub');
    expect(html).not.toContain('<a ');
  });
});

describe('normalizeRouteList (US-010)', () => {
  it('reads flat rows and nested receipt rows, dropping rows without a route state', () => {
    const tx = 'A'.repeat(64);
    const out = normalizeRouteList({
      routes: [
        {
          routeId: 'r1',
          createdAt: '2026-09-05T00:00:00Z',
          state: 'SUCCEEDED',
          taskType: 'coding',
          mode: 'balanced',
          sellerName: 'Fast Code',
          quotedCost: '0.006200',
          settledAmount: '0.006200',
          asset: 'RLUSD',
          transactionHash: tx,
        },
        {
          id: 'r2',
          createdAt: '2026-09-05T00:00:00Z',
          state: 'POLICY_REJECTED',
          selected: { offerId: 'x', sellerName: 'Deep', quotedCost: '0.02', asset: 'RLUSD' },
          payment: { amount: null, transactionHash: null },
        },
        { routeId: 'r3', state: 'NOT_A_STATE' },
      ],
      nextCursor: 'c2',
    });
    expect(out.nextCursor).toBe('c2');
    expect(out.routes.map((r) => r.routeId)).toEqual(['r1', 'r2']);
    expect(out.routes[0]).toMatchObject({ taskType: 'coding', mode: 'balanced' });
    expect(out.routes[1]).toMatchObject({ taskType: null, mode: null });
    expect(out.routes[0]?.explorerUrl).toBe(`https://testnet.xrpl.org/transactions/${tx}`);
    expect(out.routes[1]).toMatchObject({
      sellerName: 'Deep',
      quotedCost: '0.02',
      settledAmount: null,
      transactionHash: null,
    });
  });

  it('tolerates an empty or unexpected body', () => {
    expect(normalizeRouteList(null)).toEqual({ routes: [], nextCursor: null });
    expect(normalizeRouteList({ items: [] })).toEqual({ routes: [], nextCursor: null });
  });
});
