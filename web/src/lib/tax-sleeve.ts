'use client';

/**
 * Tax sleeve — virtual reserve for users whose tax isn't fully handled
 * by employer TDS. Phase 4 of the cash module.
 *
 * Who needs it
 *   • Business owners / freelancers — pay advance tax themselves on
 *     Jun 15 / Sep 15 / Dec 15 / Mar 15 (India) or Apr / Jun / Sep / Jan
 *     (US estimates).
 *   • Salaried users with non-TDS income — rental, FD interest > ₹40k,
 *     capital gains, freelance side-income. They opt in via
 *     `user.extra_income_annual_tax` at onboarding.
 *
 * What this slice tracks
 *   • Per-installment "paid" booleans (4 per fiscal year).
 *   • The most-recent installment cycle the user has acknowledged so
 *     prior years' flags don't bleed into the current banner.
 *
 * What it doesn't do (yet)
 *   • Actual money movement — there's no "transfer to sleeve account"
 *     button. The card is a calculator + reminder. Phase 5 (advisor)
 *     can wire physical sub-accounts into cash_accounts if needed.
 *
 * Render path: TaxSleeveCard on /debts pulls `computeAnnualTax`
 * from tax-bracket.ts for the target, walks `installmentSchedule` for
 * the next due date, and renders progress against this slice's paid set.
 */

import { syncSliceToServer } from './server-sync';
import type { Country, UserPayload } from './api';
import { computeAnnualTax } from './tax-brackets';

export type InstallmentKey =
  | 'IN-Q1' | 'IN-Q2' | 'IN-Q3' | 'IN-Q4'
  | 'US-Q1' | 'US-Q2' | 'US-Q3' | 'US-Q4';

export interface InstallmentInfo {
  key: InstallmentKey;
  /** Calendar date for the installment, in the relevant fiscal year. */
  dueDate: Date;
  /** Cumulative percentage of annual tax that must be paid BY this date. */
  cumulativePct: number;
  label: string;
}

export interface TaxSleeveSlice {
  /** "YYYY-Qn" keys marking installments the user has reported as paid. */
  paidInstallments: string[];
}

const STORAGE_KEY = 'rightdue_tax_sleeve';
const EMPTY: TaxSleeveSlice = { paidInstallments: [] };

// ─── Read / write ──────────────────────────────────────────────────────────

export function readTaxSleeveClient(): TaxSleeveSlice {
  if (typeof localStorage === 'undefined') return EMPTY;
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return EMPTY;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.paidInstallments)) return EMPTY;
    return parsed as TaxSleeveSlice;
  } catch {
    return EMPTY;
  }
}

export function writeTaxSleeveClient(slice: TaxSleeveSlice): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(slice));
  void syncSliceToServer('tax_sleeve', slice);
}

export function markInstallmentPaid(
  slice: TaxSleeveSlice,
  paidKey: string,
): TaxSleeveSlice {
  if (slice.paidInstallments.includes(paidKey)) return slice;
  const next: TaxSleeveSlice = {
    ...slice,
    paidInstallments: [...slice.paidInstallments, paidKey],
  };
  writeTaxSleeveClient(next);
  return next;
}

export function unmarkInstallmentPaid(
  slice: TaxSleeveSlice,
  paidKey: string,
): TaxSleeveSlice {
  if (!slice.paidInstallments.includes(paidKey)) return slice;
  const next: TaxSleeveSlice = {
    ...slice,
    paidInstallments: slice.paidInstallments.filter((k) => k !== paidKey),
  };
  writeTaxSleeveClient(next);
  return next;
}

// ─── Advance-tax schedule ──────────────────────────────────────────────────

/** India advance-tax schedule. Dates are calendar months 1-indexed. */
const IN_SCHEDULE: { key: InstallmentKey; month: number; day: number; cumPct: number; label: string }[] = [
  { key: 'IN-Q1', month: 6,  day: 15, cumPct: 0.15, label: 'June 15' },
  { key: 'IN-Q2', month: 9,  day: 15, cumPct: 0.45, label: 'September 15' },
  { key: 'IN-Q3', month: 12, day: 15, cumPct: 0.75, label: 'December 15' },
  { key: 'IN-Q4', month: 3,  day: 15, cumPct: 1.00, label: 'March 15' },
];

/** US estimated-tax schedule. The Jan 15 installment closes the PRIOR
 *  tax year — we still treat it as part of the current fiscal cycle for
 *  reminder purposes. */
const US_SCHEDULE: { key: InstallmentKey; month: number; day: number; cumPct: number; label: string }[] = [
  { key: 'US-Q1', month: 4,  day: 15, cumPct: 0.25, label: 'April 15' },
  { key: 'US-Q2', month: 6,  day: 15, cumPct: 0.50, label: 'June 15' },
  { key: 'US-Q3', month: 9,  day: 15, cumPct: 0.75, label: 'September 15' },
  { key: 'US-Q4', month: 1,  day: 15, cumPct: 1.00, label: 'January 15' },
];

