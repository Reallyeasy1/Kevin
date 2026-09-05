/**
 * In-memory XRPL ledger: the fake seller "settles" into it, the real X402PaymentClient resolves from it.
 * Only the xrpl.js Client surface that resolveTransaction touches is implemented (`tx`, `ledger`).
 */
import type { LedgerHandle } from '../../packages/payments/src/ledger.js';
import { ISSUER } from './env.js';

export interface LedgerFact {
  destination: string;
  amount: string;
  asset: string;
  ledgerIndex: number;
  resultCode: string;
  validatedAt: string;
}

export class FakeLedger {
  validatedIndex = 1000;
  readonly txs = new Map<string, LedgerFact>();

  settle(
    hash: string,
    fact: Pick<LedgerFact, 'destination' | 'amount' | 'asset'>,
    resultCode = 'tesSUCCESS',
  ): LedgerFact {
    this.validatedIndex += 1;
    const full: LedgerFact = {
      ...fact,
      ledgerIndex: this.validatedIndex,
      resultCode,
      validatedAt: new Date().toISOString(),
    };
    this.txs.set(hash, full);
    return full;
  }

  readonly handle: LedgerHandle = {
    isConnected: () => true,
    connect: async () => undefined,
    disconnect: async () => undefined,
    request: async (req: { command: string; transaction?: string }) => {
      if (req.command === 'ledger') return { result: { ledger_index: this.validatedIndex } };
      if (req.command === 'tx') {
        const fact = this.txs.get(req.transaction ?? '');
        if (!fact) {
          const err = new Error('txnNotFound') as Error & { data: { error: string } };
          err.data = { error: 'txnNotFound' };
          throw err;
        }
        const amount =
          fact.asset === 'XRP'
            ? fact.amount
            : { currency: fact.asset, issuer: ISSUER, value: fact.amount };
        return {
          result: {
            validated: true,
            ledger_index: fact.ledgerIndex,
            close_time_iso: fact.validatedAt,
            meta: { TransactionResult: fact.resultCode, delivered_amount: amount },
            tx_json: { Destination: fact.destination, Amount: amount },
          },
        };
      }
      throw new Error(`fake ledger: unexpected command ${req.command}`);
    },
  } as unknown as LedgerHandle;
}
