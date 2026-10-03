'use client';

/**
 * "I took this — update terms" modal.
 *
 * User accepts a restructuring opportunity in real life and comes back to
 * reflect the actual terms they negotiated. Banks rarely match the
 * recommendation rate exactly; the suggested rate seeds the form but
 * every field is editable.
 *
 * Behaviour per opportunity kind:
 *   • refinance       → mutate the indexed loan's rate / tenure /
 *                       processing-fee / lock-in / prepay penalty.
 *                       Loan identity (bank, outstanding, loan_type)
 *                       stays. UI nudges the bank field to the new
 *                       target_bank but the user can keep the old one
 *                       (e.g. when their original bank matched).
 *   • balance_transfer→ mutate the indexed credit card's nominal_rate
 *                       to the BT promo rate and stamp the lock-in
 *                       (promo window). Bank stays — the user may
 *                       move balance off-card later but the card
 *                       account itself is what we track.
 *   • consolidation   → zero-out the merged loans' outstanding and
 *                       append a new consolidated personal loan with
 *                       the summed balance at the new rate / tenure.
 *
 * Writes through `saveProfileClient` so the next /plan render picks
 * up the change without a manual reload. Appends a `restructuring_applied`
 * decision so /activity shows the audit trail.
 */
import { useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import { loadProfileClient, saveProfileClient } from '@/lib/user-store';
import { readDecisionsClient, recordDecision } from '@/lib/decisions';
import type {
  LoanPayload,
  RestructuringOpportunity,
  UserPayload,
} from '@/lib/api';
import { formatCurrency } from '@/lib/api';
import type { CurrencyCode } from '@/lib/currency';
import { percentRateError } from '@/lib/loan-gaps';

type FormState = {
  bank: string;
  rate: string;
  tenureMonths: string;
  processingFee: string;
  prepayPenaltyPct: string;
  prepayLockInMonths: string;
};

function seedForm(
  opp: RestructuringOpportunity,
  primary: LoanPayload | undefined,
): FormState {
  const ratePct = (Number(opp.target_rate || 0) * 100).toFixed(2);
  const targetBank = opp.target_bank ?? primary?.bank ?? '';
  const tenure = primary?.tenure_months_remaining ?? 0;
  return {
    bank: targetBank,
    rate: ratePct,
    tenureMonths: String(tenure || ''),
    processingFee: primary?.processing_fee_amortised ?? '0',
    prepayPenaltyPct: '0',
    prepayLockInMonths: '0',
  };
}

/**
 * For consolidation, derive the merged balance and the scan's assumed tenure.
 * Older opportunities fall back to five years. Single source of truth
 * for the modal's pre-fill so the form preview matches what gets saved.
 */
function consolidationPreview(
  opp: RestructuringOpportunity,
  loans: LoanPayload[],
): { totalOutstanding: number; defaultTenure: number; mergedLoans: LoanPayload[] } {
  const indices = opp.affected_loan_indices ?? [];
  const merged = indices
    .map((i) => loans[i])
    .filter((l): l is LoanPayload => l != null);
  const total = merged.reduce((s, l) => s + Number(l.outstanding || 0), 0);
  const assumedTenure = Number(opp.detail?.tenure_months);
  return { totalOutstanding: total, defaultTenure: assumedTenure > 0 ? assumedTenure : 60, mergedLoans: merged };
}

export function UpdateRestructureModal({
  opportunity,
  user,
  currency,
  onClose,
}: {
  opportunity: RestructuringOpportunity;
  user: UserPayload;
  currency: CurrencyCode;
  onClose: () => void;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);

  const indices = opportunity.affected_loan_indices ?? [];
  const primary: LoanPayload | undefined = user.loans[indices[0] ?? -1];

  const consolidation =
    opportunity.kind === 'consolidation'
      ? consolidationPreview(opportunity, user.loans)
      : null;

  const [form, setForm] = useState<FormState>(() => {
    const seeded = seedForm(opportunity, primary);
    if (consolidation) {
      return {
        ...seeded,
        tenureMonths: String(consolidation.defaultTenure),
      };
    }
    return seeded;
  });

  // Bail with a friendly error when we can't locate the loan(s) — typically
  // because the user edited their loan list between the scan and clicking
  // the button. Forcing them to re-open /plan refreshes the indices.
  if (!primary && !consolidation) {
    return (
      <ModalShell title="Update terms" onClose={onClose}>
        <p style={{ color: 'var(--muted)', fontSize: 13 }}>
          Couldn&apos;t find the loan this recommendation refers to — your
          loan list may have changed since the scan. Refresh the page and try
          again.
        </p>
      </ModalShell>
    );
  }

  const rateError = percentRateError(form.rate);

  function handleSubmit() {
    if (rateError) return;
    setSubmitting(true);
    const profile = loadProfileClient();
    const loans = [...profile.user.loans];
    const rateDecimal = String(Number(form.rate || 0) / 100);
    const tenure = Math.max(1, Number(form.tenureMonths || 0));
    const procFee = String(Number(form.processingFee || 0));
    const penaltyDecimal = String(Number(form.prepayPenaltyPct || 0) / 100);
    const lockIn = Math.max(0, Number(form.prepayLockInMonths || 0));

    if (opportunity.kind === 'consolidation' && consolidation) {
      // Zero out each merged loan in place — engine treats outstanding=0 as
      // cleared. Keeping the row around (rather than splicing) preserves
      // the index mapping for the activity log and decisions ledger.
      for (const idx of indices) {
        if (loans[idx]) {
          loans[idx] = {
            ...loans[idx],
            outstanding: '0',
            scheduled_emi: '0',
            tenure_months_remaining: 0,
          };
        }
      }
      const newLoan: LoanPayload = {
        loan_type: 'personal_loan',
        bank: form.bank || 'consolidated',
        outstanding: String(consolidation.totalOutstanding),
        nominal_rate: rateDecimal,
        rate_type: 'fixed',
        tenure_months_remaining: tenure,
        scheduled_emi: estimateEmi(
          consolidation.totalOutstanding,
          Number(rateDecimal),
          tenure,
        ),
        processing_fee_amortised: procFee,
        prepayment_penalty_pct: penaltyDecimal,
        prepay_lock_in_months: lockIn,
        currency: primary?.currency,
      } as LoanPayload;
      loans.push(newLoan);
    } else if (primary && indices[0] != null) {
      // Refi / BT: mutate the indexed loan in place. For BT we leave the
      // bank alone (the card account doesn't change banks); for refi we
      // honour the user's bank-field input.
      const i = indices[0];
      loans[i] = {
        ...loans[i],
        bank: opportunity.kind === 'balance_transfer' ? loans[i].bank : form.bank || loans[i].bank,
        nominal_rate: rateDecimal,
        tenure_months_remaining: tenure,
        scheduled_emi: estimateEmi(
          Number(loans[i].outstanding || 0),
          Number(rateDecimal),
          tenure,
        ),
        processing_fee_amortised: procFee,
        prepayment_penalty_pct: penaltyDecimal,
        prepay_lock_in_months: lockIn,
      };
    }

    saveProfileClient({
      user: { ...profile.user, loans },
      marginalRate: profile.marginalRate,
      creditScore: profile.creditScore,
    });

    recordDecision(readDecisionsClient(), {
      kind: 'restructuring_applied',
      label: `Applied ${opportunity.kind.replace('_', ' ')} — ${opportunity.target_bank ?? 'self-arranged'} @ ${form.rate}%`,
      snapshot: {
        affectedLoanIndices: indices,
        prevTerms: primary
          ? {
              bank: primary.bank,
              nominal_rate: primary.nominal_rate,
              tenure: primary.tenure_months_remaining,
            }
          : null,
      },
      result: {
        bank: form.bank,
        rate: rateDecimal,
        tenure,
        processingFee: procFee,
        prepayPenaltyPct: penaltyDecimal,
        prepayLockInMonths: lockIn,
      },
      impactDeltaMonths: null,
    });

    onClose();
    router.refresh();
  }

  const ccySym = currency === 'INR' ? '₹' : '$';
  const showBankField = opportunity.kind !== 'balance_transfer';

  return (
    <ModalShell title="Update loan terms" onClose={onClose}>
      <p style={{ fontSize: 13, lineHeight: 1.55, marginBottom: 12 }}>
        Enter the terms you actually got. We&apos;ve pre-filled the
        recommendation; edit anything the bank negotiated differently.
      </p>

      {consolidation && (
        <div
          style={{
            marginBottom: 12,
            padding: '8px 10px',
            background: 'var(--soft-bg)',
            border: '1px dashed var(--border)',
            borderRadius: 6,
            fontSize: 12,
          }}
        >
          Combining <strong>{consolidation.mergedLoans.length}</strong> loans
          totalling{' '}
          <strong>
            {formatCurrency(String(consolidation.totalOutstanding), currency)}
          </strong>{' '}
          into one new personal loan. The originals will be marked cleared.
        </div>
      )}

      <div style={{ display: 'grid', gap: 10, gridTemplateColumns: '1fr 1fr' }}>
        {showBankField && (
          <FormField
            label="Bank"
            value={form.bank}
            onChange={(v) => setForm((f) => ({ ...f, bank: v }))}
            isText
          />
        )}
        <FormField
          label="New rate (% APR)"
          value={form.rate}
          onChange={(v) => setForm((f) => ({ ...f, rate: v }))}
          error={rateError}
        />
        <FormField
          label="Tenure (months)"
          value={form.tenureMonths}
          onChange={(v) => setForm((f) => ({ ...f, tenureMonths: v }))}
        />
        <FormField
          label={`Processing fee (${ccySym})`}
          value={form.processingFee}
          onChange={(v) => setForm((f) => ({ ...f, processingFee: v }))}
        />
        <FormField
          label="Prepay penalty (%)"
          value={form.prepayPenaltyPct}
          onChange={(v) => setForm((f) => ({ ...f, prepayPenaltyPct: v }))}
        />
        <FormField
          label="Prepay lock-in (months)"
          value={form.prepayLockInMonths}
          onChange={(v) => setForm((f) => ({ ...f, prepayLockInMonths: v }))}
        />
      </div>

      <div
        style={{
          display: 'flex',
          gap: 8,
          marginTop: 14,
          justifyContent: 'flex-end',
        }}
      >
        <button
          type="button"
          onClick={onClose}
          disabled={submitting}
          style={{
            padding: '6px 12px',
            background: 'transparent',
            border: '1px solid var(--border)',
            borderRadius: 4,
            cursor: 'pointer',
            fontSize: 13,
            color: 'var(--ink)',
          }}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={submitting || rateError != null}
          style={{
            padding: '6px 14px',
            background: 'var(--accent)',
            color: 'var(--canvas)',
            border: 'none',
            borderRadius: 4,
            cursor: submitting ? 'wait' : 'pointer',
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          {submitting ? 'Saving…' : 'Save & recompute'}
        </button>
      </div>
    </ModalShell>
  );
}

// ─── tiny helpers ──────────────────────────────────────────────────────────

function ModalShell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.4)',
        zIndex: 200,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--card)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          padding: 16,
          width: '100%',
          maxWidth: 540,
          maxHeight: '90vh',
          overflow: 'auto',
          boxShadow: '0 10px 40px rgba(0,0,0,0.18)',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 8,
          }}
        >
          <h2 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="l-hit"
            style={{
              background: 'transparent',
              border: 'none',
              fontSize: 22,
              color: 'var(--muted)',
              cursor: 'pointer',
              lineHeight: 1,
              padding: 0,
            }}
          >
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function FormField({
  label,
  value,
  onChange,
  isText,
  error,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  isText?: boolean;
  error?: string | null;
}) {
  const errorId = useId();
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 11, color: 'var(--muted)' }}>{label}</span>
      <input
        type={isText ? 'text' : 'number'}
        inputMode={isText ? undefined : 'decimal'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        style={{
          padding: '6px 8px',
          background: 'var(--canvas)',
          border: `1px solid ${error ? 'var(--negative)' : 'var(--border)'}`,
          borderRadius: 4,
          fontSize: 13,
          color: 'var(--ink)',
          width: '100%',
        }}
      />
      {error && (
        <span id={errorId} role="alert" style={{ fontSize: 11, color: 'var(--negative)' }}>
          {error}
        </span>
      )}
    </label>
  );
}

/** Standard amortising EMI. Returns 0 when inputs are degenerate. */
function estimateEmi(principal: number, annualRate: number, months: number): string {
  if (principal <= 0 || months <= 0) return '0';
  if (annualRate <= 0) return (principal / months).toFixed(2);
  const r = annualRate / 12;
  const emi = (principal * r) / (1 - Math.pow(1 + r, -months));
  return emi.toFixed(2);
}
