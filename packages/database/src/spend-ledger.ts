import type { Db } from './client.js';
import { Prisma, type PaymentStatus } from './generated/client.js';

/**
 * Statuses that have (or may have) moved money; counted toward the SEC-011 hourly cap.
 * CREATED is included so concurrent claims see each other before either signs (INV-012);
 * a claim that later becomes POLICY_REJECTED leaves the set with its status.
 */
const SPENT: PaymentStatus[] = ['CREATED', 'SIGNED', 'SENT', 'SETTLED', 'OUTCOME_UNKNOWN'];

export function createSpendLedger(db: Db) {
  return {
    /**
     * Decimal-string sum of payments created in the rolling hour ending at `now` (SEC-011).
     * Pass `excludePaymentId` for the caller's own CREATED claim so it is not counted twice.
     */
    async spentLastHour(now: Date = new Date(), excludePaymentId?: string): Promise<string> {
      const since = new Date(now.getTime() - 60 * 60 * 1000);
      const rows = await db.payment.findMany({
        where: {
          status: { in: SPENT },
          createdAt: { gte: since },
          ...(excludePaymentId ? { id: { not: excludePaymentId } } : {}),
        },
        select: { amount: true },
      });
      return rows.reduce((acc, r) => acc.plus(r.amount), new Prisma.Decimal(0)).toFixed();
    },

    /** True when `nextAmount` would push the rolling-hour total over `cap` (all decimal strings). */
    async wouldExceedCap(
      cap: string,
      nextAmount: string,
      now: Date = new Date(),
      excludePaymentId?: string,
    ): Promise<boolean> {
      const spent = await this.spentLastHour(now, excludePaymentId);
      return new Prisma.Decimal(spent).plus(nextAmount).greaterThan(cap);
    },
  };
}

export type SpendLedger = ReturnType<typeof createSpendLedger>;
