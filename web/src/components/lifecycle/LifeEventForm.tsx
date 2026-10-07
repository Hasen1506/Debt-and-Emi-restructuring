'use client';

/**
 * The form for one life event — a pay change, a new rate on a loan, or a
 * new loan — shared by Plan's life events and Activity's log dialog. It
 * checks the fields and hands back a draft; the caller saves it (Plan as
 * planned, Activity as happened when the date has passed).
 */
import { tenureError } from '@/lib/tenure-rules';
import { useEffect, useMemo, useState } from 'react';
import { likelyRateType } from '@/lib/rate-type';
import type { LoanPayload, LoanType, UserPayload } from '@/lib/api';
import { formatCurrencyWhole } from '@/lib/api';
import type { LifecycleDraft, LifecycleEvent, LifecycleKind } from '@/lib/lifecycle-events';
import { resolveLoanIndex } from '@/lib/loan-ids';
import { isOpenCurrentLoan, rateChangeLoanIndex, currentLoanIndex } from '@/lib/plan-controls';
import { loadProfileClient } from '@/lib/user-store';
import { rateOutOfRange } from '@/lib/loan-gaps';
import { LOAN_TYPE_NAME } from '@/lib/loan-types';
import { getCountryToday, localIsoDate, MONTH_NAMES } from '@/lib/today';
import { Field } from '@/components/ToolPrimitives';
import { LBracket, LChip, LChipRow, L_T } from '@/components/ledger/primitives';

export const LIFE_KIND_LABEL: Record<LifecycleKind, string> = {
  salary_reset: 'PAY CHANGE',
  floating_rate_reset: 'NEW RATE',
  property_buy: 'NEW LOAN',
};

const LOAN_TYPES: LoanType[] = ['home_loan', 'auto_loan', 'personal_loan', 'education_loan', 'gold_loan', 'credit_card'];

