/**
 * Activity → cookie sync layer.
 *
 * The full activity ledger lives in localStorage (unbounded, per-tab). The
 * /plan page renders server-side, so it can't read localStorage. We
 * compress the projection-relevant subset (missed + partial events) into a
 * cookie so the server can apply the deltas before the engine simulates.
 *
 * Wire model:
 *   • Client writes activity → also writes this cookie via `syncActivityCookieClient`.
 *   • Server renders /plan → reads via `loadActivityDeltasServer`.
 *   • Engine sees a `user.loans` whose outstandings are bumped by
 *     `overdue + penalty` per logged event.
 *
 * Penalty is frozen at log-time. We accept that a slow user (logs miss in
 * April, opens /plan in June) gets a ~2-month-stale penal-interest figure;
 * indicative defaults already carry more error than that, and freezing
 * keeps server math idempotent (same cookie → same simulation every time).
 *
 * The cookie holds one total per loan, not one line per entry: it used to
 * keep the 20 newest entries, so the 21st extra payment stopped moving the
 * plan while Activity still listed it. Loans are named by id (with their
 * position as a fallback), so removing a loan can't move another's totals.
 * The JSON is lz-string compressed: fifty loans fit well inside 4 KB.
 */
import Decimal from 'decimal.js';
import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from 'lz-string';
import type { ActivityEntry } from './activity';
import { estimateLateFee } from './estimate-penalty';
import { explainMinPayment } from './min-payment';
import type { Country, LoanPayload } from './api';
import { paymentState } from './payment-state';
import { overdueAmount, daysLate, extraPrincipal, readActivityClient } from './activity';
import { alignToLoans, resolveLoanIndex } from './loan-ids';
import { localIsoDate, getCountryToday } from './today';
import { monthsBefore, paceMonths, type PaceMonth } from './pace';

const COOKIE_NAME = 'rightdue_activity_deltas';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
// v4 adds the reported balance anchor. The compressed z3 envelope stays
// readable across upgrades; v1-v3 payloads migrate on the next save.
const CURRENT_VERSION = 4;
const COMPRESSED = 'z3.';

export interface ActivityDelta {
  /** 0-based index into the user's `loans` when the cookie was written. */
  loanIndex: number;
  /** The loan's stable id; wins over `loanIndex` when the loans have ids. */
  loanId?: string;
  /** How many activity entries this delta sums (1 in a v1/v2 cookie). */
  count?: number;
  /** Unpaid principal+interest for this event, decimal string.
   *  Bumps outstanding UP. */
  overdue: string;
  /** Estimated penalty (flat + penal + GST), decimal string. Frozen at write
   *  time so server-side math is deterministic. Bumps outstanding UP. */
  penalty: string;
  /** Extra principal paid above the scheduled EMI for `paid_extra` events.
   *  Reduces outstanding. Decimal string, non-negative. */
  principalReduction?: string;
  /** This month's planned extra, marked paid on Home: the plan's first
   *  month already pays it, so it comes off the balance only after
   *  `month` ("2026-10") is over. */
  deferred?: { month: string; amount: string };
  /** Set when this delta represents a `closed` event — outstanding goes to
   *  zero regardless of the other fields. */
  closed?: boolean;
  /** Card-only: user-reported new outstanding after the payment posted.
   *  When set, /plan re-anchors the loan's outstanding to this value
   *  before simulating — wins over the original onboarding figure +
   *  any other deltas for the same loan. Carries the most-recent
   *  override only (older ones get filtered when this is set). */
  balanceOverride?: string;
  /** Identity of the reported balance this aggregate was computed against. */
  balanceAnchor?: string;
}

interface CookiePayload {
  v: number;
  deltas: ActivityDelta[];
  /** What was logged on each loan in the last three months (lib/pace). */
  pace?: PaceMonth[];
  /** UX fix 4: this month's EMIs marked paid in Activity (loan ids, else
   *  positions), so the engine's owed_today is the balance Home shows. */
  paidNow?: { month: string; loans: (string | number)[] };
}

/** EMI loans whose payment for `month` is marked paid (as Home reads it,
 *  lib/owed-now): ids where the loans have them, else positions. */
