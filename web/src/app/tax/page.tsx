import { LShell } from '@/components/ledger/primitives';
import { TaxPage } from '@/components/tax/TaxPage';

/** Its own tab title (UX50 C-26 / E-15). */
export const metadata = { title: 'Tax · RightDue' };

export const dynamic = 'force-dynamic';

/**
 * /tax: tax and your loans (sprint G2, grill #77: "bring the Tax section
 * back"). It was folded into Profile in V5 when it only repeated three
 * rows; it now compares the regimes with the loans counted, holds each
 * loan's tax inputs (co-borrower share, let-out rent, pre-construction
 * interest, the 80E start) and the 80C room. Profile's tax section links
 * here; the masthead lights PROFILE.
 */
export default function Page() {
  return (
    <LShell>
      <TaxPage />
    </LShell>
  );
}
