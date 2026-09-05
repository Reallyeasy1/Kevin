import { vi } from 'vitest';
import type { InferenceOffer } from '@subbuddy/contracts';
import type { LedgerHandle } from './ledger.js';
import type { RawRequirement } from './quote.js';

export const RLUSD_HEX = '524C555344000000000000000000000000000000';
export const ISSUER = 'rQhWct2fv4Vc4KRjRgMrxa8xPN9Zx9iLKV';
export const SELLER = 'rhaDe3NBxgUSLL12N5Sxpii2xy8vSyXNG6';
export const OTHER = 'rN7n7otQDd6FczFgLdSqtcsAUxDkw6fzRH';

export const expected = { network: 'xrpl:1', currencyHex: RLUSD_HEX, issuer: ISSUER } as const;

export const offer: InferenceOffer = {
  offerId: 'offer-1',
  sellerId: 'seller-1',
  displayName: 'Seller One',
  modelId: 'model-x',
  endpoint: 'http://127.0.0.1:8080/v1/inference/offer-1',
  payTo: SELLER,
  network: 'xrpl:1',
  asset: { code: 'RLUSD', currencyHex: RLUSD_HEX, issuer: ISSUER, decimals: 6 },
  capabilities: ['general_chat'],
  contextWindow: 8192,
  supportsTools: false,
  advertisedPrice: '0.006000',
  p50LatencyMs: 800,
  reliability: 0.99,
  qualityByTask: { general_chat: 0.8 },
  enabled: true,
  source: 'curated',
};

export const rawRequirement = (
  over: Partial<RawRequirement> = {},
  extra: Record<string, unknown> = {},
): RawRequirement => ({
  scheme: 'exact',
  network: 'xrpl:1',
  asset: RLUSD_HEX,
  payTo: SELLER,
  amount: '0.006200',
  maxTimeoutSeconds: 60,
  extra: { invoiceId: 'inv-123', issuer: ISSUER, sourceTag: 804681468, ...extra },
  ...over,
});

export interface MockLedgerState {
  validatedIndex: number;
  xrpBalanceDrops: string;
  ownerCount: number;
  iouBalance: string;
  tx?: unknown;
}

/** Mock of the xrpl.js Client surface this package touches. No network. */
export function mockLedger(state: Partial<MockLedgerState> = {}) {
  const s: MockLedgerState = {
    validatedIndex: 1000,
    xrpBalanceDrops: '100000000',
    ownerCount: 1,
    iouBalance: '5',
    ...state,
  };
  const request = vi.fn(async (req: { command: string; [k: string]: unknown }) => {
    switch (req.command) {
      case 'ledger':
        return { result: { ledger_index: s.validatedIndex } };
      case 'account_info':
        return {
          result: { account_data: { Balance: s.xrpBalanceDrops, OwnerCount: s.ownerCount } },
        };
      case 'server_info':
        return {
          result: { info: { validated_ledger: { reserve_base_xrp: 1, reserve_inc_xrp: 0.2 } } },
        };
      case 'account_lines':
        return {
          result: { lines: [{ currency: RLUSD_HEX, balance: s.iouBalance, account: ISSUER }] },
        };
      case 'tx':
        if (s.tx === undefined) {
          const err = new Error('txnNotFound') as Error & { data: { error: string } };
          err.data = { error: 'txnNotFound' };
          throw err;
        }
        return s.tx;
      default:
        throw new Error(`unexpected command ${req.command}`);
    }
  });
  const autofill = vi.fn(async (tx: Record<string, unknown>) => ({
    ...tx,
    Sequence: 42,
    Fee: '12',
    NetworkID: undefined,
  }));
  const client = {
    isConnected: () => true,
    connect: vi.fn(),
    disconnect: vi.fn(),
    request,
    autofill,
  };
  return { handle: client as unknown as LedgerHandle, request, autofill, state: s };
}