/**
 * Build the schedule of installments relevant to `today`. Each entry's
 * `dueDate` is computed to the next future occurrence (or today's, if
 * not yet past). Used by the card to pick "next" and to render the
 * cumulative-paid progress bar.
 */
export function installmentSchedule(
  country: Country,
  today: Date = new Date(),
): InstallmentInfo[] {
  const base = country === 'IN' ? IN_SCHEDULE : US_SCHEDULE;
  return base.map((row) => {
    let year = today.getFullYear();
    // If the cutoff has passed this calendar year, roll to next year.
    const cutoff = new Date(year, row.month - 1, row.day);
    if (cutoff.getTime() < today.getTime() - 24 * 3600 * 1000) {
      year += 1;
    }
    return {
      key: row.key,
      dueDate: new Date(year, row.month - 1, row.day),
      cumulativePct: row.cumPct,
      label: row.label,
    };
  });
}

/** Soonest unpaid installment as of `today`, or null if all paid. */
export function nextInstallment(
  slice: TaxSleeveSlice,
  country: Country,
  today: Date = new Date(),
): InstallmentInfo | null {
  const schedule = installmentSchedule(country, today);
  for (const inst of schedule.sort(
    (a, b) => a.dueDate.getTime() - b.dueDate.getTime(),
  )) {
    const cycleKey = `${inst.dueDate.getFullYear()}-${inst.key}`;
    if (!slice.paidInstallments.includes(cycleKey)) {
      return inst;
    }
  }
  return null;
}

export function cycleKey(inst: InstallmentInfo): string {
  return `${inst.dueDate.getFullYear()}-${inst.key}`;
}

export function daysUntil(date: Date, today: Date = new Date()): number {
  const ms = date.getTime() - today.getTime();
  return Math.ceil(ms / (24 * 3600 * 1000));
}

// ─── Annual tax target derivation ──────────────────────────────────────────

/**
 * The annual tax liability the sleeve should cover. Returns null when
 * the user doesn't need a sleeve — pure salaried with no extra income
 * is handled by employer TDS.
 *
 * Computation
 *   • If income_streams are populated → sum non-TDS liability across
 *     active streams (gross_annual × marginal × (1 − tds_pct)). Streams
 *     model concurrent sources + transitions; this is the right surface
 *     when the user has multiple income types or has switched roles.
 *   • Business owners (legacy): full estimated tax on annual_business_income.
 *   • Salaried with extra income (legacy): user-stated `extra_income_annual_tax`.
 *   • Anyone else: null.
 */
export function sleeveAnnualTarget(user: UserPayload): number | null {
  // Income streams take precedence when present — they're the more
  // accurate surface (concurrent sources + transitions).
  const streams = user.income_streams ?? [];
  if (streams.length > 0) {
    // Inline derivation to avoid a circular import; streams library
    // depends on api types via type-only imports, but the engine math
    // for marginal rate uses these helpers.
    let liability = 0;
    const now = Date.now();
    for (const s of streams) {
      const start = Date.parse(s.start_date.length === 7 ? `${s.start_date}-01` : s.start_date);
      if (!Number.isFinite(start) || start > now) continue;
      if (s.end_date) {
        const end = Date.parse(s.end_date.length === 7 ? `${s.end_date}-01` : s.end_date);
        if (Number.isFinite(end) && end < now) continue;
      }
      // Salary tax is deducted by the employer (TDS); only non-TDS income needs a sleeve.
      if (s.kind === 'salaried') continue;
      const gross = Number(s.gross_annual || 0);
      const tds = Number(s.tds_pct || 0);
      // We don't have marginal_rate on the user payload directly — it's
      // a top-level cookie. For sleeve target we approximate with a
      // bracket-derived rate via computeAnnualTax for salaried/business
      // archetypes; for other kinds we use a conservative 30% so the
      // user isn't under-sleeving.
      const marg =
        s.kind === 'business_owner' || s.kind === 'freelance' || s.kind === 'rental'
          ? 0.3
          : s.kind === 'capital_gains'
            ? 0.2
            : 0.3;
      liability += gross * marg * (1 - tds);
    }
    if (liability <= 0) return null;
    return Math.round(liability);
  }

  if (user.income_type === 'business_owner') {
    const gross = Number(user.annual_business_income || 0);
    if (gross <= 0) return null;
    const tax = computeAnnualTax(
      user.country,
      user.tax_regime ?? null,
      'business_owner',
      gross,
      user.filing_status,
    );
    return Number(tax.toString());
  }
  // Salaried path — extra income tax is the user-stated number.
  const extra = Number(user.extra_income_annual_tax || 0);
  if (extra <= 0) return null;
  return extra;
}
