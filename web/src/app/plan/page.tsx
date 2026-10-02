import { LedgerPlan } from '@/components/plan/LedgerPlan';
import { loadPlanFromCookies } from '@/components/plan/load-plan';
import { Suspense } from 'react';
import PlanLoading from './loading';

export const dynamic = 'force-dynamic';

export default function PlanPage() {
  return <Suspense fallback={<PlanLoading />}><PlanContent /></Suspense>;
}

async function PlanContent() {
  const plan = await loadPlanFromCookies();
  return (
    <>
      <h1 className="sr-only">Your plan</h1>
      <LedgerPlan plan={plan} />
    </>
  );
}