export function paidEmisMarked(entries: ActivityEntry[], loans: LoanPayload[], month: string): (string | number)[] {
  const aligned = alignToLoans(entries, loans);
  return loans.flatMap((loan, i) => {
    const emi = Number(loan.scheduled_emi) || 0;
    const owed = Number(loan.outstanding) || 0;
    if (loan.loan_type === 'credit_card' || !(emi > 0) || !(owed > 0) || (loan.first_emi_month && loan.first_emi_month > month)) return [];
    const mine = aligned.filter((e) => e.loanIndex === i && e.date.slice(0, 7) === month);
    const minimum = Math.min(emi, owed * (1 + (Number(loan.nominal_rate) || 0) / 12));
    const state = paymentState(mine, minimum, emi);
    return state === 'paid' || state === 'emi_paid' ? [loan.id ?? i] : [];
  });
}

// ─── Client write ──────────────────────────────────────────────────────────

/**
 * Recompute the cookie payload from the current localStorage entries +
 * the user's loans (needed to compute penalty estimates). Call this
 * after every activity mutation.
 */
export function syncActivityCookieClient(
  entries: ActivityEntry[],
  loans: LoanPayload[],
  country: Country,
  notify = true,
): boolean {
  if (typeof document === 'undefined') return false;
  const thisMonth = localIsoDate(getCountryToday(country)).slice(0, 7);
  const pace = paceMonths(entries, loans, thisMonth);
  const payload: CookiePayload = {
    v: CURRENT_VERSION,
    deltas: activityDeltas(entries, loans, country),
    ...(pace.some((m) => m.paid.length > 0) ? { pace } : {}),
  };
  const paidNow = paidEmisMarked(entries, loans, thisMonth);
  if (paidNow.length > 0) payload.paidNow = { month: thisMonth, loans: paidNow };
  const encoded = COMPRESSED + compressToEncodedURIComponent(JSON.stringify(payload));
  document.cookie = `${COOKIE_NAME}=${encoded}; path=/; max-age=${COOKIE_MAX_AGE}; SameSite=Lax`;
  const saved = document.cookie.match(/(?:^|; )rightdue_activity_deltas=([^;]*)/)?.[1] === encoded;
  if (saved && notify) window.dispatchEvent(new Event('rightdue:profile-changed'));
  return saved;
}

/** Each loan's net effect from its activity entries (newest first): overdue
 *  and penalties from missed or short payments, principal from extra
 *  payments, whether it was closed, and the newest reported card balance.
 *  One delta per loan with any effect, however many entries it has. */
