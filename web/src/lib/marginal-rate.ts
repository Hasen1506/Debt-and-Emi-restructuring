/**
 * The marginal tax rate Profile saves when it can't read one off gross pay.
 *
 * Root cause of "TAX BRACKET 0%" for a high earner (audit 2026-10-07 §12):
 * with no gross pay entered, Profile saved whatever rate was already on the
 * profile. That rate was an estimate from take-home pay worked out for the
 * *old* inputs, so it went stale when they changed. The live case: an Indian
 * take-home of 50,000 a month sits inside the 87A rebate (0%); after
 * switching the profile to the US the same 50,000 is dollars, a 37% bracket,
 * but the 0% stayed. Lifecycle events did the same when a profile had no
 * income field (deriveMarginalRateForUser returned "0").
 *
 * Now: gross pay wins; a rate the user typed in this visit wins next; a saved
 * rate is kept only while country, income type and take-home are unchanged;
 * otherwise the rate is estimated again from take-home.
 */
import type { Country, FilingStatusUS, IncomeType, TaxRegimeIN } from './api';
import { marginalRateFromTakeHome } from './quick-setup';

export interface MarginalRateInputs {
  /** Federal / national rate from gross pay; null when no gross is entered. */
  bracketRate: number | null;
  /** US state rate (0 elsewhere). */
  stateRate: number;
  /** The manual field as it is now, and as it was loaded. */
  manualRate: string;
  loadedRate: string;
  /** The profile as last saved (undefined on a first save). */
  prev?: { country: Country; income_type: IncomeType; monthly_income?: string };
  country: Country;
  incomeType: IncomeType;
  monthlyIncome: string;
  regime?: TaxRegimeIN;
  filing?: FilingStatusUS;
  /** Round 3: an NRI's rate on Indian income (lib/tax-setup); wins when set. */
  abroadRate?: number | null;
}

const same = (a?: string, b?: string) => Math.abs(Number(a || 0) - Number(b || 0)) < 0.5;

export function profileMarginalRate(i: MarginalRateInputs): { rate: number; estimated: boolean } {
  if (i.abroadRate != null) return { rate: i.abroadRate, estimated: false };
  if (i.bracketRate != null) return { rate: i.bracketRate + i.stateRate, estimated: false };
  const typed = i.manualRate.trim();
  if (typed !== '' && typed !== i.loadedRate.trim() && Number.isFinite(Number(typed))) {
    return { rate: Number(typed) + i.stateRate, estimated: false };
  }
  const unchanged =
    !!i.prev && i.prev.country === i.country && i.prev.income_type === i.incomeType && same(i.prev.monthly_income, i.monthlyIncome);
  if (unchanged && i.loadedRate.trim() !== '' && Number.isFinite(Number(i.loadedRate))) {
    // The saved rate already includes any state rate.
    return { rate: Number(i.loadedRate), estimated: true };
  }
  const est = marginalRateFromTakeHome(
    i.monthlyIncome,
    i.country,
    i.incomeType,
    i.country === 'IN' ? (i.regime ?? 'new') : undefined,
    i.country === 'US' ? (i.filing ?? 'single') : undefined,
  );
  return { rate: (est ? est.rate : 0.3) + i.stateRate, estimated: true };
}