function blankLoanDraft(): LoanPayload {
  return {
    loan_type: 'home_loan',
    bank: '',
    outstanding: '',
    nominal_rate: '',
    rate_type: 'fixed',
    tenure_months_remaining: 0,
    scheduled_emi: '',
    processing_fee_amortised: '',
    insurance_premium_pct: '',
  };
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** "HDFC home loan", or "Home loan" with no lender on file. */
export function lifeLoanName(l: Pick<LoanPayload, 'bank' | 'loan_type'>): string {
  const t = LOAN_TYPE_NAME[l.loan_type];
  const bank = (l.bank ?? '').replace(/\s+bank$/i, '').trim();
  return bank ? `${bank} ${t}` : cap(t);
}

/** "15 NOV 2026" */
export function dayLabel(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTH_NAMES[m - 1].slice(0, 3).toUpperCase()} ${y}`;
}

/** "Gross ₹18,00,000 a year", "Home loan → 9.10%", "Car loan · ₹8,00,000 at 9.00% · …". */
export function lifeEventSummary(e: LifecycleEvent, user: UserPayload): string {
  const ccy = user.country === 'IN' ? 'INR' : 'USD';
  if (e.kind === 'salary_reset') {
    return `Gross ${formatCurrencyWhole(e.newAnnualGross, ccy)} a year${e.newMonthlyTakeHome ? ` · take-home ${formatCurrencyWhole(e.newMonthlyTakeHome, ccy)} a month` : ''}`;
  }
  if (e.kind === 'floating_rate_reset') {
    const loan = user.loans[resolveLoanIndex(e, user.loans)];
    return `${loan ? lifeLoanName(loan) : 'A loan since removed'} → ${(Number(e.newRate) * 100).toFixed(2)}%`;
  }
  const l = e.loanDraft;
  return `${lifeLoanName(l)} · ${formatCurrencyWhole(l.outstanding, ccy)} at ${(Number(l.nominal_rate) * 100).toFixed(2)}% · EMI ${formatCurrencyWhole(l.scheduled_emi, ccy)} for ${l.tenure_months_remaining} months`;
}

export function LifeEventForm({
  user,
  configuredLoans = user.loans,
  kinds = ['salary_reset', 'floating_rate_reset', 'property_buy'],
  initialKind,
  initialLoanIndex,
  dateLabel = 'Starting from',
  saveLabel,
  onSave,
  onCancel,
  onDraft,
}: {
  user: UserPayload;
  configuredLoans?: LoanPayload[];
  /** The kinds offered; with one, there's no "What changes" row. */
  kinds?: LifecycleKind[];
  initialKind?: LifecycleKind;
  initialLoanIndex?: number;
  dateLabel?: string;
  saveLabel: string;
  onSave: (draft: LifecycleDraft) => void;
  onCancel: () => void;
  /** Called with the draft whenever every field is valid (null when not):
   *  Activity previews it against the plan. */
  onDraft?: (draft: LifecycleDraft | null) => void;
}) {
  const today = localIsoDate(getCountryToday(user.country));
  const ccy = user.country === 'IN' ? 'INR' : 'USD';
  const openLoans = useMemo(
    () => user.loans.map((l, i) => ({ l, i })).filter(({ l }) => isOpenCurrentLoan(l)),
    [user.loans],
  );
  const [kind, setKind] = useState<LifecycleKind>(initialKind ?? kinds[0]);
  // A rate change for a loan with its next reset on file starts on that date.
  const resetOn = user.loans[rateChangeLoanIndex(user.loans, initialLoanIndex)]?.next_reset_date;
  const [date, setDate] = useState(kind === 'floating_rate_reset' && resetOn && resetOn >= today ? resetOn : today);
  const [note, setNote] = useState('');
  const [gross, setGross] = useState('');
  const [takeHome, setTakeHome] = useState('');
  const [loanRef, setLoanRef] = useState(() => {
    const index = rateChangeLoanIndex(user.loans, initialLoanIndex);
    return { loanIndex: index, loanId: user.loans[index]?.id, legacy: configuredLoans[index] };
  });
  const loanIdx = resolveLoanIndex(loanRef, user.loans);
  const [newRate, setNewRate] = useState('');
  const [draft, setDraft] = useState<LoanPayload>(blankLoanDraft());
  const [tried, setTried] = useState(false);
  const [saveError, setSaveError] = useState('');

  // What's missing or wrong, per field, shown once SAVE has been tried.
  const n = (v: string) => Number(v);
  const problems: Record<string, string | null> = {
    date: date ? null : 'Pick the date.',
    gross: kind === 'salary_reset' && !(n(gross) > 0) ? 'Enter the new yearly gross pay.' : null,
    takeHome: kind === 'salary_reset' && takeHome.trim() && !(n(takeHome) >= 0) ? 'Enter a take-home amount, or leave it blank.' : null,
    newRate:
      kind === 'floating_rate_reset'
        ? (openLoans.length === 0 ? 'There are no loans to change.' : null) ??
          (!isOpenCurrentLoan(user.loans[loanIdx]) ? 'That loan is no longer open. Choose another.' : null) ??
          (newRate.trim() ? rateOutOfRange(newRate) : 'Enter the new rate.')
        : null,
    outstanding: kind === 'property_buy' && !(n(draft.outstanding) > 0) ? 'Enter the amount borrowed.' : null,
    rate: kind === 'property_buy' ? (draft.nominal_rate.trim() ? rateOutOfRange(draft.nominal_rate) : 'Enter the rate.') : null,
    months:
      kind === 'property_buy'
        ? tenureError(draft.loan_type, draft.tenure_months_remaining || '')
        : null,
    emi: kind === 'property_buy' && !(n(draft.scheduled_emi) > 0) ? 'Enter the EMI.' : null,
  };
  const show = (k: string) => (tried ? problems[k] : null);
  const valid = !Object.values(problems).some(Boolean);

  function build(): LifecycleDraft {
    const base = { status: 'planned' as const, effectiveDate: date, note: note.trim() || undefined };
    if (kind === 'salary_reset') {
      return { ...base, kind, newAnnualGross: gross, newMonthlyTakeHome: takeHome.trim() || undefined };
    }
    if (kind === 'floating_rate_reset') {
      return {
        ...base,
        kind,
        loanIndex: loanIdx,
        ...(user.loans[loanIdx]?.id ? { loanId: user.loans[loanIdx].id } : {}),
        newRate: Number(newRate).toFixed(4),
      };
    }
    // Fixed or floating isn't asked here: the usual for the kind of loan,
    // marked as assumed (lib/rate-type).
    return {
      ...base,
      kind,
      loanDraft: {
        ...draft,
        nominal_rate: Number(draft.nominal_rate).toFixed(4),
        rate_type: likelyRateType(draft.loan_type, user.country, draft.currency),
        rate_type_assumed: true,
      },
    };
  }

  const key = JSON.stringify([kind, date, gross, takeHome, loanIdx, newRate, draft]);
  useEffect(() => {
    onDraft?.(valid ? build() : null);
    // `key` covers every field the draft is built from.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, valid]);

  function save() {
    setTried(true);
    if (!valid) return;
    try {
      const value = build();
      if (value.kind === 'floating_rate_reset') {
        const current = loadProfileClient().user;
        const index = currentLoanIndex(loanRef, loanRef.legacy, current.loans);
        if (current.country !== user.country || !isOpenCurrentLoan(current.loans[index]))
          throw new Error('That loan is no longer open or changed. Reload and choose it again.');
        value.loanIndex = index;
        value.loanId = current.loans[index].id;
      }
      onSave(value);
    } catch (e) { setSaveError((e as Error).message); }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {saveError && <p role="alert" style={{ color: L_T.negative }}>{saveError}</p>}
      {kinds.length > 1 && (
        <LChipRow label="What changes">
          {kinds.map((k) => (
            <LChip key={k} on={kind === k} onClick={() => setKind(k)}>
              {k === 'salary_reset' ? 'My pay' : k === 'floating_rate_reset' ? 'A loan’s rate' : 'A new loan'}
            </LChip>
          ))}
        </LChipRow>
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
        {kind === 'floating_rate_reset' && (
          <>
            <label style={{ flex: '1 1 220px', display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
              Loan
              <select
                value={loanIdx}
                onChange={(e) => { const index = Number(e.target.value); setLoanRef({ loanIndex: index, loanId: user.loans[index]?.id, legacy: configuredLoans[index] }); setSaveError(''); }}
                style={{ fontFamily: 'inherit', fontSize: 13, padding: '8px 10px', border: `1px solid ${L_T.ink}`, background: L_T.paper }}
              >
                {loanIdx < 0 && <option value={-1}>Select an open loan</option>}
                {openLoans.map(({ l, i }) => (
                  <option key={i} value={i}>
                    {lifeLoanName(l)} · {(Number(l.nominal_rate) * 100).toFixed(2)}% now
                  </option>
                ))}
              </select>
            </label>
            <div style={{ flex: '1 1 140px', maxWidth: 180 }}>
              <Field label="New rate, % a year" kind="percent" value={newRate} onChange={setNewRate} error={show('newRate')} />
            </div>
          </>
        )}
        {kind === 'salary_reset' && (
          <>
            <div style={{ flex: '1 1 200px' }}>
              <Field label="New gross pay a year" kind="money" currency={ccy} value={gross} onChange={setGross} error={show('gross')} />
            </div>
            <div style={{ flex: '1 1 200px' }}>
              <Field
                label="New take-home a month (optional)"
                kind="money"
                currency={ccy}
                value={takeHome}
                onChange={setTakeHome}
                hint="Blank: worked out from the gross after income tax."
                error={show('takeHome')}
              />
            </div>
          </>
        )}
        <div style={{ flex: '1 1 160px', maxWidth: 220 }}>
          <Field label={dateLabel} kind="date" value={date} onChange={setDate} error={show('date')} />
        </div>
      </div>
      {kind === 'property_buy' && (
        <>
          <LChipRow label="Kind of loan">
            {LOAN_TYPES.map((t) => (
              <LChip key={t} on={draft.loan_type === t} onClick={() => setDraft({ ...draft, loan_type: t })}>
                {cap(LOAN_TYPE_NAME[t])}
              </LChip>
            ))}
          </LChipRow>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            <div style={{ flex: '1 1 160px' }}>
              <Field label="Lender (optional)" kind="text" value={draft.bank} onChange={(v) => setDraft({ ...draft, bank: v })} />
            </div>
            <div style={{ flex: '1 1 180px' }}>
              <Field
                label="Amount borrowed"
                kind="money"
                currency={ccy}
                value={draft.outstanding}
                onChange={(v) => setDraft({ ...draft, outstanding: v })}
                error={show('outstanding')}
              />
            </div>
            <div style={{ flex: '1 1 120px', maxWidth: 160 }}>
              <Field label="Interest rate, % a year" kind="percent" value={draft.nominal_rate} onChange={(v) => setDraft({ ...draft, nominal_rate: v })} error={show('rate')} />
            </div>
            <div style={{ flex: '1 1 120px', maxWidth: 160 }}>
              <Field
                label="Months to repay"
                kind="integer"
                value={draft.tenure_months_remaining ? String(draft.tenure_months_remaining) : ''}
                onChange={(v) => setDraft({ ...draft, tenure_months_remaining: Number(v) || 0 })}
                error={show('months')}
              />
            </div>
            <div style={{ flex: '1 1 160px' }}>
              <Field label="EMI a month" kind="money" currency={ccy} value={draft.scheduled_emi} onChange={(v) => setDraft({ ...draft, scheduled_emi: v })} error={show('emi')} />
            </div>
          </div>
        </>
      )}
      <div style={{ maxWidth: 420 }}>
        <Field label="Note (optional)" kind="text" value={note} onChange={setNote} placeholder="e.g. offer letter signed" />
      </div>
      <span style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
        <LBracket active onClick={save}>
          {saveLabel}
        </LBracket>
        <LBracket onClick={onCancel}>CANCEL</LBracket>
      </span>
    </div>
  );
}
