/**
 * The arithmetic behind the three-step setup (components/setup/QuickSetup):
 * an EMI from the months left, a tax bracket from take-home pay, and the
 * first extra payment the plan makes.
 */
import Decimal from 'decimal.js';
import type { AgeBracket, Country, FilingStatusUS, IncomeType, TaxRegimeIN, UserPayload } from '@/lib/api';
import { roundEmi } from '@/lib/amortization';
import { computeAnnualTax } from '@/lib/tax-brackets';
import { deriveMarginalRate } from '@/lib/deductions';
import { abroadIndiaRate, type TaxBasics } from '@/lib/tax-setup';

/**
 * The monthly payment that clears `outstanding` in `months` at `annualRate`
 * (a fraction, "0.085"): the usual reducing-balance EMI. Rupees round up to
 * the rupee, dollars to the cent. Null when an input is missing.
 */
export function emiFromMonths(
  outstanding: string,
  annualRate: string,
  months: number,
  currency: 'INR' | 'USD',
): string | null {
  if (!/^\d*\.?\d+$/.test(outstanding.trim()) || !/^\d*\.?\d+$/.test(annualRate.trim())) return null;
  if (!Number.isInteger(months) || months <= 0 || months > 600) return null;
  return roundEmi(outstanding, annualRate, months, currency);
}

/**
 * The tax rate for someone who takes home `monthlyTakeHome` a month:
 * finds the yearly gross whose tax leaves that much, then its marginal rate.
 * An estimate (it ignores PF, insurance and other deductions); Profile
 * replaces it once gross pay is entered. Null when there's no income.
 */
export function marginalRateFromTakeHome(
  monthlyTakeHome: string,
  country: Country,
  incomeType: IncomeType,
  regime: TaxRegimeIN | undefined,
  filing: FilingStatusUS | undefined,
  /** Round 3: a pensioner's age (old regime's senior tables). */
  age?: AgeBracket,
): { gross: number; rate: number } | null {
  const net = Number(monthlyTakeHome) * 12;
  if (!Number.isFinite(net) || net <= 0) return null;
  const left = (gross: number) =>
    gross - Number(computeAnnualTax(country, regime, incomeType, gross, filing, age).toString());
  // Tax never takes more than two thirds, so the gross sits in [net, 3·net].
  let lo = net;
  let hi = net * 3;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (left(mid) < net) lo = mid;
    else hi = mid;
  }
  const gross = Math.round(hi);
  // The same rate Profile works out from gross pay: in India the slab with
  // surcharge and 4% cess, and 0 within the 87A rebate (the bare slab read
  // 20% where Profile said 20.8%).
  const rate = deriveMarginalRate({ grossAnnual: gross, country, taxRegime: regime, filingStatus: filing, incomeType, ageBracket: age });
  return { gross, rate: rate ? rate.toNumber() : 0 };
}

/**
 * This month's extra payment: the loan the plan pays more than its
 * minimum, and by how much (in that loan's currency). Compares month 1 of
 * the plan with month 1 of paying minimums only.
 */
export function firstExtraPayment(
  plan: Record<string, string> | undefined,
  minimums: Record<string, string> | undefined,
): { index: number; extra: string } | null {
  if (!plan) return null;
  let best: { index: number; extra: Decimal } | null = null;
  for (const [k, v] of Object.entries(plan)) {
    const extra = new Decimal(v || 0).sub(new Decimal(minimums?.[k] || 0));
    if (extra.gt(0.5) && (!best || extra.gt(best.extra))) best = { index: Number(k), extra };
  }
  return best ? { index: best.index, extra: best.extra.toDecimalPlaces(0).toString() } : null;
}

/** The tax rate Setup saves from take-home pay and the answers above. */
export function setupMarginalRate(
  takeHome: string,
  country: Country,
  incomeType: IncomeType,
  tb: TaxBasics,
  prev?: Partial<UserPayload>,
): number {
  if (country === 'IN' && tb.residence && tb.residence !== 'GULF') {
    return abroadIndiaRate({ income_streams: prev?.income_streams, tax_regime: prev?.tax_regime });
  }
  const est = marginalRateFromTakeHome(
    takeHome,
    country,
    incomeType,
    country === 'IN' ? (prev?.tax_regime ?? 'new') : undefined,
    country === 'US' ? (tb.filing ?? prev?.filing_status ?? 'single') : undefined,
    tb.earns === 'pension' ? tb.age : undefined,
  );
  return est?.rate ?? 0.3;
}