export function activityDeltas(
  entries: ActivityEntry[],
  loans: LoanPayload[],
  country: Country,
  now: Date = new Date(),
): ActivityDelta[] {
  const thisMonth = localIsoDate(getCountryToday(country, now)).slice(0, 7);
  // Entries point at their loan's current position (by id), so a loan
  // removed in Setup takes its entries with it instead of passing them on.
  const aligned = alignToLoans(entries, loans).slice().sort((a,b) => b.date.localeCompare(a.date) || b.loggedAt.localeCompare(a.loggedAt));
  const anchored = new Set<number>();
  const byLoan = new Map<
    number,
    {
      overdue: Decimal;
      penalty: Decimal;
      reduction: Decimal;
      deferred: Decimal;
      closed: boolean;
      balanceOverride?: string;
      count: number;
    }
  >();
  const acc = (i: number) => {
    let cur = byLoan.get(i);
    if (!cur) {
      cur = {
        overdue: new Decimal(0),
        penalty: new Decimal(0),
        reduction: new Decimal(0),
        deferred: new Decimal(0),
        closed: false,
        count: 0,
      };
      byLoan.set(i, cur);
    }
    return cur;
  };

  for (const e of aligned) {
    const loan = loans[e.loanIndex];
    if (!loan || anchored.has(e.loanIndex)) continue;
    // A newly entered statement includes every earlier payment. Keep the
    // history, but apply only activity after that statement's balance.
    const asOf = loan.balance_as_of?.slice(0,10);
    if (asOf && /^\d{4}-\d{2}-\d{2}$/.test(asOf)) {
      if (e.date < asOf) continue;
      if (e.date === asOf && loan.balance_recorded_at && Date.parse(e.loggedAt) <= Date.parse(loan.balance_recorded_at)) continue;
    }

    // Card only: the newest reported balance after a payment re-anchors the
    // card's outstanding. Entries arrive newest-first, so the first wins.
    if (
      loan.loan_type === 'credit_card' &&
      e.newOutstanding !== undefined &&
      e.newOutstanding.trim() !== '' &&
      acc(e.loanIndex).balanceOverride === undefined
    ) {
      acc(e.loanIndex).balanceOverride = e.newOutstanding;
      anchored.add(e.loanIndex);
      continue; // This balance already includes this payment and every older entry.
    }

    if (e.kind === 'paid_full') continue;

    if (e.kind === 'closed') {
      const cur = acc(e.loanIndex);
      cur.closed = true;
      cur.count += 1;
      continue;
    }

    if (e.kind === 'paid_extra') {
      const extra = new Decimal(extraPrincipal(e));
      if (extra.lte(0)) continue;
      const cur = acc(e.loanIndex);
      // The plan's own extra this month (marked paid on Home) is already in
      // the plan's first month; it comes off the balance next month. Any
      // more than that was paid on top, and counts now.
      const planned =
        e.plannedExtra && e.date.slice(0, 7) === thisMonth
          ? Decimal.min(extra, Decimal.max(0, new Decimal(e.plannedExtra || 0)))
          : new Decimal(0);
      cur.reduction = cur.reduction.add(extra.sub(planned));
      cur.deferred = cur.deferred.add(planned);
      cur.count += 1;
      continue;
    }

    // missed / paid_partial.
    //
    // Amortizing loans: "minimum" = scheduled EMI. Anything less is
    // delinquent, and the unpaid portion (overdue) compounds onto
    // outstanding alongside penal interest.
    //
    // Credit cards: "minimum" = bank-formula % of outstanding (see
    // explainMinPayment). Paying ≥ minimum keeps the account current —
    // revolving interest accrues but there's no overdue principal and
    // no penalty. Paying < minimum triggers late fee + penal interest
    // on the (minimum − paid) shortfall. The unpaid portion isn't
    // overdue principal either — it's just next month's balance.
    let overdue: string;
    let shortfallForPenalty: string;
    if (loan.loan_type === 'credit_card') {
      const minHint = explainMinPayment(loan, country);
      const recordedMinimum = new Decimal(e.scheduledEmi || '0');
      const minPayable = recordedMinimum.gt(0) ? recordedMinimum : new Decimal(minHint?.estimated ?? loan.scheduled_emi);
      const paid = new Decimal(e.kind === 'missed' ? '0' : e.amount || '0');
      if (paid.gte(minPayable)) continue; // paid above min: no delta
      overdue = '0';
      shortfallForPenalty = minPayable.sub(paid).toFixed(2);
    } else {
      overdue = overdueAmount(e);
      shortfallForPenalty = overdue;
    }
    let penalty: string;
    if (e.penaltyOverride && e.penaltyOverride.trim() !== '') {
      penalty = new Decimal(e.penaltyOverride).toFixed(2);
    } else {
      const est = estimateLateFee({
        loanType: loan.loan_type,
        country,
        bank: loan.bank,
        overdueAmount: shortfallForPenalty,
        daysLate: daysLate(e),
      });
      penalty = est.total.toFixed(2);
    }
    const cur = acc(e.loanIndex);
    cur.overdue = cur.overdue.add(overdue);
    cur.penalty = cur.penalty.add(penalty);
    cur.count += 1;
  }

  const deltas: ActivityDelta[] = [];
  for (const [loanIndex, t] of byLoan) {
    deltas.push({
      loanIndex,
      balanceAnchor: loanBalanceAnchor(loans[loanIndex]),
      ...(loans[loanIndex]?.id ? { loanId: loans[loanIndex].id } : {}),
      count: t.count,
      overdue: t.overdue.toFixed(2),
      penalty: t.penalty.toFixed(2),
      ...(t.reduction.gt(0) ? { principalReduction: t.reduction.toFixed(2) } : {}),
      ...(t.deferred.gt(0) ? { deferred: { month: thisMonth, amount: t.deferred.toFixed(2) } } : {}),
      ...(t.closed ? { closed: true } : {}),
      ...(t.balanceOverride !== undefined ? { balanceOverride: t.balanceOverride } : {}),
    });
  }
  return deltas;
}

/** Re-writes the cookie when the month has turned since it was written,
 *  so the plan's pace covers the months just gone (or when it was written
 *  before it carried them). True when it changed. */
