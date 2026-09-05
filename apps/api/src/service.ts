/**
 * Buyer route service (PRD §11.2–§11.4, §9.1, §14). One class, three entry points:
 *   createRoute  — classify, filter, score, quote (walks to the next unpaid offer, FR-051/§14), stores the quote.
 *   execute      — hash check (AT-009), DB claim (AT-005), policy gate (FR-060), then sign/pay/verify in the
 *                  background so a client disconnect never stops settlement (§14).
 *   getReceipt   — FR-090 receipt, redacted by construction (no seed, blob, or prompt).
 * Money is decimal.js / decimal strings throughout (INV-006).
 */
import { createHash } from 'node:crypto';
import { Decimal } from 'decimal.js';
import type { FastifyBaseLogger } from 'fastify';
import {
  ROUTE_TRANSITIONS,
  assertPaymentTransition,
  assertRouteTransition,
  isTerminalRouteState,
  FALLBACK_TASK_PROFILE,
  TaskProfile as TaskProfileSchema,
  type Classifier,
  type ExactPayment,
  type ExecuteResponse,
  type InferenceOffer,
  PaymentRequirement as PaymentRequirementSchema,
  type PaymentClient,
  type PaymentRequirement,
  type PaymentState,
  type Receipt,
  type RouteCandidateView,
  type RouteRequest,
  type RouteResponse,
  type RouteState,
  type SelectedOffer,
  type SellerInferenceResponse,
  type SellerRequest,
  type SettlementAssetCode,
  type SignedPayment,
  type TaskProfile,
  type WalletSigner,
  type XrplNetworkId,
} from '@subbuddy/contracts';
import type { CuratedRegistry } from '@subbuddy/config';
import type { CandidateInput, Repository, RouteReceipt, SpendLedger } from '@subbuddy/database';
import {
  PaymentError,
  assertExactMatchesRequirement,
  classifySettlement,
  toExactPayment,
} from '@subbuddy/payments';
import {
  explainSelection,
  filterEligible,
  scoreOffers,
  type ScoredCandidate,
} from '@subbuddy/routing';
import type { BalanceReader } from './balances.js';
import { ApiError, fromPaymentError } from './errors.js';
import type { Correlation, RouteEvents } from './events.js';
import type { Metrics } from './metrics.js';

/** §14: pre-payment quote attempts are bounded by min(this, remaining eligible offers). */
export const MAX_QUOTE_ATTEMPTS = 3;
const TERMINAL_STATES = (Object.keys(ROUTE_TRANSITIONS) as RouteState[]).filter(
  isTerminalRouteState,
);

export interface ServiceConfig {
  network: XrplNetworkId;
  asset: SettlementAssetCode;
  hourlySpendCap: string;
  mandateTtlSeconds: number;
  explorerBase: string;
  /** Cached at startup so the policy gate never touches the wallet before approving (FR-060). */
  walletAddress: string;
  /** Quote must still be valid this long at policy time ("leaves enough time to submit"). Default 15s. */
  quoteHeadroomSeconds?: number;
  /** Ledger polls while VERIFYING; bounded exponential backoff (§14). */
  maxResolveAttempts?: number;
}

export interface ServiceDeps {
  repo: Repository;
  spend: SpendLedger;
  registry: CuratedRegistry;
  classifier: Classifier;
  payments: PaymentClient;
  signer: WalletSigner;
  balances: BalanceReader;
  events: RouteEvents;
  metrics: Metrics;
  log: FastifyBaseLogger;
  config: ServiceConfig;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
}

export interface PolicyCheck {
  name: string;
  passed: boolean;
  reason?: string;
}
export interface PolicyDecision {
  approved: boolean;
  checks: PolicyCheck[];
}

/** Receipt plus the fields the UI needs that the FR-090 list leaves implicit (§11.4 "final result"). */
export type RouteView = Receipt & {
  selected: SelectedOffer | null;
  result: string | null;
  expiresAt: string;
};

/** GET /v1/routes (US-010): one row per completed route, receipt-level fields only (SEC-009). */
export interface RouteListItem {
  routeId: string;
  createdAt: string;
  state: RouteState;
  mode: RouteRequest['mode'];
  selected: { offerId: string; sellerName: string; modelId: string | null } | null;
  asset: SettlementAssetCode;
  quotedCost: string | null;
  settledAmount: string | null;
  transactionHash: string | null;
  explorerUrl: string | null;
}
export interface RouteListPage {
  routes: RouteListItem[];
  nextCursor: string | null;
}

interface Ctx {
  routeId: string;
  state: RouteState;
  log: FastifyBaseLogger;
}

/**
 * SEC-005 / INV-005: the payment about to be signed must equal the immutable Quote ROW, field by field.
 * Amounts compare as decimals (the row is Decimal(20,6), the wire is the seller's string).
 */
