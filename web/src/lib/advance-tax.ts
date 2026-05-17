/**
 * Advance-tax / estimated-tax quarterly schedule.
 *
 * India (Section 208): 4 instalments per FY (FY runs Apr-Mar).
 *   • 15 Jun — 15% cumulative
 *   • 15 Sep — 45% cumulative
 *   • 15 Dec — 75% cumulative
 *   • 15 Mar — 100% cumulative
 *   • Threshold: liability > ₹10,000 after TDS.
 *   • Penalty: Sec 234C (1%/mo per missed quarter) + Sec 234B
 *     (1%/mo on year-end shortfall when total < 90% of assessed).
 *
 * US (Form 1040-ES): 4 instalments per tax year (Jan-Dec).
 *   • 15 Apr — 25% cumulative
 *   • 15 Jun — 50% cumulative  (yes, only 2 months later — IRS quirk)
 *   • 15 Sep — 75% cumulative
 *   • 15 Jan (next yr) — 100% cumulative
 *   • Threshold: owing > $1,000 after withholding.
 *   • Penalty: Form 2210, federal short-term rate + 3% ≈ 8% APR.
 *
 * "Partial mark-paid" is supported: governments accept any amount toward
 * an instalment; shortfall just rolls forward and accrues 234C / 2210.
 */
import Decimal from 'decimal.js';
import type { Country } from './api';

export type AdvanceTaxStatus = 'pending' | 'paid' | 'missed';

export interface AdvanceTaxInstalment {
  /** ISO date string (YYYY-MM-DD). */
  dueDate: string;
  /** 1-based instalment number within the fiscal year (1..4). */
  ordinal: number;
  /** Cumulative percentage of annual liability due BY this instalment.
   *  e.g. India Q2 = 45%, US Q1 = 25%. */
  cumulativePct: number;
  /** Currency-native amount due AT this instalment (cumulative target
   *  minus what should have already been paid by the prior instalment). */
  amountDue: string;
  status: AdvanceTaxStatus;
  /** Actual amount paid against this instalment. Empty / '0' when status
   *  is 'pending' or 'missed'. May be less than amountDue (partial). */
  paidAmount?: string;
  /** ISO date the user marked the instalment paid. */
  paidOn?: string;
}

export interface AdvanceTaxSchedule {
  /** Country whose rules generated this schedule. */
  country: Country;
  /** Fiscal year label, e.g. "FY 2026-27" (IN) or "TY 2026" (US). */
  fiscalYearLabel: string;
  /** Estimated full-year tax liability used to compute amountDue values. */
  annualLiability: string;
  /** Schedule entries, ordered by dueDate. */
  instalments: AdvanceTaxInstalment[];
}

// ─── Schedule generation ────────────────────────────────────────────────────

/**
 * Builds the current-FY (India) or current-TY (US) schedule starting from
 * the next due date relative to `today`. Past instalments are skipped —
 * they're already on the books (paid or missed) at engine-call time and
 * the user can't change history through this flow.
 *
 * The total annualLiability is split using the cumulativePct table; each
 * instalment carries the *delta* (not the cumulative target) so callers
 * don't have to walk the prior-due-amount themselves.
 */
export function buildSchedule(
  country: Country,
  annualLiability: Decimal,
  today: Date,
): AdvanceTaxSchedule | null {
  if (annualLiability.lte(0)) return null;

  const allInstalments =
    country === 'IN' ? indiaSchedule(today) : usSchedule(today);

  // Filter to upcoming (today or later). Past ones are out of scope
  // for the generator; existing cookie state owns their status.
  const todayIso = today.toISOString().slice(0, 10);
  const upcoming = allInstalments.filter((i) => i.dueDate >= todayIso);
  if (upcoming.length === 0) return null;

  // Compute amountDue per instalment from cumulative-pct table.
  // Cumulative target at instalment K = annualLiability × cumulativePct[K].
  // amountDue at K = (cumulativeTarget[K] − cumulativeTarget[K-1]).
  let priorCumulative = new Decimal(0);
  const filledInstalments: AdvanceTaxInstalment[] = upcoming.map((i) => {
    const cumulativeAmount = annualLiability.mul(i.cumulativePct).div(100);
    const delta = cumulativeAmount.sub(priorCumulative);
    priorCumulative = cumulativeAmount;
    return {
      ...i,
      amountDue: delta.toFixed(0),
      status: 'pending' as const,
    };
  });

  return {
    country,
    fiscalYearLabel: fiscalYearLabel(country, today),
    annualLiability: annualLiability.toFixed(0),
    instalments: filledInstalments,
  };
}

function indiaSchedule(today: Date): AdvanceTaxInstalment[] {
  // India FY runs Apr 1 → Mar 31. Find which FY `today` falls in.
  const year = today.getFullYear();
  const month = today.getMonth() + 1; // 1-based
  const fyStart = month >= 4 ? year : year - 1; // calendar year FY starts in
  return [
    { dueDate: `${fyStart}-06-15`, ordinal: 1, cumulativePct: 15,  amountDue: '0', status: 'pending' },
    { dueDate: `${fyStart}-09-15`, ordinal: 2, cumulativePct: 45,  amountDue: '0', status: 'pending' },
    { dueDate: `${fyStart}-12-15`, ordinal: 3, cumulativePct: 75,  amountDue: '0', status: 'pending' },
    { dueDate: `${fyStart + 1}-03-15`, ordinal: 4, cumulativePct: 100, amountDue: '0', status: 'pending' },
  ];
}

