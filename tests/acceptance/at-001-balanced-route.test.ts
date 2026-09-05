/**
 * AT-001: Successful balanced route (PRD §17). Mocked variant runs here: real API, real repository (in-memory
 * DB), real X402PaymentClient over HTTP to the fake seller, fake ledger + fake signer.
 */
import { describe, expect, it, test } from 'vitest';
import { EXPLORER_BASE, RLUSD_HEX, SELLER, WALLET } from '../fakes/env.js';
import { createHarness } from '../fakes/harness.js';

describe('AT-001: Successful balanced route', () => {
  it('classifies, ranks, quotes the top offer, pays exactly once, verifies on ledger, returns the answer', async () => {
    const h = await createHarness();
    // Given: three active RLUSD Testnet offers
    const offers = (
      await h.app.inject({
        method: 'GET',
        url: '/v1/offers',
        headers: { authorization: 'Bearer demo-key-0123456789abcdef' },
      })
    ).json();
    expect(offers.offers).toHaveLength(3);
    expect(
      offers.offers.every(
        (o: { asset: { code: string }; network: string }) =>
          o.asset.code === 'RLUSD' && o.network === 'xrpl:1',
      ),
    ).toBe(true);

    // When: a coding prompt, mode balanced, maxCost 0.020000
    const res = await h.route({ mode: 'balanced', maxCost: '0.020000' });
    expect(res.statusCode).toBe(201);
    const body = res.json();

    // Then: classified as coding, ranked deterministically, quote from the highest-ranked offer
    expect(body.taskProfile.taskType).toBe('coding');
    expect(body.state).toBe('QUOTED');
    const eligible = body.candidates.filter(
      (c: { eligibility: string }) => c.eligibility !== 'ineligible',
    );
    const scores = eligible.map((c: { finalScore: string }) => c.finalScore);
    expect(scores).toEqual([...scores].sort().reverse()); // ranked by finalScore desc
    expect(eligible[0].eligibility).toBe('selected');
    expect(body.selected.offerId).toBe(eligible[0].offerId);
    expect(body.selected.quotedCost).toBe('0.006000');
    expect(h.seller.unpaidRequests).toHaveLength(1); // FR-050: prompt went to the selected seller only
    expect(h.seller.modelInvocations).toBe(0);
    expect(h.signCalls).toHaveLength(0);

    // And: policy passes, exactly one payment is submitted
    const exec = await h.execute(body.routeId);
    expect(exec.statusCode).toBe(202);
    expect(exec.json()).toEqual({
      routeId: body.routeId,
      state: 'POLICY_APPROVED',
      statusUrl: `/v1/routes/${body.routeId}`,
      eventsUrl: `/v1/routes/${body.routeId}/events`,
    });
    expect(await h.terminal(body.routeId)).toBe('SUCCEEDED');
    expect(h.signCalls).toHaveLength(1); // sign called exactly once
    expect(h.signCalls[0]).toMatchObject({
      destination: SELLER,
      amount: '0.006000',
      asset: RLUSD_HEX,
    });
    expect(h.seller.paidRequests).toHaveLength(1);
    expect(h.states(body.routeId)).toEqual([
      'CLASSIFYING',
      'ROUTING',
      'QUOTING',
      'QUOTED',
      'POLICY_APPROVED',
      'SIGNED',
      'PAID_REQUEST_SENT',
      'VERIFYING',
      'SUCCEEDED',
    ]);

    // And: validated success on the ledger; seller returned a model response
    const hash = h.signed[0]!.transactionHash;
    expect(h.ledger.txs.get(hash)?.resultCode).toBe('tesSUCCESS');
    const receipt = await h.receipt(body.routeId);
    expect(receipt.payment).toMatchObject({
      status: 'SETTLED',
      payerAddress: WALLET,
      destination: SELLER,
      amount: '0.006000',
      assetCode: 'RLUSD',
      transactionHash: hash,
      explorerUrl: `${EXPLORER_BASE}${hash}`,
    });
    expect(receipt.policyDecision.approved).toBe(true);
    // And: what the UI shows — answer, quoted cost, seller, reason, transaction hash
    expect(receipt.result).toBe('answer from demo/fast-code');
    expect(receipt.quotedCost).toBe('0.006000');
    expect(receipt.selected).toMatchObject({ sellerName: 'Fast Code', quotedCost: '0.006000' });
    expect(receipt.selected.reason).toEqual(expect.any(String));
    expect(receipt.execution).toMatchObject({ status: 'succeeded', modelId: 'demo/fast-code' });
    expect(JSON.stringify(receipt)).not.toContain('FAKEBLOB'); // SEC-009
  });

  // Manual live variant (PRD §18.3): run `pnpm tsx scripts/smoke-testnet.ts` against a funded Testnet
  // agent wallet with the seller, API and web started with real Testnet settings; follow README
  // "Manual live Testnet smoke test" steps 1-7 and record the hash in docs/EVIDENCE.md.
  test.skip('AT-001 live Testnet variant (manual: scripts/smoke-testnet.ts)', () => undefined);
});