export function assertExactMatchesQuote(
  exact: ExactPayment,
  quote: NonNullable<RouteReceipt['quote']>,
  offer: InferenceOffer,
): void {
  const asset = quote.assetCode as SettlementAssetCode;
  const mismatch = (field: string) =>
    new PaymentError('QUOTE_REJECTED', `${field} differs from the stored quote`);
  if (exact.destination !== quote.destination) throw mismatch('payTo');
  if (!wireToUnits(exact.amount, asset).eq(quote.amount)) throw mismatch('amount');
  if (exact.asset !== (offer.asset.currencyHex ?? 'XRP')) throw mismatch('asset');
  if ((exact.issuer ?? null) !== (quote.assetIssuer ?? null)) throw mismatch('issuer');
  if (exact.network !== quote.network) throw mismatch('network');
  if (exact.invoiceId !== quote.invoiceId) throw mismatch('invoiceId');
}

export const sha256 = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex');

const DROPS = new Decimal(1_000_000);
/** x402 XRP amounts are drops; RLUSD is already in asset units. DB, cap and mandate use asset units. */
const wireToUnits = (amount: string, asset: SettlementAssetCode): Decimal =>
  asset === 'XRP' ? new Decimal(amount).div(DROPS) : new Decimal(amount);
const unitsToWire = (amount: string, asset: SettlementAssetCode): string =>
  asset === 'XRP' ? new Decimal(amount).mul(DROPS).toFixed(0) : amount;

// Quote walk stops on anything that is not a "this seller, this quote" problem (§14 bounded retry).
const WALKABLE = new Set<PaymentError['code']>([
  'QUOTE_REJECTED',
  'SELLER_UNAVAILABLE',
  'SELLER_MISCONFIGURED',
  'ENDPOINT_NOT_ALLOWED',
]);

export class RouteService {
  // ponytail: in-memory caches. Requirements are also persisted as Quote.requirementJson (INV-005), so the
  // cache is a hot path only; policy decisions fall back to the payment row after a restart. Add
  // Route.policyDecision Json if per-check evidence must survive a restart.
  private readonly requirements = new Map<string, PaymentRequirement>();
  private readonly policyDecisions = new Map<string, PolicyDecision>();
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => Date;

  constructor(private readonly d: ServiceDeps) {
    this.sleep = d.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.now = d.now ?? (() => new Date());
  }

  // ---------------------------------------------------------------------------------------------------
  // POST /v1/routes
  // ---------------------------------------------------------------------------------------------------

