'use client';

/**
 * E5 (audit 80): for someone earning abroad, the plan's extra on a rupee
 * loan gets one honest line: what prepaying really earns in their own
 * currency after the rupee's slide and the cost of sending money, beside
 * the plain alternative of keeping the dollars. The numbers come from the
 * engine (engine/cross_border.py nri_prepay_comparison via
 * /api/cross-border-decision), never a twin here. It never says "prepay".
 */
import { useEffect, useState } from 'react';
import { api, type LoanPayload, type UserPayload } from '@/lib/api';
import { L_T } from '@/components/ledger/primitives';
import { INR_SLIDE_VS_USD } from '@/lib/fx-drift';

/** The rupee loan the line is about: the highest-rate open one. */
export function nriLineLoan(user: Pick<UserPayload, 'country' | 'loans' | 'fx_to_user_currency'>): LoanPayload | null {
  if (user.country !== 'US') return null;
  const rupee = user.loans.filter(
    (l) => (l.currency || '').toUpperCase() === 'INR' && Number(l.outstanding) > 0 && l.loan_type !== 'credit_card',
  );
  if (rupee.length === 0 || !(Number(user.fx_to_user_currency?.INR) > 0)) return null;
  return rupee.reduce((a, b) => (Number(b.nominal_rate) > Number(a.nominal_rate) ? b : a));
}

export function NriPrepayLine({ user, drift }: { user: UserPayload; drift: 'on' | 'off' }) {
  const loan = nriLineLoan(user);
  const [line, setLine] = useState<{ text: string; caveats: string[] } | null>(null);
  const key = loan ? JSON.stringify([loan.outstanding, loan.nominal_rate, loan.tenure_months_remaining, drift, user.fx_to_user_currency?.INR]) : '';
  useEffect(() => {
    if (!loan) return;
    let live = true;
    api
      .crossBorder({
        loan_balance: String(loan.outstanding),
        loan_nominal_rate: String(loan.nominal_rate),
        loan_tenure_months: Math.max(1, Number(loan.tenure_months_remaining) || 12),
        loan_currency: 'INR',
        user_currency: 'USD',
        user_savings_yield: '0',
        use_published_savings_rate: true,
        manual_fx_rate: String(user.fx_to_user_currency?.INR),
        manual_fx_drift_annual: drift === 'on' ? INR_SLIDE_VS_USD : '0',
      })
      .then((r) => live && r.comparison_line && setLine({ text: r.comparison_line, caveats: r.comparison_caveats ?? [] }))
      .catch(() => live && setLine(null));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  if (!loan || !line) return null;
  return (
    <section data-testid="nri-prepay-line" aria-label="Prepaying a rupee loan from dollars" style={{ fontSize: 13, lineHeight: 1.5 }}>
      <p style={{ margin: 0 }}>{line.text}</p>
      {line.caveats.length > 0 && (
        <ul style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: 12, color: L_T.muted }}>
          {line.caveats.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
