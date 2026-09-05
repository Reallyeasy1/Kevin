/** AT-010: Commission exclusion (PRD §17, INV-008, DEC-007). Issue #39. */
import { describe, expect, it } from 'vitest';
import { SELLER } from '../fakes/env.js';
import { createHarness } from '../fakes/harness.js';

describe('AT-010: Commission exclusion', () => {
  it.each(['balanced', 'quality', 'cheapest', 'fastest'] as const)(
    'mode %s: exactly one commercial payment to the seller, no router-fee payment, no commission in the total',
    async (mode) => {
      const h = await createHarness();
      const body = (await h.route({ mode })).json();
      expect(body.state).toBe('QUOTED');
      await h.execute(body.routeId);
      expect(await h.terminal(body.routeId)).toBe('SUCCEEDED');

      // Payment records: exactly one row, for the selected seller, for the quoted amount.
      const rows = await h.paymentRows();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        routeId: body.routeId,
        destination: SELLER,
        status: 'SETTLED',
      });
      expect(rows[0]!.amount.toFixed(6)).toBe(body.selected.quotedCost);

      // XRPL transactions: exactly one, to the seller, for the quoted amount; nothing to any other address.
      expect(h.ledger.txs.size).toBe(1);
      const [fact] = [...h.ledger.txs.values()];
      expect(fact).toMatchObject({ destination: SELLER, amount: body.selected.quotedCost });
      expect(h.signCalls).toHaveLength(1);
      expect(h.signCalls[0]).toMatchObject({
        destination: SELLER,
        amount: body.selected.quotedCost,
      });

      // Displayed total: the receipt carries the quoted cost only; no fee/commission field anywhere.
      const receipt = await h.receipt(body.routeId);
      expect(receipt.quotedCost).toBe(body.selected.quotedCost);
      expect(receipt.payment.amount).toBe(body.selected.quotedCost);
      expect(JSON.stringify(receipt).toLowerCase()).not.toMatch(
        /commission|platformfee|routerfee|"fee"/,
      );
      expect(Object.keys(receipt.payment).sort()).toEqual(
        [
          'amount',
          'assetCode',
          'destination',
          'explorerUrl',
          'failureCode',
          'ledgerIndex',
          'payerAddress',
          'status',
          'transactionHash',
          'validatedAt',
        ].sort(),
      );
    },
  );
});