  async createRoute(req: RouteRequest, requestId: string): Promise<RouteResponse> {
    const { repo, registry, config, metrics, events } = this.d;
    const startedAt = Date.now();
    const promptHash = sha256(req.prompt);
    const expiresAt = new Date(this.now().getTime() + config.mandateTtlSeconds * 1000);
    const created = await repo.createRoute({
      promptHash,
      mode: req.mode,
      maxCost: req.maxCost,
      assetCode: config.asset,
      network: config.network,
      registryVersion: registry.registryVersion,
      expiresAt,
    });
    metrics.routesCreated += 1;
    const ctx = this.ctx(created.id, 'CLASSIFYING', { requestId });
    events.emit(ctx.routeId, 'route.state_changed', 'CLASSIFYING');

    // FR-010/FR-011: the classifier falls back internally; anything escaping is a hard failure.
    let profile: TaskProfile;
    try {
      profile = await this.d.classifier.classify({
        prompt: req.prompt,
        ...(req.maxOutputTokens !== undefined ? { maxOutputTokens: req.maxOutputTokens } : {}),
      });
    } catch (err) {
      ctx.log.error({ err }, 'classifier failed');
      await this.transition(ctx, 'FAILED', { reason: 'CLASSIFIER_FAILED' });
      throw new ApiError('INTERNAL_ERROR', 'Prompt classification failed.', {
        routeId: ctx.routeId,
        retryable: true,
      });
    }
    await repo.updateRoute(ctx.routeId, { taskProfile: profile });
    await this.transition(ctx, 'ROUTING', { taskType: profile.taskType });

    // FR-030 + FR-002: the mandate allowlist is the registry's seller set.
    const offers = await registry.listActiveOffers();
    const { eligible, rejected } = filterEligible(offers, {
      profile,
      maxCost: req.maxCost,
      network: config.network,
      asset: config.asset,
      allowedSellerIds: new Set(offers.map((o) => o.sellerId)),
      allowedPayTo: new Set(offers.map((o) => o.payTo)),
    });
    const mandate = {
      maxCost: req.maxCost,
      network: config.network,
      asset: config.asset,
      expiresAt: expiresAt.toISOString(),
    };
    const ineligible: CandidateInput[] = rejected.map((r) => ({
      offerId: r.offer.offerId,
      eligibility: 'ineligible',
      rejectionReasons: r.reasons,
      qualityScore: '0',
      costScore: '0',
      latencyScore: '0',
      reliabilityScore: '0',
      finalScore: '0',
      estimatedCost: r.offer.advertisedPrice,
    }));

    if (eligible.length === 0) {
      await repo.saveCandidates(ctx.routeId, ineligible);
      await this.transition(ctx, 'NO_ELIGIBLE_OFFER', { rejected: rejected.length });
      metrics.noEligibleOffer += 1;
      metrics.observe('routeLatency', Date.now() - startedAt);
      return {
        routeId: ctx.routeId,
        state: 'NO_ELIGIBLE_OFFER',
        expiresAt: mandate.expiresAt,
        taskProfile: profile,
        selected: null,
        candidates: this.candidateViews(ineligible, null),
        mandate,
      };
    }

    // FR-040 then FR-050/FR-051: quote the top offer, walk to the next on a per-seller failure (§14).
    // Bounded to min(MAX_QUOTE_ATTEMPTS, eligible offers); all of this happens before any signature, so
    // INV-004 holds: once a quote is accepted the walk stops and a paid route is never rerouted.
    const ranked = scoreOffers(eligible, profile, req.mode);
    await this.transition(ctx, 'QUOTING', { candidates: ranked.length });
    const tried = new Map<string, string>();
    let selected: { cand: ScoredCandidate; requirement: PaymentRequirement } | null = null;
    let lastError: PaymentError | null = null;
    for (const cand of ranked.slice(0, MAX_QUOTE_ATTEMPTS)) {
      const request: SellerRequest = {
        offerId: cand.offer.offerId,
        endpoint: cand.offer.endpoint,
        requestId: ctx.routeId,
        prompt: req.prompt,
        promptHash,
        ...(req.maxOutputTokens !== undefined ? { maxOutputTokens: req.maxOutputTokens } : {}),
      };
      try {
        const requirement = await this.d.payments.obtainRequirement(request);
        if (wireToUnits(requirement.amount, config.asset).gt(req.maxCost)) {
          tried.set(cand.offer.offerId, 'QUOTE_OVER_BUDGET');
          metrics.quoteRejected('QUOTE_OVER_BUDGET');
          lastError = new PaymentError('QUOTE_REJECTED', 'quote exceeds budget');
          continue;
        }
        selected = { cand, requirement };
        break;
      } catch (err) {
        if (!(err instanceof PaymentError) || !WALKABLE.has(err.code)) throw err;
        ctx.log.warn(
          { offerId: cand.offer.offerId, code: err.code },
          'quote rejected, trying next',
        );
        tried.set(cand.offer.offerId, err.code);
        metrics.quoteRejected(err.code);
        lastError = err;
      }
    }

    const scoredInputs = (sel: string | null): CandidateInput[] =>
      ranked.map((c) => ({
        offerId: c.offer.offerId,
        eligibility:
          c.offer.offerId === sel
            ? 'selected'
            : tried.has(c.offer.offerId)
              ? 'quote_rejected'
              : 'not_quoted',
        rejectionReasons: tried.has(c.offer.offerId) ? [tried.get(c.offer.offerId) as string] : [],
        qualityScore: c.qualityScore,
        costScore: c.costScore,
        latencyScore: c.latencyScore,
        reliabilityScore: c.reliabilityScore,
        finalScore: c.finalScore,
        estimatedCost: c.offer.advertisedPrice,
      }));

    if (!selected) {
      // §14: attempts exhausted with no acceptable quote and nothing signed or paid. §9.1 has no
      // QUOTING -> NO_ELIGIBLE_OFFER edge, so the route is FAILED; the public code is the last quote
      // failure's (AT-004 pins QUOTE_REJECTED for an invalid requirement, §11.1 for over budget).
      await repo.saveCandidates(ctx.routeId, [...scoredInputs(null), ...ineligible]);
      const err = fromPaymentError(
        lastError ??
          new PaymentError('SELLER_UNAVAILABLE', 'no seller quoted', { retryable: true }),
        ctx.routeId,
      );
      await this.transition(ctx, 'FAILED', {
        reason: 'QUOTE_ATTEMPTS_EXHAUSTED',
        lastQuoteError: err.code,
        attempts: tried.size,
        maxAttempts: Math.min(MAX_QUOTE_ATTEMPTS, ranked.length),
      });
      metrics.observe('routeLatency', Date.now() - startedAt);
      this.d.events.emit(ctx.routeId, 'route.failed', ctx.state, {
        code: err.code,
        message: err.message,
      });
      throw err;
    }

    const { cand, requirement } = selected;
    const quotedUnits = wireToUnits(requirement.amount, config.asset).toFixed(6);
    await repo.saveQuote({
      routeId: ctx.routeId,
      invoiceId: requirement.invoiceId,
      sellerId: cand.offer.sellerId,
      offerId: cand.offer.offerId,
      destination: requirement.payTo,
      amount: quotedUnits,
      assetCode: config.asset,
      assetIssuer: requirement.issuer,
      network: requirement.network,
      rawRequirementHash: requirement.requirementHash,
      // INV-005: the validated requirement with its exact wire strings (and the raw accepts[] entry inside
      // it) so requirementFor rebuilds it byte-identical after a restart.
      requirementJson: JSON.stringify(requirement),
      expiresAt: new Date(requirement.expiresAt),
    });
    this.requirements.set(ctx.routeId, requirement);
    const candidates = [...scoredInputs(cand.offer.offerId), ...ineligible];
    await repo.saveCandidates(ctx.routeId, candidates);
    await repo.updateRoute(ctx.routeId, { selectedOfferId: cand.offer.offerId });
    this.bind(ctx, { offerId: cand.offer.offerId, invoiceId: requirement.invoiceId });
    await this.transition(ctx, 'QUOTED', {
      offerId: cand.offer.offerId,
      quotedCost: quotedUnits,
      asset: config.asset,
    });
    metrics.selected(cand.offer.offerId);
    metrics.observe('routeLatency', Date.now() - startedAt);

    const explanation = explainSelection(ranked, profile, req.mode, quotedUnits);
    return {
      routeId: ctx.routeId,
      state: 'QUOTED',
      expiresAt: mandate.expiresAt,
      taskProfile: profile,
      selected: {
        offerId: cand.offer.offerId,
        sellerName: cand.offer.displayName,
        modelId: cand.offer.modelId,
        score: cand.finalScore,
        estimatedCost: cand.offer.advertisedPrice,
        quotedCost: quotedUnits,
        asset: config.asset,
        reason: explanation.explanation,
      },
      candidates: this.candidateViews(candidates, quotedUnits),
      mandate,
    };
  }

