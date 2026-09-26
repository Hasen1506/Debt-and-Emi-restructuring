import { Suspense } from 'react';
import { loadProfileServer } from '@/lib/user-store';
import { LedgerHome } from '@/components/home/LedgerHome';
import {
  HomeDebtFreeCaption,
  HomeDebtFreeValue,
  HomeMoveDetail,
  HomeMoveHeadline,
  HomeMoveOneStep,
} from '@/components/home/HomeDebtFree';

// Home streams the plan's date and this month's move: the page paints at
// once and the engine's answer (~10–40 ms) fills in.
export default async function HomePage() {
  const profile = await loadProfileServer();
  // The ledger layout shows no page title; screen readers still need one.
  return (
    <>
      <h1 className="sr-only">Home</h1>
      <LedgerHome
        profile={profile}
        debtFree={{
          v: (
            <Suspense fallback={<span aria-busy="true">……</span>}>
              <HomeDebtFreeValue />
            </Suspense>
          ),
          s: (
            <Suspense fallback={<span>WORKING OUT YOUR DATE</span>}>
              <HomeDebtFreeCaption />
            </Suspense>
          ),
        }}
        move={{
          headline: (
            <Suspense fallback={<span aria-busy="true">WORKING OUT THIS MONTH…</span>}>
              <HomeMoveHeadline />
            </Suspense>
          ),
          detail: (
            <Suspense fallback={<span>&nbsp;</span>}>
              <HomeMoveDetail />
            </Suspense>
          ),
          oneStep: (
            <Suspense fallback={<span aria-busy="true">……</span>}>
              <HomeMoveOneStep />
            </Suspense>
          ),
        }}
      />
    </>
  );
}
