import { createHash } from 'node:crypto';
import { Decimal } from 'decimal.js';
import { Wallet, type Payment } from 'xrpl';
import {
  DecimalString,
  XrplAddress,
  type ExactPayment,
  type SignedPayment,
  type WalletSigner,
  type XrplNetworkId,
} from '@subbuddy/contracts';
import { PaymentError } from './errors.js';
import {
  asClient,
  assertNotMainnet,
  validatedLedgerIndex,
  withBackoff,
  type LedgerHandle,
} from './ledger.js';
import { DEFAULT_SOURCE_TAG } from './quote.js';

export interface WalletSignerOptions {
  ledger: LedgerHandle;
  network: XrplNetworkId;
  /** Env var holding the wallet seed. Read only inside signExactPayment/getAddress, never stored. Default XRPL_WALLET_SEED. */
  seedEnvVar?: string;
  sourceTag?: number;
  /** Ledgers past the latest validated ledger before the tx expires. Default 20 (~1-1.5 min). */
  lastLedgerOffset?: number;
}

function loadWallet(envVar: string): Wallet {
  const seed = process.env[envVar];
  if (!seed) throw new PaymentError('SIGNER_UNAVAILABLE', 'wallet signer not configured');
  try {
    return Wallet.fromSeed(seed);
  } catch (cause) {
    throw new PaymentError('SIGNER_UNAVAILABLE', 'wallet signer not configured', { cause });
  }
}

/** FR-070 signer. Signs exactly once per call; the caller persists the blob+hash before sending (INV-011). */
export class XrplWalletSigner implements WalletSigner {
  private readonly opts: Required<WalletSignerOptions>;
  // ponytail: one wallet, one promise-chain mutex. Upgrade to Tickets if throughput matters (FR-070 P1).
  private queue: Promise<unknown> = Promise.resolve();

  constructor(opts: WalletSignerOptions) {
    assertNotMainnet(opts.network);
    this.opts = {
      seedEnvVar: 'XRPL_WALLET_SEED',
      sourceTag: DEFAULT_SOURCE_TAG,
      lastLedgerOffset: 20,
      ...opts,
    };
  }

  async getAddress(): Promise<string> {
    return loadWallet(this.opts.seedEnvVar).classicAddress;
  }

  signExactPayment(input: ExactPayment): Promise<SignedPayment> {
    const run = this.queue.then(() => this.signLocked(input));
    this.queue = run.catch(() => undefined);
    return run;
  }

  /** SEC-005: revalidate every field immediately before signing. */
  private revalidate(input: ExactPayment): void {
    const bad = (reason: string): never => {
      throw new PaymentError('QUOTE_REJECTED', reason);
    };
    if (input.network !== this.opts.network) bad('network mismatch');
    if (!XrplAddress.safeParse(input.destination).success) bad('invalid destination');
    if (!DecimalString.safeParse(input.amount).success) bad('invalid amount');
    const amount = new Decimal(input.amount);
    if (!amount.greaterThan(0)) bad('amount must be positive');
    if (input.asset === 'XRP') {
      if (input.issuer !== null) bad('issuer not allowed for XRP');
      if (!amount.isInteger()) bad('XRP amount must be whole drops');
    } else {
      if (!/^[0-9A-F]{40}$/.test(input.asset)) bad('asset not supported');
      if (!input.issuer || !XrplAddress.safeParse(input.issuer).success) bad('issuer required');
    }
    if (!input.invoiceId.trim()) bad('invoice id missing');
  }

  private async signLocked(input: ExactPayment): Promise<SignedPayment> {
    this.revalidate(input);
    const client = await asClient(this.opts.ledger);
    const wallet = loadWallet(this.opts.seedEnvVar);
    const account = wallet.classicAddress;

    await this.assertSufficientBalance(client, account, input);

    const amount: Payment['Amount'] =
      input.asset === 'XRP'
        ? input.amount
        : { currency: input.asset, issuer: input.issuer as string, value: input.amount };

    const lastLedgerSequence =
      (await withBackoff(() => validatedLedgerIndex(client))) + this.opts.lastLedgerOffset;
    const tx: Payment = {
      TransactionType: 'Payment',
      Account: account,
      Destination: input.destination,
      Amount: amount,
      ...(input.asset === 'XRP' ? {} : { SendMax: amount }),
      InvoiceID: createHash('sha256').update(input.invoiceId).digest('hex').toUpperCase(),
      SourceTag: this.opts.sourceTag,
      LastLedgerSequence: lastLedgerSequence,
      Flags: 0, // never tfPartialPayment; no Paths
    };

    const filled = await withBackoff(() => client.autofill(tx));
    if (typeof filled.Sequence !== 'number')
      throw new PaymentError('SIGNER_UNAVAILABLE', 'could not determine sequence');

    const signed = wallet.sign(filled); // the only signing event; hash computed locally
    return {
      signedTxBlob: signed.tx_blob,
      transactionHash: signed.hash,
      payerAddress: account,
      sequence: filled.Sequence,
      lastLedgerSequence,
    };
  }

  /** §14: insufficient balance stops before signing. */
  private async assertSufficientBalance(
    client: Awaited<ReturnType<typeof asClient>>,
    account: string,
    input: ExactPayment,
  ): Promise<void> {
    const insufficient = (): never => {
      throw new PaymentError('INSUFFICIENT_BALANCE', 'wallet balance is insufficient');
    };
    if (input.asset === 'XRP') {
      const [info, server] = await Promise.all([
        withBackoff(() =>
          client.request({ command: 'account_info', account, ledger_index: 'validated' }),
        ),
        withBackoff(() => client.request({ command: 'server_info' })),
      ]);
      const ledger = server.result.info.validated_ledger;
      const reserve = new Decimal(ledger?.reserve_base_xrp ?? 1)
        .plus(
          new Decimal(ledger?.reserve_inc_xrp ?? 0.2).times(info.result.account_data.OwnerCount),
        )
        .times(1_000_000);
      const spendable = new Decimal(info.result.account_data.Balance).minus(reserve);
      // ponytail: 12 drops covers the open-ledger fee on Testnet; autofill computes the real one.
      if (spendable.lessThan(new Decimal(input.amount).plus(12))) insufficient();
      return;
    }
    const lines = await withBackoff(() =>
      client.request({
        command: 'account_lines',
        account,
        peer: input.issuer as string,
        ledger_index: 'validated',
      }),
    );
    const line = lines.result.lines.find((l) => l.currency.toUpperCase() === input.asset);
    if (!line || new Decimal(line.balance).lessThan(new Decimal(input.amount))) insufficient();
  }
}
