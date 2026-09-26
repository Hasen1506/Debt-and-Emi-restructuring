'use client';

/**
 * User-recorded activity ledger — the engine that drives all three theme
 * variants of the Insights page.
 *
 * Replaces the hardcoded LOG + CALENDAR arrays that the page used to ship
 * with. Reads/writes entries from localStorage via `lib/activity`, shows
 * a penalty estimate next to each partial/missed entry via
 * `lib/estimate-penalty`. Per Hasen's Bucket-C scope, NO calendar OAuth —
 * the ledger is fully manual.
 *
 * The component is theme-aware: it ships three layouts under one logic
 * shell, picked by `variant`. The form is shared (cards-style with subtle
 * variant tweaks); only the entries list differs significantly between
 * themes.
 */

import { useEffect, useMemo, useState } from 'react';
import Decimal from 'decimal.js';
import {
  addActivityEntry,
  readActivityClient,
  removeActivityEntry,
  sortActivityNewestFirst,
  writeActivityClient,
  type ActivityEntry,
  type ActivityKind,
} from '@/lib/activity';
import {
  readExpenseCommits,
  staleExpenseCommits,
  undoExpenseCommit,
} from '@/lib/expense-commit';
import {
  deleteDecision,
  readDecisionsClient,
  writeDecisionsClient,
  type DecisionEntry,
} from '@/lib/decision-log';
import { decorateEntry } from '@/lib/activity-derived';
import { estimateLateFee } from '@/lib/estimate-penalty';
import { explainMinPayment, suggestedGraceDays } from '@/lib/min-payment';
import { syncActivityCookieClient } from '@/lib/activity-cookie';
import {
  addMonthlySpend,
  readMonthlySpendClient,
  removeMonthlySpend,
  spentForMonth,
  writeMonthlySpendClient,
  type MonthlySpendEntry,
} from '@/lib/monthly-spend';
import { getCountryToday, MONTH_NAMES } from '@/lib/today';
import { formatCurrency } from '@/lib/api';
import { userDefaultCurrency } from '@/lib/currency';
import { LOAN_TYPE_SHORT } from '@/lib/loan-types';
import {
  formatINR,
  formatUSD,
  type Country,
  type LoanPayload,
  type UserPayload,
} from '@/lib/api';

export type LedgerVariant = 'ledger' | 'existing' | 'editorial';

const KIND_LABEL: Record<ActivityKind, string> = {
  paid_full: 'Paid in full',
  paid_partial: 'Paid partial',
  missed: 'Missed entirely',
  paid_extra: 'Paid extra',
  closed: 'Closed (paid off)',
};

const KIND_TONE: Record<ActivityKind, string> = {
  paid_full: 'var(--positive)',
  paid_partial: 'var(--accent)',
  missed: 'var(--negative)',
  paid_extra: 'var(--positive)',
  closed: 'var(--positive)',
};

function today(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/** Most-recent statement date (≤ today) and its due date for a card.
 *  If `dueDay` is set, anchors the due date on that day-of-month. Else
 *  adds `graceDays` (bank-aware default from registry) to the statement.
 *  Returns ISO dates + a short pretty label. */
function computeCycle(
  statementDay: number,
  dueDay: number | undefined,
  graceDays: number,
): { statementIso: string; dueIso: string; label: string } {
  const d = new Date();
  let year = d.getFullYear();
  let month = d.getMonth(); // 0-indexed
  const day = d.getDate();
  if (day < statementDay) {
    month -= 1;
    if (month < 0) {
      month = 11;
      year -= 1;
    }
  }
  const stmt = new Date(year, month, statementDay);
  let due: Date;
  if (dueDay) {
    // Anchor due on the user-specified day. If dueDay < statementDay,
    // it's the next month's same day-of-month.
    const dueYear = dueDay < statementDay ? (month === 11 ? year + 1 : year) : year;
    const dueMonth = dueDay < statementDay ? (month + 1) % 12 : month;
    due = new Date(dueYear, dueMonth, dueDay);
  } else {
    due = new Date(stmt);
    due.setDate(due.getDate() + graceDays);
  }
  const iso = (x: Date) => {
    const y = x.getFullYear();
    const m = String(x.getMonth() + 1).padStart(2, '0');
    const dy = String(x.getDate()).padStart(2, '0');
    return `${y}-${m}-${dy}`;
  };
  const short = (x: Date) =>
    x.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  return {
    statementIso: iso(stmt),
    dueIso: iso(due),
    label: `${short(stmt)} statement · due ${short(due)}`,
  };
}

function moneyFmt(country: Country) {
  return country === 'IN' ? formatINR : formatUSD;
}

/** Form input styling shared by LogForm and ForwardPrepayForm. Ledger
 *  variant uses mono font + sharp corners; the warm-card themes use sans
 *  + rounded. */
function themedInputStyle(variant: LedgerVariant): React.CSSProperties {
  return {
    padding: '6px 10px',
    fontSize: 13,
    border: '1px solid var(--border)',
    borderRadius: variant === 'ledger' ? 0 : 6,
    background: 'var(--canvas)',
    color: 'var(--ink)',
    fontFamily: variant === 'ledger' ? 'var(--font-mono)' : 'var(--font-sans)',
    width: '100%',
  };
}

/** Vertical label + input wrapper used throughout the activity forms. The
 *  optional `hint` slot renders right-aligned next to the label — used by
 *  amount fields to show "Scheduled: ₹X" alongside "Amount paid (₹)". */
function Field({
  label,
  hint,
  fullWidth = false,
  children,
}: {
  label: React.ReactNode;
  hint?: React.ReactNode;
  /** When true, the label spans the full grid row (both columns) inside
   *  the 1fr/1fr form grid. */
  fullWidth?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        ...(fullWidth ? { gridColumn: '1 / -1' } : null),
      }}
    >
      <span
        className="muted"
        style={
          hint
            ? { fontSize: 11, display: 'flex', justifyContent: 'space-between', gap: 8 }
            : { fontSize: 11 }
        }
      >
        <span>{label}</span>
        {hint}
      </span>
      {children}
    </label>
  );
}

export function ActivityLedger({
  user,
  variant,
}: {
  user: UserPayload;
  variant: LedgerVariant;
}) {
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const fmt = moneyFmt(user.country);

  // Hydrate from localStorage AFTER mount so SSR doesn't see different
  // markup than the first client render. The skeleton state below shows
  // a "loading" line briefly; in practice it's one tick.
  useEffect(() => {
    const initial = readActivityClient();
    setEntries(initial);
    setHydrated(true);
    // Also re-sync the cookie at mount so the cookie reflects whatever
    // localStorage carries — covers the "new browser, restored from
    // backup" case where localStorage exists but the cookie doesn't.
    syncActivityCookieClient(initial, user.loans, user.country);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync across tabs — if another tab adds an entry, refresh ours.
  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key === 'finoptima_activity') {
        const next = readActivityClient();
        setEntries(next);
        syncActivityCookieClient(next, user.loans, user.country);
      }
    }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [user.loans, user.country]);

  function commit(next: ActivityEntry[]) {
    setEntries(next);
    writeActivityClient(next);
    // Mirror the projection-relevant subset to a cookie so /plan can apply
    // the deltas server-side on next render.
    syncActivityCookieClient(next, user.loans, user.country);
  }

  function add(draft: Omit<ActivityEntry, 'id' | 'loggedAt'>) {
    commit(addActivityEntry(entries, draft));
  }

  function remove(id: string) {
    commit(removeActivityEntry(entries, id));
  }

  const sorted = useMemo(() => sortActivityNewestFirst(entries), [entries]);
  const validEntries = useMemo(
    () => sorted.filter((e) => e.loanIndex >= 0 && e.loanIndex < user.loans.length),
    [sorted, user.loans.length],
  );

  function confirmNothingChanged() {
    const additions: Omit<ActivityEntry, 'id' | 'loggedAt'>[] = [];
    confirmableLoans(user.loans, entries).forEach(({ loan, idx }) => {
      additions.push({
        loanIndex: idx,
        kind: 'paid_full',
        date: today(),
        amount: loan.scheduled_emi || '0',
        scheduledEmi: loan.scheduled_emi || '0',
      });
    });
    if (additions.length === 0) return;
    let next = entries;
    for (const draft of additions) {
      next = addActivityEntry(next, draft);
    }
    commit(next);
  }

  return (
    <div
      id="activity-ledger"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: variant === 'ledger' ? 18 : 22,
        scrollMarginTop: 24,
      }}
    >
      <NothingChangedBar
        entries={entries}
        loans={user.loans}
        variant={variant}
        onConfirm={confirmNothingChanged}
      />
      <MonthlySpendCard user={user} variant={variant} />
      <BudgetCommitments country={user.country} variant={variant} />
      <LogForm onAdd={add} loans={user.loans} country={user.country} variant={variant} />
      <ForwardPrepayForm onAdd={add} loans={user.loans} country={user.country} variant={variant} />
      <EntriesList
        entries={validEntries}
        loans={user.loans}
        country={user.country}
        fmt={fmt}
        onRemove={remove}
        hydrated={hydrated}
        variant={variant}
      />
    </div>
  );
}

