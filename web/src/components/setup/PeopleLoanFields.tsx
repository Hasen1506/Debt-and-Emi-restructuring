'use client';

/** A loan a credit report will never show: family, a friend, a chit fund. */
import type { LoanPayload } from '@/lib/api';
import { Field } from '@/components/ToolPrimitives';
import { L_T, LChip as Chip, LChipRow as ChipRow } from '@/components/ledger/primitives';
import { peoplePatch, type PeopleInterest, type PeopleRepay } from '@/lib/people-loan';

const INTEREST: Array<[PeopleInterest, string]> = [
  ['none', 'No interest'],
  ['annual', 'Yearly %'],
  ['monthly', 'Monthly %'],
  ['fixed', 'A fixed amount'],
];
const REPAY: Array<[PeopleRepay, string]> = [
  ['emi', 'Fixed EMI'],
  ['whenever', 'Pay whenever'],
  ['lump', 'Lump sum by a date'],
];

export function PeopleLoanFields({
  loan,
  thisMonth,
  onPatch,
}: {
  loan: LoanPayload;
  thisMonth: string;
  onPatch: (p: Partial<LoanPayload>) => void;
}) {
  const interest = loan.people_interest ?? 'none';
  const repay = loan.people_repay ?? 'whenever';
  const input = loan.people_rate_input ?? '';
  const due = loan.people_due ?? '';
  function set(patch: { interest?: PeopleInterest; rateInput?: string; repay?: PeopleRepay; due?: string }) {
    onPatch(peoplePatch(loan, { ...patch, thisMonth }));
  }
  return (
    <div data-testid="people-loan" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <p style={{ margin: 0, fontSize: 12, lineHeight: 1.5, color: L_T.inkSoft }}>
        Someone you know, not a bank. It sits beside the loans from your credit report. A zero rate is paid last when you put extra on the costliest loan. Pay whenever, with no date, adds nothing due this month.
      </p>
      <ChipRow label="Interest">
        {INTEREST.map(([id, label]) => (
          <Chip key={id} on={interest === id} onClick={() => set({ interest: id })}>{label}</Chip>
        ))}
      </ChipRow>
      {interest === 'annual' && (
        <Field label="Interest, % a year" kind="decimal" value={input} onChange={(v) => set({ rateInput: v, interest: 'annual' })} hint="8.5 means 8.5% a year." />
      )}
      {interest === 'monthly' && (
        <Field label="Interest, % a month" kind="decimal" value={input} onChange={(v) => set({ rateInput: v, interest: 'monthly' })} hint="2 means 2% a month, kept as 24% a year and charged simply each month." />
      )}
      {interest === 'fixed' && (
        <Field label="Interest each month" kind="money" currency={loan.currency === 'USD' ? 'USD' : 'INR'} value={input} onChange={(v) => set({ rateInput: v, interest: 'fixed' })} hint="The plan charges this amount every month until the loan is cleared, even as the balance falls." />
      )}
      <ChipRow label="How you pay it back">
        {REPAY.map(([id, label]) => (
          <Chip key={id} on={repay === id} onClick={() => set({ repay: id })}>{label}</Chip>
        ))}
      </ChipRow>
      {repay === 'lump' && (
        <Field label="Due month (year-month)" kind="text" placeholder="2027-03" value={due} onChange={(v) => set({ due: v, repay: 'lump' })} />
      )}
      {repay === 'whenever' && (
        <p style={{ margin: 0, fontSize: 12, color: L_T.muted }}>No date and no fixed payment. Pay any amount from Home when you can. The balance still earns the interest above.</p>
      )}
      <Field label="Note (optional)" kind="text" value={loan.nickname ?? ''} onChange={(v) => onPatch({ nickname: v })} placeholder="Chit, or what it was for" />
    </div>
  );
}
