/**
 * Runtime env validation (NFR-009, SEC-010, DEC-003..005). Buyer and seller have separate secret sets
 * (PRD §10.1): each loader returns only its own keys, so the seller never holds the wallet seed and the
 * buyer never holds the upstream model key. Parsed objects contain secrets; never log or serialise them.
 */
import { z } from 'zod';
import {
  CurrencyHex,
  PositiveDecimalString,
  SettlementAssetCode,
  XRPL_NETWORKS,
  XrplAddress,
  XrplNetworkId,
} from '@subbuddy/contracts';

export class ConfigError extends Error {
  override readonly name = 'ConfigError';
}

/** Public Mainnet websocket hosts; any of these under APP_ENV=hackathon is a startup failure (SEC-010). */
const MAINNET_WSS_HOSTS = ['s1.ripple.com', 's2.ripple.com', 'xrplcluster.com'];

// Family seed: base58 (no 0, O, I, l) starting with s. The .env.example placeholder contains "_" and fails.
const WalletSeed = z.string().regex(/^s[1-9A-HJ-NP-Za-km-z]{20,60}$/, 'XRPL family seed required');

const shared = {
  APP_ENV: z.enum(['hackathon', 'development']),
  XRPL_NETWORK: XrplNetworkId,
  XRPL_WSS_URL: z.url({ protocol: /^wss?$/ }),
  XRPL_EXPLORER_BASE: z.url(),
  SETTLEMENT_ASSET: SettlementAssetCode,
  RLUSD_ISSUER: XrplAddress.optional(),
  RLUSD_CURRENCY_HEX: CurrencyHex.optional(),
  FACILITATOR_URL: z.url(),
  SELLER_BASE_URL: z.url(),
  SELLER_PAYTO_ADDRESS: XrplAddress,
};

type EnvSource = Record<string, string | undefined>;

/**
 * Cross-field rules, evaluated on the raw source so they are reported together with shape errors
 * (Zod skips refinements once any field fails, which would hide these until the next restart).
 */
function crossFieldIssues(env: EnvSource, role: 'buyer' | 'seller'): string[] {
  const out: string[] = [];
  if (env.SETTLEMENT_ASSET === 'RLUSD') {
    for (const key of ['RLUSD_ISSUER', 'RLUSD_CURRENCY_HEX'])
      if (!env[key]) out.push(`${key}: required when SETTLEMENT_ASSET=RLUSD`);
  }
  if (env.APP_ENV === 'hackathon') {
    if (env.XRPL_NETWORK === XRPL_NETWORKS.mainnet)
      out.push(
        `XRPL_NETWORK: Mainnet (${XRPL_NETWORKS.mainnet}) is rejected while APP_ENV=hackathon (SEC-010); use ${XRPL_NETWORKS.testnet}`,
      );
    const host = hostnameOf(env.XRPL_WSS_URL);
    if (host && MAINNET_WSS_HOSTS.some((h) => host === h || host.endsWith(`.${h}`)))
      out.push(
        `XRPL_WSS_URL: ${host} is a Mainnet node; rejected while APP_ENV=hackathon (SEC-010)`,
      );
  }
  if (
    role === 'buyer' &&
    env.CLASSIFIER_PROVIDER &&
    env.CLASSIFIER_PROVIDER !== 'mock' &&
    !env.CLASSIFIER_API_KEY
  )
    out.push(`CLASSIFIER_API_KEY: required when CLASSIFIER_PROVIDER=${env.CLASSIFIER_PROVIDER}`);
  if (
    role === 'seller' &&
    env.SELLER_UPSTREAM_PROVIDER &&
    env.SELLER_UPSTREAM_PROVIDER !== 'mock'
  ) {
    for (const key of ['SELLER_UPSTREAM_BASE_URL', 'SELLER_UPSTREAM_API_KEY'])
      if (!env[key])
        out.push(`${key}: required when SELLER_UPSTREAM_PROVIDER=${env.SELLER_UPSTREAM_PROVIDER}`);
  }
  return out;
}

function hostnameOf(url: string | undefined): string | null {
  try {
    return url ? new URL(url).hostname : null;
  } catch {
    return null;
  }
}

export const BuyerEnv = z.object({
  ...shared,
  AGENT_WALLET_SEED: WalletSeed,
  DEMO_API_KEY: z.string().min(16),
  HOURLY_SPEND_CAP: PositiveDecimalString,
  MANDATE_TTL_SECONDS: z.coerce.number().int().positive(),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  CLASSIFIER_PROVIDER: z.enum(['mock', 'anthropic', 'openai-compatible']),
  CLASSIFIER_API_KEY: z.string().min(1).optional(),
  CLASSIFIER_MODEL: z.string().min(1).optional(),
  CLASSIFIER_BASE_URL: z.url().optional(),
});
export type BuyerEnv = z.infer<typeof BuyerEnv>;

export const SellerEnv = z.object({
  ...shared,
  SELLER_UPSTREAM_PROVIDER: z.enum(['mock', 'openai-compatible']),
  SELLER_UPSTREAM_BASE_URL: z.url().optional(),
  SELLER_UPSTREAM_API_KEY: z.string().min(1).optional(),
});
export type SellerEnv = z.infer<typeof SellerEnv>;

export type SharedEnv = Pick<BuyerEnv, keyof typeof shared>;

function parseEnv<T>(schema: z.ZodType<T>, source: EnvSource, role: 'buyer' | 'seller'): T {
  // Empty strings (e.g. `CLASSIFIER_API_KEY=`) mean unset.
  const cleaned: EnvSource = Object.fromEntries(
    Object.entries(source).filter(([, v]) => v !== undefined && v !== ''),
  );
  const result = schema.safeParse(cleaned);
  const lines = crossFieldIssues(cleaned, role);
  if (!result.success) {
    for (const issue of result.error.issues) {
      const key = String(issue.path[0] ?? '?');
      lines.push(
        `${key}: ${cleaned[key] === undefined && issue.code === 'invalid_type' ? 'missing' : issue.message}`,
      );
    }
  }
  if (lines.length === 0 && result.success) return result.data;
  const list = lines.map((l) => `  - ${l}`).join('\n');
  throw new ConfigError(
    `Invalid ${role} configuration (NFR-009). Fix these variables and restart:\n${list}`,
  );
}

export function loadBuyerEnv(source: EnvSource = process.env): BuyerEnv {
  return parseEnv(BuyerEnv, source, 'buyer');
}

export function loadSellerEnv(source: EnvSource = process.env): SellerEnv {
  return parseEnv(SellerEnv, source, 'seller');
}
