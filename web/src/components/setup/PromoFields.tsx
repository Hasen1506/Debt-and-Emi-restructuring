'use client';

/** UX2B-5: a card at 0% asks, optionally, when the offer ends and the rate
 *  after it (lib/promo-rate), so the plan charges interest from then. */
import type { LoanPayload } from '@/lib/api';
import { Field } from '@/components/ToolPrimitives';

export function PromoFields({ loan, onPatch, error }: { loan: LoanPayload; onPatch: (p: Partial<LoanPayload>) => void; error?: string }) {
  if (loan.loan_type !== 'credit_card' || (loan.nominal_rate ?? '').trim() === '' || Number(loan.nominal_rate) !== 0) return null;
  return (
    <div data-testid="setup-promo" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
      <Field label="0% until (year-month, optional)" kind="text" placeholder="2027-04" value={loan.promo_until ?? ''} onChange={(v) => onPatch({ promo_until: v })} error={error} />
      {(loan.promo_until ?? '').trim() !== '' && (
        <Field label="Rate after that, % a year" kind="percent" value={loan.rate_after_promo ?? ''} onChange={(v) => onPatch({ rate_after_promo: v })} />
      )}
    </div>
  );
}
