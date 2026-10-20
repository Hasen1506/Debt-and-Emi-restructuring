'use client';

/**
 * Activity's "log an entry" dialog (REDESIGN R4.2). One place to record
 * what happened: a payment (in full, part, missed, extra, paid off), a new
 * rate, a pay change, the month's spending or a new loan. Before saving it
 * shows what the entry does to the plan — the debt-free month and the
 * interest — from the same engine run Plan uses.
 */
import { planEnd } from '@/lib/plan-gap';
import { localTerms, paymentWords } from '@/lib/terms';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import Decimal from 'decimal.js';
import { api, formatCurrencyWhole, type PlanRunArgs, type UserPayload } from '@/lib/api';
import type { StrategyName } from '@/lib/strategy';
import type { ActivityEntry, ActivityKind } from '@/lib/activity';
import { activityDeltas, applyActivityDeltas } from '@/lib/activity-cookie';
import { estimateLateFee } from '@/lib/estimate-penalty';
import { requiredMonthly } from '@/lib/min-payment';
import { loanCurrency, userDefaultCurrency } from '@/lib/currency';
import {
  applyConfirmedEvent,
  plannedEventsForEngine,
  type LifecycleDraft,
  type LifecycleEvent,
  type LifecycleKind,
} from '@/lib/lifecycle-events';
import { countryMonthKey, monthIndexToCountryLabel } from '@/lib/today';
import { Field } from '@/components/ToolPrimitives';
import { LBracket, LChip, LChipRow, L_MONO, L_T } from '@/components/ledger/primitives';
import { LifeEventForm } from '@/components/lifecycle/LifeEventForm';
import { loanLabel, openLoans } from './history';
import { PrepayChoice } from '@/components/PrepayChoice';
import { asksPrepayChoice, lowerEmiAfter, prepayFields, type PrepayMode } from '@/lib/prepay-choice';
import { rateChangeLoanIndex, isOpenCurrentLoan } from '@/lib/plan-controls';

export type LogType = 'payment' | 'rate' | 'pay' | 'spending' | 'loan';
export type PayStatus = 'full' | 'part' | 'missed' | 'extra' | 'off';

export interface LogInitial {
  type?: LogType;
  loanIndex?: number;
  status?: PayStatus;
  /** An entry to change instead of a new one. */
  edit?: ActivityEntry;
}

/** What the dialog asks its page to save. */
export type LogSave =
  | { kind: 'entry'; draft: Omit<ActivityEntry, 'id' | 'loggedAt'>; replaces?: string }
  | { kind: 'life'; draft: LifecycleDraft }
  | { kind: 'spent'; month: string; amount: string }
  | { kind: 'budget'; amount: string };

const TYPES: { t: LogType; label: string }[] = [
  { t: 'payment', label: 'PAYMENT' },
  { t: 'rate', label: 'RATE CHANGE' },
  { t: 'pay', label: 'PAY CHANGE' },
  { t: 'spending', label: 'SPENDING' },
  { t: 'loan', label: 'NEW LOAN' },
];
const LIFE_KIND: Partial<Record<LogType, LifecycleKind>> = { rate: 'floating_rate_reset', pay: 'salary_reset', loan: 'property_buy' };

const STATUSES: { s: PayStatus; label: string }[] = [
  { s: 'full', label: 'Paid in full' },
  { s: 'part', label: 'Paid part of it' },
  { s: 'missed', label: 'Missed it' },
  { s: 'extra', label: 'Paid extra' },
  { s: 'off', label: 'Paid it off' },
];
const KIND_OF: Record<PayStatus, ActivityKind> = {
  full: 'paid_full',
  part: 'paid_partial',
  missed: 'missed',
  extra: 'paid_extra',
  off: 'closed',
};
const STATUS_OF: Record<ActivityKind, PayStatus> = {
  paid_full: 'full',
  paid_partial: 'part',
  missed: 'missed',
  paid_extra: 'extra',
  closed: 'off',
  // A Profile correction is changed in Profile; here it reads as an extra.
  balance_correction: 'extra',
};
const SOURCES: { v: string; label: string }[] = [
  { v: 'surplus', label: 'This month’s spare cash' },
  { v: 'bonus', label: 'A bonus or gift' },
  { v: 'savings', label: 'Savings' },
  { v: 'sold-asset', label: 'Sold something' },
];

