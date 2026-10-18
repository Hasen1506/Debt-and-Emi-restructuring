'use client';

/** Setup's "I don't know the balance": work it out from what was borrowed,
 *  when it started and its term (moved out of QuickSetup, UX2-3, to keep it
 *  under its size cap). */
import type { LoanPayload } from '@/lib/api';
import type { CurrencyCode } from '@/lib/currency';
import { Field } from '@/components/ToolPrimitives';
import { L_T, LBracket } from '@/components/ledger/primitives';
import { paymentWords } from '@/lib/r7-inputs';
import { estimateBalance, monthsSince, withEstimate } from '@/lib/setup-estimates';

export interface EstimateUi {
  estAmount?: string;
  estStart?: string;
  estTerm?: string;
  estError?: string | null;
}

const grid2 = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(240px, 100%), 1fr))', gap: 14 } as const;

export function EstimateBalance({ loan, ui, onUi, onPatch, country, ccy, typical, thisMonth }: {
  loan: LoanPayload;
  ui: EstimateUi;
  onUi: (p: EstimateUi & { estOpen?: boolean; byMonths?: boolean; months?: string }) => void;
  onPatch: (p: Partial<LoanPayload>) => void;
  country: string;
  ccy: CurrencyCode;
  typical: number | null;
  thisMonth: string;
}) {
  return (
    <div role="group" aria-label="Work out the balance" style={{ ...grid2, padding: '10px 12px', background: L_T.paper, border: `1px solid ${L_T.ruleSoft}` }}>
      <p style={{ gridColumn: '1 / -1', margin: 0, fontSize: 'var(--fs-dense)', color: L_T.inkSoft }}>
        From what you borrowed, when it started and its term, at the rate above. It assumes every {paymentWords(country).one} was paid on time
        and nothing extra: an estimate, marked as one, until you enter the real balance.
      </p>
      <Field label="Amount borrowed" kind="money" currency={ccy} value={ui.estAmount ?? ''} onChange={(v) => onUi({ estAmount: v })} />
      <Field label={`${paymentWords(country).first} (year-month)`} kind="text" placeholder="2022-04" value={ui.estStart ?? ''} onChange={(v) => onUi({ estStart: v })} />
      <Field label="Term when you took it, months" kind="integer" value={ui.estTerm ?? ''} onChange={(v) => onUi({ estTerm: v })} />
      <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <LBracket
          accent
          onClick={() => {
            const rate = loan.nominal_rate.trim() || (typical != null ? String(typical) : '');
            const paid = monthsSince((ui.estStart ?? '').trim(), thisMonth);
            const term = Number(ui.estTerm);
            const bal = rate && paid != null && term > 0 ? estimateBalance(ui.estAmount ?? '', rate, term, paid) : null;
            if (!bal || !(Number(rate) > 0)) {
              onUi({ estError: `Enter the amount, the month of the ${paymentWords(country).first.replace(/^First/, 'first')} (like 2022-04), the term in months, and the rate above (or tap I DON’T KNOW THE RATE).` });
              return;
            }
            let next = withEstimate(loan, 'balance', true);
            if (!loan.nominal_rate.trim()) next = withEstimate(next, 'rate', true);
            onPatch({ outstanding: bal, nominal_rate: rate, estimated_fields: next.estimated_fields });
            onUi({ estOpen: false, estError: null, byMonths: true, months: String(Math.max(1, term - (paid ?? 0))) });
          }}
        >
          USE THIS ESTIMATE
        </LBracket>
        {ui.estError && <span role="alert" style={{ fontSize: 'var(--fs-dense)', color: L_T.negative }}>{ui.estError}</span>}
      </div>
    </div>
  );
}
