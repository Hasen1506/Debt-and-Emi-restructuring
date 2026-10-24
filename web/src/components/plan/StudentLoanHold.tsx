'use client';
/**
 * UX walkthrough fix 6: a US student loan not marked federal or private (or
 * with no PSLF/IDR answer) gets no extra payments (W10 E7), so once the
 * other debts are paid the spare cash sits unused and the date is set by the
 * loan's required payment alone. Home and Plan say so, with a one-tap answer.
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { LoanPayload, UserPayload } from '@/lib/api';
import { forgivenessAnswerPending } from '@/lib/us-loans';
import { loanName } from '@/lib/loan-types';
import { loadProfileClient, saveProfileClient } from '@/lib/user-store';
import { LBracket, L_T } from '@/components/ledger/primitives';

type Answer = Pick<LoanPayload, 'student_loan_kind' | 'forgiveness_track'>;
export const HOLD_ANSWERS: { label: string; patch: Answer }[] = [
  { label: 'PRIVATE', patch: { student_loan_kind: 'private', forgiveness_track: undefined } },
  { label: 'FEDERAL, NO FORGIVENESS PLAN', patch: { student_loan_kind: 'federal', forgiveness_track: 'none' } },
  { label: 'FEDERAL, ON PSLF OR AN INCOME-DRIVEN PLAN', patch: { student_loan_kind: 'federal', forgiveness_track: 'idr' } },
];

/** The first held loan, or null. */
export function heldStudentLoan(user: Pick<UserPayload, 'loans' | 'country'>): { index: number; loan: LoanPayload } | null {
  const index = user.loans.findIndex((l) => Number(l.outstanding) > 0 && forgivenessAnswerPending(l, user.country));
  return index < 0 ? null : { index, loan: user.loans[index] };
}

export function holdLine(loan: LoanPayload, money: (v: number) => string): string {
  const emi = Number(loan.scheduled_emi) || 0;
  return `Your ${loanName(loan)} isn’t marked federal or private yet, so no spare cash goes on it: once your other debts are paid, the money sits unused and the plan pays only its required ${emi > 0 ? `${money(emi)} a month` : 'payment'}. That sets your debt-free date. What kind is it?`;
}

export function StudentLoanHold({ user, money, testId = 'student-loan-hold' }: { user: Pick<UserPayload, 'loans' | 'country'>; money: (v: number) => string; testId?: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [failed, setFailed] = useState(false);
  const held = heldStudentLoan(user);
  if (!held || user.country !== 'US') return null;
  const answer = (patch: Answer) => {
    const stored = loadProfileClient();
    const loans = stored.user.loans.map((l, i) => ((held.loan.id ? l.id === held.loan.id : i === held.index) ? { ...l, ...patch } : l));
    const ok = saveProfileClient({ ...stored, user: { ...stored.user, loans } });
    setFailed(!ok);
    if (ok) start(() => router.refresh());
  };
  return (
    <p role="note" data-testid={testId} style={{ margin: 0, fontSize: 'var(--fs-dense)', lineHeight: 1.6, color: L_T.inkSoft, borderLeft: `2px solid ${L_T.accent}`, paddingLeft: 10 }}>
      {holdLine(held.loan, money)}{' '}
      {HOLD_ANSWERS.map((a) => (
        <span key={a.label} style={{ marginRight: 8, whiteSpace: 'nowrap' }}>
          <LBracket onClick={() => answer(a.patch)} disabled={pending}>{a.label}</LBracket>
        </span>
      ))}
      <a href="https://studentaid.gov/aid-summary/loans" target="_blank" rel="noopener noreferrer" style={{ color: L_T.muted }}>Not sure? studentaid.gov lists your federal loans.</a>
      {failed ? <span role="alert" style={{ color: L_T.negative }}> Couldn’t save. Try again.</span> : null}
    </p>
  );
}
