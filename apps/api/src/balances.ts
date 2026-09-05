/**
 * Wallet balances for GET /v1/wallet (§11.7) and the FR-060 balance check. Reads only; never touches the seed.
 * ponytail: raw XRPL websocket JSON over Node 22's global WebSocket, one connection per call, no SDK. Move into
 * packages/payments once it grows a getBalances(); done here so the API never imports xrpl.js (PRD §10.3).
 */
import { Decimal } from 'decimal.js';
import type { SettlementAssetCode } from '@subbuddy/contracts';

export interface Balance {
  asset: SettlementAssetCode;
  /** Asset units (XRP, not drops), 6 dp. */
  amount: string;
}

export interface BalanceReader {
  getBalances(address: string): Promise<Balance[]>;
}

export interface BalanceReaderConfig {
  wssUrl: string;
  asset: SettlementAssetCode;
  issuer: string | null;
  currencyHex: string | null;
  timeoutMs?: number;
}

interface WsLike {
  addEventListener(type: 'open' | 'message' | 'error', fn: (ev: unknown) => void): void;
  send(data: string): void;
  close(): void;
}
type WsCtor = new (url: string) => WsLike;

const DROPS = new Decimal(1_000_000);

async function rpc(
  wssUrl: string,
  commands: Record<string, unknown>[],
  timeoutMs: number,
): Promise<Record<string, unknown>[]> {
  const Ws = (globalThis as unknown as { WebSocket?: WsCtor }).WebSocket;
  if (!Ws) throw new Error('global WebSocket unavailable (Node 22 required)');
  return new Promise((resolve, reject) => {
    const ws = new Ws(wssUrl);
    const results = new Map<number, Record<string, unknown>>();
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error('ledger request timed out'));
    }, timeoutMs);
    const done = (fn: () => void) => {
      clearTimeout(timer);
      ws.close();
      fn();
    };
    ws.addEventListener('error', () => done(() => reject(new Error('ledger connection failed'))));
    ws.addEventListener('open', () => {
      commands.forEach((c, i) => ws.send(JSON.stringify({ id: i, ...c })));
    });
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(String((ev as { data: unknown }).data)) as {
        id: number;
        status: string;
        result?: Record<string, unknown>;
        error?: string;
      };
      if (msg.status !== 'success' || !msg.result) {
        done(() => reject(new Error(`ledger error ${msg.error ?? msg.status}`)));
        return;
      }
      results.set(msg.id, msg.result);
      if (results.size === commands.length)
        done(() => resolve(commands.map((_, i) => results.get(i) as Record<string, unknown>)));
    });
  });
}

export function createBalanceReader(cfg: BalanceReaderConfig): BalanceReader {
  const timeoutMs = cfg.timeoutMs ?? 10_000;
  return {
    async getBalances(address) {
      const commands: Record<string, unknown>[] = [
        { command: 'account_info', account: address, ledger_index: 'validated' },
      ];
      if (cfg.asset === 'RLUSD' && cfg.issuer)
        commands.push({
          command: 'account_lines',
          account: address,
          peer: cfg.issuer,
          ledger_index: 'validated',
        });
      const [info, lines] = await rpc(cfg.wssUrl, commands, timeoutMs);
      const drops = String((info?.['account_data'] as { Balance?: string })?.Balance ?? '0');
      const out: Balance[] = [];
      if (lines) {
        const line = ((lines['lines'] as { currency: string; balance: string }[]) ?? []).find(
          (l) => l.currency.toUpperCase() === cfg.currencyHex,
        );
        out.push({ asset: 'RLUSD', amount: new Decimal(line?.balance ?? '0').toFixed(6) });
      }
      out.push({ asset: 'XRP', amount: new Decimal(drops).div(DROPS).toFixed(6) });
      return out;
    },
  };
}
