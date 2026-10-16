'use client';

/** UX2-3: "How is it repaid?" on a Setup loan: EMI, interest only (an
 *  education moratorium, an overdraft or credit line) or all at the end (a
 *  gold loan). lib/repayment-shape turns the answer into what the engine
 *  models (repayment, pre-EMI window, months to the end). */
import type { LoanPayload } from '@/lib/api';
import { Field } from '@/components/ToolPrimitives';
import { L_T, LChip as Chip, LChipRow as ChipRow } from '@/components/ledger/primitives';
import { shapeChoices, shapeNote, shapeOf } from '@/lib/repayment-shape';

export function RepaymentChips({ loan, country, endMonth, onPatch, onEnd, error, money }: {
  loan: LoanPayload;
  country: string;
  endMonth: string;
  onPatch: (p: Partial<LoanPayload>) => void;
  onEnd: (month: string) => void;
  error?: string;
  money: (v: number) => string;
}) {
  const choices = shapeChoices(loan.loan_type, country);
  if (!choices) return null;
  const shape = shapeOf(loan);
  const note = shapeNote(loan, endMonth, money, country);
  const endLabel = shape === 'bullet'
    ? 'Due month (year-month)'
    : loan.loan_type === 'education_loan' || loan.loan_type === 'home_loan'
      ? 'Interest only until (year-month)'
      : 'Amount borrowed due (year-month, optional)';
  return (
    <div data-testid="setup-repayment" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <ChipRow label="How it’s repaid">
        {choices.map(([s, label]) => (
          <Chip key={s} on={shape === s} onClick={() => onPatch({ repayment: s === 'emi' ? undefined : s, pre_emi_months_remaining: 0 })}>
            {label}
          </Chip>
        ))}
      </ChipRow>
      {shape !== 'emi' && (
        <Field label={endLabel} kind="text" placeholder="2027-04" value={endMonth} onChange={onEnd} error={error} />
      )}
      {note && <p style={{ margin: 0, fontSize: 'var(--fs-dense)', color: L_T.inkSoft }}>{note}</p>}
    </div>
  );
}
