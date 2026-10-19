import { AdvanceTaxPanel, NoAdvanceTax } from '@/components/plan/AdvanceTaxPanel';
import { loadPlanFromCookies } from '@/components/plan/load-plan';
import { LSectionHeader, LShell, L_T } from '@/components/ledger/primitives';
import Link from 'next/link';

export const metadata = { title: 'Advance tax · RightDue' };
export const dynamic = 'force-dynamic';

/**
 * The advance-tax screen. More, the tax page and the plan all open this.
 * The plan still shows the same panel; this page is the place the links land.
 */
export default async function AdvanceTaxPage() {
  const plan = await loadPlanFromCookies();
  const schedule = plan.advanceTaxSchedule;
  const country = plan.user.country;
  return (
    <LShell>
      <h1 className="sr-only">Advance tax</h1>
      <p style={{ margin: '0 0 12px', fontSize: 13, color: L_T.inkSoft, lineHeight: 1.6 }}>
        Income-tax Act, sections 208 to 211, 234B and 234C. The plan uses the same figures as this page.
      </p>
      {schedule ? (
        <AdvanceTaxPanel
          schedule={schedule}
          country={country}
          displayCurrency={plan.displayCurrency}
          monthlyPenaltyCost={plan.advanceTaxPenaltyMonthly}
          variant="ledger"
        />
      ) : (
        <NoAdvanceTax country={country} />
      )}
      {schedule && plan.advanceTaxNote && (
        <p data-testid="advance-tax-salaried-note" style={{ margin: '8px 0 0', fontSize: 12, color: L_T.muted, lineHeight: 1.6 }}>
          {plan.advanceTaxNote}
        </p>
      )}
      <section aria-labelledby="advance-tax-rules" style={{ marginTop: 20 }}>
        <LSectionHeader>
          <span id="advance-tax-rules">How the instalments are worked out</span>
        </LSectionHeader>
        <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 12, lineHeight: 1.6, color: L_T.inkSoft }}>
          <li>Advance tax applies when the tax still due after TDS is ₹10,000 or more. ₹9,999 does not.</li>
          <li>15% by 15 June, 45% by 15 September, 75% by 15 December, and 100% by 15 March.</li>
          <li>Section 44AD and 44ADA pay the whole amount by 15 March.</li>
          <li>A resident aged 60 or over with no business or profession income does not pay advance tax. Freelance income at 61 still does.</li>
          <li>Section 234C allows a 12% shortfall in June and 36% in September. Section 234B applies when less than 90% was paid.</li>
        </ul>
        <p style={{ margin: '12px 0 0', fontSize: 12 }}>
          <Link href="/plan">Back to the plan</Link>
          {' · '}
          <Link href="/tax">Tax and your loans</Link>
        </p>
      </section>
    </LShell>
  );
}
