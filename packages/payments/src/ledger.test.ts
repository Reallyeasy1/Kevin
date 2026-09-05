import { describe, expect, it, vi } from 'vitest';
import { withBackoff } from './ledger.js';

describe('withBackoff (§14, SEC-004, #67)', () => {
  it('retries with capped exponential delays and gives up after `retries`', async () => {
    const sleep = vi.fn(async (_ms: number) => {});
    const fn = vi.fn(async () => {
      throw new Error('down');
    });
    await expect(withBackoff(fn, { retries: 4, baseMs: 100, maxMs: 350, sleep })).rejects.toThrow(
      'down',
    );
    expect(fn).toHaveBeenCalledTimes(5);
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([100, 200, 350, 350]);
  });

  it('never starts a retry that would end past the deadline', async () => {
    const sleep = vi.fn(async (_ms: number) => {});
    const fn = vi.fn(async () => {
      throw new Error('down');
    });
    // 1s base, 30ms budget: the first retry alone would overshoot, so it fails fast without sleeping.
    await expect(
      withBackoff(fn, { retries: 100, baseMs: 1_000, deadlineMs: 30, sleep }),
    ).rejects.toThrow('down');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });
});
