import { Client } from 'xrpl';
import type { XrplNetworkId } from '@subbuddy/contracts';
import { PaymentError } from './errors.js';

/**
 * Opaque handle around an xrpl.js Client (PRD §10.3 adapter boundary).
 * Create with `createLedgerClient`; nothing outside this package inspects it.
 */
export interface LedgerHandle {
  readonly kind: 'xrpl-ledger';
}

export function createLedgerClient(wsUrl: string): LedgerHandle {
  return new Client(wsUrl) as unknown as LedgerHandle;
}

/** Internal: unwrap the handle. Tests pass a mock cast to LedgerHandle. */
export async function asClient(handle: LedgerHandle): Promise<Client> {
  const client = handle as unknown as Client;
  if (!client.isConnected()) {
    await withBackoff(() => client.connect(), { retries: 3 });
  }
  return client;
}

/** SEC-010: Mainnet is never acceptable while APP_ENV=hackathon. */
export function assertNotMainnet(network: XrplNetworkId): void {
  if (network === 'xrpl:0' && process.env.APP_ENV === 'hackathon') {
    throw new PaymentError('SELLER_MISCONFIGURED', 'Mainnet is not allowed in hackathon mode');
  }
}

export interface BackoffOptions {
  /** Retries after the first attempt. Default 4. */
  retries?: number;
  baseMs?: number;
  maxMs?: number;
  retryOn?: (err: unknown) => boolean;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Bounded exponential backoff for every network poll (§14, SEC-004). */
export async function withBackoff<T>(fn: () => Promise<T>, opts: BackoffOptions = {}): Promise<T> {
  const retries = opts.retries ?? 4;
  const baseMs = opts.baseMs ?? 250;
  const maxMs = opts.maxMs ?? 4_000;
  const sleep = opts.sleep ?? defaultSleep;
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= retries || (opts.retryOn && !opts.retryOn(err))) throw err;
      await sleep(Math.min(maxMs, baseMs * 2 ** attempt));
    }
  }
}

/** Latest validated ledger index. */
export async function validatedLedgerIndex(client: Client): Promise<number> {
  const resp = await client.request({ command: 'ledger', ledger_index: 'validated' });
  const idx = resp.result.ledger_index;
  if (typeof idx !== 'number') throw new Error('ledger_index missing');
  return idx;
}
