/**
 * Activity's history (REDESIGN R4.1): everything logged, grouped by month,
 * newest first. A row is one thing that happened — a payment, a month's
 * spending, a life event — or, in the current month, a payment that's due
 * and not logged yet.
 */
import type { Country, LoanPayload, UserPayload } from '@/lib/api';
import { formatCurrencyWhole } from '@/lib/api';
import type { ActivityEntry } from '@/lib/activity';
import { decorateEntry } from '@/lib/activity-derived';
import type { LifecycleEvent } from '@/lib/lifecycle-events';
import { latestByMonth, type MonthlySpendEntry } from '@/lib/monthly-spend';
import { isWithinUndoWindow, type DecisionEntry as PlanDecision } from '@/lib/decisions';
import { canUndoPlanDecision } from '@/lib/decision-undo';
import type { DecisionEntry as Recommendation } from '@/lib/decision-log';
import { staleExpenseCommits } from '@/lib/expense-commit';
import { requiredMonthly } from '@/lib/min-payment';
import { loanCurrency, userDefaultCurrency } from '@/lib/currency';
import { loanLabel } from '@/lib/loan-types';
import { localIsoDate, MONTH_NAMES_SHORT } from '@/lib/today';
import { LIFE_KIND_LABEL, lifeEventSummary } from '@/components/lifecycle/LifeEventForm';

export type Tone = 'positive' | 'negative' | 'muted' | 'ink' | 'accent';

export interface HistoryRow {
  key: string;
  /** 'YYYY-MM-DD', or 'YYYY-MM' when only the month is known. */
  date: string;
  /** "EMI", "CARD BILL", "EXTRA", "PAYOFF", "SPENDING", "NEW RATE"… */
  type: string;
  /** "Personal loan", "HDFC credit card", "Spending", "Home loan → 9.10%". */
  target: string;
  planned?: string;
  actual?: string;
  status: string;
  tone: Tone;
  effect?: { text: string; tone: Tone };
  note?: string;
  /** Due this month and not logged yet. */
  pending?: boolean;
  /** What the row's buttons act on. */
  ref:
    | { kind: 'entry'; id: string; loanIndex: number }
    | {
        kind: 'due';
        loanIndex: number;
        /** What PAID records: the plan's payment, or the EMI or minimum. */
        amount: string;
        card: boolean;
        /** The EMI or card minimum inside `amount`, and the plan's extra. */
        minimum?: string;
        extra?: string;
        /** Raw profile minimum at render, used only to detect stale edits. */
        configuredMinimum?: string;
      }
    | { kind: 'spend'; month: string }
    | { kind: 'life'; id: string; due: boolean }
    | { kind: 'decision'; id: string; undoable: boolean }
    | { kind: 'cut'; id: string; held: boolean };
}

export interface MonthGroup {
  /** 'YYYY-MM' */
  month: string;
  /** 'OCT 2026' */
  label: string;
  current: boolean;
  rows: HistoryRow[];
}

/** "Personal loan", or "HDFC credit card" when the lender is on file. */
export { loanLabel };

/** "OCT 2026": a two-digit year ("OCT 26") read as the 26th. */
export function monthLabel(month: string): string {
  return `${MONTH_NAMES_SHORT[Number(month.slice(5, 7)) - 1].toUpperCase()} ${month.slice(0, 4)}`;
}

/** Loans with a payment due this month: open now, not a planned loan. */
export function openLoans(loans: LoanPayload[]): { loan: LoanPayload; index: number }[] {
  return loans
    .map((loan, index) => ({ loan, index }))
    .filter(({ loan }) => Number(loan.outstanding) > 0 && !(loan.planned_effective_month && loan.planned_effective_month > 1));
}

