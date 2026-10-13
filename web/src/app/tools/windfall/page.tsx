import { WindfallTool } from './tool';
import { LToolPageHeader } from '@/components/ledger/LToolPageHeader';
import { loadPlanInputsFromCookies } from '@/components/plan/load-plan';

/** Its own tab title (UX50 C-26 / E-15). */
export const metadata = { title: 'Spare cash · RightDue' };

export const dynamic = 'force-dynamic';

export default async function WindfallPage() {
  // The plan's inputs (not a run of it): each split is run against them.
  const inputs = await loadPlanInputsFromCookies().catch(() => null);
  const hasLoans = (inputs?.simBaseArgs.user.loans ?? []).some((l) => Number(l.outstanding) > 0);
  return (
    <LToolPageHeader id="windfall">
      <WindfallTool runArgs={hasLoans ? inputs!.simBaseArgs : null} strategy={inputs?.strategy ?? 'avalanche'} />
    </LToolPageHeader>
  );
}
