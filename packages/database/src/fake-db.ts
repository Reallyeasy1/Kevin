import type { Db } from './client.js';
import { Prisma } from './generated/client.js';

// ponytail: in-memory stand-in for the Prisma client covering only what repository/spend-ledger call.
// Enforces the FR-071 unique constraints by throwing Prisma's P2002 shape. Test-only.

type Row = Record<string, unknown>;
const uniqueViolation = () =>
  Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
const DECIMAL_COLS = new Set([
  'maxCost',
  'amount',
  'estimatedCost',
  'qualityScore',
  'costScore',
  'latencyScore',
  'reliabilityScore',
  'finalScore',
]);

function table(uniques: string[][], defaults: Row = {}) {
  const rows: Row[] = [];
  const normalise = (data: Row): Row => {
    const out: Row = {
      id: crypto.randomUUID(),
      createdAt: new Date(),
      updatedAt: new Date(),
      ...defaults,
    };
    for (const [k, v] of Object.entries(data)) {
      out[k] =
        DECIMAL_COLS.has(k) && (typeof v === 'string' || typeof v === 'number')
          ? new Prisma.Decimal(v)
          : v;
    }
    return out;
  };
  const matches = (row: Row, where: Row) =>
    Object.entries(where).every(([k, v]) => {
      if (v && typeof v === 'object' && !(v instanceof Date)) {
        const cond = v as { in?: unknown[]; gte?: Date; not?: unknown };
        if (cond.in) return cond.in.includes(row[k]);
        if (cond.gte) return (row[k] as Date) >= cond.gte;
        if ('not' in cond) return row[k] !== cond.not;
      }
      return row[k] === v;
    });
  const insert = (data: Row) => {
    const row = normalise(data);
    for (const cols of uniques) {
      if (cols.some((c) => row[c] == null)) continue;
      if (rows.some((r) => cols.every((c) => r[c] === row[c]))) throw uniqueViolation();
    }
    rows.push(row);
    return row;
  };
  return {
    rows,
    create: async ({ data }: { data: Row }) => insert(data),
    createMany: async ({ data }: { data: Row[] }) => ({ count: data.map(insert).length }),
    findMany: async ({ where = {} }: { where?: Row }) => rows.filter((r) => matches(r, where)),
    findUnique: async ({ where }: { where: Row }) => rows.find((r) => matches(r, where)) ?? null,
    findUniqueOrThrow: async ({ where }: { where: Row }) => {
      const r = rows.find((row) => matches(row, where));
      if (!r) throw new Error('not found');
      return r;
    },
    update: async ({ where, data }: { where: Row; data: Row }) => {
      const r = rows.find((row) => matches(row, where));
      if (!r) throw new Error('not found');
      for (const [k, v] of Object.entries(data)) if (v !== undefined) r[k] = v;
      return r;
    },
    upsert: async ({ where, create, update }: { where: Row; create: Row; update: Row }) => {
      const r = rows.find((row) => matches(row, where));
      if (!r) return insert(create);
      Object.assign(r, update);
      return r;
    },
  };
}

export function createFakeDb() {
  const route = table([]);
  const routeCandidate = table([['routeId', 'offerId']]);
  const quote = table([['routeId'], ['invoiceId']]);
  const payment = table([['routeId'], ['quoteId'], ['invoiceId'], ['transactionHash']], {
    status: 'CREATED', // schema @default(CREATED); the spend ledger counts CREATED claims (INV-012)
  });
  const execution = table([['routeId'], ['invoiceId']]);
  const withRelations = (r: Row) => ({
    ...r,
    candidates: routeCandidate.rows.filter((c) => c['routeId'] === r['id']),
    quote: quote.rows.find((q) => q['routeId'] === r['id']) ?? null,
    payment: payment.rows.find((p) => p['routeId'] === r['id']) ?? null,
    execution: execution.rows.find((e) => e['routeId'] === r['id']) ?? null,
  });
  const db = {
    route: {
      ...route,
      findUnique: async ({ where }: { where: Row }) => {
        const r = await route.findUnique({ where });
        return r && withRelations(r);
      },
    },
    routeCandidate,
    quote,
    payment,
    execution,
  };
  return db as unknown as Db;
}
