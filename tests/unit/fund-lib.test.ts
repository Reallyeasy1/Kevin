import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RLUSD_ISSUER,
  RLUSD_CURRENCY_HEX,
  assertNoSeed,
  envLines,
  faucetSteps,
  parseArgs,
  trustSetTx,
} from '../../scripts/fund-lib.js';

const AGENT = 'rN7n7otQDd6FczFgLdSqtcsAUxDkw6fzRH';
const SELLER = 'rhaDe3NBxgUSLL12N5Sxpii2xy8vSyXNG6';
const SEED = 'sEdVFakeSeedForTestsOnly000000000';

describe('parseArgs', () => {
  it('defaults to the known Testnet issuer and local file', () => {
    expect(parseArgs([], {})).toEqual({
      out: './testnet-wallets.local.json',
      issuer: DEFAULT_RLUSD_ISSUER,
      wss: 'wss://s.altnet.rippletest.net:51233',
    });
  });
  it('prefers .env values, then flags', () => {
    expect(parseArgs([], { RLUSD_ISSUER: SELLER }).issuer).toBe(SELLER);
    expect(
      parseArgs(['--', '--issuer', AGENT, '--out', 'x.json'], { RLUSD_ISSUER: SELLER }),
    ).toMatchObject({
      issuer: AGENT,
      out: 'x.json',
    });
  });
  it('rejects bad flags, bad issuers and Mainnet endpoints', () => {
    expect(() => parseArgs(['--nope'], {})).toThrow('unknown flag');
    expect(() => parseArgs(['--issuer', 'not-an-address'], {})).toThrow('classic XRPL address');
    expect(() => parseArgs(['--wss', 'wss://xrplcluster.com'], {})).toThrow('SEC-010');
    expect(() => parseArgs(['--wss', 'wss://s1.ripple.com'], {})).toThrow('SEC-010');
  });
});

describe('trustSetTx / envLines / faucetSteps', () => {
  it('builds an RLUSD TrustSet', () => {
    expect(trustSetTx(AGENT, DEFAULT_RLUSD_ISSUER)).toEqual({
      TransactionType: 'TrustSet',
      Account: AGENT,
      LimitAmount: { currency: RLUSD_CURRENCY_HEX, issuer: DEFAULT_RLUSD_ISSUER, value: '1000' },
    });
  });
  it('prints addresses and the issuer but points at the file for the seed', () => {
    const text = envLines(AGENT, SELLER, DEFAULT_RLUSD_ISSUER, './w.json');
    expect(text).toContain(`SELLER_PAYTO_ADDRESS=${SELLER}`);
    expect(text).toContain(`RLUSD_ISSUER=${DEFAULT_RLUSD_ISSUER}`);
    expect(text).toContain(AGENT);
    expect(text).toMatch(/^# AGENT_WALLET_SEED=<.*\.\/w\.json/m);
    expect(text).not.toMatch(/^AGENT_WALLET_SEED=s/m);
    expect(faucetSteps(AGENT)).toContain('tryrlusd.com');
    expect(faucetSteps(AGENT)).toContain(AGENT);
  });
});

describe('assertNoSeed', () => {
  it('lets seed-free text through and blocks a seed', () => {
    expect(() => assertNoSeed(`address ${AGENT}`, [SEED])).not.toThrow();
    expect(() => assertNoSeed(`oops ${SEED}`, ['', SEED])).toThrow('refusing');
  });
});
