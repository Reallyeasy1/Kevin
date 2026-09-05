import { Suspense } from 'react';
import { RouterApp } from './components/RouterApp';

export default function HomePage() {
  return (
    <main className="mx-auto w-full max-w-4xl p-3 sm:p-6">
      <h1 className="sr-only">SubBuddy inference router</h1>
      {/* useSearchParams needs a Suspense boundary for static rendering. */}
      <Suspense fallback={<p className="text-sm text-neutral-500">Loading…</p>}>
        <RouterApp />
      </Suspense>
    </main>
  );
}
