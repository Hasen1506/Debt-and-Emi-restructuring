import { Suspense } from 'react';
import { loadCurrentProfileServer } from '@/lib/user-store';
import { readLifecycleServer } from '@/lib/lifecycle-events';
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
  const profile = await loadCurrentProfileServer();
  const plannedLoans=(await readLifecycleServer()).filter(e=>e.status==='planned' && e.kind==='property_buy');
  const showPlannedSummary=plannedLoans.length>0 && !profile.user.loans.some(l=>Number(l.outstanding)>0);
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
      {showPlannedSummary && <section style={{padding:'16px 0',fontSize:12}}>
        <p>PLANNED LOANS · {plannedLoans.map(e=>e.kind==='property_buy' ? `${e.loanDraft.bank || 'New loan'} from ${e.effectiveDate}` : '').join('; ')}</p>
        <p>FORECAST · <Suspense fallback={<span>WORKING OUT YOUR DATE</span>}><HomeDebtFreeValue /></Suspense></p>
        <p><Suspense fallback={<span>WORKING OUT YOUR PLAN</span>}><HomeDebtFreeCaption /></Suspense></p>
        <a href="/plan">Review the planned loans and funding →</a>
      </section>}
    </>
  );
}