function usSchedule(today: Date): AdvanceTaxInstalment[] {
  // US TY = calendar year. Final instalment for TY-N is Jan 15 of TY-(N+1).
  const year = today.getFullYear();
  return [
    { dueDate: `${year}-04-15`,     ordinal: 1, cumulativePct: 25,  amountDue: '0', status: 'pending' },
    { dueDate: `${year}-06-15`,     ordinal: 2, cumulativePct: 50,  amountDue: '0', status: 'pending' },
    { dueDate: `${year}-09-15`,     ordinal: 3, cumulativePct: 75,  amountDue: '0', status: 'pending' },
    { dueDate: `${year + 1}-01-15`, ordinal: 4, cumulativePct: 100, amountDue: '0', status: 'pending' },
  ];
}

function fiscalYearLabel(country: Country, today: Date): string {
  const year = today.getFullYear();
  const month = today.getMonth() + 1;
  if (country === 'IN') {
    const fyStart = month >= 4 ? year : year - 1;
    return `FY ${fyStart}-${String((fyStart + 1) % 100).padStart(2, '0')}`;
  }
  return `TY ${year}`;
}

// ─── Missed-event detection ─────────────────────────────────────────────────

/**
 * Walk a schedule against today and return the set of instalments that
 * are past-due and still unpaid (or partially paid). Caller mints
 * `advance_tax_missed` activity entries for these so the user is alerted.
 *
 * "Partially paid" counts as missed for the shortfall — Sec 234C / Form
 * 2210 penalty applies to the unpaid balance, not the original due
 * amount.
 */
export function detectMissedInstalments(
  schedule: AdvanceTaxSchedule,
  today: Date,
): { instalment: AdvanceTaxInstalment; shortfall: string }[] {
  const todayIso = today.toISOString().slice(0, 10);
  const out: { instalment: AdvanceTaxInstalment; shortfall: string }[] = [];
  for (const inst of schedule.instalments) {
    if (inst.dueDate >= todayIso) continue;            // not yet due
    if (inst.status === 'missed') continue;            // already flagged
    const paid = new Decimal(inst.paidAmount ?? '0');
    const due = new Decimal(inst.amountDue);
    if (paid.gte(due)) continue;                       // fully paid (incl. overpay)
    out.push({
      instalment: inst,
      shortfall: due.sub(paid).toFixed(0),
    });
  }
  return out;
}

// ─── Penalty interest accrual ───────────────────────────────────────────────

/**
 * Compute penalty interest accrued on missed instalments up to `today`.
 *
 * India:
 *   • Sec 234C: 1%/month on the shortfall, counted per missed quarter.
 *     Each instalment that fell short accrues from its due date forward
 *     until either (a) the deficit is cleared, or (b) the FY ends and
 *     234B takes over.
 *   • Sec 234B: 1%/month on year-end shortfall (when total payments
 *     < 90% of final liability). Kicks in after Mar 31 of the FY.
 *
 * US (Form 2210):
 *   • Penalty rate = federal short-term rate + 3% ≈ 8% APR ≈ 0.67%/mo.
 *     Applied to shortfall from each missed due date forward until paid.
 *
 * Returns total accrued penalty in currency-native units. We model 234C
 * and 2210 together (treating both as a flat per-month rate from the
 * missed due date). 234B is added separately as a small additional
 * accrual when the FY has ended (India only).
 */
export function accruedPenalty(
  schedule: AdvanceTaxSchedule,
  today: Date,
): { sec234C: string; sec234B: string; total: string } {
  const rate234C = 0.01; // 1%/mo for both India 234C and (close enough) US 2210
  let total234C = new Decimal(0);
  const todayDate = today.getTime();

  for (const inst of schedule.instalments) {
    const due = new Decimal(inst.amountDue);
    const paid = new Decimal(inst.paidAmount ?? '0');
    if (paid.gte(due)) continue;
    const shortfall = due.sub(paid);
    const dueDate = new Date(inst.dueDate + 'T00:00:00').getTime();
    if (dueDate > todayDate) continue;
    const monthsLate = Math.floor(
      (todayDate - dueDate) / (1000 * 60 * 60 * 24 * 30.4375),
    );
    if (monthsLate <= 0) continue;
    total234C = total234C.add(shortfall.mul(rate234C).mul(monthsLate));
  }

  // 234B: only India, only after FY end. We don't have the year-end
  // assessed-tax cross-check here (would require finalised TDS) so we
  // approximate as "additional 1%/mo from Mar 31 onwards on any shortfall
  // still outstanding". Conservative — slightly overstates.
  let total234B = new Decimal(0);
  if (schedule.country === 'IN') {
    const lastInst = schedule.instalments[schedule.instalments.length - 1];
    if (lastInst) {
      const fyEnd = new Date(lastInst.dueDate + 'T00:00:00');
      if (todayDate > fyEnd.getTime()) {
        const monthsPastFy = Math.floor(
          (todayDate - fyEnd.getTime()) / (1000 * 60 * 60 * 24 * 30.4375),
        );
        // Sum unpaid shortfalls across the whole schedule.
        let totalUnpaid = new Decimal(0);
        for (const inst of schedule.instalments) {
          const due = new Decimal(inst.amountDue);
          const paid = new Decimal(inst.paidAmount ?? '0');
          if (paid.lt(due)) totalUnpaid = totalUnpaid.add(due.sub(paid));
        }
        total234B = totalUnpaid.mul(rate234C).mul(monthsPastFy);
      }
    }
  }

  const total = total234C.add(total234B);
  return {
    sec234C: total234C.toFixed(0),
    sec234B: total234B.toFixed(0),
    total: total.toFixed(0),
  };
}