function entryRow(e: ActivityEntry, loan: LoanPayload, country: Country): HistoryRow {
  const ccy = loanCurrency(loan, country);
  const fmt = (v: string | number) => formatCurrencyWhole(Math.round(Number(v)), ccy);
  const card = loan.loan_type === 'credit_card';
  const { overdue, est, extra } = decorateEntry(e, loan, country);
  const planned = Number(e.scheduledEmi) > 0 ? fmt(e.scheduledEmi) : undefined;
  const notes: string[] = [];
  if (e.newOutstanding) notes.push(`balance now ${fmt(e.newOutstanding)}`);
  if (e.coversForwardMonths) notes.push(`covers ${e.coversForwardMonths} months${e.source ? ` · ${e.source.replace('-', ' ')}` : ''}`);
  else if (e.source) notes.push(e.source.replace('-', ' '));
  if (e.note) notes.push(e.note);
  const base = {
    key: e.id,
    date: e.date,
    target: loanLabel(loan),
    planned,
    actual: fmt(e.amount),
    note: notes.join(' · ') || undefined,
    ref: { kind: 'entry' as const, id: e.id, loanIndex: e.loanIndex },
  };
  const fee = est && est.total.gt(0) ? ` · FEE ~${fmt(est.total.toFixed(0))}` : '';
  switch (e.kind) {
    case 'paid_full':
      return { ...base, type: card ? 'CARD BILL' : 'EMI', status: 'PAID', tone: 'positive' };
    case 'paid_partial':
      return {
        ...base,
        type: card ? 'CARD BILL' : 'EMI',
        status: 'PART PAID',
        tone: 'negative',
        effect: Number(overdue) > 0 || fee ? { text: `+${fmt(overdue)} OWED${fee}`, tone: 'negative' } : undefined,
      };
    case 'missed':
      return {
        ...base,
        type: card ? 'CARD BILL' : 'EMI',
        status: 'MISSED',
        tone: 'negative',
        effect: { text: `+${fmt(overdue)} OWED${fee}`, tone: 'negative' },
      };
    case 'paid_extra':
      return {
        ...base,
        type: 'EXTRA',
        status: 'PAID',
        tone: 'positive',
        effect: Number(extra) > 0 ? { text: `−${fmt(extra)} OFF THE BALANCE`, tone: 'positive' } : undefined,
      };
    case 'closed':
      return { ...base, type: 'PAYOFF', status: 'PAID OFF', tone: 'positive', effect: { text: 'BALANCE → 0', tone: 'positive' } };
  }
}