export function refreshActivityCookieClient(loans: LoanPayload[], country: Country): boolean {
  if (typeof document === 'undefined') return false;
  const entries = readActivityClient();
  if (entries.length === 0) return false;
  const raw = document.cookie.match(/(?:^|; )rightdue_activity_deltas=([^;]*)/)?.[1] ?? '';
  const pace = raw ? parseActivityPace(raw) : [];
  const lastMonth = monthsBefore(localIsoDate(getCountryToday(country)).slice(0, 7), 1)[0];
  if (pace.length > 0 && pace[pace.length - 1].month === lastMonth) return false;
  const before = raw;
  syncActivityCookieClient(alignToLoans(entries, loans), loans, country, false);
  return (document.cookie.match(/(?:^|; )rightdue_activity_deltas=([^;]*)/)?.[1] ?? '') !== before;
}

// ─── Server read ───────────────────────────────────────────────────────────

export async function loadActivityDeltasServer(): Promise<ActivityDelta[]> {
  const { cookies } = await import('next/headers');
  const raw = (await cookies()).get(COOKIE_NAME)?.value;
  if (!raw) return [];
  return parseActivityDeltas(raw);
}

/** The last three months as logged (lib/pace), for the plan's pace. */
export async function loadActivityPaceServer(): Promise<PaceMonth[]> {
  const { cookies } = await import('next/headers');
  const raw = (await cookies()).get(COOKIE_NAME)?.value;
  return raw ? parseActivityPace(raw) : [];
}

/** UX fix 4: positions in `loans` whose EMI for `month` is marked paid. */
export async function loadPaidNowServer(loans: LoanPayload[], month: string): Promise<number[]> {
  const { cookies } = await import('next/headers');
  const raw = (await cookies()).get(COOKIE_NAME)?.value;
  return raw ? parsePaidNow(raw, loans, month) : [];
}

export function parsePaidNow(raw: string, loans: LoanPayload[], month: string): number[] {
  try {
    if (!raw.startsWith(COMPRESSED)) return [];
    const p: CookiePayload = JSON.parse(decompressFromEncodedURIComponent(raw.slice(COMPRESSED.length)) ?? '');
    if (p?.paidNow?.month !== month || !Array.isArray(p.paidNow.loans)) return [];
    const marked = new Set(p.paidNow.loans);
    return loans.flatMap((l, i) => (marked.has(l.id ?? i) ? [i] : []));
  } catch {
    return [];
  }
}

export function parseActivityPace(raw: string): PaceMonth[] {
  try {
    if (!raw.startsWith(COMPRESSED)) return [];
    const parsed: CookiePayload = JSON.parse(decompressFromEncodedURIComponent(raw.slice(COMPRESSED.length)) ?? '');
    if (!Array.isArray(parsed?.pace)) return [];
    return parsed.pace.filter(
      (m) => typeof m?.month === 'string' && typeof m?.complete === 'boolean' && Array.isArray(m?.paid),
    );
  } catch {
    return [];
  }
}

/** The deltas in a cookie value: v3 (compressed, per loan) or the older
 *  per-entry v1/v2 JSON. Empty when it can't be read. */
export function parseActivityDeltas(raw: string): ActivityDelta[] {
  try {
    const parsed: CookiePayload = raw.startsWith(COMPRESSED)
      ? JSON.parse(decompressFromEncodedURIComponent(raw.slice(COMPRESSED.length)) ?? '')
      : JSON.parse(decodeURIComponent(raw));
    // Accept v1 (missed/partial only) and v2 (adds paid_extra/closed) — older
    // browsers may still be carrying one until the next mutation.
    if (parsed?.v !== 1 && parsed?.v !== 2 && parsed?.v !== 3 && parsed?.v !== CURRENT_VERSION) return [];
    if (!Array.isArray(parsed.deltas)) return [];
    return parsed.deltas.filter(
      (d) =>
        typeof d?.loanIndex === 'number' &&
        typeof d?.overdue === 'string' &&
        typeof d?.penalty === 'string',
    );
  } catch {
    return [];
  }
}

// ─── Engine helper ─────────────────────────────────────────────────────────

