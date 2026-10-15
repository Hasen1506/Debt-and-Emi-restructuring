'use client';

/**
 * Round 2 (founder, 15 Oct 2026): Plan chips for inputs the engine used to
 * assume without saying so. Each saves to the profile (saveProfileClient,
 * synced like every profile field) and re-runs the plan.
 *  - BORROWING LIMIT (item 2): the most the plan may borrow to cover short
 *    months before it calls the plan unfundable (engine C11). Blank = 3
 *    months of take-home, shown as an assumption.
 *  - YOUR RETURN (item 3): the user's own assumed return after tax; the
 *    prepay / keep / split question comes up for a loan costing less than
 *    this + 1 point after tax, once the emergency fund is full.
 *  - RATE RISE (item 1): per floating loan, extend / raise EMI / mix, the
 *    lender's maximum tenure; the date of birth and retirement age that cap
 *    a tenure-first extension.
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { LoanPayload, UserPayload } from '@/lib/api';
import { formatCurrencyWhole } from '@/lib/api';
import { loadProfileClient, saveProfileClient } from '@/lib/user-store';
import { localIsoDate } from '@/lib/today';
import {
  DEFAULT_ASSUMED_RETURN, GAP_LIMIT_MONTHS, SPLIT_MARGIN, assumedReturnFor, ceilingLine, gapLimitFor,
  monthsToAgeLimit, parseAmount, parseDob, parseMaxTenure, parseRetirementAge, parseReturnPct, rateRiseModeFor,
  retirementAgeFor, type RateRiseMode,
} from '@/lib/plan-inputs';
import { Field } from '@/components/ToolPrimitives';
import { LBracket, LChip, L_T } from '@/components/ledger/primitives';

const note = { margin: 0, fontSize: 'var(--fs-dense)', color: L_T.muted, lineHeight: 1.6 } as const;

/** Save a change to the stored profile's user, then re-run the plan. */
function useSaveUser() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState(false);
  function save(patch: (u: UserPayload) => UserPayload) {
    const stored = loadProfileClient();
    const ok = saveProfileClient({ ...stored, user: patch(stored.user) });
    setFailed(!ok);
    if (ok) startTransition(() => router.refresh());
    return ok;
  }
  return { save, pending, failed };
}

function without<T extends object, K extends keyof T>(o: T, k: K): T {
  const c = { ...o };
  delete c[k];
  return c;
}

// ── item 2: borrowing limit ───────────────────────────────────────────────

export function GapLimitControl({ user, currency }: { user: UserPayload; currency: 'INR' | 'USD' }) {
  const { save, pending, failed } = useSaveUser();
  const g = gapLimitFor(user);
  const [mode, setMode] = useState<'assumed' | 'own'>(g.assumed ? 'assumed' : 'own');
  const [value, setValue] = useState(g.assumed ? '' : String(g.value));
  const [error, setError] = useState<string | null>(null);
  const fmt = (v: number) => formatCurrencyWhole(String(Math.round(v)), currency);
  const assumedValue = Math.round(Number(user.monthly_income || 0) * GAP_LIMIT_MONTHS);

  function saveOwn() {
    const v = parseAmount(value);
    if (v === null || v === '') {
      setError(`Type an amount, for example ${fmt(assumedValue)}.`);
      return;
    }
    setError(null);
    save((u) => ({ ...u, gap_credit_limit: v }));
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }} data-testid="gap-limit-control">
      <div role="group" aria-label="Borrowing limit" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <LChip
          on={mode === 'assumed'}
          onClick={() => {
            setMode('assumed');
            setError(null);
            if (!g.assumed) save((u) => without(u, 'gap_credit_limit'));
          }}
        >
          Assumed: {GAP_LIMIT_MONTHS} months of take-home · {fmt(assumedValue)}
        </LChip>
        <LChip on={mode === 'own'} onClick={() => setMode('own')}>
          My own limit
        </LChip>
      </div>
      {mode === 'own' && (
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 200px', maxWidth: 260 }}>
            <Field label="Most I could borrow for a short month" kind="text" value={value}
              onChange={(v) => { setValue(v); setError(null); }} placeholder={String(assumedValue)} error={error} />
          </div>
          <span style={{ paddingBottom: 8 }}>
            <LBracket active onClick={saveOwn}>{pending ? 'WORKING IT OUT…' : 'SAVE'}</LBracket>
          </span>
        </div>
      )}
      <p style={note}>
        When a month is short, the plan uses your emergency fund, then borrows (on a card or overdraft) up to this
        limit. Past it, the plan says it isn&apos;t fundable as it stands rather than show a date. Use your cards&apos;
        unused limit, or less if you wouldn&apos;t borrow that much.
      </p>
      {failed && <p role="alert" style={{ ...note, color: L_T.negative }}>That wasn&apos;t saved: this browser didn&apos;t keep it.</p>}
    </div>
  );
}