  // ---------------------------------------------------------------------------------------------------
  // POST /v1/routes/:id/execute
  // ---------------------------------------------------------------------------------------------------

  async execute(
    routeId: string,
    prompt: string,
    requestId: string,
  ): Promise<{ status: number; body: ExecuteResponse }> {
    const { repo, config } = this.d;
    const route = await repo.getRoute(routeId);
    if (!route) throw new ApiError('NOT_FOUND', 'Route not found.', { routeId });
    // AT-009 / FR-002: the mandate binds the prompt hash; a mutated prompt never reaches signing.
    if (sha256(prompt) !== route.promptHash)
      throw new ApiError('PROMPT_MISMATCH', 'Prompt does not match the quoted route.', { routeId });

    const response = (state: RouteState) => ({
      status: 202,
      body: {
        routeId,
        state,
        statusUrl: `/v1/routes/${routeId}`,
        eventsUrl: `/v1/routes/${routeId}/events`,
      },
    });

    if (route.state !== 'QUOTED') {
      // §11.3 idempotency: anything past QUOTED reports its current state; anything before has no quote.
      if (route.quote && route.payment) return response(route.state);
      throw new ApiError('CONFLICT', `Route is ${route.state} and cannot be executed.`, {
        routeId,
      });
    }
    const quote = route.quote;
    if (!quote) throw new ApiError('CONFLICT', 'Route has no quote.', { routeId });

    // AT-005 / SEC-007: the DB unique constraint elects one winner; losers report the current state.
    const claim = await repo.claimPayment({
      routeId,
      quoteId: quote.id,
      invoiceId: quote.invoiceId,
      payerAddress: config.walletAddress,
      destination: quote.destination,
      amount: quote.amount,
      assetCode: quote.assetCode,
    });
    if (!claim.claimed) {
      const current = await repo.getRoute(routeId);
      return response(current?.state ?? route.state);
    }

    const ctx = this.ctx(routeId, route.state, {
      requestId,
      offerId: quote.offerId,
      invoiceId: quote.invoiceId,
    });
    const decision = await this.policyGate(route, quote, claim.paymentId);
    this.policyDecisions.set(routeId, decision);
    if (!decision.approved) {
      const failed = decision.checks.filter((c) => !c.passed);
      await repo.updatePayment(claim.paymentId, {
        status: 'POLICY_REJECTED',
        failureCode: failed.map((c) => c.name).join(','),
      });
      await this.transition(ctx, 'POLICY_REJECTED', { checks: decision.checks });
      const first = failed[0] as PolicyCheck;
      const code =
        first.name === 'spend_cap'
          ? 'SPEND_CAP_REACHED'
          : first.name === 'mandate_active'
            ? 'MANDATE_EXPIRED'
            : 'POLICY_REJECTED';
      this.d.events.emit(routeId, 'route.failed', 'POLICY_REJECTED', {
        code,
        message: first.reason,
      });
      throw new ApiError(code, first.reason ?? 'Policy rejected the payment.', { routeId });
    }
    await this.transition(ctx, 'POLICY_APPROVED', { checks: decision.checks });

    // §14 "client disconnects": settlement continues without the request.
    void this.settle(ctx, route, quote, claim.paymentId, prompt).catch((err) => {
      ctx.log.error({ err }, 'settlement pipeline aborted');
    });
    return response('POLICY_APPROVED');
  }

