/** US-010 (P1) route history. ponytail: localStorage per browser; swap for a GET /v1/routes list when the API grows one. */
export interface HistoryEntry {
  routeId: string;
  state: string;
  mode: string;
  sellerName: string | null;
  at: string;
}

const KEY = 'subbuddy.history';
const MAX = 50;

export function loadHistory(): HistoryEntry[] {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    return raw ? (JSON.parse(raw) as HistoryEntry[]) : [];
  } catch {
    return [];
  }
}

export function saveHistory(entry: HistoryEntry): void {
  try {
    const rest = loadHistory().filter((e) => e.routeId !== entry.routeId);
    globalThis.localStorage?.setItem(KEY, JSON.stringify([entry, ...rest].slice(0, MAX)));
  } catch {
    // storage unavailable; history is a convenience only
  }
}
