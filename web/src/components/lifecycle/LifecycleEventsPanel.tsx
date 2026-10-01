'use client';

/**
 * Life events on Plan (REDESIGN R3.4): what's coming that changes the
 * plan from a date — a pay change, a new rate on a floating-rate loan, a
 * new loan. One row each (DATE · WHAT · STATUS · actions); the plan runs
 * every planned event from its date. Once the date has passed, IT
 * HAPPENED writes it into the profile.
 *
 * Saved in a cookie (`lib/lifecycle-events`); every change re-runs the
 * plan. Other parts of Plan open the form pre-filled by dispatching
 * `ADD_LIFE_EVENT` (the rate-reset reminder opens "new rate" for its loan).
 */
import { useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { resolveLoanIndex } from '@/lib/loan-ids';
import type { LoanPayload, LoanType, UserPayload } from '@/lib/api';
import { formatCurrencyWhole } from '@/lib/api';
import {
  readLifecycleClient,
  writeLifecycleClient,
  addLifecycleEvent,
  type LifecycleEvent,
  type LifecycleDraft,
  type LifecycleKind,
  type LifecycleStatus,
} from '@/lib/lifecycle-events';
import { commitLifecycle } from '@/lib/commit-lifecycle';
import { rateOutOfRange } from '@/lib/loan-gaps';
import { LOAN_TYPE_NAME } from '@/lib/loan-types';
import { getCountryToday, localIsoDate, MONTH_NAMES } from '@/lib/today';
import { Field } from '@/components/ToolPrimitives';
import { LBracket, LChip, LChipRow, LSectionHeader, L_T } from '@/components/ledger/primitives';

/** `window.dispatchEvent(new CustomEvent(ADD_LIFE_EVENT, { detail }))`
 *  opens the form; detail: `{ kind?, loanIndex? }`. */
export const ADD_LIFE_EVENT = 'finoptima:add-life-event';

const KIND: Record<LifecycleKind, string> = {
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

function loanName(l: Pick<LoanPayload, 'bank' | 'loan_type'>): string {
  const t = LOAN_TYPE_NAME[l.loan_type];
  const bank = (l.bank ?? '').replace(/\s+bank$/i, '').trim();
  return bank ? `${bank} ${t}` : cap(t);
}

/** "15 NOV 2026" */
function dayLabel(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTH_NAMES[m - 1].slice(0, 3).toUpperCase()} ${y}`;
}

export function LifecycleEventsPanel({ user }: { user: UserPayload }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const today = localIsoDate(getCountryToday(user.country));
  const ccy = user.country === 'IN' ? 'INR' : 'USD';
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [events, setEvents] = useState<LifecycleEvent[]>([]);
  const [adding, setAdding] = useState(false);
  const [kind, setKind] = useState<LifecycleKind>('salary_reset');
  const [date, setDate] = useState(today);
  const [note, setNote] = useState('');
  const [gross, setGross] = useState('');
  const [takeHome, setTakeHome] = useState('');
  const [loanIdx, setLoanIdx] = useState(0);
  const [newRate, setNewRate] = useState('');
  const [draft, setDraft] = useState<LoanPayload>(blankLoanDraft());
  const [tried, setTried] = useState(false);

  const openLoans = useMemo(
    () => user.loans.map((l, i) => ({ l, i })).filter(({ l }) => Number(l.outstanding) > 0 && !l.planned_effective_month),
    [user.loans],
  );

  function open(k: LifecycleKind = 'salary_reset', loanIndex?: number) {
    setAdding(true);
    setKind(k);
    // A rate change for a loan with its next reset on file starts on that date.
    const resetOn = loanIndex != null ? user.loans[loanIndex]?.next_reset_date : undefined;
    setDate(k === 'floating_rate_reset' && resetOn && resetOn >= today ? resetOn : today);
    setNote('');
    setGross('');
    setTakeHome('');
    setLoanIdx(loanIndex ?? openLoans.find(({ l }) => l.rate_type === 'floating')?.i ?? openLoans[0]?.i ?? 0);
    setNewRate('');
    setDraft(blankLoanDraft());
    setTried(false);
    setError('');
  }

  useEffect(() => {
    setEvents(readLifecycleClient());
    setReady(true);
    const onAdd = (e: Event) => {
      const d = (e as CustomEvent<{ kind?: LifecycleKind; loanIndex?: number }>).detail ?? {};
      open(d.kind, d.loanIndex);
      requestAnimationFrame(() =>
        document.getElementById('life-events')?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
      );
    };
    window.addEventListener(ADD_LIFE_EVENT, onAdd);
    return () => window.removeEventListener(ADD_LIFE_EVENT, onAdd);
    // `open` only sets state; re-binding on each render isn't needed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // What's missing or wrong, per field, shown once SAVE has been tried.
  const n = (v: string) => Number(v);
  const problems: Record<string, string | null> = {
    date: date ? null : 'Pick the date it starts.',
    gross: kind === 'salary_reset' && !(n(gross) > 0) ? 'Enter the new yearly gross pay.' : null,
    takeHome: kind === 'salary_reset' && takeHome.trim() && !(n(takeHome) >= 0) ? 'Enter a take-home amount, or leave it blank.' : null,
    newRate:
      kind === 'floating_rate_reset'
        ? (openLoans.length === 0 ? 'There are no loans to change.' : null) ??
          (newRate.trim() ? rateOutOfRange(newRate) : 'Enter the new rate.')
        : null,
    outstanding: kind === 'property_buy' && !(n(draft.outstanding) > 0) ? 'Enter the amount borrowed.' : null,
    rate: kind === 'property_buy' ? (draft.nominal_rate.trim() ? rateOutOfRange(draft.nominal_rate) : 'Enter the rate.') : null,
    months:
      kind === 'property_buy' &&
      !(Number.isInteger(draft.tenure_months_remaining) && draft.tenure_months_remaining > 0 && draft.tenure_months_remaining <= 480)
        ? 'Enter the months to repay, 1 to 480.'
        : null,
    emi: kind === 'property_buy' && !(n(draft.scheduled_emi) > 0) ? 'Enter the EMI.' : null,
  };
  const show = (k: string) => (tried ? problems[k] : null);

  function refresh(next: LifecycleEvent[]) {
    setEvents(next);
    setError('');
    startTransition(() => router.refresh());
  }

  function save() {
    setTried(true);
    if (Object.values(problems).some(Boolean)) return;
    const base = { status: 'planned' as const, effectiveDate: date, note: note.trim() || undefined };
    let d: LifecycleDraft;
    if (kind === 'salary_reset') {
      d = { ...base, kind, newAnnualGross: gross, newMonthlyTakeHome: takeHome.trim() || undefined };
    } else if (kind === 'floating_rate_reset') {
      d = {
        ...base,
        kind,
        loanIndex: loanIdx,
        ...(user.loans[loanIdx]?.id ? { loanId: user.loans[loanIdx].id } : {}),
        newRate: Number(newRate).toFixed(4),
      };
    } else {
      d = { ...base, kind, loanDraft: { ...draft, nominal_rate: Number(draft.nominal_rate).toFixed(4) } };
    }
    try {
      const next = addLifecycleEvent(readLifecycleClient(), d);
      writeLifecycleClient(next);
      setAdding(false);
      refresh(next);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  function act(id: string, action: LifecycleStatus | 'delete') {
    try {
      refresh(commitLifecycle(id, action));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  if (!ready) return null;

  const what = (e: LifecycleEvent): string => {
    if (e.kind === 'salary_reset') {
      return `Gross ${formatCurrencyWhole(e.newAnnualGross, ccy)} a year${e.newMonthlyTakeHome ? ` · take-home ${formatCurrencyWhole(e.newMonthlyTakeHome, ccy)} a month` : ''}`;
    }
    if (e.kind === 'floating_rate_reset') {
      const loan = user.loans[resolveLoanIndex(e, user.loans)];
      return `${loan ? loanName(loan) : 'A loan since removed'} → ${(Number(e.newRate) * 100).toFixed(2)}%`;
    }
    const l = e.loanDraft;
    return `${loanName(l)} · ${formatCurrencyWhole(l.outstanding, ccy)} at ${(Number(l.nominal_rate) * 100).toFixed(2)}% · EMI ${formatCurrencyWhole(l.scheduled_emi, ccy)} for ${l.tenure_months_remaining} months`;
  };

  return (
    <section aria-labelledby="life-events-h">
      <LSectionHeader right={!adding && <LBracket onClick={() => open()}>+ ADD AN EVENT</LBracket>}>
        <span id="life-events-h">Life events · {events.length}</span>
      </LSectionHeader>
      {error && (
        <p role="alert" style={{ color: L_T.negative, fontSize: 12, margin: '0 0 8px' }}>
          {error}
        </p>
      )}
      {events.length === 0 && !adding && (
        <p style={{ margin: 0, fontSize: 12, color: L_T.muted, lineHeight: 1.6 }}>
          A pay change, a new rate on a floating-rate loan, or a loan you&apos;re about to take: the plan uses each
          from its date.
        </p>
      )}

      {events.length > 0 && (
        <ol style={{ listStyle: 'none', margin: 0, padding: 0, borderTop: `2px solid ${L_T.ink}` }}>
          {events.map((e) => {
            const due = e.effectiveDate <= today;
            const label = KIND[e.kind];
            const status =
              e.status === 'confirmed' ? 'HAPPENED' : e.status === 'cancelled' ? 'CANCELLED' : due ? 'DUE · DID IT HAPPEN?' : 'PLANNED';
            return (
              <li
                key={e.id}
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'minmax(96px, auto) minmax(0, 1fr)',
                  gap: '4px 14px',
                  padding: '10px 8px',
                  borderBottom: `1px dashed ${L_T.ruleSoft}`,
                  fontSize: 12,
                  opacity: e.status === 'cancelled' ? 0.6 : 1,
                }}
              >
                <span style={{ color: L_T.muted, fontSize: 11, whiteSpace: 'nowrap' }}>{dayLabel(e.effectiveDate)}</span>
                <div style={{ minWidth: 0 }}>
                  <div>
                    <strong style={{ letterSpacing: '0.08em', fontSize: 11 }}>{label}</strong> · {what(e)}
                  </div>
                  {e.note && <div style={{ color: L_T.muted, fontSize: 11, marginTop: 2 }}>{e.note}</div>}
                  <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'baseline', marginTop: 6, fontSize: 10, letterSpacing: '0.1em' }}>
                    <span
                      style={{
                        fontWeight: 700,
                        color: e.status === 'confirmed' ? L_T.positive : e.status === 'planned' && due ? L_T.accent : L_T.muted,
                      }}
                    >
                      {status}
                    </span>
                    {e.status === 'planned' && due && (
                      <LBracket accent onClick={() => act(e.id, 'confirmed')} label={`${label} on ${dayLabel(e.effectiveDate)} happened`}>
                        IT HAPPENED
                      </LBracket>
                    )}
                    {e.status === 'planned' && (
                      <LBracket onClick={() => act(e.id, 'cancelled')} label={`Cancel the ${label.toLowerCase()} on ${dayLabel(e.effectiveDate)}`}>
                        CANCEL
                      </LBracket>
                    )}
                    {e.status !== 'planned' && (
                      <LBracket onClick={() => act(e.id, 'planned')} label={`Reopen the ${label.toLowerCase()} on ${dayLabel(e.effectiveDate)}`}>
                        REOPEN
                      </LBracket>
                    )}
                    <LBracket onClick={() => act(e.id, 'delete')} label={`Delete the ${label.toLowerCase()} on ${dayLabel(e.effectiveDate)}`}>
                      DELETE
                    </LBracket>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {adding && (
        <div
          role="group"
          aria-label="New life event"
          style={{ marginTop: 10, padding: '12px 14px', borderLeft: `2px solid ${L_T.accent}`, background: L_T.paper, display: 'flex', flexDirection: 'column', gap: 12 }}
        >
          <LChipRow label="What changes">
            {(Object.keys(KIND) as LifecycleKind[]).map((k) => (
              <LChip key={k} on={kind === k} onClick={() => setKind(k)}>
                {k === 'salary_reset' ? 'My pay' : k === 'floating_rate_reset' ? 'A loan’s rate' : 'A new loan'}
              </LChip>
            ))}
          </LChipRow>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            <div style={{ flex: '1 1 180px', maxWidth: 220 }}>
              <Field label="From" kind="date" value={date} onChange={setDate} error={show('date')} />
            </div>
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
            {kind === 'floating_rate_reset' && (
              <>
                <label style={{ flex: '1 1 220px', display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
                  Loan
                  <select
                    value={loanIdx}
                    onChange={(e) => setLoanIdx(Number(e.target.value))}
                    style={{ fontFamily: 'inherit', fontSize: 13, padding: '8px 10px', border: `1px solid ${L_T.ink}`, background: L_T.paper }}
                  >
                    {openLoans.map(({ l, i }) => (
                      <option key={i} value={i}>
                        {loanName(l)} · {(Number(l.nominal_rate) * 100).toFixed(2)}% now
                      </option>
                    ))}
                  </select>
                </label>
                <div style={{ flex: '1 1 140px', maxWidth: 180 }}>
                  <Field label="New rate" kind="percent" value={newRate} onChange={setNewRate} error={show('newRate')} />
                </div>
              </>
            )}
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
                  <Field label="Rate" kind="percent" value={draft.nominal_rate} onChange={(v) => setDraft({ ...draft, nominal_rate: v })} error={show('rate')} />
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
                  <Field label="EMI" kind="money" currency={ccy} value={draft.scheduled_emi} onChange={(v) => setDraft({ ...draft, scheduled_emi: v })} error={show('emi')} />
                </div>
              </div>
            </>
          )}
          <div style={{ maxWidth: 420 }}>
            <Field label="Note (optional)" kind="text" value={note} onChange={setNote} placeholder="e.g. offer letter signed" />
          </div>
          <span style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
            <LBracket active onClick={save}>
              SAVE · RE-RUN THE PLAN
            </LBracket>
            <LBracket onClick={() => setAdding(false)}>CANCEL</LBracket>
          </span>
        </div>
      )}
      {pending && (
        <p role="status" style={{ fontSize: 11, color: L_T.muted, margin: '8px 0 0' }}>
          Re-running the plan…
        </p>
      )}
    </section>
  );
}