export function buildHistory({
  user,
  entries,
  spend,
  life,
  decisions = [],
  cuts = [],
  today,
  planPay,
}: {
  user: UserPayload;
  entries: ActivityEntry[];
  spend: MonthlySpendEntry[];
  life: LifecycleEvent[];
  /** Plan choices (payoff order, emergency-fund share, goals…). */
  decisions?: PlanDecision[];
  /** Spending cuts committed to fund a goal (decision log, expense_commit). */
  cuts?: Recommendation[];
  /** 'YYYY-MM-DD' in the user's country. */
  today: string;
  /** This month's payment per loan from the plan (Home's Pay this month),
   *  so Activity asks for the same amount Home does. */
  planPay?: Record<number, { amount: number; minimum: number; extra: number }>;
}): MonthGroup[] {
  const thisMonth = today.slice(0, 7);
  const rows: HistoryRow[] = [];

  for (const e of entries) {
    const loan = user.loans[e.loanIndex];
    if (loan) rows.push(entryRow(e, loan, user.country));
  }

  // What's due this month and not logged yet.
  for (const { loan, index } of openLoans(user.loans)) {
    if (loan.first_emi_month && loan.first_emi_month > thisMonth) continue;
    if (entries.some((e) => e.loanIndex === index && e.date.slice(0, 7) === thisMonth &&
      (e.kind !== 'paid_extra' || Number(e.scheduledEmi) > 0))) continue;
    const card = loan.loan_type === 'credit_card';
    const amount = requiredMonthly(loan, user.country);
    if (amount.lte(0)) continue;
    const day = card && loan.due_day ? String(loan.due_day).padStart(2, '0') : null;
    const ccy = loanCurrency(loan, user.country);
    const plan = planPay?.[index];
    const hasPlan = plan && Number.isFinite(plan.amount) && plan.amount > 0 &&
      Number.isFinite(plan.minimum) && plan.minimum >= 0;
    const payment = hasPlan ? Math.round(plan.amount) : Math.round(amount.toNumber());
    const minimum = hasPlan ? Math.min(payment, Math.round(plan.minimum)) : Math.round(amount.toNumber());
    // The plan's own payment when it puts extra on this loan: Activity
    // said ₹4,000 for a card Home said to pay ₹80,500 on.
    const extra = Math.max(0, payment - minimum);
    rows.push({
      key: `due-${loan.id ?? index}`,
      date: day ? `${thisMonth}-${day}` : thisMonth,
      type: card ? 'CARD BILL' : 'EMI',
      target: loanLabel(loan),
      planned: formatCurrencyWhole(payment, ccy),
      status: 'TO PAY',
      tone: 'muted',
      note: extra > 0
        ? `${formatCurrencyWhole(minimum, ccy)} ${card ? 'minimum' : 'EMI'} + ${formatCurrencyWhole(extra, ccy)} extra, as on Home`
        : card ? (planPay ? 'the minimum; the plan has no extra for it this month' : 'the minimum; the plan may pay more') : undefined,
      pending: true,
      ref: hasPlan
        ? { kind: 'due', loanIndex: index, amount: String(payment), card,
            minimum: minimum.toFixed(2), configuredMinimum: amount.toFixed(2),
            ...(extra > 0 ? { extra: String(extra) } : {}) }
        : { kind: 'due', loanIndex: index, amount: amount.toFixed(2), card },
    });
  }

  // A month's spending, against what Profile says a month costs.
  const budget = Number(user.fixed_expenses || 0) + Number(user.variable_expenses || 0);
  const ccy = userDefaultCurrency(user.country);
  for (const [month, spent] of Object.entries(latestByMonth(spend))) {
    const over = budget > 0 ? spent - budget : 0;
    rows.push({
      key: `spend-${month}`,
      date: month,
      type: 'SPENDING',
      target: 'Spending',
      planned: budget > 0 ? formatCurrencyWhole(budget, ccy) : undefined,
      actual: formatCurrencyWhole(spent, ccy),
      status: budget <= 0 ? 'LOGGED' : over > 0 ? 'OVER' : 'WITHIN',
      tone: budget <= 0 ? 'ink' : over > 0 ? 'negative' : 'positive',
      effect: budget > 0 && over !== 0 ? { text: `${over > 0 ? '+' : '−'}${formatCurrencyWhole(Math.abs(over), ccy)} vs PLAN`, tone: over > 0 ? 'negative' : 'positive' } : undefined,
      ref: { kind: 'spend', month },
    });
  }

  // Life events once their date has come: happened, or waiting to be confirmed.
  for (const e of life) {
    if (e.status === 'cancelled' || e.effectiveDate > today) continue;
    const confirmed = e.status === 'confirmed';
    rows.push({
      key: `life-${e.id}`,
      date: e.effectiveDate,
      type: LIFE_KIND_LABEL[e.kind],
      target: lifeEventSummary(e, user),
      status: confirmed ? 'HAPPENED' : 'DID IT HAPPEN?',
      tone: confirmed ? 'positive' : 'accent',
      note: e.note,
      ref: { kind: 'life', id: e.id, due: !confirmed },
    });
  }

  // Plan choices. Life events already have their own rows.
  for (const d of decisions) {
    if (d.kind === 'lifecycle_event_added' || d.kind === 'lifecycle_event_confirmed') continue;
    const dm = d.impactDeltaMonths;
    rows.push({
      key: `decision-${d.id}`,
      date: localIsoDate(new Date(d.at)),
      type: 'PLAN',
      target: d.label,
      status: d.reverted ? 'UNDONE' : 'CHANGED',
      tone: d.reverted ? 'muted' : 'ink',
      effect:
        dm == null || d.reverted
          ? undefined
          : { text: dm === 0 ? 'DEBT-FREE: NO CHANGE' : `DEBT-FREE ${dm > 0 ? '+' : '−'}${Math.abs(dm)} MO`, tone: dm > 0 ? 'negative' : dm < 0 ? 'positive' : 'muted' },
      ref: { kind: 'decision', id: d.id, undoable: canUndoPlanDecision(d) && isWithinUndoWindow(d) },
    });
  }

  // Spending cuts made to fund a goal: did they hold?
  const stale = new Set(staleExpenseCommits(cuts).map((c) => c.id));
  for (const c of cuts) {
    if (c.kind !== 'expense_commit' || c.status === 'declined') continue;
    const meta = c.recommendation.metadata ?? {};
    const held = c.status === 'reconciled';
    rows.push({
      key: `cut-${c.id}`,
      date: localIsoDate(new Date(c.recommendedAt)),
      type: 'SPENDING CUT',
      target: c.recommendation.context,
      actual: `−${formatCurrencyWhole(Math.round(Number(meta.monthlyDelta ?? 0)), ccy)}/MO`,
      status: held ? 'HELD' : stale.has(c.id) ? 'STILL HOLDING?' : meta.effectiveMonth ? `FROM ${monthLabel(meta.effectiveMonth)}` : 'COMMITTED',
      tone: held ? 'positive' : stale.has(c.id) ? 'accent' : 'ink',
      note: c.recommendation.reasoning,
      ref: { kind: 'cut', id: c.id, held },
    });
  }

  const byMonth = new Map<string, HistoryRow[]>([[thisMonth, []]]);
  for (const r of rows) {
    const m = r.date.slice(0, 7);
    if (m > thisMonth) continue;
    if (!byMonth.has(m)) byMonth.set(m, []);
    byMonth.get(m)!.push(r);
  }
  return [...byMonth.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([month, list]) => ({
      month,
      label: monthLabel(month),
      current: month === thisMonth,
      // Due rows first (they want a tap), then newest first.
      rows: list.sort((a, b) => Number(!!b.pending) - Number(!!a.pending) || b.date.localeCompare(a.date)),
    }));
}