  /** FR-060. Pure reads; never calls the signer. Every check is recorded, pass or fail. */
  private async policyGate(
    route: RouteReceipt,
    quote: NonNullable<RouteReceipt['quote']>,
    paymentId: string,
  ): Promise<PolicyDecision> {
    const { config, registry, spend, balances } = this.d;
    const now = this.now().getTime();
    const headroom = (config.quoteHeadroomSeconds ?? 15) * 1000;
    const offer = registry.getOffer(quote.offerId);
    const checks: PolicyCheck[] = [];
    const check = (name: string, passed: boolean, reason: string) =>
      checks.push(passed ? { name, passed } : { name, passed, reason });

    check('route_state_quoted', route.state === 'QUOTED', 'Route is not in a quotable state.');
    check('mandate_active', route.expiresAt.getTime() > now, 'The request mandate has expired.');
    check(
      'quote_not_expired',
      quote.expiresAt.getTime() - now > headroom,
      'The seller quote expired before payment could be submitted.',
    );
    check(
      'network_match',
      quote.network === config.network,
      'Quote network does not match configuration.',
    );
    check(
      'asset_match',
      quote.assetCode === config.asset,
      'Quote asset does not match configuration.',
    );
    check(
      'seller_allowlisted',
      offer !== undefined &&
        registry.isAllowlisted(quote.offerId, offer.endpoint, quote.destination),
      'Seller or destination is not allowlisted.',
    );
    check(
      'amount_within_mandate',
      new Decimal(quote.amount).lte(route.maxCost),
      'The quoted amount exceeds the request budget.',
    );
    // The claim that got us here is the DB proof; a second payment row cannot exist (FR-071).
    check('no_existing_payment', true, '');
    let overCap = true;
    try {
      // Our own CREATED claim is already in the ledger; exclude it so the amount is counted once.
      overCap = await spend.wouldExceedCap(
        config.hourlySpendCap,
        quote.amount,
        this.now(),
        paymentId,
      );
    } catch {
      /* treated as failed below */
    }
    check('spend_cap', !overCap, 'The hourly wallet spend cap has been reached.');
    let sufficient = false;
    try {
      const bal = (await balances.getBalances(config.walletAddress)).find(
        (b) => b.asset === config.asset,
      );
      sufficient = bal !== undefined && new Decimal(bal.amount).gte(quote.amount);
    } catch {
      /* balance unavailable: stop before signing (§14) */
    }
    check('wallet_balance', sufficient, 'Wallet balance is insufficient for this payment.');
    return { approved: checks.every((c) => c.passed), checks };
  }

  // ---------------------------------------------------------------------------------------------------
  // Background: sign once, pay, verify on ledger (FR-070..FR-072, FR-081, §9.1/§9.2)
  // ---------------------------------------------------------------------------------------------------