// ── item 3: the user's own return after tax ───────────────────────────────

export function AssumedReturnControl({ user }: { user: UserPayload }) {
  const { save, pending, failed } = useSaveUser();
  const a = assumedReturnFor(user);
  const country = user.country === 'US' ? 'US' : 'IN';
  const defPct = (Number(DEFAULT_ASSUMED_RETURN[country]) * 100).toFixed(1);
  const [mode, setMode] = useState<'assumed' | 'own'>(a.assumed ? 'assumed' : 'own');
  const [value, setValue] = useState(a.assumed ? '' : (a.value * 100).toFixed(1));
  const [error, setError] = useState<string | null>(null);

  function saveOwn() {
    const v = parseReturnPct(value);
    if (v === null || v === '') {
      setError('Type a yearly % after tax, from 0 to 30, for example 7.');
      return;
    }
    setError(null);
    save((u) => ({ ...u, assumed_post_tax_return: v }));
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }} data-testid="assumed-return-control">
      <div role="group" aria-label="Your return after tax" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <LChip
          on={mode === 'assumed'}
          onClick={() => {
            setMode('assumed');
            setError(null);
            if (!a.assumed) save((u) => without(u, 'assumed_post_tax_return'));
          }}
        >
          Assumed: {defPct}% a year after tax
        </LChip>
        <LChip on={mode === 'own'} onClick={() => setMode('own')}>My own figure</LChip>
      </div>
      {mode === 'own' && (
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 160px', maxWidth: 200 }}>
            <Field label="Return after tax, % a year" kind="text" value={value}
              onChange={(v) => { setValue(v); setError(null); }} placeholder={defPct} error={error} />
          </div>
          <span style={{ paddingBottom: 8 }}>
            <LBracket active onClick={saveOwn}>{pending ? 'WORKING IT OUT…' : 'SAVE'}</LBracket>
          </span>
        </div>
      )}
      <p style={note}>
        What money you keep back might earn a year, after tax: your own assumption, not a forecast. Once your
        emergency fund is full, a loan costing less than this plus {(SPLIT_MARGIN * 100).toFixed(0)} point after tax gets the
        question &quot;prepay, keep, or split?&quot;. Above it the plan keeps paying the loan.
      </p>
      {failed && <p role="alert" style={{ ...note, color: L_T.negative }}>That wasn&apos;t saved: this browser didn&apos;t keep it.</p>}
    </div>
  );
}

// ── item 1: rate rises ────────────────────────────────────────────────────

const MODE_LABEL: Record<RateRiseMode, string> = {
  extend: 'Keep the EMI, extend the tenure',
  raise_emi: 'Raise the EMI, keep the end date',
  mix: 'Half and half',
};

function loanName(l: LoanPayload, i: number): string {
  return `${l.bank || 'Loan'} ${String(l.loan_type || '').replace('_loan', '').replace('_', ' ')} · #${i + 1}`;
}

