/**
 * Shared constants for the acceptance harness. Addresses are the throwaway fixtures already used by
 * packages/payments; nothing here is a secret. Test-only.
 */
import { createHash } from 'node:crypto';
import type { SharedEnv } from '../../packages/config/src/index.js';

export const RLUSD_HEX = '524C555344000000000000000000000000000000';
export const ISSUER = 'rQhWct2fv4Vc4KRjRgMrxa8xPN9Zx9iLKV';
/** Registry seller destination ("address A" in AT-004). */
export const SELLER = 'rhaDe3NBxgUSLL12N5Sxpii2xy8vSyXNG6';
/** A different valid address ("address B" in AT-004). */
export const OTHER = 'rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe';
/** Agent wallet address reported by the fake signer. */
export const WALLET = 'rN7n7otQDd6FczFgLdSqtcsAUxDkw6fzRH';
export const DEMO_API_KEY = 'demo-key-0123456789abcdef';
export const AUTH = { authorization: `Bearer ${DEMO_API_KEY}` };
export const EXPLORER_BASE = 'https://testnet.xrpl.org/transactions/';
export const NETWORK = 'xrpl:1';

/** Coding prompt (AT-001, §22.2 analogue); the fallback classifier maps "typescript" to coding. */
export const CODING_PROMPT = 'Implement Dijkstra in typescript and explain its complexity.';

export const sha256 = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex');

/** Fake signer and fake seller agree on this so the seller can echo the hash the buyer persisted. */
export const fakeTxHash = (signedTxBlob: string): string => sha256(signedTxBlob).toUpperCase();

export function sharedEnv(sellerBaseUrl: string): SharedEnv {
  return {
    APP_ENV: 'hackathon',
    XRPL_NETWORK: NETWORK,
    XRPL_WSS_URL: 'wss://s.altnet.rippletest.net:51233',
    XRPL_EXPLORER_BASE: EXPLORER_BASE,
    SETTLEMENT_ASSET: 'RLUSD',
    RLUSD_ISSUER: ISSUER,
    RLUSD_CURRENCY_HEX: RLUSD_HEX,
    FACILITATOR_URL: 'https://facilitator.example',
    SELLER_BASE_URL: sellerBaseUrl,
    SELLER_PAYTO_ADDRESS: SELLER,
  };
}