/** The plan's debt-free month and interest, for a run's arguments. */
async function run(args: PlanRunArgs, strategy: StrategyName) {
  const r = await api.simulate({ ...args, strategy });
  return {
    // Round 2: planEnd() — no date for a capped run (as Plan and the tools).
    month: planEnd(r).debtFreeMonth,
    interest: Number(r.total_interest_paid),
    /** What the plan pays above the minimums this month, in the user's currency. */
    extraThisMonth: Number(r.trajectory.find((p) => p.month === 1)?.extra_paid ?? 0),
  };
}
type RunResult = Awaited<ReturnType<typeof run>>;

export function LogDialog({
  user,
  today,
  runArgs,
  strategy,
  initial,
  planPay,
  onSave,
  onClose,
}: {
  /** The saved profile (the loans entries point at). */
  user: UserPayload;
  /** 'YYYY-MM-DD' in the user's country. */
  today: string;
  /** The plan's inputs (with logged activity applied), for the preview;
   *  null when the plan can't run. */
  runArgs: PlanRunArgs | null;
  strategy: StrategyName;
  initial: LogInitial;
  planPay?: Record<number, { amount: number; minimum: number; extra: number }>;
  onSave: (save: LogSave, said: string) => void;
  onClose: () => void;
}) {
  const country = user.country;
  const ccy = userDefaultCurrency(country);
  const loans = useMemo(() => openLoans(user.loans), [user.loans]);
  const edit = initial.edit;
  const [type, setType] = useState<LogType>(edit ? 'payment' : initial.type ?? (loans.length ? 'payment' : 'spending'));

  // ── Payment ────────────────────────────────────────────────────────────
  const [loanIndex, setLoanIndex] = useState(edit?.loanIndex ?? rateChangeLoanIndex(user.loans, initial.loanIndex));
  const loan = user.loans[loanIndex];
  const card = loan?.loan_type === 'credit_card';
  const lccy = loan ? loanCurrency(loan, country) : ccy;
  const [date, setDate] = useState(edit?.date ?? today);
  const planned = useMemo(() => {
    if (loan?.first_emi_month && date.slice(0, 7) < loan.first_emi_month) return new Decimal(0);
    if (edit && Number(edit.scheduledEmi) > 0) return new Decimal(edit.scheduledEmi);
    const minimum = planPay?.[loanIndex]?.minimum;
    if (date.slice(0, 7) === today.slice(0, 7) && minimum != null && Number.isFinite(minimum) && minimum >= 0) {
      return new Decimal(minimum);
    }
    return loan ? requiredMonthly(loan, country) : new Decimal(0);
  }, [edit, loan, country, planPay, loanIndex, date, today]);
  const [status, setStatus] = useState<PayStatus>(edit ? STATUS_OF[edit.kind] : initial.status ?? 'full');
  const [amount, setAmount] = useState(() => {
    if (edit) {
      if (edit.kind === 'paid_extra') return new Decimal(edit.amount).sub(new Decimal(edit.scheduledEmi || 0)).toFixed(2);
      return edit.amount;
    }
    const due = planPay?.[loanIndex]?.amount;
    return due != null && due > 0 && (initial.status ?? 'full') !== 'extra' ? String(Math.round(due)) : '';
  });
  const [newBalance, setNewBalance] = useState(edit?.newOutstanding ?? '');
  const [fee, setFee] = useState(edit?.penaltyOverride ?? '');
  const [source, setSource] = useState(edit?.source ?? 'surplus');
  const [note, setNote] = useState(edit?.note ?? '');
  const [tried, setTried] = useState(false);
  // UX2 #20: a prepayment on an EMI loan asks "lower your EMI or finish sooner?".
  const [prepayMode, setPrepayMode] = useState<PrepayMode | null>(edit?.prepayMode ?? null);

  // An amount left blank means the usual one, where there is one.
  const typed = amount.trim();
  const amt =
    status === 'full' && !typed ? planned
    : status === 'off' && !typed ? new Decimal(loan?.outstanding || 0)
    : new Decimal(Number(typed) || 0);
  // A typed total on "Paid in full" can be part, the EMI, more, or zero.
  // The kind follows the number. The extra chip still means "amount above the EMI".
  const resolved: PayStatus =
    status !== 'full' ? status
    : !typed || amt.eq(planned) ? 'full'
    : amt.lte(0) ? 'missed'
    : planned.gt(0) && amt.lt(planned) ? 'part'
    : planned.gt(0) && amt.gt(planned) ? 'extra'
    : 'full';
  const fmt = (v: Decimal.Value) => formatCurrencyWhole(new Decimal(v).toFixed(0), lccy);
  const usual = card ? `Minimum ${fmt(planned)}` : `${country === 'US' ? 'Payment' : 'EMI'} ${fmt(planned)}`;

  const asksPrepay = !edit && status === 'extra' && asksPrepayChoice(loan) && amt.gt(0) && amt.lt(new Decimal(loan?.outstanding || 0));
  const lowerEmi = asksPrepay && loan ? lowerEmiAfter(loan, amt.toNumber()) : null;
  const payProblems: Record<string, string | null> = {
    timing: loan?.first_emi_month && date.slice(0, 7) < loan.first_emi_month && ['full', 'part', 'missed'].includes(status) ? localTerms('The first EMI is not due yet. Choose “Paid extra” for an early prepayment.', country) : null,
    loan: isOpenCurrentLoan(loan) ? null : 'Pick an open loan.',
    amount:
      resolved === 'missed' ? null
      : !amt.isFinite() || !amt.gt(0) ? 'Enter the amount.'
      : status === 'off' && amt.lt(new Decimal(loan?.outstanding || 0)) ? 'That does not clear the balance. Choose a partial or extra payment.'
      : status === 'part' && planned.gt(0) && amt.gte(planned) ? `That's the full ${card ? 'minimum' : paymentWords(country).one} or more: pick “Paid in full” or “Paid extra”.`
      : null,
    date: !date ? 'Pick the date.' : date > today ? 'That’s after today. A payment you’re planning goes on Plan.' : null,
    newBalance: newBalance.trim() && !(Number(newBalance) >= 0) ? 'Enter the balance, or leave it blank.' : null,
    fee: fee.trim() && !(Number(fee) >= 0) ? 'Enter the fee, or leave it blank.' : null,
    prepay: asksPrepay && !prepayMode ? 'Choose one: it changes what the bank does with the money.' : null,
  };
  const payValid = !Object.values(payProblems).some(Boolean);
  const showPay = (k: string) => (tried ? payProblems[k] : null);

  // What the bank is likely to charge for a short or missed payment.
  const shortfall = status === 'missed' ? planned : status === 'part' ? Decimal.max(0, planned.sub(amt)) : new Decimal(0);
  const unpaid = shortfall.toFixed(2);
  const feeEstimate = useMemo(() => {
    if (!loan || !(Number(unpaid) > 0)) return null;
    const days = Math.max(0, Math.floor((Date.parse(today) - Date.parse(date || today)) / 86_400_000));
    return estimateLateFee({ loanType: loan.loan_type, country, bank: loan.bank, overdueAmount: unpaid, daysLate: days });
  }, [loan, unpaid, country, date, today]);

  // An extra from this month's spare cash is money the plan already pays
  // on top of the minimums this month. That part waits until the month is
  // over, as Home's MARK PAID does, so it isn't counted twice.
  // An edit keeps the split the original entry recorded; it never re-asks the engine.
  const fromSpareCash = !edit && status === 'extra' && source === 'surplus' && date.slice(0, 7) === today.slice(0, 7);
  function plannedExtraFrom(base: RunResult | null): string | undefined {
    if (!fromSpareCash || !base || !(base.extraThisMonth > 0)) return undefined;
    const fx = Number(runArgs?.user.fx_to_user_currency?.[lccy] ?? 0);
    const inLoanCcy = lccy === ccy ? base.extraThisMonth : fx > 0 ? base.extraThisMonth / fx : 0;
    const held = Decimal.min(amt, new Decimal(inLoanCcy));
    return held.gt(0) ? held.toFixed(2) : undefined;
  }

  function paymentDraft(base: RunResult | null = baseResult.current): Omit<ActivityEntry, 'id' | 'loggedAt'> {
    const kind = KIND_OF[resolved];
    const plannedExtra = plannedExtraFrom(base);
    const paid = resolved === 'missed' ? new Decimal(0) : status === 'extra' ? planned.add(amt) : amt;
    return {
      loanIndex,
      ...(loan?.id ? { loanId: loan.id } : {}),
      kind,
      date,
      amount: paid.toFixed(2),
      scheduledEmi: planned.toFixed(2),
      ...((status === 'part' || status === 'missed') && fee.trim() ? { penaltyOverride: fee.trim() } : {}),
      ...(card && newBalance.trim() ? { newOutstanding: newBalance.trim() } : {}),
      ...(status === 'extra' ? { source } : {}),
      ...(plannedExtra ? { plannedExtra }
        : edit?.plannedExtra && status === 'extra' ? { plannedExtra: Decimal.min(new Decimal(edit.plannedExtra), amt).toFixed(2) }
        : {}),
      ...(note.trim() ? { note: note.trim() } : {}),
      ...(asksPrepay && prepayMode ? prepayFields(prepayMode, loan?.scheduled_emi || 0, lowerEmi)
        : edit?.prepayMode && status === 'extra'
          ? { prepayMode: edit.prepayMode, ...(edit.emiBefore ? { emiBefore: edit.emiBefore } : {}), ...(edit.emiAfter ? { emiAfter: edit.emiAfter } : {}) }
          : {}),
    };
  }

  // ── Spending ───────────────────────────────────────────────────────────
  const budget = Number(user.fixed_expenses || 0) + Number(user.variable_expenses || 0);
  const [spendMode, setSpendMode] = useState<'month' | 'budget'>('month');
  const [spent, setSpent] = useState('');
  const spendProblem = !spent.trim() || !Number.isFinite(Number(spent)) || Number(spent) < 0 ? 'Enter a non-negative amount.' : null;

  // ── Life events (rate, pay, new loan) ──────────────────────────────────
  const [lifeDraft, setLifeDraft] = useState<LifecycleDraft | null>(null);

  // ── Preview ────────────────────────────────────────────────────────────
  const baseRef = useRef<Promise<RunResult> | null>(null);
  const baseResult = useRef<RunResult | null>(null);
  const [preview, setPreview] = useState<{ before: RunResult; after: RunResult } | 'none' | 'held' | 'loading' | 'error' | null>(null);

  /** Builds the plan's arguments with this entry in them, given the plan as
   *  it stands ('same' when the entry doesn't change it); null when there's
   *  nothing to preview yet. */
  const build = useMemo((): ((base: RunResult | null) => PlanRunArgs | 'same') | null => {
    if (!runArgs) return null;
    if (type === 'payment') {
      if (!payValid || edit) return null;
      return (base) => {
        const draft = paymentDraft(base);
        if (draft.kind === 'paid_full' && !draft.newOutstanding) return 'same';
        const full = { ...draft, id: 'preview', loggedAt: new Date().toISOString() } as ActivityEntry;
        const deltas = activityDeltas([full], runArgs.user.loans, country);
        const applied = applyActivityDeltas(runArgs.user.loans, deltas, countryMonthKey(country));
        if (applied.loans.every((l, i) => l.outstanding === runArgs.user.loans[i].outstanding)) return 'same';
        return { ...runArgs, user: { ...runArgs.user, loans: applied.loans } };
      };
    }
    if (type === 'spending') {
      // This month's total is a record; it doesn't change the plan.
      if (spendMode === 'month' || spendProblem) return null;
      const args = { ...runArgs, user: { ...runArgs.user, fixed_expenses: new Decimal(spent).toFixed(2), variable_expenses: '0' } };
      return () => args;
    }
    if (!lifeDraft) return null;
    const event = { ...lifeDraft, id: 'preview', loggedAt: '' } as LifecycleEvent;
    if (lifeDraft.effectiveDate <= today) {
      try {
        const args = { ...runArgs, user: applyConfirmedEvent(runArgs.user, event).user };
        return () => args;
      } catch {
        return null;
      }
    }
    const planned = plannedEventsForEngine([event], today, runArgs.user.loans, runArgs.user);
    const args = { ...runArgs, lifecycle_events: [...(runArgs.lifecycle_events ?? []), ...planned] };
    return () => args;
    // paymentDraft reads the payment fields listed here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runArgs, type, payValid, edit, loanIndex, status, amount, date, newBalance, fee, source, spendMode, spent, spendProblem, lifeDraft, today, country]);

  useEffect(() => {
    baseRef.current = null;
    baseResult.current = null;
  }, [runArgs, strategy]);

  useEffect(() => {
    if (build === null) return setPreview(null);
    // Without the spare-cash question, a payment the plan already counts needs no run.
    if (!fromSpareCash && build(null) === 'same') return setPreview('none');
    setPreview('loading');
    let live = true;
    const timer = window.setTimeout(async () => {
      try {
        baseRef.current ??= run(runArgs!, strategy);
        const before = await baseRef.current;
        if (!live) return;
        baseResult.current = before;
        const args = build(before);
        if (args === 'same') {
          if (live) setPreview(fromSpareCash ? 'held' : 'none');
          return;
        }
        const after = await run(args, strategy);
        if (live) setPreview({ before, after });
      } catch {
        baseRef.current = null;
        if (live) setPreview('error');
      }
    }, 450);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [build, fromSpareCash, runArgs, strategy]);

  const previewLine =
    preview && typeof preview === 'object'
      ? (() => {
          const { before, after } = preview;
          const dm = before.month && after.month ? after.month - before.month : null;
          const di = after.interest - before.interest;
          const month = after.month ? monthIndexToCountryLabel(after.month, country) : null;
          const shift = dm ? ` (${dm > 0 ? '+' : '−'}${Math.abs(dm)} mo)` : '';
          // `value` for the preview's DEBT-FREE row; `text` ends the saved sentence.
          return {
            dm,
            di,
            value: month ? `${month}${shift}${dm === 0 ? ' · no change' : ''}` : 'Never',
            text: !month ? 'no longer has a debt-free date' : dm === 0 ? `still debt-free in ${month}` : `debt-free in ${month}${shift}`,
          };
        })()
      : null;

  // ── Save ───────────────────────────────────────────────────────────────
  function save() {
    setTried(true);
    const after = previewLine ? `; plan ${previewLine.text}` : '';
    if (type === 'payment') {
      if (!payValid || !loan || (fromSpareCash && (!baseResult.current || preview === 'loading' || preview === 'error'))) return;
      const label = STATUSES.find((s) => s.s === status)!.label.toLowerCase();
      const how = status === 'missed' ? '' : ` ${fmt(amt)}`;
      onSave({ kind: 'entry', draft: paymentDraft(), replaces: edit?.id }, `${loanLabel(loan)}: ${label}${how}${after}.`);
      return;
    }
    if (type === 'spending') {
      if (spendProblem) return;
      const v = new Decimal(spent).toFixed(2);
      if (spendMode === 'month') onSave({ kind: 'spent', month: today.slice(0, 7), amount: v }, `Spent ${formatCurrencyWhole(v, ccy)} this month.`);
      else onSave({ kind: 'budget', amount: v }, `Spending is now ${formatCurrencyWhole(v, ccy)} a month${after}.`);
    }
  }

  function saveLife(draft: LifecycleDraft) {
    const happened = draft.effectiveDate <= today;
    const where = happened ? '' : ' It’s on Plan’s life events until then.';
    const what = TYPES.find((t) => t.t === type)!.label.toLowerCase();
    onSave({ kind: 'life', draft }, `${what.charAt(0).toUpperCase()}${what.slice(1)} saved${previewLine ? `; plan ${previewLine.text}` : ''}.${where}`);
  }

  // ── Dialog mechanics: Escape closes, focus moves in and back. ──────────
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    panel.current?.querySelector<HTMLElement>('button, input, select')?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      before?.focus?.();
    };
  }, [onClose]);

  const lifeKind = LIFE_KIND[type];

  return (
    <div
      onClick={(e) => e.target === e.currentTarget && onClose()}
      style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(10,10,10,0.38)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '5vh 16px', overflowY: 'auto' }}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="log-dialog-h"
        style={{ width: '100%', maxWidth: 600, background: L_T.paper, border: `2px solid ${L_T.ink}`, boxShadow: `6px 6px 0 0 ${L_T.ink}`, padding: '18px 20px', fontFamily: L_MONO, display: 'flex', flexDirection: 'column', gap: 14 }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
          <h2 id="log-dialog-h" style={{ margin: 0, fontSize: 11, letterSpacing: '0.18em', color: L_T.accent, fontWeight: 700 }}>
            {edit ? 'CHANGE THIS ENTRY' : 'LOG AN ENTRY'}
          </h2>
          <LBracket onClick={onClose} label="Close">× CLOSE</LBracket>
        </div>

        {!edit && (
          <LChipRow label="What happened">
            {TYPES.filter((t) => loans.length > 0 || (t.t !== 'payment' && t.t !== 'rate')).map(({ t, label }) => (
              <LChip key={t} on={type === t} onClick={() => { setType(t); setTried(false); setLifeDraft(null); }}>
                {label}
              </LChip>
            ))}
          </LChipRow>
        )}

        {type === 'payment' && loan && (
          <>
            {loans.length > 1 && (
              <LChipRow label="Which loan">
                {loans.map(({ loan: l, index }) => (
                  <LChip key={index} on={loanIndex === index} onClick={() => setLoanIndex(index)}>
                    {loanLabel(l)}
                  </LChip>
                ))}
              </LChipRow>
            )}
            <LChipRow label={`${loanLabel(loan)} · ${usual}`}>
              {STATUSES.map(({ s, label }) => (
                <LChip key={s} on={status === s} onClick={() => { setStatus(s); setAmount(''); }}>
                  {label}
                </LChip>
              ))}
            </LChipRow>
            {tried && payProblems.timing && <p role="alert" style={{ color: L_T.negative }}>{payProblems.timing}</p>}
            <Row>
              {status !== 'missed' && (
                <div style={{ flex: '1 1 200px' }}>
                  <Field
                    label={status === 'extra' ? `Extra, on top of the ${card ? 'minimum' : paymentWords(country).one}` : status === 'off' ? 'Amount that cleared it' : 'Amount paid'}
                    kind="money"
                    currency={lccy}
                    value={amount}
                    onChange={setAmount}
                    placeholder={status === 'full' ? planned.toFixed(0) : status === 'off' ? new Decimal(loan.outstanding || 0).toFixed(0) : undefined}
                    error={showPay('amount')}
                  />
                </div>
              )}
              <div style={{ flex: '1 1 160px', maxWidth: 220 }}>
                <Field label="Date" kind="date" value={date} onChange={setDate} error={showPay('date')} />
              </div>
            </Row>
            {asksPrepay && (
              <PrepayChoice
                country={country}
                value={prepayMode}
                onChange={setPrepayMode}
                detail={lowerEmi ? { reduce_emi: `${fmt(new Decimal(loan?.scheduled_emi || 0))} → ${fmt(lowerEmi)} a month` } : undefined}
                error={showPay('prepay')}
              />
            )}
            {status === 'extra' && (
              <LChipRow label="Where it came from">
                {SOURCES.map(({ v, label }) => (
                  <LChip key={v} on={source === v} onClick={() => setSource(v)}>
                    {label}
                  </LChip>
                ))}
              </LChipRow>
            )}
            {shortfall.gt(0) && (
              <div style={{ fontSize: 12, lineHeight: 1.6, color: L_T.inkSoft }}>
                {fmt(shortfall)} unpaid
                {feeEstimate && feeEstimate.total.gt(0) && (
                  <>
                    {' '}· the bank will likely charge about <strong style={{ color: L_T.negative }}>{fmt(feeEstimate.total)}</strong>
                    {feeEstimate.source === 'bank_specific' ? ` (${loan.bank || 'its'} published charges)` : ' (a typical charge)'}
                  </>
                )}
                . Both go on the balance.
                <div style={{ maxWidth: 240, marginTop: 6 }}>
                  <Field
                    label="Fee on your statement (optional)"
                    kind="money"
                    currency={lccy}
                    value={fee}
                    onChange={setFee}
                    placeholder={feeEstimate ? feeEstimate.total.toFixed(0) : undefined}
                    error={showPay('fee')}
                  />
                </div>
              </div>
            )}
            {card && (
              <div style={{ maxWidth: 260 }}>
                <Field
                  label="Card balance now (optional)"
                  kind="money"
                  currency={lccy}
                  value={newBalance}
                  onChange={setNewBalance}
                  hint={`From the statement. Was ${fmt(loan.outstanding || 0)}.`}
                  error={showPay('newBalance')}
                />
              </div>
            )}
            <div style={{ maxWidth: 420 }}>
              <Field label="Note (optional)" kind="text" value={note} onChange={setNote} placeholder="e.g. paid 5 days late" />
            </div>
          </>
        )}

        {type === 'spending' && (
          <>
            <LChipRow label="Which">
              <LChip on={spendMode === 'month'} onClick={() => setSpendMode('month')}>What I spent this month</LChip>
              <LChip on={spendMode === 'budget'} onClick={() => setSpendMode('budget')}>What I spend a month from now on</LChip>
            </LChipRow>
            <div style={{ maxWidth: 260 }}>
              <Field
                label={spendMode === 'month' ? 'Spent this month' : 'Spending a month'}
                kind="money"
                currency={ccy}
                value={spent}
                onChange={setSpent}
                hint={budget > 0 ? `The plan counts ${formatCurrencyWhole(budget, ccy)} a month.` : undefined}
                error={tried ? spendProblem : null}
              />
            </div>
            {spendMode === 'month' && Number(spent) > 0 && budget > 0 && (
              <p style={{ margin: 0, fontSize: 12, color: Number(spent) > budget ? L_T.negative : L_T.positive }}>
                {formatCurrencyWhole(Math.abs(Number(spent) - budget), ccy)} {Number(spent) > budget ? 'over' : 'under'} the plan. Kept as a
                record; to change the plan, pick “from now on”.
              </p>
            )}
          </>
        )}

        {lifeKind && (
          <LifeEventForm
            key={type}
            user={user}
            kinds={[lifeKind]}
            initialKind={lifeKind}
            initialLoanIndex={type === 'rate' ? initial.loanIndex : undefined}
            dateLabel={type === 'loan' ? 'Taken on' : 'Starting from'}
            saveLabel="SAVE · RE-RUN THE PLAN"
            onSave={saveLife}
            onCancel={onClose}
            onDraft={setLifeDraft}
          />
        )}

        <Preview state={preview} line={previewLine} ccy={ccy} />

        {!lifeKind && (
          <span style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'baseline' }}>
            <LBracket active disabled={type === 'payment' && fromSpareCash && (!baseResult.current || preview === 'loading' || preview === 'error')} onClick={save}>
              {type === 'spending' && spendMode === 'month' ? 'SAVE' : 'SAVE · RE-RUN THE PLAN'}
            </LBracket>
            <LBracket onClick={onClose}>CANCEL</LBracket>
          </span>
        )}
      </div>
    </div>
  );
}