export interface DeltaApplication {
  /** Adjusted loans with outstandings bumped per deltas. */
  loans: LoanPayload[];
  /** Per-loan summary of how much was bumped, for the banner UI. */
  perLoanBumps: { loanIndex: number; totalBump: string; entryCount: number }[];
  /** Total currency bump across all loans. */
  totalBump: string;
  /** How many activity entries contributed. */
  entryCount: number;
}

/**
 * Returns a copy of `loans` with `outstanding` adjusted by the net delta per
 * loan:
 *   • missed / partial bump UP by overdue + penalty
 *   • paid_extra bumps DOWN by principalReduction
 *   • closed forces outstanding to 0
 *
 * Outstanding is floored at 0 — extras beyond what's owed are clamped (rather
 * than going negative, which would crash the engine). The original array is
 * left unchanged so the caller can still surface the user's reported numbers.
 */
export function applyActivityDeltas(
  loans: LoanPayload[],
  deltas: ActivityDelta[],
  /** The current month, "2026-10" (the server passes the user's country's);
   *  a deferred extra counts once this is past its month. */
  month: string = localIsoDate(new Date()).slice(0, 7),
): DeltaApplication {
  const perLoan = new Map<
    number,
    { bump: Decimal; count: number; closed: boolean; balanceOverride: string | null }
  >();
  let entryCount = 0;
  for (const raw of deltas) {
    // By id when the delta and the loans have them: a loan removed since
    // the cookie was written matches nothing rather than its neighbour.
    const d = { ...raw, loanIndex: resolveLoanIndex(raw, loans) };
    if (d.loanIndex < 0) continue;
    if (d.balanceAnchor !== undefined && d.balanceAnchor !== loanBalanceAnchor(loans[d.loanIndex])) continue;
    entryCount += d.count ?? 1;
    const overdue = new Decimal(d.overdue || 0);
    const penalty = new Decimal(d.penalty || 0);
    const deferred =
      typeof d.deferred?.month === 'string' && d.deferred.month < month ? d.deferred.amount : 0;
    const reduction = new Decimal(d.principalReduction || 0).add(deferred || 0);
    const cur = perLoan.get(d.loanIndex) ?? {
      bump: new Decimal(0),
      count: 0,
      closed: false,
      balanceOverride: null as string | null,
    };
    cur.bump = cur.bump.add(overdue).add(penalty).sub(reduction);
    cur.count += d.count ?? 1;
    if (d.closed) cur.closed = true;
    // First override wins (deltas are emitted newest-first by syncActivityCookieClient).
    if (d.balanceOverride !== undefined && cur.balanceOverride === null) {
      cur.balanceOverride = d.balanceOverride;
    }
    perLoan.set(d.loanIndex, cur);
  }

  const adjusted = loans.map((loan, i) => {
    const entry = perLoan.get(i);
    if (!entry) return loan;
    if (entry.closed) {
      return { ...loan, outstanding: '0' };
    }
    // Explicit balance override wins over the bump-from-onboarding logic
    // for credit cards. The user's reported post-payment balance is the
    // most accurate ground truth we have.
    if (entry.balanceOverride !== null) {
      return { ...loan, outstanding: Decimal.max(0, new Decimal(entry.balanceOverride).add(entry.bump)).toFixed(2) };
    }
    if (entry.bump.eq(0)) return loan;
    const next = new Decimal(loan.outstanding || 0).add(entry.bump);
    const clamped = next.lt(0) ? new Decimal(0) : next;
    return { ...loan, outstanding: clamped.toFixed(2) };
  });

  let totalBump = new Decimal(0);
  const perLoanBumps: DeltaApplication['perLoanBumps'] = [];
  for (const [idx, { bump, count, closed }] of perLoan.entries()) {
    if (!closed && bump.eq(0)) continue;
    totalBump = totalBump.add(bump);
    perLoanBumps.push({
      loanIndex: idx,
      totalBump: bump.toFixed(2),
      entryCount: count,
    });
  }
  perLoanBumps.sort((a, b) => Math.abs(Number(b.totalBump)) - Math.abs(Number(a.totalBump)));

  return {
    loans: adjusted,
    perLoanBumps,
    totalBump: totalBump.toFixed(2),
    entryCount,
  };
}

function loanBalanceAnchor(loan: LoanPayload): string {
  return JSON.stringify([loan.balance_as_of ?? null,loan.balance_recorded_at ?? null]);
}
