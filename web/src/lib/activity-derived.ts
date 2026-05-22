/**
 * Derived per-entry values used by /insights and /plan surfaces. Pulled out
 * of ActivityLedger.tsx so the four call sites that need these values
 * (LedgerEntries, ExistingEntries, EditorialEntries inside ActivityLedger;
 * computeSummary inside InsightsSummaryStrip) compute them the same way.
 *
 * Before this module, the penalty-estimate computation drifted between
 * call sites — InsightsSummaryStrip used `Number(penaltyOverride)` while
 * the renderers used `buildOverrideEstimate(...)`, and the summary
 * clamped `daysLate` to a minimum of 1 while the renderers used the
 * raw `daysLate(entry)`. Standardising on this module's logic.
 */

import Decimal from 'decimal.js';
import type { Country, LoanPayload } from './api';
import {
  daysLate,
  extraPrincipal,
  overdueAmount,
  type ActivityEntry,
} from './activity';
import { estimateLateFee, type PenaltyEstimate } from './estimate-penalty';

export interface DecoratedEntry {
  /** Principal+interest the user didn't pay. "0" for non-penalty events. */
  overdue: string;
  /** True for paid_partial / missed; the only kinds that accrue a penalty. */
  needsPenalty: boolean;
  /** Resolved penalty estimate. `null` when `!needsPenalty` OR when the
   *  underlying loan has been deleted (loanIndex points past the array). */
  est: PenaltyEstimate | null;
  /** Principal applied above the scheduled EMI for paid_extra. "0" otherwise. */
  extra: string;
}

/** Build a synthetic estimate from a user-supplied override. All breakdown
 *  components zero out; total = override; source is tagged as bank-specific
 *  because the user has overridden the country/loan-type default. */
export function buildOverrideEstimate(override: string): PenaltyEstimate {
  const totalNum = Number(override || '0');
  const total = new Decimal(Number.isFinite(totalNum) ? totalNum : 0);
  return {
    flatFee: total,
    penalInterest: new Decimal(0),
    gst: new Decimal(0),
    total,
    source: 'bank_specific',
  };
}

/** Compute the rendering-relevant derived values for an entry in one place.
 *  Pass `loan` from `loans[entry.loanIndex]` — when it's undefined (deleted
 *  loan, stale index) the helper safely returns `est: null`. */
export function decorateEntry(
  entry: ActivityEntry,
  loan: LoanPayload | undefined,
  country: Country,
): DecoratedEntry {
  const overdue = overdueAmount(entry);
  const needsPenalty = entry.kind === 'paid_partial' || entry.kind === 'missed';
  let est: PenaltyEstimate | null = null;
  if (needsPenalty) {
    if (entry.penaltyOverride && entry.penaltyOverride.trim() !== '') {
      est = buildOverrideEstimate(entry.penaltyOverride);
    } else if (loan) {
      est = estimateLateFee({
        loanType: loan.loan_type,
        country,
        bank: loan.bank,
        overdueAmount: overdue,
        daysLate: daysLate(entry),
      });
    }
  }
  return {
    overdue,
    needsPenalty,
    est,
    extra: extraPrincipal(entry),
  };
}
