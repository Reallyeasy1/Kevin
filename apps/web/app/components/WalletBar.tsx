import type { WalletResponse } from '@subbuddy/contracts';
import { networkLabel } from '../../src/lib/route-ui';

export function WalletBar({
  wallet,
  error,
}: {
  wallet: WalletResponse | null;
  error: string | null;
}) {
  const mainnet = wallet?.network === 'xrpl:0';
  return (
    <header
      aria-label="Wallet"
      className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-neutral-200 bg-white px-4 py-3 text-sm"
    >
      <span className="font-semibold">Agent wallet</span>
      {wallet ? (
        <>
          <code
            className="truncate font-mono text-xs"
            title={wallet.address}
            data-testid="wallet-address"
          >
            {wallet.address}
          </code>
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${
              mainnet ? 'bg-red-100 text-red-800' : 'bg-emerald-100 text-emerald-800'
            }`}
            data-testid="network-badge"
          >
            {networkLabel(wallet.network)}
          </span>
          <ul className="ml-auto flex gap-3" aria-label="Balances">
            {wallet.balances.map((b) => (
              <li key={b.asset} className="font-mono text-xs">
                {b.amount} <span className="text-neutral-500">{b.asset}</span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <span className="text-neutral-500" role="status">
          {error ?? 'Loading wallet…'}
        </span>
      )}
    </header>
  );
}
