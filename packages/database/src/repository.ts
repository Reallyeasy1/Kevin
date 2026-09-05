import type { Db } from './client.js';
import type {
  Eligibility,
  ExecutionStatus,
  PaymentStatus,
  RouteMode,
  RouteState,
} from './generated/client.js';

// Money crosses this boundary only as decimal strings (INV-006). Prisma accepts strings for Decimal
// columns and hands back Prisma.Decimal, which we serialise with toFixed() (never exponent notation).
type Money = string;
const money = (d: { toFixed(): string }): Money => d.toFixed();

export interface CreateRouteInput {
  promptHash: string;
  mode: RouteMode;
  maxCost: Money;
  assetCode: string;
  network: string;
  registryVersion: string;
  expiresAt: Date;
}

export interface CandidateInput {
  offerId: string;
  eligibility: Eligibility;
  rejectionReasons: string[];
  qualityScore: Money;
  costScore: Money;
  latencyScore: Money;
  reliabilityScore: Money;
  finalScore: Money;
  estimatedCost: Money;
}

export interface QuoteInput {
  routeId: string;
  invoiceId: string;
  sellerId: string;
  offerId: string;
  destination: string;
  amount: Money;
  assetCode: string;
  assetIssuer: string | null;
  network: string;
  rawRequirementHash: string;
  expiresAt: Date;
}

export interface ClaimPaymentInput {
  routeId: string;
  quoteId: string;
  invoiceId: string;
  payerAddress: string;
  destination: string;
  amount: Money;
  assetCode: string;
}

export interface PaymentUpdate {
  status?: PaymentStatus;
  transactionHash?: string;
  signedTxBlob?: string;
  lastLedgerSequence?: number;
  ledgerIndex?: number;
  validatedAt?: Date;
  failureCode?: string;
}

export interface ExecutionInput {
  routeId: string;
  invoiceId: string;
  offerId: string;
  modelId: string;
  status: ExecutionStatus;
  inputTokens?: number;
  outputTokens?: number;
  latencyMs?: number;
  result?: string;
  failureCode?: string;
}

export type ClaimResult = { claimed: boolean; paymentId: string };

const isUniqueViolation = (err: unknown): boolean =>
  typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 'P2002';

export function createRepository(db: Db) {
  return {
    async createRoute(input: CreateRouteInput) {
      const row = await db.route.create({ data: input });
      return { id: row.id, state: row.state, createdAt: row.createdAt };
    },

    async updateRoute(
      routeId: string,
      patch: { state?: RouteState; taskProfile?: object; selectedOfferId?: string },
    ) {
      await db.route.update({ where: { id: routeId }, data: patch });
    },

    async saveCandidates(routeId: string, candidates: CandidateInput[]) {
      await db.routeCandidate.createMany({ data: candidates.map((c) => ({ routeId, ...c })) });
    },

    async saveQuote(input: QuoteInput) {
      const row = await db.quote.create({ data: input });
      return { id: row.id };
    },

    /**
     * SEC-007 / FR-071: a plain INSERT. UNIQUE(routeId | quoteId | invoiceId) makes every concurrent
     * claim but one fail with P2002; losers get the winner's payment id and must not sign.
     */
    async claimPayment(input: ClaimPaymentInput): Promise<ClaimResult> {
      try {
        const row = await db.payment.create({ data: input });
        return { claimed: true, paymentId: row.id };
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
        const existing = await db.payment.findUniqueOrThrow({
          where: { routeId: input.routeId },
          select: { id: true },
        });
        return { claimed: false, paymentId: existing.id };
      }
    },

    async updatePayment(paymentId: string, patch: PaymentUpdate) {
      await db.payment.update({ where: { id: paymentId }, data: patch });
    },

    /** Payment adapter only: resend of the identical blob (INV-011). Never expose (SEC-009). */
    async getSignedPayment(routeId: string) {
      return db.payment.findUnique({
        where: { routeId },
        select: {
          id: true,
          status: true,
          signedTxBlob: true,
          transactionHash: true,
          lastLedgerSequence: true,
        },
      });
    },

    async saveExecution(input: ExecutionInput) {
      const row = await db.execution.upsert({
        where: { routeId: input.routeId },
        create: input,
        update: input,
      });
      return { id: row.id };
    },

    /** Everything the FR-090 receipt needs; money as strings, signed blob omitted (SEC-009). */
    async getRoute(routeId: string) {
      const r = await db.route.findUnique({
        where: { id: routeId },
        include: { candidates: true, quote: true, execution: true, payment: true },
      });
      if (!r) return null;
      // Strip the blob explicitly rather than via Prisma omit so the boundary does not depend on client config.
      const payment = r.payment && (({ signedTxBlob: _blob, ...rest }) => rest)(r.payment);
      return {
        ...r,
        maxCost: money(r.maxCost),
        candidates: r.candidates.map((c) => ({
          ...c,
          qualityScore: money(c.qualityScore),
          costScore: money(c.costScore),
          latencyScore: money(c.latencyScore),
          reliabilityScore: money(c.reliabilityScore),
          finalScore: money(c.finalScore),
          estimatedCost: money(c.estimatedCost),
        })),
        quote: r.quote && { ...r.quote, amount: money(r.quote.amount) },
        payment: payment && { ...payment, amount: money(payment.amount) },
      };
    },
  };
}

export type Repository = ReturnType<typeof createRepository>;
export type RouteReceipt = NonNullable<Awaited<ReturnType<Repository['getRoute']>>>;