function Row({ children }: { children: ReactNode }) {
  return <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>{children}</div>;
}

function Preview({
  state,
  line,
  ccy,
}: {
  state: { before: RunResult; after: RunResult } | 'none' | 'held' | 'loading' | 'error' | null;
  line: { dm: number | null; di: number; value: string } | null;
  ccy: string;
}) {
  if (!state) return null;
  const tone = (v: number) => (v > 0 ? L_T.negative : v < 0 ? L_T.positive : L_T.muted);
  return (
    <div aria-live="polite" style={{ padding: '10px 12px', border: `1px dashed ${L_T.ink}`, background: L_T.bg, fontSize: 11, lineHeight: 1.7 }}>
      <div style={{ fontSize: 9, letterSpacing: '0.14em', color: L_T.muted }}>WHAT IT DOES TO THE PLAN</div>
      {state === 'none' && <div>Nothing changes: the plan already counts this.</div>}
      {state === 'held' && (
        <div>
          Nothing changes this month: the plan already puts this month’s spare cash on your loans. Paid to this loan, it comes off
          its balance from next month.
        </div>
      )}
      {state === 'loading' && <div style={{ color: L_T.muted }}>Working it out…</div>}
      {state === 'error' && <div style={{ color: L_T.muted }}>Can’t work it out right now; saving still updates the plan.</div>}
      {typeof state === 'object' && line && (
        <>
          <div>
            DEBT-FREE · <strong style={{ color: tone(line.dm ?? 0) }}>{line.value}</strong>
          </div>
          <div>
            INTEREST ·{' '}
            <strong style={{ color: tone(line.di) }}>
              {Math.abs(line.di) < 1 ? 'no change' : `${line.di > 0 ? '+' : '−'}${formatCurrencyWhole(Math.abs(Math.round(line.di)), ccy)}`}
            </strong>
          </div>
        </>
      )}
    </div>
  );
}