/**
 * Budget-commitments panel — surfaces `expense_commit` entries from the
 * decision log directly in the activity ledger. Each row carries the
 * committed monthly delta, the source goal, the effective month, and
 * an undo affordance that restores the prior expense values on the
 * profile.
 *
 * Stale (>30d unreconciled) commitments get a "needs reconciliation"
 * highlight — the nudge from the design pass. The plan has been
 * silently assuming the cut held that whole time; the user needs to
 * confirm or undo before drift compounds.
 *
 * Renders nothing when there are no commitments — no empty banner.
 */
function BudgetCommitments({
  country,
  variant,
}: {
  country: Country;
  variant: LedgerVariant;
}) {
  const [commits, setCommits] = useState<DecisionEntry[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const ccySym = country === 'IN' ? '₹' : '$';

  useEffect(() => {
    setCommits(readExpenseCommits());
    setHydrated(true);
    // Cross-tab sync — if another tab undoes a commit (or commits a new
    // cut from /goals), reflect that here without a hard refresh.
    // Mirrors the activity-ledger storage listener above so the two
    // panels stay consistent. Listens to both keys: the legacy
    // `finoptima_decisions` key (in case migration hasn't run in the
    // other tab yet) and the new `finoptima_decision_log` key.
    function onStorage(e: StorageEvent) {
      if (
        e.key === 'finoptima_decision_log' ||
        e.key === 'finoptima_decisions'
      ) {
        setCommits(readExpenseCommits());
      }
    }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const stale = useMemo(() => staleExpenseCommits(commits), [commits]);

  function handleUndo(entry: DecisionEntry) {
    const ok = window.confirm(
      'Undo this expense cut? Your monthly expenses will be restored to the pre-commit value.',
    );
    if (!ok) return;
    undoExpenseCommit(entry);
    const next = deleteDecision(readDecisionsClient(), entry.id);
    writeDecisionsClient(next);
    setCommits(readExpenseCommits());
  }

  if (!hydrated || commits.length === 0) return null;

  return (
    <section
      style={{
        padding: variant === 'ledger' ? '10px 12px' : 14,
        background: 'var(--card)',
        border: '1px solid var(--border)',
        borderLeft: '3px solid var(--accent)',
        borderRadius: variant === 'ledger' ? 0 : 6,
      }}
    >
      <div
        style={{
          fontSize: 11,
          color: 'var(--accent)',
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          marginBottom: 8,
          fontFamily: variant === 'ledger' ? 'var(--font-mono)' : 'inherit',
        }}
      >
        Budget commitments
      </div>
      {stale.length > 0 && (
        <div
          style={{
            padding: '6px 10px',
            background: 'var(--soft-bg)',
            borderLeft: '3px solid var(--warning)',
            fontSize: 12,
            color: 'var(--ink)',
            lineHeight: 1.45,
            marginBottom: 10,
          }}
        >
          <strong>{stale.length} commitment{stale.length === 1 ? '' : 's'}</strong>{' '}
          {stale.length === 1 ? 'is' : 'are'} more than 30 days old without a
          reconcile. Did the cut hold? Reconcile or undo to keep the plan honest.
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {commits.map((e) => {
          const meta = e.recommendation.metadata ?? {};
          const delta = Number(meta.monthlyDelta ?? '0');
          const effective = meta.effectiveMonth ?? '';
          const prevFixed = Number(meta.previousFixedExpenses ?? '0');
          const prevVariable = Number(meta.previousVariableExpenses ?? '0');
          const prevTotal = prevFixed + prevVariable;
          const newTotal = Math.max(0, prevTotal - delta);
          const isStale = stale.some((s) => s.id === e.id);
          return (
            <div
              key={e.id}
              style={{
                display: 'flex',
                gap: 10,
                alignItems: 'baseline',
                justifyContent: 'space-between',
                padding: '8px 10px',
                background: 'var(--soft-bg)',
                border: isStale ? '1px solid var(--warning)' : '1px solid var(--border)',
                borderRadius: variant === 'ledger' ? 0 : 4,
                fontSize: 12,
                lineHeight: 1.5,
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600 }}>
                  Expense reduction · −{ccySym}
                  {Math.round(delta).toLocaleString()}/mo
                  {effective && (
                    <span className="muted" style={{ fontWeight: 400, marginLeft: 6 }}>
                      · from {effective}
                    </span>
                  )}
                </div>
                <div className="muted" style={{ fontSize: 11 }}>
                  {e.recommendation.context} · {ccySym}
                  {Math.round(prevTotal).toLocaleString()} → {ccySym}
                  {Math.round(newTotal).toLocaleString()}/mo
                </div>
              </div>
              <button
                type="button"
                onClick={() => handleUndo(e)}
                title="Undo this commitment"
                style={{
                  flexShrink: 0,
                  padding: '4px 10px',
                  border: '1px solid var(--border)',
                  background: 'transparent',
                  color: 'var(--muted)',
                  borderRadius: variant === 'ledger' ? 0 : 4,
                  cursor: 'pointer',
                  fontSize: 11,
                  fontFamily: variant === 'ledger' ? 'var(--font-mono)' : 'inherit',
                }}
              >
                Undo
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** Loans "nothing changed" can log as paid: open, with an EMI, and no
 *  entry this month yet. Cards are left out: what was paid on a card
 *  varies, and with no EMI set it logged a ₹0 payment as "paid in full". */
function confirmableLoans(loans: LoanPayload[], entries: ActivityEntry[]) {
  const month = today().slice(0, 7);
  return loans
    .map((loan, idx) => ({ loan, idx }))
    .filter(
      ({ loan, idx }) =>
        loan.loan_type !== 'credit_card' &&
        Number(loan.outstanding) > 0 &&
        Number(loan.scheduled_emi) > 0 &&
        !entries.some((e) => e.loanIndex === idx && e.date.slice(0, 7) === month),
    );
}

/**
 * One-tap "nothing changed this month" affordance. Shown when the user
 * has EMI loans with no entry for the current calendar month yet — it
 * creates `paid_full` entries at the scheduled EMI for each of them, so
 * the ledger doesn't go stale just because the user didn't open the page.
 *
 * Loans that already have any entry for the current month are skipped
 * (the user logged something deliberately and we shouldn't overwrite).
 * When everything's already logged the bar hides itself entirely.
 */
function NothingChangedBar({
  entries,
  loans,
  variant,
  onConfirm,
}: {
  entries: ActivityEntry[];
  loans: LoanPayload[];
  variant: LedgerVariant;
  onConfirm: () => void;
}) {
  const month = today().slice(0, 7);
  const unlogged = confirmableLoans(loans, entries);
  const cardsUnlogged = loans.filter(
    (l, idx) =>
      l.loan_type === 'credit_card' &&
      Number(l.outstanding) > 0 &&
      !entries.some((e) => e.loanIndex === idx && e.date.slice(0, 7) === month),
  ).length;
  if (unlogged.length === 0) return null;
  const monthLabel = new Date(`${month}-01T00:00:00`).toLocaleString(undefined, {
    month: 'long',
    year: 'numeric',
  });
  const isLedger = variant === 'ledger';
  return (
    <div
      style={{
        padding: isLedger ? '10px 14px' : '12px 14px',
        background: 'var(--card)',
        border: isLedger ? '1px dashed var(--border)' : '1px solid var(--border)',
        borderRadius: isLedger ? 0 : 6,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        fontFamily: isLedger ? 'var(--font-mono)' : undefined,
        fontSize: isLedger ? 11 : 13,
      }}
    >
      <div style={{ lineHeight: 1.5 }}>
        {isLedger ? (
          <>
            <span style={{ color: 'var(--muted)' }}>
              {monthLabel.toUpperCase()} ·{' '}
            </span>
            {unlogged.length} EMI{unlogged.length === 1 ? '' : 'S'} UNLOGGED
            THIS MONTH
            {cardsUnlogged > 0 && (
              <span style={{ color: 'var(--muted)' }}>
                {' '}· CARDS: LOG WHAT YOU PAID BELOW
              </span>
            )}
          </>
        ) : (
          <>
            <strong>Nothing changed this {monthLabel}?</strong>{' '}
            <span className="muted">
              One tap logs the scheduled EMI as paid for the {unlogged.length}{' '}
              loan{unlogged.length === 1 ? '' : 's'} you haven&apos;t logged yet.
              {cardsUnlogged > 0 && ' Log card payments below: the amount varies.'}
            </span>
          </>
        )}
      </div>
      <button
        type="button"
        onClick={onConfirm}
        style={{
          padding: isLedger ? '6px 10px' : '8px 14px',
          border: '1px solid var(--ink)',
          background: 'var(--ink)',
          color: 'var(--canvas)',
          cursor: 'pointer',
          fontSize: isLedger ? 10 : 12,
          letterSpacing: isLedger ? '0.12em' : undefined,
          borderRadius: isLedger ? 0 : 4,
          flexShrink: 0,
        }}
      >
        {isLedger ? 'CONFIRM EMIS PAID · NO CHANGES' : 'Nothing changed → mark EMIs paid'}
      </button>
    </div>
  );
}

// ─── Log form ───────────────────────────────────────────────────────────────

function LogForm({
  onAdd,
  loans,
  country,
  variant,
}: {
  onAdd: (draft: Omit<ActivityEntry, 'id' | 'loggedAt'>) => void;
  loans: LoanPayload[];
  country: Country;
  variant: LedgerVariant;
}) {
  const [loanIndex, setLoanIndex] = useState(0);
  const [kind, setKind] = useState<ActivityKind>('paid_full');
  const [date, setDate] = useState(today());
  const [amount, setAmount] = useState('');
  const [penaltyOverride, setPenaltyOverride] = useState('');
  const [newOutstanding, setNewOutstanding] = useState('');
  const [note, setNote] = useState('');

  const selectedLoan: LoanPayload | undefined = loans[loanIndex];
  const scheduledEmi = selectedLoan?.scheduled_emi ?? '0';
  const isCard = selectedLoan?.loan_type === 'credit_card';

  // For cards, the "amount owed this month" is the bank's minimum-payable
  // formula on outstanding — paying ≥ that keeps the account current. For
  // every other loan type, scheduled_emi IS the minimum.
  const minHint = useMemo(
    () => (selectedLoan && isCard ? explainMinPayment(selectedLoan, country) : null),
    [selectedLoan, isCard, country],
  );
  const minPayable = isCard
    ? minHint?.estimated ?? scheduledEmi
    : scheduledEmi;

  // Cycle labels for cards with a configured statement_day. Compute the
  // most-recent statement date (≤ today) and its due date — prefer the
  // user-specified due_day; fall back to the bank's typical grace
  // period from our registry; fall back further to the country default
  // (20 days IN, 23 days US).
  const cycle = useMemo(() => {
    if (!isCard || !selectedLoan?.statement_day) return null;
    const graceDays = suggestedGraceDays(selectedLoan.bank, country);
    return computeCycle(
      selectedLoan.statement_day,
      selectedLoan.due_day,
      graceDays,
    );
  }, [isCard, selectedLoan?.statement_day, selectedLoan?.due_day, selectedLoan?.bank, country]);

  // Default the amount when kind / loan changes.
  useEffect(() => {
    if (kind === 'paid_full') setAmount(scheduledEmi);
    else if (kind === 'missed') setAmount('0');
    else if (kind === 'closed') setAmount(selectedLoan?.outstanding ?? '0');
    else setAmount(''); // partial / paid_extra — user types
    if (kind !== 'paid_partial' && kind !== 'missed') setPenaltyOverride('');
  }, [kind, scheduledEmi, selectedLoan?.outstanding]);

  // For carded loans with a known cycle, default the payment date to
  // the next due date so the user doesn't have to manually type it.
  useEffect(() => {
    if (cycle) setDate(cycle.dueIso);
  }, [cycle?.dueIso]);

  // Live penalty estimate for missed/partial entries — uses the same engine
  // helper that the cookie writer + entries list use, so what the user sees
  // here is exactly what /plan will apply.
  //
  // Cards: shortfall is measured against the minimum payable, not the
  // scheduled amount. Paying above minimum is fine (revolving interest
  // applies but no penalty).
  const estimatedPenalty = useMemo(() => {
    if (!selectedLoan || (kind !== 'paid_partial' && kind !== 'missed')) return null;
    const reference = isCard ? minPayable : scheduledEmi;
    const overdue =
      kind === 'missed'
        ? reference
        : String(Math.max(0, Number(reference) - Number(amount || 0)));
    if (Number(overdue) <= 0) return null;
    const eventDate = new Date(date);
    const todayDate = new Date();
    const diffMs = todayDate.getTime() - eventDate.getTime();
    const days = Number.isNaN(diffMs)
      ? 0
      : Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
    return estimateLateFee({
      loanType: selectedLoan.loan_type,
      country,
      bank: selectedLoan.bank,
      overdueAmount: overdue,
      daysLate: days,
    });
  }, [selectedLoan, kind, scheduledEmi, minPayable, isCard, amount, date, country]);

  const fmtPreview = country === 'IN' ? formatINR : formatUSD;

  if (loans.length === 0) {
    return (
      <Panel variant={variant}>
        <div style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.6 }}>
          Add a loan in setup to start logging payment activity. Once you
          have at least one loan, this panel becomes a form for recording
          paid, partial, missed, extra, or paid-off events.
        </div>
      </Panel>
    );
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedLoan) return;
    onAdd({
      loanIndex,
      kind,
      date,
      amount: amount.trim() === '' ? '0' : amount,
      scheduledEmi,
      penaltyOverride:
        (kind === 'paid_partial' || kind === 'missed') &&
        penaltyOverride.trim() !== ''
          ? penaltyOverride
          : undefined,
      newOutstanding:
        isCard && newOutstanding.trim() !== ''
          ? newOutstanding
          : undefined,
      note: note.trim() || undefined,
    });
    setNote('');
    setPenaltyOverride('');
    setNewOutstanding('');
    setKind('paid_full');
    setAmount(scheduledEmi);
  }

  const inputStyle = themedInputStyle(variant);

  return (
    <Panel variant={variant}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>
        Log a payment event
      </div>
      {cycle && (
        <div
          style={{
            fontSize: 11,
            color: 'var(--muted)',
            marginBottom: 10,
            padding: '6px 10px',
            background: 'var(--soft-bg)',
            borderRadius: variant === 'ledger' ? 0 : 4,
            borderLeft: '2px solid var(--accent)',
          }}
        >
          {cycle.label}
        </div>
      )}
      <form
        onSubmit={submit}
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 10,
        }}
      >
        <Field label="Which loan">
          <select
            value={loanIndex}
            onChange={(e) => setLoanIndex(Number(e.target.value))}
            style={inputStyle}
          >
            {loans.map((l, i) => (
              <option key={i} value={i}>
                {l.bank || 'Unnamed'} · {LOAN_TYPE_SHORT[l.loan_type] ?? l.loan_type}
              </option>
            ))}
          </select>
        </Field>
        <Field label="What happened">
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as ActivityKind)}
            style={inputStyle}
          >
            <option value="paid_full">Paid in full</option>
            <option value="paid_partial">Paid partial</option>
            <option value="missed">Missed entirely</option>
            <option value="paid_extra">Paid extra (lump sum)</option>
            <option value="closed">Closed (paid off entirely)</option>
          </select>
        </Field>
        <Field label="Payment date">
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            max={today()}
            style={inputStyle}
          />
        </Field>
        <Field
          label={`Amount paid ${country === 'IN' ? '(₹)' : '($)'}`}
          hint={
            kind !== 'paid_extra' && kind !== 'closed' ? (
              <span
                style={{ color: 'var(--muted)' }}
                title={isCard && minHint ? minHint.formula : undefined}
              >
                {isCard ? 'Minimum payable' : 'Scheduled'}:{' '}
                {fmtPreview(isCard ? minPayable : scheduledEmi)}
              </span>
            ) : undefined
          }
        >
          <input
            type="text"
            inputMode="numeric"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            disabled={kind === 'missed'}
            placeholder={
              kind === 'paid_partial'
                ? `Less than ${scheduledEmi}`
                : kind === 'paid_extra'
                  ? `More than ${scheduledEmi}`
                  : kind === 'closed'
                    ? selectedLoan?.outstanding ?? '0'
                    : scheduledEmi
            }
            style={{
              ...inputStyle,
              fontFamily: 'var(--font-mono)',
              textAlign: 'right',
              opacity: kind === 'missed' ? 0.5 : 1,
            }}
          />
        </Field>
        {(kind === 'paid_partial' || kind === 'missed') && estimatedPenalty && (
          <div
            style={{
              gridColumn: '1 / -1',
              padding: 10,
              border: '1px dashed var(--border)',
              borderRadius: variant === 'ledger' ? 0 : 6,
              background: 'var(--soft-bg)',
              fontSize: 12,
              lineHeight: 1.55,
              color: 'var(--ink)',
            }}
          >
            <div style={{ marginBottom: 8, color: 'var(--muted)' }}>
              <strong style={{ color: 'var(--ink)' }}>
                {isCard ? 'Below minimum:' : 'Shortfall:'}
              </strong>{' '}
              {fmtPreview(isCard ? minPayable : scheduledEmi)}{' '}
              {isCard ? 'minimum' : 'scheduled'} · {fmtPreview(amount || '0')}{' '}
              paid ·{' '}
              <strong style={{ color: 'var(--negative)' }}>
                {fmtPreview(
                  String(
                    Math.max(
                      0,
                      Number(isCard ? minPayable : scheduledEmi) - Number(amount || 0),
                    ),
                  ),
                )}{' '}
                short
              </strong>
              {isCard && (
                <div style={{ marginTop: 4, fontSize: 11, fontStyle: 'italic' }}>
                  Paying ≥ minimum keeps the card current (revolving interest
                  still applies, but no late fee or bureau hit).
                </div>
              )}
            </div>
            <div style={{ marginBottom: 8 }}>
              We estimate this would attract a penalty of{' '}
              <strong style={{ color: 'var(--negative)' }}>
                ~{fmtPreview(estimatedPenalty.total.toFixed(0))}
              </strong>{' '}
              (
              {[
                `late fee ${fmtPreview(estimatedPenalty.flatFee.toFixed(0))}`,
                `penal interest ${fmtPreview(estimatedPenalty.penalInterest.toFixed(0))}`,
                estimatedPenalty.gst.gt(0)
                  ? `GST ${fmtPreview(estimatedPenalty.gst.toFixed(0))}`
                  : null,
              ]
                .filter(Boolean)
                .join(' · ')}
              ), {estimatedPenalty.source === 'bank_specific'
                ? `from ${selectedLoan?.bank || 'this bank'}'s published Schedule of Charges`
                : `from country/loan-type defaults`}
              . Override below if your statement shows a different number.
            </div>
            <input
              type="text"
              inputMode="numeric"
              value={penaltyOverride}
              onChange={(e) => setPenaltyOverride(e.target.value)}
              placeholder={`Override (${fmtPreview(estimatedPenalty.total.toFixed(0))})`}
              style={{
                ...inputStyle,
                fontFamily: 'var(--font-mono)',
                textAlign: 'right',
                maxWidth: 220,
              }}
            />
          </div>
        )}
        {isCard && (
          <Field
            fullWidth
            label={`New outstanding after this payment ${country === 'IN' ? '(₹)' : '($)'} — optional`}
            hint={
              <span style={{ color: 'var(--muted)', fontStyle: 'italic' }}>
                Current: {fmtPreview(selectedLoan?.outstanding ?? '0')}
              </span>
            }
          >
            <input
              type="text"
              inputMode="numeric"
              value={newOutstanding}
              onChange={(e) => setNewOutstanding(e.target.value)}
              placeholder="Leave blank to keep current"
              style={{
                ...inputStyle,
                fontFamily: 'var(--font-mono)',
                textAlign: 'right',
              }}
            />
            <span style={{ fontSize: 11, color: 'var(--muted)' }}>
              When set, /plan re-anchors this card to your reported balance
              instead of letting it drift. Read this off your statement after
              the payment posts.
            </span>
          </Field>
        )}
        <Field fullWidth label="Note (optional)">
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. paid 5 days late, called bank to waive fee"
            style={inputStyle}
            maxLength={120}
          />
        </Field>
        <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}>
          <button
            type="submit"
            className="btn btn-primary"
            style={{
              padding: '6px 14px',
              fontSize: 13,
              cursor: 'pointer',
              borderRadius: variant === 'ledger' ? 0 : 6,
            }}
          >
            {variant === 'ledger' ? '[LOG ENTRY]' : 'Log entry'}
          </button>
        </div>
      </form>
      <div
        className="muted"
        style={{ fontSize: 11, marginTop: 10, lineHeight: 1.55 }}
      >
        Stored locally to this browser only — same model as the rest of your
        profile. Penalty estimates use your bank&apos;s published Schedule of
        Charges when available, otherwise a country/loan-type default.
      </div>
    </Panel>
  );
}

// ─── Forward-prepay form ───────────────────────────────────────────────────
//
// Captures the "I just sold an asset / got a bonus, log N forward months of
// EMI as already-paid" flow. Records ONE paid_extra entry for today with
// amount = N × scheduledEmi, tagged with the source. The amortisation engine
// applies the excess as principal reduction immediately; the forward-month
// metadata (`coversForwardMonths`, `source`) is informational for the UI so
// the ledger can render "covers next N months via X" without parsing notes.
//
// Why not N separate forward-dated paid_full entries: the activity-cookie
// reducer treats paid_full as a no-op on outstanding (it's the baseline);
// only paid_extra contributes principal reduction. So N forward paid_fulls
// wouldn't actually pull the trajectory forward in /plan — the user would
// have done all that work and seen no change. One paid_extra does it.

const PREPAY_SOURCES: { value: string; label: string }[] = [
  { value: 'sold-asset', label: 'Sold an asset' },
  { value: 'bonus', label: 'Bonus / windfall' },
  { value: 'gift', label: 'Gift / family transfer' },
  { value: 'refund', label: 'Refund / settlement' },
  { value: 'other', label: 'Other' },
];

function ForwardPrepayForm({
  onAdd,
  loans,
  country,
  variant,
}: {
  onAdd: (draft: Omit<ActivityEntry, 'id' | 'loggedAt'>) => void;
  loans: LoanPayload[];
  country: Country;
  variant: LedgerVariant;
}) {
  const [open, setOpen] = useState(false);
  const [loanIndex, setLoanIndex] = useState(0);
  const [months, setMonths] = useState('6');
  const [source, setSource] = useState<string>('sold-asset');
  const [note, setNote] = useState('');

  const selectedLoan: LoanPayload | undefined = loans[loanIndex];
  const scheduledEmi = selectedLoan?.scheduled_emi ?? '0';
  const fmtPreview = country === 'IN' ? formatINR : formatUSD;

  const monthsN = Math.max(0, Math.min(36, Number(months) || 0));
  const totalAmount = new Decimal(scheduledEmi || 0).mul(monthsN).toFixed(0);
  const lumpExtra = new Decimal(scheduledEmi || 0).mul(Math.max(0, monthsN - 1)).toFixed(0);

  if (loans.length === 0) return null;

  const inputStyle = themedInputStyle(variant);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedLoan || monthsN <= 0) return;
    onAdd({
      loanIndex,
      kind: 'paid_extra',
      date: today(),
      amount: totalAmount,
      scheduledEmi,
      note: note.trim() || undefined,
      source,
      coversForwardMonths: monthsN,
    });
    setNote('');
    setOpen(false);
    setMonths('6');
  }

  return (
    <Panel variant={variant}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          background: 'transparent',
          border: 'none',
          padding: 0,
          color: 'var(--accent)',
          fontFamily: 'var(--font-sans)',
          fontSize: 13,
          fontWeight: 600,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
        }}
        aria-expanded={open}
      >
        <span style={{ fontFamily: 'var(--font-mono)' }}>{open ? '▾' : '▸'}</span>
        Prepay forward months (sold an asset, got a bonus)
      </button>
      {open && (
        <form onSubmit={submit} style={{ marginTop: 12, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Field label="Which loan">
            <select
              value={loanIndex}
              onChange={(e) => setLoanIndex(Number(e.target.value))}
              style={inputStyle}
            >
              {loans.map((l, i) => (
                <option key={i} value={i}>
                  {l.bank || 'Unnamed'} · {LOAN_TYPE_SHORT[l.loan_type] ?? l.loan_type}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Months to prepay (1-36)">
            <input
              type="text"
              inputMode="numeric"
              value={months}
              onChange={(e) => setMonths(e.target.value)}
              style={{ ...inputStyle, fontFamily: 'var(--font-mono)', textAlign: 'right' }}
            />
          </Field>
          <Field label="Source">
            <select
              value={source}
              onChange={(e) => setSource(e.target.value)}
              style={inputStyle}
            >
              {PREPAY_SOURCES.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </Field>
          <Field label="Note (optional)">
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={
                source === 'sold-asset'
                  ? 'e.g. sold equity MF, prepaying 6 months of EMI'
                  : 'Optional detail'
              }
              style={inputStyle}
              maxLength={120}
            />
          </Field>
          {monthsN > 0 && Number(scheduledEmi) > 0 && (
            <div
              style={{
                gridColumn: '1 / -1',
                padding: 10,
                border: '1px dashed var(--border)',
                borderRadius: variant === 'ledger' ? 0 : 6,
                background: 'var(--soft-bg)',
                fontSize: 12,
                lineHeight: 1.55,
                color: 'var(--ink)',
              }}
            >
              Will record one <strong>paid_extra</strong> entry today for{' '}
              <strong>{fmtPreview(totalAmount)}</strong> (
              {monthsN} × {fmtPreview(scheduledEmi)} EMI). The first EMI
              counts as this month&apos;s scheduled payment;{' '}
              <strong>{fmtPreview(lumpExtra)}</strong> goes straight to
              principal, pulling your debt-free date forward in /plan.
            </div>
          )}
          <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
            <button
              type="button"
              onClick={() => setOpen(false)}
              style={{
                padding: '6px 12px',
                fontSize: 13,
                background: 'transparent',
                border: '1px solid var(--border)',
                borderRadius: variant === 'ledger' ? 0 : 6,
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={monthsN <= 0 || Number(scheduledEmi) <= 0}
              style={{
                padding: '6px 14px',
                fontSize: 13,
                cursor: monthsN > 0 ? 'pointer' : 'not-allowed',
                borderRadius: variant === 'ledger' ? 0 : 6,
                opacity: monthsN > 0 && Number(scheduledEmi) > 0 ? 1 : 0.6,
              }}
            >
              {variant === 'ledger' ? '[PREPAY]' : 'Record prepayment'}
            </button>
          </div>
        </form>
      )}
    </Panel>
  );
}

// ─── Entries list ──────────────────────────────────────────────────────────

function EntriesList({
  entries,
  loans,
  country,
  fmt,
  onRemove,
  hydrated,
  variant,
}: {
  entries: ActivityEntry[];
  loans: LoanPayload[];
  country: Country;
  fmt: (v: string | number) => string;
  onRemove: (id: string) => void;
  hydrated: boolean;
  variant: LedgerVariant;
}) {
  if (!hydrated) {
    return (
      <Panel variant={variant}>
        <div className="muted" style={{ fontSize: 12 }}>
          Loading activity…
        </div>
      </Panel>
    );
  }

  if (entries.length === 0) {
    return (
      <Panel variant={variant}>
        <div style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.6 }}>
          {variant === 'editorial'
            ? 'Nothing in the ledger yet. As you log payments above, the entries will appear here with a penalty estimate beside any partial or missed payments — so you can see, in numbers, what skipping an EMI would have cost.'
            : "No entries yet. Log a payment above — partial and missed entries show the penalty you'd have been charged."}
        </div>
      </Panel>
    );
  }

  if (variant === 'ledger') {
    return (
      <LedgerEntries
        entries={entries}
        loans={loans}
        country={country}
        fmt={fmt}
        onRemove={onRemove}
      />
    );
  }

  if (variant === 'editorial') {
    return (
      <EditorialEntries
        entries={entries}
        loans={loans}
        country={country}
        fmt={fmt}
        onRemove={onRemove}
      />
    );
  }

  return (
    <ExistingEntries
      entries={entries}
      loans={loans}
      country={country}
      fmt={fmt}
      onRemove={onRemove}
    />
  );
}

// ─── Ledger entries (mono table) ────────────────────────────────────────────

function LedgerEntries({
  entries,
  loans,
  country,
  fmt,
  onRemove,
}: {
  entries: ActivityEntry[];
  loans: LoanPayload[];
  country: Country;
  fmt: (v: string | number) => string;
  onRemove: (id: string) => void;
}) {
  return (
    <section>
      <div
        style={{
          fontSize: 11,
          color: 'var(--muted)',
          letterSpacing: '0.18em',
          marginBottom: 6,
          fontFamily: 'var(--font-mono)',
        }}
      >
        $ ACTIVITY · {entries.length} ENTRIES
      </div>
      <table
        style={{
          width: '100%',
          borderCollapse: 'collapse',
          fontSize: 12,
          fontFamily: 'var(--font-mono)',
        }}
      >
        <thead>
          <tr
            style={{
              borderTop: '2px solid var(--ink)',
              borderBottom: '1px solid var(--ink)',
            }}
          >
            {['DATE', 'LOAN', 'EVENT', 'PAID', 'PENALTY EST.', ''].map((h, i) => (
              <th
                key={h + i}
                style={{
                  padding: '8px 12px',
                  textAlign: i >= 3 && i < 5 ? 'right' : 'left',
                  fontWeight: 700,
                  letterSpacing: '0.08em',
                  fontSize: 10,
                  color: 'var(--muted)',
                }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => {
            const loan = loans[e.loanIndex];
            const { est, extra } = decorateEntry(e, loan, country);
            return (
              <tr
                key={e.id}
                style={{
                  borderBottom: '1px dashed var(--dash)',
                }}
              >
                <td style={{ padding: '10px 12px', color: 'var(--muted)' }}>
                  {e.date}
                </td>
                <td style={{ padding: '10px 12px' }}>
                  {loan.bank || 'Unnamed'}{' '}
                  <span style={{ color: 'var(--muted)' }}>
                    · {LOAN_TYPE_SHORT[loan.loan_type] ?? loan.loan_type}
                  </span>
                  {e.coversForwardMonths && e.coversForwardMonths > 0 && (
                    <div
                      style={{
                        marginTop: 4,
                        fontSize: 10,
                        color: 'var(--accent)',
                        letterSpacing: '0.06em',
                      }}
                    >
                      covers {e.coversForwardMonths} mo
                      {e.source ? ` · ${e.source.replace('-', ' ')}` : ''}
                    </div>
                  )}
                </td>
                <td
                  style={{
                    padding: '10px 12px',
                    fontWeight: 700,
                    color: KIND_TONE[e.kind],
                    textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                  }}
                >
                  {e.kind.replace('_', ' ')}
                </td>
                <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                  {fmt(e.amount)}
                </td>
                <td
                  style={{
                    padding: '10px 12px',
                    textAlign: 'right',
                    color:
                      e.kind === 'closed' || (e.kind === 'paid_extra' && Number(extra) > 0)
                        ? 'var(--positive)'
                        : est && est.total.gt(0)
                          ? 'var(--negative)'
                          : 'var(--muted)',
                    fontWeight:
                      e.kind === 'closed' ||
                      (e.kind === 'paid_extra' && Number(extra) > 0) ||
                      (est && est.total.gt(0))
                        ? 600
                        : 400,
                  }}
                >
                  {e.kind === 'closed'
                    ? '[CLOSED]'
                    : e.kind === 'paid_extra' && Number(extra) > 0
                      ? `−${fmt(extra)}`
                      : est && est.total.gt(0)
                        ? `~${fmt(est.total.toFixed(0))}`
                        : '—'}
                </td>
                <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                  <button
                    type="button"
                    onClick={() => onRemove(e.id)}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: 'var(--muted)',
                      fontSize: 11,
                      letterSpacing: '0.12em',
                      cursor: 'pointer',
                      fontFamily: 'var(--font-mono)',
                    }}
                    aria-label="Delete entry"
                    title="Delete entry"
                  >
                    [×]
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <NoteSummary entries={entries} variant="ledger" />
    </section>
  );
}

// ─── Existing entries (card list) ───────────────────────────────────────────

function ExistingEntries({
  entries,
  loans,
  country,
  fmt,
  onRemove,
}: {
  entries: ActivityEntry[];
  loans: LoanPayload[];
  country: Country;
  fmt: (v: string | number) => string;
  onRemove: (id: string) => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div className="muted" style={{ fontSize: 12 }}>
        {entries.length} {entries.length === 1 ? 'entry' : 'entries'} · newest first
      </div>
      {entries.map((e) => {
        const loan = loans[e.loanIndex];
        const { est, extra } = decorateEntry(e, loan, country);
        return (
          <div
            key={e.id}
            style={{
              border: '1px solid var(--border)',
              borderLeft: `3px solid ${KIND_TONE[e.kind]}`,
              borderRadius: 6,
              padding: 12,
              background: 'var(--card)',
              display: 'grid',
              gridTemplateColumns: '1fr auto',
              gap: 8,
            }}
          >
            <div>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'baseline',
                  gap: 10,
                  flexWrap: 'wrap',
                  marginBottom: 4,
                }}
              >
                <span style={{ fontWeight: 600, fontSize: 14 }}>
                  {loan.bank || 'Unnamed'}{' '}
                  <span className="muted" style={{ fontWeight: 400 }}>
                    · {LOAN_TYPE_SHORT[loan.loan_type] ?? loan.loan_type}
                  </span>
                  {e.coversForwardMonths && e.coversForwardMonths > 0 && (
                    <span
                      className="chip"
                      style={{
                        marginLeft: 8,
                        fontSize: 11,
                        color: 'var(--accent)',
                        borderColor: 'var(--accent)',
                        background: 'transparent',
                      }}
                    >
                      covers {e.coversForwardMonths} mo
                      {e.source ? ` · ${e.source.replace('-', ' ')}` : ''}
                    </span>
                  )}
                </span>
                <span
                  className="chip"
                  style={{
                    background: 'transparent',
                    color: KIND_TONE[e.kind],
                    borderColor: KIND_TONE[e.kind],
                    fontSize: 11,
                  }}
                >
                  {KIND_LABEL[e.kind]}
                </span>
                <span className="muted" style={{ fontSize: 12 }}>
                  {e.date}
                </span>
              </div>
              <div className="muted" style={{ fontSize: 13 }}>
                {e.kind === 'closed' ? (
                  <>
                    Cleared the line with <span className="num">{fmt(e.amount)}</span>. The
                    plan now treats this loan as paid off.
                  </>
                ) : e.kind === 'paid_extra' ? (
                  <>
                    Paid <span className="num">{fmt(e.amount)}</span> against a scheduled{' '}
                    <span className="num">{fmt(e.scheduledEmi)}</span> — the extra{' '}
                    <span
                      className="num"
                      style={{ color: 'var(--positive)', fontWeight: 600 }}
                    >
                      {fmt(extra)}
                    </span>{' '}
                    comes off principal in the next /plan run.
                  </>
                ) : (
                  <>
                    Paid <span className="num">{fmt(e.amount)}</span> of{' '}
                    <span className="num">{fmt(e.scheduledEmi)}</span> scheduled
                    {est && est.total.gt(0) && (
                      <>
                        {' '}· Likely penalty{' '}
                        <span
                          className="num"
                          style={{ color: 'var(--negative)', fontWeight: 600 }}
                        >
                          ~{fmt(est.total.toFixed(0))}
                        </span>
                        {e.penaltyOverride && e.penaltyOverride.trim() !== '' ? (
                          <span className="muted" style={{ marginLeft: 4 }}>
                            (your override)
                          </span>
                        ) : (
                          <>
                            {' '}
                            <PenaltyBreakdownTooltip est={est} fmt={fmt} />
                          </>
                        )}
                      </>
                    )}
                  </>
                )}
                {e.note && (
                  <div
                    style={{ fontSize: 12, marginTop: 4, fontStyle: 'italic' }}
                  >
                    “{e.note}”
                  </div>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={() => onRemove(e.id)}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--muted)',
                cursor: 'pointer',
                fontSize: 18,
                lineHeight: 1,
                padding: '0 4px',
                alignSelf: 'start',
              }}
              aria-label="Delete entry"
              title="Delete entry"
            >
              ×
            </button>
          </div>
        );
      })}
      <NoteSummary entries={entries} variant="existing" />
    </div>
  );
}

// ─── Editorial entries (dispatches) ─────────────────────────────────────────

function EditorialEntries({
  entries,
  loans,
  country,
  fmt,
  onRemove,
}: {
  entries: ActivityEntry[];
  loans: LoanPayload[];
  country: Country;
  fmt: (v: string | number) => string;
  onRemove: (id: string) => void;
}) {
  return (
    <div>
      <div
        style={{
          fontFamily: 'var(--font-sans)',
          fontSize: 10,
          letterSpacing: '0.15em',
          textTransform: 'uppercase',
          color: 'var(--soft)',
          marginBottom: 16,
        }}
      >
        Dispatches, in your hand · {entries.length}{' '}
        {entries.length === 1 ? 'entry' : 'entries'}
      </div>
      {entries.map((e, i) => {
        const loan = loans[e.loanIndex];
        const { est, extra } = decorateEntry(e, loan, country);
        return (
          <div
            key={e.id}
            style={{
              paddingBottom: 24,
              marginBottom: 24,
              borderBottom:
                i === entries.length - 1 ? 'none' : '1px solid var(--border)',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'baseline',
                justifyContent: 'space-between',
                gap: 18,
                marginBottom: 8,
                fontFamily: 'var(--font-sans)',
                fontSize: 11,
                textTransform: 'uppercase',
                letterSpacing: '0.12em',
                color: 'var(--soft)',
              }}
            >
              <span>
                {KIND_LABEL[e.kind]} · {loan.bank || 'Unnamed'}
              </span>
              <span>{e.date}</span>
            </div>
            <p
              style={{
                fontFamily: 'var(--font-display)',
                fontSize: 17,
                lineHeight: 1.65,
                margin: 0,
              }}
            >
              {e.kind === 'closed' ? (
                <>
                  You cleared your{' '}
                  {LOAN_TYPE_SHORT[loan.loan_type] ?? loan.loan_type} with{' '}
                  {loan.bank || 'this lender'} on {e.date} with a final{' '}
                  <strong>{fmt(e.amount)}</strong>. The next plan run drops
                  this line from the schedule.
                </>
              ) : e.kind === 'paid_extra' ? (
                <>
                  You sent <strong>{fmt(e.amount)}</strong> against your{' '}
                  {LOAN_TYPE_SHORT[loan.loan_type] ?? loan.loan_type} with{' '}
                  {loan.bank || 'this lender'} on {e.date}
                  {e.coversForwardMonths && e.coversForwardMonths > 0 ? (
                    <>
                      {' '}— covering the next{' '}
                      <strong>{e.coversForwardMonths} months</strong>
                      {e.source ? (
                        <>
                          {' '}from <em>{e.source.replace('-', ' ')}</em>
                        </>
                      ) : null}
                      .
                    </>
                  ) : (
                    <>
                      {' '}— the scheduled EMI was{' '}
                      <strong>{fmt(e.scheduledEmi)}</strong>,
                    </>
                  )}{' '}
                  so the extra{' '}
                  <strong style={{ color: 'var(--positive)' }}>
                    {fmt(extra)}
                  </strong>{' '}
                  comes off principal in the next plan run.
                </>
              ) : (
                <>
                  You sent <strong>{fmt(e.amount)}</strong> against your{' '}
                  {LOAN_TYPE_SHORT[loan.loan_type] ?? loan.loan_type} with{' '}
                  {loan.bank || 'this lender'} on {e.date}. The scheduled EMI was{' '}
                  <strong>{fmt(e.scheduledEmi)}</strong>.
                  {est && est.total.gt(0) && (
                    <>
                      {' '}
                      {e.penaltyOverride && e.penaltyOverride.trim() !== ''
                        ? 'You recorded a penalty of'
                        : "On the bank's published Schedule of Charges this would attract"}{' '}
                      <strong style={{ color: 'var(--negative)' }}>
                        {e.penaltyOverride && e.penaltyOverride.trim() !== ''
                          ? fmt(est.total.toFixed(0))
                          : `roughly ${fmt(est.total.toFixed(0))}`}
                      </strong>
                      {e.penaltyOverride && e.penaltyOverride.trim() !== ''
                        ? ' for this missed cycle.'
                        : ` in late fees and penal interest${
                            country === 'IN' && est.gst.gt(0) ? ' (including GST)' : ''
                          }.`}
                    </>
                  )}
                </>
              )}
              {e.note && (
                <>
                  {' '}
                  <em style={{ color: 'var(--muted)' }}>“{e.note}”</em>
                </>
              )}
            </p>
            <button
              type="button"
              onClick={() => onRemove(e.id)}
              style={{
                marginTop: 8,
                background: 'transparent',
                border: 'none',
                color: 'var(--muted)',
                cursor: 'pointer',
                fontFamily: 'var(--font-sans)',
                fontSize: 11,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                padding: 0,
              }}
            >
              remove ×
            </button>
          </div>
        );
      })}
      <NoteSummary entries={entries} variant="editorial" />
    </div>
  );
}

// ─── Footer summary across all variants ─────────────────────────────────────

function NoteSummary({
  entries,
  variant,
}: {
  entries: ActivityEntry[];
  variant: LedgerVariant;
}) {
  const counts = useMemo(() => {
    let projection = 0;
    for (const e of entries) {
      if (e.kind === 'paid_full') continue;
      projection += 1;
    }
    return projection;
  }, [entries]);

  if (counts === 0) return null;

  const text =
    counts === 1
      ? `1 entry feeds into your /plan projection — missed/partial bumps your outstanding up, extra payments and closures bring it down.`
      : `${counts} entries feed into your /plan projection — missed/partial bumps your outstanding up, extra payments and closures bring it down.`;

  if (variant === 'ledger') {
    return (
      <div
        style={{
          marginTop: 14,
          padding: '8px 12px',
          border: '1px dashed var(--border)',
          fontSize: 11,
          color: 'var(--muted)',
          letterSpacing: '0.04em',
          fontFamily: 'var(--font-mono)',
          lineHeight: 1.6,
        }}
      >
        <strong style={{ color: 'var(--ink)' }}>NOTE</strong> · {text}
      </div>
    );
  }

  return (
    <div
      style={{
        marginTop: 12,
        padding: 12,
        background: 'var(--soft-bg)',
        borderRadius: variant === 'editorial' ? 0 : 6,
        fontSize: 12,
        color: 'var(--muted)',
        lineHeight: 1.55,
      }}
    >
      {text}
    </div>
  );
}

// ─── Small helpers ─────────────────────────────────────────────────────────

function Panel({
  children,
  variant,
}: {
  children: React.ReactNode;
  variant: LedgerVariant;
}) {
  if (variant === 'ledger') {
    return (
      <section
        style={{
          border: '1px solid var(--ink)',
          padding: 16,
          background: 'var(--card)',
          fontFamily: 'var(--font-mono)',
          fontSize: 12,
        }}
      >
        {children}
      </section>
    );
  }
  return (
    <section
      style={{
        border: '1px solid var(--border)',
        borderRadius: variant === 'editorial' ? 0 : 8,
        padding: 14,
        background: 'var(--card)',
      }}
    >
      {children}
    </section>
  );
}

function PenaltyBreakdownTooltip({
  est,
  fmt,
}: {
  est: ReturnType<typeof estimateLateFee>;
  fmt: (v: string | number) => string;
}) {
  const parts: string[] = [
    `Late fee ${fmt(est.flatFee.toFixed(0))}`,
    `Penal interest ${fmt(est.penalInterest.toFixed(0))}`,
  ];
  if (est.gst.gt(0)) parts.push(`GST ${fmt(est.gst.toFixed(0))}`);
  parts.push(
    est.source === 'bank_specific'
      ? `from this bank's Schedule of Charges`
      : `from country/loan-type defaults`,
  );
  return (
    <abbr
      title={parts.join(' · ')}
      style={{
        cursor: 'help',
        borderBottom: '1px dotted var(--muted)',
        marginLeft: 4,
        fontSize: 11,
      }}
    >
      breakdown
    </abbr>
  );
}

// ─── Monthly-spend log ─────────────────────────────────────────────────────

/**
 * "What did you actually spend this month?" — a single-line capture that
 * lets the BudgetMonthCard on /plan render a variance against the
 * planned envelope. Stored independently of the activity-ledger
 * payment events; doesn't move any loan, doesn't run through the
 * engine.
 *
 * Renders the current month's entry inline (with an Edit affordance)
 * and a small "Past months" expandable list for completeness.
 */
function MonthlySpendCard({
  user,
  variant,
}: {
  user: UserPayload;
  variant: LedgerVariant;
}) {
  const [entries, setEntries] = useState<MonthlySpendEntry[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [draft, setDraft] = useState('');
  const [showHistory, setShowHistory] = useState(false);

  const today = getCountryToday(user.country);
  const currentMonthIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  const monthLabel = `${MONTH_NAMES[today.getMonth()]} ${today.getFullYear()}`;
  const ccy = userDefaultCurrency(user.country);
  const ccySym = user.country === 'IN' ? '₹' : '$';
  const upper = variant === 'ledger';

  useEffect(() => {
    setEntries(readMonthlySpendClient());
    setHydrated(true);
    function onStorage(e: StorageEvent) {
      if (e.key === 'finoptima_monthly_spend') {
        setEntries(readMonthlySpendClient());
      }
    }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const loggedThisMonth = spentForMonth(entries, currentMonthIso);
  const plannedBudget =
    Number(user.fixed_expenses || 0) + Number(user.variable_expenses || 0);

  function commit() {
    const cleaned = draft.replace(/[,₹$\s]/g, '');
    const n = Number(cleaned);
    if (!Number.isFinite(n) || n < 0) return;
    const next = addMonthlySpend(entries, {
      monthIso: currentMonthIso,
      spent: String(n),
    });
    writeMonthlySpendClient(next);
    setEntries(next);
    setDraft('');
  }

  function remove(id: string) {
    const next = removeMonthlySpend(entries, id);
    writeMonthlySpendClient(next);
    setEntries(next);
  }

  const variance =
    loggedThisMonth !== null && plannedBudget > 0
      ? loggedThisMonth - plannedBudget
      : null;
  const overBudget = variance !== null && variance > 0;

  // Past months — distinct monthIso values excluding the current one,
  // sorted descending. One row per month showing the latest entry.
  const pastMonths = useMemo(() => {
    const winners = new Map<string, MonthlySpendEntry>();
    for (const e of entries) {
      if (e.monthIso === currentMonthIso) continue;
      const prev = winners.get(e.monthIso);
      if (!prev || e.loggedAt > prev.loggedAt) {
        winners.set(e.monthIso, e);
      }
    }
    return Array.from(winners.values()).sort((a, b) =>
      b.monthIso.localeCompare(a.monthIso),
    );
  }, [entries, currentMonthIso]);

  return (
    <section
      style={{
        padding: variant === 'ledger' ? '10px 12px' : 14,
        background: 'var(--card)',
        border: '1px solid var(--border)',
        borderLeft: '3px solid var(--accent)',
        borderRadius: variant === 'ledger' ? 0 : 6,
      }}
    >
      <div
        style={{
          fontSize: 11,
          color: 'var(--accent)',
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          marginBottom: 8,
          fontFamily: variant === 'ledger' ? 'var(--font-mono)' : 'inherit',
        }}
      >
        {upper
          ? `THIS MONTH'S SPEND · ${monthLabel.toUpperCase()}`
          : `This month's spend · ${monthLabel}`}
      </div>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 8,
          alignItems: 'center',
        }}
      >
        <span className="muted" style={{ fontSize: 12 }}>
          Planned {formatCurrency(plannedBudget.toString(), ccy)} ·{' '}
          {hydrated && loggedThisMonth !== null ? (
            <>
              logged{' '}
              <strong style={{ color: 'var(--ink)' }}>
                {formatCurrency(loggedThisMonth.toString(), ccy)}
              </strong>
              {variance !== null && Math.abs(variance) >= 1 && (
                <>
                  {' '}·{' '}
                  <span
                    style={{
                      color: overBudget ? 'var(--negative)' : 'var(--positive)',
                      fontWeight: 600,
                    }}
                  >
                    {overBudget ? '+' : '−'}
                    {formatCurrency(Math.abs(variance).toString(), ccy)}{' '}
                    {overBudget ? 'over' : 'under'}
                  </span>
                </>
              )}
            </>
          ) : (
            <span className="muted">not logged yet</span>
          )}
        </span>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input
            type="text"
            inputMode="decimal"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={loggedThisMonth !== null ? 'Update' : `${ccySym} this month`}
            style={{
              ...themedInputStyle(variant),
              width: 120,
              padding: '4px 8px',
              fontSize: 12,
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit();
            }}
          />
          <button
            type="button"
            onClick={commit}
            disabled={!draft.trim()}
            style={{
              padding: '4px 10px',
              fontSize: 12,
              background: draft.trim() ? 'var(--accent)' : 'var(--soft-bg)',
              color: draft.trim() ? '#fff' : 'var(--muted)',
              border: 'none',
              borderRadius: variant === 'ledger' ? 0 : 4,
              cursor: draft.trim() ? 'pointer' : 'not-allowed',
              fontFamily: variant === 'ledger' ? 'var(--font-mono)' : 'inherit',
            }}
          >
            {loggedThisMonth !== null ? 'Update' : 'Log'}
          </button>
        </div>
      </div>
      {pastMonths.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <button
            type="button"
            onClick={() => setShowHistory((v) => !v)}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--accent)',
              fontSize: 11,
              padding: 0,
              cursor: 'pointer',
              fontFamily: variant === 'ledger' ? 'var(--font-mono)' : 'inherit',
            }}
          >
            {showHistory
              ? upper
                ? '[HIDE PAST MONTHS]'
                : 'Hide past months'
              : upper
                ? `[SHOW PAST MONTHS · ${pastMonths.length}]`
                : `Show past months (${pastMonths.length})`}
          </button>
          {showHistory && (
            <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {pastMonths.map((e) => {
                const v = Number(e.spent || '0');
                const delta = plannedBudget > 0 ? v - plannedBudget : 0;
                return (
                  <div
                    key={e.id}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: 8,
                      fontSize: 12,
                      padding: '4px 0',
                      borderBottom: '1px solid var(--border)',
                    }}
                  >
                    <span>{e.monthIso}</span>
                    <span style={{ color: 'var(--ink)' }}>
                      {formatCurrency(v.toString(), ccy)}
                      {plannedBudget > 0 && Math.abs(delta) >= 1 && (
                        <span
                          style={{
                            color: delta > 0 ? 'var(--negative)' : 'var(--positive)',
                            marginLeft: 6,
                          }}
                        >
                          {delta > 0 ? '+' : '−'}
                          {formatCurrency(Math.abs(delta).toString(), ccy)}
                        </span>
                      )}
                    </span>
                    <button
                      type="button"
                      onClick={() => remove(e.id)}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: 'var(--muted)',
                        cursor: 'pointer',
                        fontSize: 11,
                      }}
                      title="Remove this entry"
                    >
                      ✕
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
