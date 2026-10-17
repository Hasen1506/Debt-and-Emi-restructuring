'use client';

/**
 * Round 3 part B: the per-loan questions under a Setup loan (lib/loan-status).
 *   #10 a loan against property / top-up: "Was it used for a house?"
 *   #21 an EMI taken from salary before it reaches the bank
 *   #13 payment status: normal / behind / collections / settled, one plain
 *       line each; tucked behind a link while the loan is paid normally.
 * Plus US medical debt's own short guidance.
 */
import { useState } from 'react';
import type { LoanPayload } from '@/lib/api';
import { L_T, LBracket, LChip as Chip, LChipRow as ChipRow } from '@/components/ledger/primitives';
import { HOUSE_USE_KINDS } from '@/lib/loan-types';
import {
  DEBT_STATUS_CHOICES, HOUSE_USE_CHOICES, SALARY_DEDUCTED_HINT, SALARY_DEDUCTED_LABEL, US_MEDICAL_NOTES,
  canBeSalaryDeducted, debtStatus,
} from '@/lib/loan-status';

const note = { margin: 0, fontSize: 'var(--fs-dense)', color: L_T.muted } as const;

export function LoanExtras({ loan, country, onPatch }: {
  loan: LoanPayload;
  country: 'IN' | 'US';
  onPatch: (p: Partial<LoanPayload>) => void;
}) {
  const status = debtStatus(loan);
  const [open, setOpen] = useState(status !== 'normal');
  const house = HOUSE_USE_KINDS.includes(loan.loan_type) && (loan.currency ?? (country === 'US' ? 'USD' : 'INR')) === 'INR';
  const use = HOUSE_USE_CHOICES.find(([k]) => k === loan.house_use);
  return (
    <div data-testid="setup-loan-extras" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {house && (
        <div>
          <ChipRow label="Was the money used for a house?">
            {HOUSE_USE_CHOICES.map(([k, label]) => (
              <Chip key={k} on={loan.house_use === k} onClick={() => onPatch({ house_use: k })}>{label}</Chip>
            ))}
          </ChipRow>
          <p style={note} data-testid="setup-house-use-note">
            {use ? use[2] : 'Only money that bought, built or repaired a house gets the home-loan tax break. Until you say, none is counted.'}
          </p>
        </div>
      )}
      {loan.loan_type === 'medical_loan' && country === 'US' && (
        <ul style={{ ...note, paddingLeft: 18 }} data-testid="setup-us-medical">
          {US_MEDICAL_NOTES.map((t) => <li key={t}>{t}</li>)}
        </ul>
      )}
      {canBeSalaryDeducted(loan.loan_type) && (
        <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 'var(--fs-small)' }}>
          <input type="checkbox" checked={!!loan.salary_deducted} data-testid="setup-salary-deducted"
            onChange={(e) => onPatch({ salary_deducted: e.target.checked || undefined })} />
          <span>
            {SALARY_DEDUCTED_LABEL}
            {loan.salary_deducted && <span style={{ ...note, display: 'block' }}>{SALARY_DEDUCTED_HINT}</span>}
          </span>
        </label>
      )}
      {!open ? (
        <span><LBracket onClick={() => setOpen(true)}>BEHIND, WITH COLLECTORS OR SETTLED?</LBracket></span>
      ) : (
        <div role="radiogroup" aria-label="Payment status" data-testid="setup-debt-status" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={note}>Payment status</span>
          {DEBT_STATUS_CHOICES.map(([k, label, line]) => (
            <label key={k} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 'var(--fs-small)' }}>
              <input type="radio" name={`status-${loan.id ?? ''}`} checked={status === k} data-testid={`setup-status-${k}`}
                onChange={() => onPatch(k === 'settled'
                  // Settled: nothing more is owed, so it leaves the plan like a cleared loan.
                  ? { debt_status: k, outstanding: '0', scheduled_emi: '0', salary_deducted: undefined }
                  : { debt_status: k === 'normal' ? undefined : k })} />
              <span><strong>{label}</strong> <span style={note}>{line}</span></span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
