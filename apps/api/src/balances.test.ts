import { afterEach, describe, expect, it } from 'vitest';
import { createBalanceReader } from './balances.js';

// Fake global WebSocket: answers every command with the scripted reply.
function installFakeWs(reply: (cmd: { command: string }) => Record<string, unknown>) {
  class FakeWs {
    private listeners = new Map<string, ((ev: unknown) => void)[]>();
    constructor(_url: string) {
      queueMicrotask(() => this.emit('open', {}));
    }
    addEventListener(type: string, fn: (ev: unknown) => void) {
      this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
    }
    send(data: string) {
      const cmd = JSON.parse(data) as { id: number; command: string };
      queueMicrotask(() =>
        this.emit('message', { data: JSON.stringify({ id: cmd.id, ...reply(cmd) }) }),
      );
    }
    close() {}
    private emit(type: string, ev: unknown) {
      for (const fn of this.listeners.get(type) ?? []) fn(ev);
    }
  }
  (globalThis as { WebSocket?: unknown }).WebSocket = FakeWs;
}
const realWs = (globalThis as { WebSocket?: unknown }).WebSocket;
afterEach(() => {
  (globalThis as { WebSocket?: unknown }).WebSocket = realWs;
});

const cfg = {
  wssUrl: 'wss://fake',
  asset: 'RLUSD' as const,
  issuer: 'rIssuer',
  currencyHex: '524C555344000000000000000000000000000000',
};

describe('createBalanceReader', () => {
  it('reports zero balances for a never-funded account (actNotFound is not an error)', async () => {
    installFakeWs(() => ({ status: 'error', error: 'actNotFound' }));
    await expect(createBalanceReader(cfg).getBalances('rNew')).resolves.toEqual([
      { asset: 'RLUSD', amount: '0.000000' },
      { asset: 'XRP', amount: '0.000000' },
    ]);
  });

  it('still rejects on other ledger errors', async () => {
    installFakeWs(() => ({ status: 'error', error: 'invalidParams' }));
    await expect(createBalanceReader(cfg).getBalances('rBad')).rejects.toThrow(
      'ledger error invalidParams',
    );
  });
});
