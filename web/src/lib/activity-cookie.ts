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
 * Cookie has a hard 4KB browser limit. We cap to MAX_DELTAS most recent
 * entries to stay well under that.
 */
import Decimal from 'decimal.js';
import type { ActivityEntry } from './activity';
import { estimateLateFee } from './estimate-penalty';
import type { Country, LoanPayload } from './api';
import { overdueAmount, daysLate, extraPrincipal } from './activity';

const COOKIE_NAME = 'finoptima_activity_deltas';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
const MAX_DELTAS = 20;
// Version 2 added `principalReduction` and `closed` so server-side parsers
// know to ignore v1-only payloads if the shape changes. Old v1 payloads
// (missed/partial only) are still accepted as a subset of v2.
const CURRENT_VERSION = 2;

export interface ActivityDelta {
  /** 0-based index into the user's `loans`. */
  loanIndex: number;
  /** Unpaid principal+interest for this event, decimal string.
   *  Bumps outstanding UP. */
  overdue: string;
  /** Estimated penalty (flat + penal + GST), decimal string. Frozen at write
   *  time so server-side math is deterministic. Bumps outstanding UP. */
  penalty: string;
  /** Extra principal paid above the scheduled EMI for `paid_extra` events.
   *  Reduces outstanding. Decimal string, non-negative. */
  principalReduction?: string;
  /** Set when this delta represents a `closed` event — outstanding goes to
   *  zero regardless of the other fields. */
  closed?: boolean;
}

interface CookiePayload {
  v: number;
  deltas: ActivityDelta[];
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
): void {
  if (typeof document === 'undefined') return;

  const deltas: ActivityDelta[] = [];
  for (const e of entries) {
    if (e.kind === 'paid_full') continue;
    const loan = loans[e.loanIndex];
    if (!loan) continue;

    if (e.kind === 'closed') {
      deltas.push({
        loanIndex: e.loanIndex,
        overdue: '0',
        penalty: '0',
        closed: true,
      });
      if (deltas.length >= MAX_DELTAS) break;
      continue;
    }

    if (e.kind === 'paid_extra') {
      const extra = extraPrincipal(e);
      if (Number(extra) <= 0) continue;
      deltas.push({
        loanIndex: e.loanIndex,
        overdue: '0',
        penalty: '0',
        principalReduction: extra,
      });
      if (deltas.length >= MAX_DELTAS) break;
      continue;
    }

    // missed / paid_partial — outstanding bumps UP by overdue + penalty.
    const overdue = overdueAmount(e);
    let penalty: string;
    if (e.penaltyOverride && e.penaltyOverride.trim() !== '') {
      penalty = new Decimal(e.penaltyOverride).toFixed(2);
    } else {
      const est = estimateLateFee({
        loanType: loan.loan_type,
        country,
        bank: loan.bank,
        overdueAmount: overdue,
        daysLate: daysLate(e),
      });
      penalty = est.total.toFixed(2);
    }
    deltas.push({ loanIndex: e.loanIndex, overdue, penalty });
    if (deltas.length >= MAX_DELTAS) break;
  }

  const payload: CookiePayload = { v: CURRENT_VERSION, deltas };
  const encoded = encodeURIComponent(JSON.stringify(payload));
  document.cookie = `${COOKIE_NAME}=${encoded}; path=/; max-age=${COOKIE_MAX_AGE}; SameSite=Lax`;
}

export function clearActivityCookieClient(): void {
  if (typeof document === 'undefined') return;
  document.cookie = `${COOKIE_NAME}=; path=/; max-age=0; SameSite=Lax`;
}

// ─── Server read ───────────────────────────────────────────────────────────

export async function loadActivityDeltasServer(): Promise<ActivityDelta[]> {
  const { cookies } = await import('next/headers');
  const raw = cookies().get(COOKIE_NAME)?.value;
  if (!raw) return [];
  try {
    const parsed: CookiePayload = JSON.parse(decodeURIComponent(raw));
    // Accept v1 (missed/partial only) and v2 (adds paid_extra/closed) — older
    // browsers may still be carrying a v1 cookie until the next mutation.
    if (parsed?.v !== 1 && parsed?.v !== CURRENT_VERSION) return [];
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
): DeltaApplication {
  const perLoan = new Map<number, { bump: Decimal; count: number; closed: boolean }>();
  for (const d of deltas) {
    if (d.loanIndex < 0 || d.loanIndex >= loans.length) continue;
    const overdue = new Decimal(d.overdue || 0);
    const penalty = new Decimal(d.penalty || 0);
    const reduction = new Decimal(d.principalReduction || 0);
    const cur = perLoan.get(d.loanIndex) ?? {
      bump: new Decimal(0),
      count: 0,
      closed: false,
    };
    cur.bump = cur.bump.add(overdue).add(penalty).sub(reduction);
    cur.count += 1;
    if (d.closed) cur.closed = true;
    perLoan.set(d.loanIndex, cur);
  }

  const adjusted = loans.map((loan, i) => {
    const entry = perLoan.get(i);
    if (!entry) return loan;
    if (entry.closed) {
      return { ...loan, outstanding: '0' };
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
    entryCount: deltas.length,
  };
}
