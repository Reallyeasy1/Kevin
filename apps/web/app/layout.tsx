import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'Kevin',
  description: 'Wallet-native AI inference router on XRPL Testnet',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-neutral-50 text-neutral-900 antialiased">
        <nav
          aria-label="Primary"
          className="mx-auto flex w-full max-w-4xl items-center gap-4 px-3 pt-3 text-sm sm:px-6"
        >
          <Link href="/" className="font-semibold focus:outline-2 focus:outline-indigo-600">
            Kevin
          </Link>
          <Link
            href="/chat"
            className="text-neutral-600 hover:underline focus:outline-2 focus:outline-indigo-600"
          >
            Chat
          </Link>
          <Link
            href="/history"
            className="text-neutral-600 hover:underline focus:outline-2 focus:outline-indigo-600"
          >
            History
          </Link>
        </nav>
        {children}
      </body>
    </html>
  );
}