  private async settle(
    ctx: Ctx,
    route: RouteReceipt,
    quote: NonNullable<RouteReceipt['quote']>,
    paymentId: string,
    prompt: string,
  ): Promise<void> {
    const { repo, payments, signer, events, metrics, config } = this.d;
    const requirement = this.requirementFor(route);
    const offer = this.d.registry.getOffer(quote.offerId);
    if (!offer) throw new Error('selected offer vanished from registry');
    const request: SellerRequest = {
      offerId: offer.offerId,
      endpoint: offer.endpoint,
      requestId: ctx.routeId,
      prompt,
      promptHash: route.promptHash,
    };
    let paymentState: PaymentState = 'CREATED';
    const movePayment = async (
      to: Exclude<PaymentState, 'NOT_CREATED'>,
      patch: Record<string, unknown> = {},
    ) => {
      paymentState = assertPaymentTransition(paymentState, to);
      await repo.updatePayment(paymentId, { status: to, ...patch });
    };

    // The only signing event (INV-011). SEC-005: the ExactPayment about to be signed is compared with the
    // STORED quote row (amount, payTo, asset, network, invoiceId), not with the in-memory requirement it was
    // built from, and the requirement's own expiry is re-checked.
    let signed: SignedPayment;
    try {
      const exact = toExactPayment(requirement);
      assertExactMatchesQuote(exact, quote, offer);
      assertExactMatchesRequirement(exact, requirement);
      signed = await signer.signExactPayment(exact);
    } catch (err) {
      // §14: signer unavailable / insufficient balance stops here; nothing was submitted. §9.1 has no exit
      // from POLICY_APPROVED, so the route stays there and the payment row records why.
      const code = err instanceof PaymentError ? err.code : 'SIGNER_UNAVAILABLE';
      await repo.updatePayment(paymentId, { failureCode: code });
      ctx.log.warn({ code }, 'signing aborted');
      events.emit(ctx.routeId, 'route.failed', ctx.state, {
        code: 'POLICY_REJECTED',
        message: 'Payment could not be signed. No money moved.',
      });
      return;
    }
    await movePayment('SIGNED', {
      signedTxBlob: signed.signedTxBlob,
      transactionHash: signed.transactionHash,
      lastLedgerSequence: signed.lastLedgerSequence,
    });
    this.bind(ctx, { transactionHash: signed.transactionHash });
    await this.transition(ctx, 'SIGNED');

    await movePayment('SENT');
    await this.transition(ctx, 'PAID_REQUEST_SENT');
    const sentAt = Date.now();
    events.emit(ctx.routeId, 'payment.submitted', ctx.state, {
      transactionHash: signed.transactionHash,
      amount: quote.amount,
      asset: config.asset,
      destination: quote.destination,
      explorerUrl: this.explorer(signed.transactionHash),
    });
    events.emit(ctx.routeId, 'execution.started', ctx.state, { offerId: offer.offerId });

    let result: SellerInferenceResponse | null = null;
    let failureCode: string | null = null;
    try {
      const paid = await payments.payAndRetry({ request, requirement, signed });
      result = paid.result;
      const echoed = paid.paymentResponse?.transactionHash;
      if (echoed && echoed !== signed.transactionHash)
        ctx.log.warn(
          { echoed },
          'PAYMENT-RESPONSE hash differs from the signed hash; verifying ours',
        );
    } catch (err) {
      failureCode = err instanceof PaymentError ? err.code : 'INTERNAL_ERROR';
      ctx.log.warn({ code: failureCode }, 'paid request did not succeed; checking ledger');
      if (failureCode === 'OUTCOME_UNKNOWN') {
        metrics.payment.unknown += 1;
        await movePayment('OUTCOME_UNKNOWN');
        await this.transition(ctx, 'OUTCOME_UNKNOWN');
      }
      // PAYMENT_FAILED / PAID_EXECUTION_FAILED: §14 says check the persisted hash before saying no money moved.
    }

    // FR-072 / INV-009: only the ledger decides. Never re-sign; a lost response resolves by hash (AT-006).
    await this.transition(ctx, 'VERIFYING');
    const outcome = await this.resolve(signed);
    if (outcome.kind === 'VALIDATED_FAILED') {
      await movePayment('VALIDATED_FAILED', { failureCode: outcome.resultCode });
      metrics.payment.failure += 1;
      await this.transition(ctx, 'PAYMENT_FAILED', { resultCode: outcome.resultCode });
      events.emit(ctx.routeId, 'route.failed', ctx.state, {
        code: 'PAYMENT_FAILED',
        message: 'The payment was not validated on the ledger. No money moved.',
      });
      return;
    }
    await movePayment('SETTLED', {
      ledgerIndex: outcome.ledgerIndex,
      validatedAt: new Date(outcome.validatedAt),
    });
    metrics.payment.success += 1;
    metrics.observe('settlementLatency', Date.now() - sentAt);
    events.emit(ctx.routeId, 'payment.validated', ctx.state, {
      transactionHash: signed.transactionHash,
      ledgerIndex: outcome.ledgerIndex,
      validatedAt: outcome.validatedAt,
      explorerUrl: this.explorer(signed.transactionHash),
    });

    if (result) {
      await repo.saveExecution({
        routeId: ctx.routeId,
        invoiceId: quote.invoiceId,
        offerId: offer.offerId,
        modelId: result.modelId,
        status: 'succeeded',
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        latencyMs: result.providerLatencyMs,
        result: result.content,
      });
      metrics.observe('providerLatency', result.providerLatencyMs);
      metrics.routesCompleted += 1;
      await this.transition(ctx, 'SUCCEEDED');
      events.emit(ctx.routeId, 'execution.completed', ctx.state, {
        modelId: result.modelId,
        providerLatencyMs: result.providerLatencyMs,
        usage: result.usage,
      });
      return;
    }
    // FR-081 / INV-004: paid but not served. Terminal; no automatic reroute. A new purchase needs a new route.
    await repo.saveExecution({
      routeId: ctx.routeId,
      invoiceId: quote.invoiceId,
      offerId: offer.offerId,
      modelId: offer.modelId,
      status: 'failed',
      failureCode: failureCode ?? 'PAID_EXECUTION_FAILED',
    });
    metrics.paidExecutionFailed += 1;
    await this.transition(ctx, 'PAID_EXECUTION_FAILED', { failureCode });
    events.emit(ctx.routeId, 'route.failed', ctx.state, {
      code: 'PAID_EXECUTION_FAILED',
      message: 'Payment succeeded but the seller did not deliver a result.',
    });
  }

