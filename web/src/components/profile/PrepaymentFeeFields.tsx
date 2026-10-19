'use client';

/**
 * Prepayment / foreclosure charge.
 *
 * Where RBI sets the charge to zero the box is not shown: the plan uses 0
 * and a one-line note says so. Where a charge can still apply (a fixed-rate
 * loan, or a business loan outside the 2025 lender and amount rules) the
 * box sits under More options, with the facts the rule needs.
 */
import { Field, Select } from '@/components/ToolPrimitives';
import type { Country, LoanPayload } from '@/lib/api';
import { asksBusinessPurpose } from '@/lib/loan-purpose';
import {
  RBI_ZERO_NOTE,
  feeShown,
  lenderFeeTypeFromName,
  prepaymentBarred,
  prepaymentFeeDefault,
} from '@/lib/prepayment-fee';
import { loanMarket } from '@/lib/currency';

const LENDER_OPTIONS = [
  { value: '', label: 'Not sure' },
  { value: 'bank', label: 'Commercial bank' },
  { value: 'small_finance_bank', label: 'Small finance bank' },
  { value: 'regional_rural_bank', label: 'Regional rural bank' },
  { value: 'cooperative_bank', label: 'Co-operative bank' },
  { value: 'hfc', label: 'Housing finance company' },
  { value: 'nbfc', label: 'Other NBFC' },
  { value: 'other', label: 'Someone else (employer, friend, chit)' },
];

export function PrepaymentFeeFields({
  loan,
  country,
  askOpen,
  note = true,
  onChange,
  findIt,
  error,
}: {
  loan: LoanPayload;
  country: Country;
  /** True when More options is open. The zero-charge note shows either way. */
  askOpen: boolean;
  /** The note is rendered once, outside More. The copy inside More skips it. */
  note?: boolean;
  onChange: (patch: Partial<LoanPayload>) => void;
  findIt?: string | null;
  error?: string | null;
}) {
  if (loan.loan_type === 'credit_card') return null;
  const barred = prepaymentBarred(loan, country);
  const shown = feeShown(loan, country);
  const business = asksBusinessPurpose(loan, country) && loan.business_purpose === true;
  const lender = loan.lender_type || lenderFeeTypeFromName(loan.bank) || '';
  const needsAmount = lender === 'small_finance_bank' || lender === 'regional_rural_bank' || lender === 'hfc' || lender === 'nbfc' || lender === 'cooperative_bank';
  return (
    <>
      {note && barred && (
        <p data-testid="prepayment-fee-barred" title={shown.hint} style={{ gridColumn: '1 / -1', margin: '4px 0 0', fontSize: 13, lineHeight: 1.45, color: 'var(--muted)' }}>
          {RBI_ZERO_NOTE}
        </p>
      )}
      {askOpen && business && (
        <>
          <Select
            label="Kind of lender"
            value={loan.lender_type || lender}
            onChange={(v) => onChange({ lender_type: (v || undefined) as LoanPayload['lender_type'] })}
            options={LENDER_OPTIONS}
            hint={lenderFeeTypeFromName(loan.bank) && !loan.lender_type ? 'Filled in from the lender name. Change it if that is wrong.' : 'Decides whether a business loan can carry a prepayment charge.'}
          />
          <Field
            label="Year sanctioned or last renewed"
            kind="integer"
            value={loan.sanction_year ? String(loan.sanction_year) : ''}
            onChange={(v) => onChange({ sanction_year: v.trim() ? Number(v) : undefined })}
            placeholder="2026"
            hint="The 2026 rule covers loans sanctioned or renewed from 1 January 2026."
          />
          {needsAmount && (
            <Field
              label="Amount sanctioned (₹)"
              kind="money"
              currency="INR"
              value={loan.sanctioned_amount ?? ''}
              onChange={(v) => onChange({ sanctioned_amount: v })}
              hint="The ₹50 lakh line is this amount, not what is left to repay."
            />
          )}
        </>
      )}
      {askOpen && !barred && (
        <Field
          label="Prepayment fee (%, optional)"
          findIt={findIt}
          kind="percent"
          value={loan.prepayment_penalty_pct ?? ''}
          onChange={(v) => onChange({ prepayment_penalty_pct: v })}
          error={error}
          placeholder={shown.placeholder}
          hint={shown.hint}
          info={
            <>
              What the lender charges on an amount you pay early, as a percent of that amount.
              {loanMarket(loan, country) === 'IN'
                ? ' RBI sets this to zero on a floating-rate loan to an individual that is not for a business. A fixed-rate loan, and some business loans, can still carry a charge: the sanction letter or Key Facts Statement states it.'
                : ' The sanction letter or Key Facts Statement states it.'}
            </>
          }
        />
      )}
    </>
  );
}

/** Drop a stored fee (and, from 2026, a lock-in) the law does not allow. */
export function withStatutoryPrepayment<T extends LoanPayload>(loan: T, country: Country): T {
  if (!prepaymentBarred(loan, country)) return loan;
  const raw = (loan.prepayment_penalty_pct ?? '').trim();
  const fee = raw !== '' && Number(raw) !== 0 ? '0' : loan.prepayment_penalty_pct;
  const lock = (loan.sanction_year ?? 0) >= 2026 && (loan.prepay_lock_in_months ?? 0) > 0 ? 0 : loan.prepay_lock_in_months;
  if (fee === loan.prepayment_penalty_pct && lock === loan.prepay_lock_in_months) return loan;
  return { ...loan, prepayment_penalty_pct: fee, prepay_lock_in_months: lock };
}

/** The rule's own reading, for tests that want the reason next to the note. */
export function barredReason(loan: LoanPayload, country: Country): string {
  return prepaymentFeeDefault(loan.loan_type, loan.rate_type, loanMarket(loan, country), {
    lenderType: loan.lender_type || lenderFeeTypeFromName(loan.bank),
    businessPurpose: loan.business_purpose,
    sanctionYear: loan.sanction_year,
    sanctionedAmount: loan.sanctioned_amount,
  }).reason;
}
