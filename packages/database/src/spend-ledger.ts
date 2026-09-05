import type { Db } from './client.js';
import { Prisma, type PaymentStatus } from './generated/client.js';

/** Statuses that have (or may have) moved money; counted toward the SEC-011 hourly cap. */
const SPENT: PaymentStatus[] = ['SIGNED', 'SENT', 'SETTLED', 'OUTCOME_UNKNOWN'];

export function createSpendLedger(db: Db) {
  return {
    /** Decimal-string sum of payments created in the rolling hour ending at `now` (SEC-011). */
    async spentLastHour(now: Date = new Date()): Promise<string> {
      const since = new Date(now.getTime() - 60 * 60 * 1000);
      const rows = await db.payment.findMany({
        where: { status: { in: SPENT }, createdAt: { gte: since } },
        select: { amount: true },
      });
      return rows.reduce((acc, r) => acc.plus(r.amount), new Prisma.Decimal(0)).toFixed();
    },

    /** True when `nextAmount` would push the rolling-hour total over `cap` (all decimal strings). */
    async wouldExceedCap(
      cap: string,
      nextAmount: string,
      now: Date = new Date(),
    ): Promise<boolean> {
      const spent = await this.spentLastHour(now);
      return new Prisma.Decimal(spent).plus(nextAmount).greaterThan(cap);
    },
  };
}

export type SpendLedger = ReturnType<typeof createSpendLedger>;