  private async resolve(
    signed: SignedPayment,
  ): Promise<
    | { kind: 'SETTLED'; ledgerIndex: number; validatedAt: string }
    | { kind: 'VALIDATED_FAILED'; resultCode: string }
  > {
    const max = this.d.config.maxResolveAttempts ?? 30;
    for (let attempt = 0; attempt < max; attempt++) {
      const fact = await this.d.payments.resolveTransaction(signed.transactionHash);
      const cls = classifySettlement(fact, signed.lastLedgerSequence);
      if (cls === 'SETTLED' && fact.status === 'validated')
        return { kind: 'SETTLED', ledgerIndex: fact.ledgerIndex, validatedAt: fact.validatedAt };
      if (cls === 'VALIDATED_FAILED')
        return {
          kind: 'VALIDATED_FAILED',
          resultCode: fact.status === 'validated' ? fact.resultCode : 'NOT_FOUND_AFTER_LAST_LEDGER',
        };
      await this.sleep(Math.min(8_000, 1_000 * 2 ** attempt));
    }
    // Ledger unreachable for the whole window: stay VERIFYING rather than guess (NFR-003 no false success).
    throw new Error('settlement unresolved after bounded polling');
  }

  // ---------------------------------------------------------------------------------------------------
  // GET /v1/routes/:id
  // ---------------------------------------------------------------------------------------------------

  async getReceipt(routeId: string): Promise<RouteView> {
    const r = await this.d.repo.getRoute(routeId);
    if (!r) throw new ApiError('NOT_FOUND', 'Route not found.', { routeId });
    const { registry, config } = this.d;
    const parsed = TaskProfileSchema.safeParse(r.taskProfile);
    const taskProfile = parsed.success ? parsed.data : FALLBACK_TASK_PROFILE;
    // Postgres returns Decimal(20,6) padded; the in-memory fake does not. Normalise so clients see 6 dp always.
    const money6 = (v: string | null | undefined): string | null =>
      v == null ? null : new Decimal(v).toFixed(6);
    const quotedCost = money6(r.quote?.amount);
    const candidates = this.candidateViews(
      r.candidates.map((c) => ({ ...c, rejectionReasons: c.rejectionReasons })),
      quotedCost,
    );
    const sel = r.selectedOfferId ? registry.getOffer(r.selectedOfferId) : undefined;
    const selCand = r.candidates.find((c) => c.offerId === r.selectedOfferId);
    const p = r.payment;
    const policyDecision =
      this.policyDecisions.get(routeId) ??
      (p
        ? {
            approved: p.status !== 'POLICY_REJECTED',
            checks: (p.status === 'POLICY_REJECTED' && p.failureCode
              ? p.failureCode.split(',')
              : []
            ).map((name) => ({ name, passed: false })),
          }
        : null);
    return {
      routeId: r.id,
      promptHash: r.promptHash,
      taskProfile,
      mode: r.mode,
      state: r.state,
      candidates,
      selectedOfferId: r.selectedOfferId,
      estimatedCost: selCand?.estimatedCost ?? null,
      quotedCost,
      policyDecision,
      payment: {
        status: p?.status ?? 'NOT_CREATED',
        payerAddress: p?.payerAddress ?? null,
        destination: p?.destination ?? null,
        amount: money6(p?.amount),
        assetCode: p ? config.asset : null,
        transactionHash: p?.transactionHash ?? null,
        explorerUrl: p?.transactionHash ? this.explorer(p.transactionHash) : null,
        ledgerIndex: p?.ledgerIndex ?? null,
        validatedAt: p?.validatedAt?.toISOString() ?? null,
        failureCode: p?.failureCode ?? null,
      },
      execution: {
        status: r.execution?.status ?? 'pending',
        modelId: r.execution?.modelId ?? null,
        latencyMs: r.execution?.latencyMs ?? null,
        inputTokens: r.execution?.inputTokens ?? null,
        outputTokens: r.execution?.outputTokens ?? null,
        failureCode: r.execution?.failureCode ?? null,
      },
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
      expiresAt: r.expiresAt.toISOString(),
      selected:
        sel && selCand
          ? {
              offerId: sel.offerId,
              sellerName: sel.displayName,
              modelId: sel.modelId,
              score: selCand.finalScore,
              estimatedCost: selCand.estimatedCost,
              quotedCost,
              asset: config.asset,
              reason: `Selected ${sel.displayName} for a ${taskProfile.taskType} task in ${r.mode} mode.`,
            }
          : null,
      result: r.execution?.result ?? null,
    };
  }

  // ---------------------------------------------------------------------------------------------------
  // helpers
  // ---------------------------------------------------------------------------------------------------

  private async transition(ctx: Ctx, to: RouteState, payload: Record<string, unknown> = {}) {
    ctx.state = assertRouteTransition(ctx.state, to);
    await this.d.repo.updateRoute(ctx.routeId, { state: to });
    this.bind(ctx, {});
    ctx.log.info('route state changed');
    this.d.events.emit(ctx.routeId, 'route.state_changed', to, payload);
  }