export function RateRiseControl({ user, floating }: { user: UserPayload; floating: number[] }) {
  const { save, pending, failed } = useSaveUser();
  const todayIso = localIsoDate(new Date());
  const r = retirementAgeFor(user);
  const [dob, setDob] = useState(user.date_of_birth ?? '');
  const [age, setAge] = useState(user.retirement_age ? String(user.retirement_age) : '');
  const [tenure, setTenure] = useState<Record<number, string>>(
    Object.fromEntries(floating.map((i) => [i, user.loans[i]?.max_tenure_months ? String(user.loans[i].max_tenure_months) : ''])),
  );
  const [error, setError] = useState<string | null>(null);
  const ageMonths = monthsToAgeLimit(user, todayIso);

  function setMode(i: number, mode: RateRiseMode) {
    save((u) => ({ ...u, loans: u.loans.map((l, k) => (k === i ? { ...l, on_rate_rise: mode } : l)) }));
  }

  function saveDetails() {
    const d = parseDob(dob, todayIso);
    const a = parseRetirementAge(age);
    if (d === null) return setError('Date of birth as YYYY-MM or YYYY-MM-DD, for example 1990-06.');
    if (a === null) return setError('Retirement age from 40 to 85, or leave it blank.');
    const tenures: Record<number, number | ''> = {};
    for (const i of floating) {
      const t = parseMaxTenure(tenure[i] ?? '');
      if (t === null) return setError("Lender's maximum tenure in months, from 1 to 480, or leave it blank.");
      tenures[i] = t;
    }
    setError(null);
    save((u) => {
      let n: UserPayload = { ...u, loans: u.loans.map((l, k) => {
        if (!(k in tenures)) return l;
        const t = tenures[k];
        return t === '' ? without(l, 'max_tenure_months') : { ...l, max_tenure_months: t };
      }) };
      n = d === '' ? without(n, 'date_of_birth') : { ...n, date_of_birth: d };
      n = a === '' ? without(n, 'retirement_age') : { ...n, retirement_age: a };
      return n;
    });
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }} data-testid="rate-rise-control">
      {floating.map((i) => {
        const l = user.loans[i];
        const m = rateRiseModeFor(l, user.country);
        return (
          <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <strong style={{ fontSize: 'var(--fs-dense)' }}>{loanName(l, i)}</strong>
            <div role="group" aria-label={`When the rate on ${loanName(l, i)} rises`} style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {(['extend', 'raise_emi', 'mix'] as RateRiseMode[]).map((mode) => (
                <LChip key={mode} on={m.mode === mode} onClick={() => setMode(i, mode)}>
                  {MODE_LABEL[mode]}{m.assumed && m.mode === mode ? ' (default)' : ''}
                </LChip>
              ))}
            </div>
            <div style={{ maxWidth: 260 }}>
              <Field label="Lender's maximum tenure, months (optional)" kind="text" value={tenure[i] ?? ''}
                onChange={(v) => setTenure((t) => ({ ...t, [i]: v }))} placeholder={l.loan_type === 'home_loan' ? '360' : ''} />
            </div>
            {m.mode !== 'raise_emi' && <p style={note}>{ceilingLine(l, ageMonths, user.country)}</p>}
          </div>
        );
      })}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div style={{ flex: '1 1 160px', maxWidth: 200 }}>
          <Field label="Date of birth (optional)" kind="text" value={dob} onChange={(v) => { setDob(v); setError(null); }} placeholder="1990-06" />
        </div>
        <div style={{ flex: '1 1 160px', maxWidth: 200 }}>
          <Field label={`Pay loans off by age (default ${user.income_type === 'salaried' ? 60 : 70})`} kind="text" value={age}
            onChange={(v) => { setAge(v); setError(null); }} placeholder={String(r.value)} />
        </div>
        <span style={{ paddingBottom: 8 }}>
          <LBracket active onClick={saveDetails}>{pending ? 'WORKING IT OUT…' : 'SAVE'}</LBracket>
        </span>
      </div>
      {error && <p role="alert" style={{ ...note, color: L_T.negative }}>{error}</p>}
      <p style={note}>
        RBI lets you choose at each reset: a higher EMI, a longer tenure, or both (circular of 18 Aug 2023). Indian
        lenders usually extend the tenure first. With your date of birth the plan never stretches a loan past the age
        you pay loans off by ({r.assumed ? `assumed ${r.value}` : r.value}). Fixed-rate loans don&apos;t reset.
      </p>
      {failed && <p role="alert" style={{ ...note, color: L_T.negative }}>That wasn&apos;t saved: this browser didn&apos;t keep it.</p>}
    </div>
  );
}
