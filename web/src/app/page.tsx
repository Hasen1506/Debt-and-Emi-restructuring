import { Suspense } from 'react';
import type { Metadata } from 'next';
import { loadCurrentProfileServer } from '@/lib/user-store';
import { readLifecycleServer } from '@/lib/lifecycle-events';
import { loadStrategyServer } from '@/lib/strategy';
import { LedgerHome } from '@/components/home/LedgerHome';
import { GuestWelcomeBack } from '@/components/home/GuestWelcomeBack';
import {
  HomeCheaperRates,
  HomeDebtFreeCaption,
  HomeDebtFreeValue,
  HomeInterestCaption,
  HomeInterestValue,
  HomeMoveOneStep,
  HomePayThisMonth,
  HomeThisMonthStrip,
} from '@/components/home/HomeDebtFree';

// Live re-test 6B R6B-6: Home had the generic site title.
export const metadata: Metadata = { title: 'Home · RightDue' };

// Home streams the plan's date and this month's payments: the page paints
// at once and the engine's answer (~10–40 ms) fills in.
export default async function HomePage() {
  const [profile, strategy] = await Promise.all([loadCurrentProfileServer(), loadStrategyServer()]);
  const plannedLoans=(await readLifecycleServer()).filter(e=>e.status==='planned' && e.kind==='property_buy');
  const showPlannedSummary=plannedLoans.length>0 && !profile.user.loans.some(l=>Number(l.outstanding)>0);
  // The ledger layout shows no page title; screen readers still need one.
  return (
    <>
      <h1 className="sr-only">Home</h1>
      {/* A guest coming back to a plan saved in this browser: continue or start fresh (live test #1). */}
      <GuestWelcomeBack />
      <LedgerHome
        profile={profile}
        strategy={strategy}
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
        interest={{
          v: (
            <Suspense fallback={<span aria-busy="true">……</span>}>
              <HomeInterestValue />
            </Suspense>
          ),
          s: (
            <Suspense fallback={<span>WORKING OUT THIS MONTH</span>}>
              <HomeInterestCaption />
            </Suspense>
          ),
        }}
        register={
          <Suspense fallback={<p aria-busy="true" style={{ fontSize: 'var(--fs-dense)' }}>WORKING OUT THIS MONTH&apos;S PAYMENTS…</p>}>
            <HomePayThisMonth />
          </Suspense>
        }
        thisMonth={
          <Suspense fallback={null}>
            <HomeThisMonthStrip />
          </Suspense>
        }
        cheaper={
          <Suspense fallback={null}>
            <HomeCheaperRates />
          </Suspense>
        }
        oneStep={
          // Live re-test 2 R2-9: no "……" while the step loads; the empty
          // busy span lets the soft view show its own line meanwhile.
          <Suspense fallback={<span aria-busy="true" />}>
            <HomeMoveOneStep />
          </Suspense>
        }
      />
      {showPlannedSummary && <section style={{padding:'16px 0',fontSize: 'var(--fs-dense)'}}>
        <p>PLANNED LOANS · {plannedLoans.map(e=>e.kind==='property_buy' ? `${e.loanDraft.bank || 'New loan'} from ${e.effectiveDate}` : '').join('; ')}</p>
        <p>FORECAST · <Suspense fallback={<span>WORKING OUT YOUR DATE</span>}><HomeDebtFreeValue /></Suspense></p>
        <p><Suspense fallback={<span>WORKING OUT YOUR PLAN</span>}><HomeDebtFreeCaption /></Suspense></p>
        <a href="/plan">Review the planned loans and funding →</a>
      </section>}
    </>
  );
}