  /** §19: one logger per route carrying routeId, requestId, offerId, invoiceId, transactionHash, state. */
  private ctx(routeId: string, state: RouteState, ids: Correlation): Ctx {
    const ctx: Ctx = { routeId, state, log: this.d.log };
    this.bind(ctx, ids);
    return ctx;
  }

  /** Record newly known correlation ids on the event bus and rebuild the route logger from the base logger. */
  private bind(ctx: Ctx, ids: Correlation): void {
    const merged = this.d.events.correlate(ctx.routeId, ids);
    ctx.log = this.d.log.child({ routeId: ctx.routeId, ...merged, state: ctx.state });
  }

  // ---------------------------------------------------------------------------------------------------
  // GET /v1/routes (US-010 history)
  // ---------------------------------------------------------------------------------------------------

  async listRoutes(limit: number, cursor?: string): Promise<RouteListPage> {
    const rows = await this.d.repo.listRoutes({
      limit,
      states: TERMINAL_STATES,
      ...(cursor ? { cursor } : {}),
    });
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return {
      routes: page.map((r) => {
        const offer = r.selectedOfferId ? this.d.registry.getOffer(r.selectedOfferId) : undefined;
        return {
          routeId: r.id,
          createdAt: r.createdAt.toISOString(),
          state: r.state,
          mode: r.mode,
          selected: r.selectedOfferId
            ? {
                offerId: r.selectedOfferId,
                sellerName: offer?.displayName ?? r.selectedOfferId,
                modelId: offer?.modelId ?? null,
              }
            : null,
          asset: this.d.config.asset,
          quotedCost: r.quotedCost === null ? null : new Decimal(r.quotedCost).toFixed(6),
          settledAmount: r.settledAmount === null ? null : new Decimal(r.settledAmount).toFixed(6),
          transactionHash: r.transactionHash,
          explorerUrl: r.transactionHash ? this.explorer(r.transactionHash) : null,
        };
      }),
      nextCursor: rows.length > limit && last ? last.id : null,
    };
  }

  private explorer(hash: string): string {
    return `${this.d.config.explorerBase.replace(/\/+$/, '')}/${hash}`;
  }

  private candidateViews(rows: CandidateInput[], quotedCost: string | null): RouteCandidateView[] {
    return rows.map((c) => {
      const offer = this.d.registry.getOffer(c.offerId);
      const scored = c.eligibility !== 'ineligible';
      return {
        offerId: c.offerId,
        sellerId: offer?.sellerId ?? 'unknown',
        displayName: offer?.displayName ?? c.offerId,
        eligibility: c.eligibility,
        rejectionReasons: c.rejectionReasons,
        qualityScore: scored ? c.qualityScore : null,
        costScore: scored ? c.costScore : null,
        latencyScore: scored ? c.latencyScore : null,
        reliabilityScore: scored ? c.reliabilityScore : null,
        finalScore: scored ? c.finalScore : null,
        estimatedCost: c.estimatedCost,
        // FR-092: only the selected offer ever carries an authoritative price.
        quotedCost: c.eligibility === 'selected' ? quotedCost : null,
        source: offer?.source ?? 'curated',
      };
    });
  }

  /**
   * Immutable quote for the paid request. After a restart it is the persisted requirement JSON, byte-identical
   * to what was validated (INV-005); the field-wise rebuild below only serves rows saved before that column.
   */
  private requirementFor(route: RouteReceipt): PaymentRequirement {
    const cached = this.requirements.get(route.id);
    if (cached) return cached;
    const q = route.quote;
    const offer = q && this.d.registry.getOffer(q.offerId);
    if (!q || !offer) throw new Error('route has no quote');
    if (q.requirementJson) {
      const stored = PaymentRequirementSchema.parse(JSON.parse(q.requirementJson));
      if (stored.invoiceId !== q.invoiceId || stored.requirementHash !== q.rawRequirementHash)
        throw new PaymentError('QUOTE_REJECTED', 'stored requirement does not match quote row');
      return stored;
    }
    return {
      scheme: 'exact',
      network: q.network as XrplNetworkId,
      asset: (offer.asset.currencyHex ?? 'XRP') as PaymentRequirement['asset'],
      issuer: q.assetIssuer as PaymentRequirement['issuer'],
      payTo: q.destination as PaymentRequirement['payTo'],
      amount: unitsToWire(q.amount, this.d.config.asset),
      invoiceId: q.invoiceId,
      resource: offer.endpoint,
      maxTimeoutSeconds: Math.max(
        1,
        Math.round((q.expiresAt.getTime() - q.createdAt.getTime()) / 1000),
      ),
      expiresAt: q.expiresAt.toISOString(),
      requirementHash: q.rawRequirementHash,
    };
  }
}
