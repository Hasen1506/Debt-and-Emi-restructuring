import { LShell } from '@/components/ledger/primitives';
import { TaxPage } from '@/components/tax/TaxPage';
import { AssetsTaxNav } from '@/components/chrome/AssetsTaxNav';

/** Its own tab title (UX50 C-26 / E-15). */
export const metadata = { title: 'Assets & tax: tax · RightDue' };

export const dynamic = 'force-dynamic';

/**
 * /tax: tax and your loans (sprint G2, grill #77: "bring the Tax section
 * back"). It was folded into Profile in V5 when it only repeated three
 * rows; it now compares the regimes with the loans counted, holds each
 * loan's tax inputs (co-borrower share, let-out rent, pre-construction
 * interest, the 80E start) and the 80C room. Profile's tax section links
 * here. Audit 80+ A20: the second half of the Assets & tax section (with
 * /portfolio), behind More; the masthead lights More.
 */
export default function Page() {
  return (
    <LShell>
      <AssetsTaxNav current="/tax" />
      <TaxPage />
    </LShell>
  );
}
