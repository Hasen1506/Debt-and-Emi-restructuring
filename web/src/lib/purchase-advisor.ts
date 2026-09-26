/**
 * Purchase advisor — feasibility analysis for a planned big-ticket buy
 * (house, vehicle, other). Distinct from goals.ts (savings target by a
 * date) and from achievability.ts (goal-funding check). This module
 * answers: "Given a price, target date, and my surplus, can I afford
 * this on the cash + loan path I'm planning?"
 *
 * Pure library; no UI. Consumers feed analyses into a /tools/purchase
 * page or embed a verdict card on /plan. The math is deliberately
 * conservative: TCO assumes scheduled EMIs (no avalanche acceleration),
 * tax benefits respect the user's chosen regime without nudging a
 * switch, and depreciation warnings surface for vehicles regardless of
 * country.
 *
 * Country + regime gating:
 *   • IN old regime: home loan Sec 24(b) ₹2L/yr cap on interest.
 *   • IN new regime: no tax benefit (respects the user's regime choice).
 *   • US: home mortgage interest deductible to $750k loan, only if
 *     itemising exceeds standard deduction — surfaced as a conditional.
 *   • Vehicle / other: no tax benefit in either country.
 */

import Decimal from 'decimal.js';
import type { Country, FilingStatusUS, TaxRegimeIN } from './api';
import { deductionTaxSaving } from './deductions';

export type PurchaseType = 'home' | 'vehicle' | 'other';

export interface PurchaseInput {
  type: PurchaseType;
  /** Price in user's residence currency. */
  price: number;
  /** Target month in YYYY-MM (when the purchase must happen). */
  targetMonth: string;
  /** Down payment as a fraction of price (e.g. 0.20 for 20%). When
   *  omitted, defaulted by type: home 20%, vehicle 15%, other 25%. */
  downPaymentPct?: number;
  /** Loan tenure in years. When omitted, defaulted by type: home 20,
   *  vehicle 5, other 5. */
  loanTenureYears?: number;
  /** Indicative annual interest rate (decimal, e.g. 0.085 for 8.5%).
   *  Caller pulls from rate-cards.ts based on bank/country/loan type. */
  loanRateAnnual: number;
  /** User context. */
  country: Country;
  taxRegime?: TaxRegimeIN;
  /** Marginal tax rate as a decimal (e.g. 0.30 for 30% bracket). Used
   *  as a fallback when `taxableIncome` is not provided — the
   *  bracket-aware path below is preferred. */
  marginalRate: number;
  /** Pre-deduction taxable income (gross slab income minus already-
   *  claimed deductions, in user residence ccy). When provided, the
   *  tax-benefit calc walks slab boundaries so a deduction that
   *  crosses brackets saves at the correct blended rate. When omitted,
   *  the calc falls back to `deduction × marginalRate` (the
   *  approximation we used previously, which over-stated saving for
   *  users near slab boundaries). */
  taxableIncome?: number;
  /** US filing status — needed for federal bracket walk. Defaults to
   *  'single' inside `deductionTaxSaving`. */
  filingStatus?: FilingStatusUS;
  /** US state marginal rate (decimal). Applied flat on top of the
   *  federal saving — state slab structures aren't modelled. */
  stateMarginalRate?: string;
  /** Override for `stateMarginalRate` (from
   *  `deductions.state_marginal_rate_override`). Wins when set. */
  stateMarginalRateOverride?: string;
  /** Whether the user itemises in the US (Schedule A exceeds standard
   *  deduction). Ignored for IN. Defaults to false — conservative. */
  itemisesUS?: boolean;
  /** Available monthly surplus (₹/$ per month) — the value /plan
   *  displays after fixed + variable + EMI minimums. */
  monthlySurplus: number;
  /** Today's date — injectable for tests. */
  today?: Date;
}

export interface PurchaseAnalysis {
  feasibility: 'feasible' | 'tight' | 'unfeasible';
  /** Months between today and target month. 0 when target is past. */
  monthsToTarget: number;
  /** Down payment math. */
  downPayment: {
    amount: number;
    pctOfPrice: number;
    monthlySavingRequired: number;
    /** True when the user can cover the down-payment savings with
     *  surplus before they need the loan EMI too. */
    coverableBySurplus: boolean;
  };
  /** Loan math. */
  loan: {
    principal: number;
    monthlyEmi: number;
    totalInterestOverTenure: number;
    /** Effective rate after tax benefit, expressed as a decimal. Equal
     *  to nominal when no tax benefit applies. */
    effectiveAfterTaxRate: number;
    tcoPostTax: number;
    tenureYears: number;
  };
  /** Affordability — can the user handle EMI on top of existing
   *  commitments after the purchase? */
  affordability: {
    monthlyEmi: number;
    /** Surplus that remains after the new EMI. Negative = over-budget. */
    surplusAfterEmi: number;
    /** EMI as a fraction of surplus. >1 means user would have to dip
     *  into expenses or other income to service. */
    emiOverSurplus: number;
  };
  /** Changes that would make it comfortable (savings for the down payment
   *  fit the surplus by the date, and the EMI is at most 40% of it). Each
   *  is null when it isn't needed or wouldn't help: they used to echo the
   *  entered price and down payment back as "≤ ₹20 lakh" and "≥ 20%". */
  levers: {
    /** Highest price that fits both, at the entered down payment and date. */
    lowerPriceTo: number | null;
    /** Extra months to save the down payment (fixes the savings gap only). */
    extendTargetByMonths: number | null;
    /** Down payment that brings the EMI within 40%, offered only when it
     *  can still be saved by the date (a bigger one widens that gap). */
    increaseDownPaymentToPct: number | null;
  };
  /** Free-text caveats specific to this purchase. */
  warnings: string[];
  /** Free-text upside notes (e.g. tax benefit available). */
  notes: string[];
}

// ─── Defaults ──────────────────────────────────────────────────────────────

const DEFAULT_DOWN_PCT: Record<PurchaseType, number> = {
  home: 0.20,
  vehicle: 0.15,
  other: 0.25,
};

const DEFAULT_TENURE_YEARS: Record<PurchaseType, number> = {
  home: 20,
  vehicle: 5,
  other: 5,
};

// ─── Public API ────────────────────────────────────────────────────────────

export function analyzePurchase(input: PurchaseInput): PurchaseAnalysis {
  const today = input.today ?? new Date();
  const monthsToTarget = monthsBetween(today, input.targetMonth);

  const downPct =
    input.downPaymentPct != null
      ? input.downPaymentPct
      : DEFAULT_DOWN_PCT[input.type];
  const downAmount = round2(input.price * downPct);
  const principal = round2(input.price - downAmount);
  const tenureYears =
    input.loanTenureYears ?? DEFAULT_TENURE_YEARS[input.type];

  const monthlySavingRequired =
    monthsToTarget > 0 ? round2(downAmount / monthsToTarget) : downAmount;

  // EMI via standard amortisation. Falls back to principal/n when rate
  // is 0, which is fine for the no-cost-EMI / interest-free case.
  const monthlyEmi = emi(principal, input.loanRateAnnual, tenureYears * 12);
  const totalInterest = round2(monthlyEmi * tenureYears * 12 - principal);

  // Per-year interest schedule, walked through the amortisation table.
  // The previous rough Y1 approximation (`emi*12 − principal/n`) treated
  // principal repayment as straight-line, which understates Y1 interest
  // (interest is front-loaded in amortisation). The exact schedule lets
  // us compute the cap-bounded tax benefit year by year and the precise
  // Y1 interest used to derive `effectiveAfterTaxRate`.
  const yearlyInterest = yearlyInterestSchedule(
    principal,
    input.loanRateAnnual,
    tenureYears * 12,
  );
  const annualInterestY1 = yearlyInterest[0] ?? 0;

  const taxResult = computeTaxBenefit({
    type: input.type,
    country: input.country,
    taxRegime: input.taxRegime,
    marginalRate: input.marginalRate,
    taxableIncome: input.taxableIncome,
    filingStatus: input.filingStatus,
    stateMarginalRate: input.stateMarginalRate,
    stateMarginalRateOverride: input.stateMarginalRateOverride,
    annualInterestY1,
    yearlyInterest,
    principal,
    itemisesUS: input.itemisesUS ?? false,
  });
  const effectiveAfterTaxRate = effectiveRate(
    input.loanRateAnnual,
    taxResult.annualSavingPct,
  );
  const tcoPostTax = round2(
    downAmount + monthlyEmi * tenureYears * 12 - taxResult.totalSavingOverTenure,
  );

  const surplusAfterEmi = round2(input.monthlySurplus - monthlyEmi);
  const emiOverSurplus =
    input.monthlySurplus > 0 ? monthlyEmi / input.monthlySurplus : Infinity;

  const coverableBySurplus =
    monthsToTarget > 0 && monthlySavingRequired <= input.monthlySurplus;

  // Feasibility: tight = EMI eats most of surplus OR savings rate doesn't
  // quite fit. Unfeasible = surplus can't cover savings AND EMI together.
  const feasibility = classifyFeasibility(
    monthsToTarget,
    coverableBySurplus,
    emiOverSurplus,
  );

  // Levers against the two things that can go wrong: saving the down
  // payment by the date, and an EMI above 40% of the surplus afterwards.
  const surplus = input.monthlySurplus;
  const n = tenureYears * 12;
  const comfortableEmi = surplus * 0.4;
  const savingsFit = monthsToTarget > 0 && downAmount <= surplus * monthsToTarget;
  const emiFits = surplus > 0 && monthlyEmi <= comfortableEmi;
  // Largest loan whose EMI is comfortable.
  const maxPrincipal = surplus > 0 ? invertEmiForPrincipal(comfortableEmi, input.loanRateAnnual, n) : 0;
  // Clamp away from 100% down: the price lever divides by (1 − down).
  const safeDownPct = Math.min(downPct, 0.95);
  const priceForSavings =
    monthsToTarget > 0 && downPct > 0 ? (surplus * monthsToTarget) / downPct : monthsToTarget > 0 ? Infinity : 0;
  const priceForEmi = maxPrincipal / (1 - safeDownPct);
  const bestPrice = Math.min(priceForSavings, priceForEmi);
  const neededDownPct = input.price > 0 ? 1 - maxPrincipal / input.price : 1;
  const levers = {
    lowerPriceTo:
      surplus > 0 && bestPrice > 0 && bestPrice < input.price && !(savingsFit && emiFits)
        ? round2(bestPrice)
        : null,
    extendTargetByMonths:
      !savingsFit && surplus > 0
        ? Math.max(1, Math.ceil(downAmount / surplus) - monthsToTarget)
        : null,
    increaseDownPaymentToPct:
      !emiFits &&
      surplus > 0 &&
      neededDownPct > downPct &&
      neededDownPct < 1 &&
      monthsToTarget > 0 &&
      neededDownPct * input.price <= surplus * monthsToTarget
        ? round4(neededDownPct)
        : null,
  };

  const warnings = buildWarnings(input, monthsToTarget);
  const notes = buildNotes(input, taxResult);

  return {
    feasibility,
    monthsToTarget,
    downPayment: {
      amount: downAmount,
      pctOfPrice: downPct,
      monthlySavingRequired,
      coverableBySurplus,
    },
    loan: {
      principal,
      monthlyEmi,
      totalInterestOverTenure: totalInterest,
      effectiveAfterTaxRate,
      tcoPostTax,
      tenureYears,
    },
    affordability: {
      monthlyEmi,
      surplusAfterEmi,
      emiOverSurplus,
    },
    levers,
    warnings,
    notes,
  };
}

// ─── Tax benefit ───────────────────────────────────────────────────────────

interface TaxResult {
  /** Annual % of interest that's effectively rebated (e.g. 0.30 means
   *  30% of interest is saved as tax). 0 when no benefit applies. */
  annualSavingPct: number;
  /** Lifetime saving in user-residence ccy, summed over tenure. */
  totalSavingOverTenure: number;
  /** Free-text reason for the result. */
  reason: string;
}

function computeTaxBenefit(args: {
  type: PurchaseType;
  country: Country;
  taxRegime?: TaxRegimeIN;
  marginalRate: number;
  /** When provided, the calc walks slab boundaries for accurate
   *  cross-bracket saving. When omitted, falls back to
   *  `deduction × marginalRate`. */
  taxableIncome?: number;
  filingStatus?: FilingStatusUS;
  stateMarginalRate?: string;
  stateMarginalRateOverride?: string;
  annualInterestY1: number;
  /** Per-year interest schedule (length = tenureYears). Used to compute
   *  the exact cap-bounded lifetime saving instead of a hardcoded
   *  tenure baseline. */
  yearlyInterest: number[];
  /** Total loan principal — used to scale the US $750k deductible cap. */
  principal: number;
  itemisesUS: boolean;
}): TaxResult {
  // Vehicle / other — no benefit in either country.
  if (args.type !== 'home') {
    return {
      annualSavingPct: 0,
      totalSavingOverTenure: 0,
      reason: `${args.type} loans don't carry a tax benefit in ${args.country === 'IN' ? 'India' : 'the US'}.`,
    };
  }
  // Saving for a single year's deduction. Branches: when we have the
  // user's taxable income, walk slab boundaries via `deductionTaxSaving`
  // (exact across brackets). Without it, fall back to flat marginal
  // (approximation; over-states saving for users near slab edges).
  const savingForDeduction = (deduction: number): number => {
    if (deduction <= 0) return 0;
    if (args.taxableIncome != null && args.taxableIncome > 0) {
      const s = deductionTaxSaving({
        taxableIncome: args.taxableIncome,
        deductionAmount: deduction,
        country: args.country,
        taxRegime: args.taxRegime,
        filingStatus: args.filingStatus,
        stateMarginalRate: args.stateMarginalRate,
        stateMarginalRateOverride: args.stateMarginalRateOverride,
      });
      return s.toNumber();
    }
    return deduction * args.marginalRate;
  };

  if (args.country === 'IN') {
    // Honour the user's regime choice. We don't nudge a switch — that
    // costs the lower slab rates the new regime offers, which this
    // module can't fully evaluate.
    const isOld = args.taxRegime === 'old';
    if (!isOld) {
      return {
        annualSavingPct: 0,
        totalSavingOverTenure: 0,
        reason:
          'Sec 24(b) home-loan interest deduction is not available on the new tax regime.',
      };
    }
    const cap = 200_000;
    // Lifetime saving: walk the actual amortisation schedule, apply the
    // ₹2L cap per year, then compute the bracket-aware saving for that
    // capped deduction. Front-loaded years hit the cap; back-loaded
    // years fall below it. Tenure-aware by construction.
    const totalSaving = args.yearlyInterest.reduce(
      (sum, interestY) => sum + savingForDeduction(Math.min(interestY, cap)),
      0,
    );
    const y1Deduction = Math.min(args.annualInterestY1, cap);
    const y1Benefit = savingForDeduction(y1Deduction);
    return {
      annualSavingPct:
        args.annualInterestY1 > 0 ? y1Benefit / args.annualInterestY1 : 0,
      totalSavingOverTenure: round2(totalSaving),
      reason: `Sec 24(b): up to ₹${(cap / 1000).toFixed(0)}k of interest deductible each year on the old regime.`,
    };
  }
  // US — only if itemising and within the $750k loan cap.
  if (!args.itemisesUS) {
    return {
      annualSavingPct: 0,
      totalSavingOverTenure: 0,
      reason:
        'Mortgage interest deduction only helps if your Schedule A itemised total exceeds the standard deduction. Toggle the itemise flag if applicable.',
    };
  }
  // $750k debt-balance cap: only the portion of interest attributable
  // to the first $750k of loan principal is deductible. Approximate as
  // a flat ratio against the full year's interest — accurate when the
  // balance stays above $750k for the whole year, slightly understated
  // once it drops below (later years), which is conservative.
  const US_DEBT_CAP = 750_000;
  const eligibleRatio = Math.min(1, US_DEBT_CAP / args.principal);
  const totalSaving = args.yearlyInterest.reduce(
    (sum, interestY) => sum + savingForDeduction(interestY * eligibleRatio),
    0,
  );
  const y1Deduction = args.annualInterestY1 * eligibleRatio;
  const y1Benefit = savingForDeduction(y1Deduction);
  return {
    annualSavingPct:
      args.annualInterestY1 > 0 ? y1Benefit / args.annualInterestY1 : 0,
    totalSavingOverTenure: round2(totalSaving),
    reason:
      args.principal > US_DEBT_CAP
        ? `Mortgage interest deduction limited to the $750k debt cap (${Math.round(eligibleRatio * 100)}% of interest deductible).`
        : 'Mortgage interest deduction (Schedule A) applied at your marginal rate.',
  };
}

// ─── Warnings + notes ──────────────────────────────────────────────────────

function buildWarnings(input: PurchaseInput, monthsToTarget: number): string[] {
  const w: string[] = [];
  if (monthsToTarget <= 0) {
    w.push('Target date is now or in the past — set a future month.');
  }
  if (input.type === 'vehicle') {
    w.push(
      'Vehicles depreciate sharply: typically 15–25% in year 1, ~50% by year 5. Underwater periods are likely if you finance a long tenure.',
    );
    if ((input.loanTenureYears ?? DEFAULT_TENURE_YEARS.vehicle) > 5) {
      w.push(
        'Tenure beyond 5 years on a vehicle loan amplifies the underwater risk — the balance can exceed market value for most of the loan.',
      );
    }
  }
  // Country-specific "above typical" threshold. IN home loans run
  // 8–10% in normal markets, so 10%+ is the suspicious band. US
  // 30-yr fixed mortgages in 2026 sit around 6–7.5%, so >9% is the
  // analogous flag. Vehicle / other loans aren't gated — their typical
  // range is too wide to call.
  if (input.type === 'home') {
    const homeHighThreshold = input.country === 'IN' ? 0.10 : 0.09;
    if (input.loanRateAnnual > homeHighThreshold) {
      w.push(
        `Quoted rate is above the typical ${input.country === 'IN' ? 'India' : 'US'} home-loan range — confirm with a sanction letter or shop around before locking in.`,
      );
    }
  }
  if (input.loanRateAnnual > 0 && input.loanRateAnnual < 0.03) {
    w.push(
      'Quoted rate is unusually low — verify it isn\'t an introductory teaser rate that resets later.',
    );
  }
  return w;
}

function buildNotes(input: PurchaseInput, tax: TaxResult): string[] {
  const n: string[] = [];
  n.push(tax.reason);
  if (input.type === 'home') {
    n.push(
      'Tenure choice trades EMI vs. total interest: longer tenure lowers EMI but inflates total interest. Most users default to 20–25 years to keep monthly affordability comfortable.',
    );
  }
  return n;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function classifyFeasibility(
  months: number,
  coverable: boolean,
  emiRatio: number,
): PurchaseAnalysis['feasibility'] {
  if (months <= 0) return 'unfeasible';
  if (!coverable) return 'unfeasible';
  if (emiRatio > 0.6) return 'unfeasible';
  if (emiRatio > 0.4) return 'tight';
  return 'feasible';
}

function monthsBetween(today: Date, targetMonth: string): number {
  const y = Number(targetMonth.slice(0, 4));
  const m = Number(targetMonth.slice(5, 7));
  if (!Number.isFinite(y) || !Number.isFinite(m)) return 0;
  const target = new Date(y, m - 1, 1);
  const diff =
    (target.getFullYear() - today.getFullYear()) * 12 +
    (target.getMonth() - today.getMonth());
  return diff > 0 ? diff : 0;
}

/** Standard amortisation EMI. Returns 0 when n ≤ 0. */
function emi(principal: number, rateAnnual: number, n: number): number {
  if (n <= 0) return 0;
  if (rateAnnual <= 0) return round2(principal / n);
  const r = new Decimal(rateAnnual).div(12);
  const p = new Decimal(principal);
  const factor = r.add(1).pow(n);
  return round2(p.mul(r).mul(factor).div(factor.sub(1)).toNumber());
}

/** Per-year interest paid, walked through the amortisation table.
 *  Output length = ceil(n/12); the final entry covers any stub year
 *  shorter than 12 months. Used by the tax-benefit calc to apply
 *  per-year caps (₹2L IN, $750k US loan-balance limit) against the
 *  actual interest profile — interest is front-loaded, so the
 *  straight-line approximation we used previously systematically
 *  understated Y1 and overstated late-year saving. */
function yearlyInterestSchedule(
  principal: number,
  rateAnnual: number,
  n: number,
): number[] {
  if (n <= 0 || principal <= 0) return [];
  const monthlyEmi = emi(principal, rateAnnual, n);
  if (monthlyEmi <= 0) return [];
  const out: number[] = [];
  if (rateAnnual <= 0) {
    // No interest accrues — every year reports 0.
    const years = Math.ceil(n / 12);
    for (let y = 0; y < years; y++) out.push(0);
    return out;
  }
  const r = rateAnnual / 12;
  let balance = principal;
  let yearInterest = 0;
  for (let m = 1; m <= n; m++) {
    const interestThisMonth = balance * r;
    // Cap principal at remaining balance so the last month doesn't
    // overshoot due to EMI rounding.
    const principalThisMonth = Math.min(monthlyEmi - interestThisMonth, balance);
    yearInterest += interestThisMonth;
    balance -= principalThisMonth;
    if (m % 12 === 0 || m === n) {
      out.push(yearInterest);
      yearInterest = 0;
    }
  }
  return out;
}

/** Invert the EMI formula to find principal given a target monthly. */
function invertEmiForPrincipal(
  targetEmi: number,
  rateAnnual: number,
  n: number,
): number {
  if (n <= 0 || targetEmi <= 0) return 0;
  if (rateAnnual <= 0) return targetEmi * n;
  const r = new Decimal(rateAnnual).div(12);
  const factor = r.add(1).pow(n);
  return round2(
    new Decimal(targetEmi).mul(factor.sub(1)).div(r.mul(factor)).toNumber(),
  );
}

/** Effective annual rate after applying a tax-benefit pct that
 *  effectively rebates `savingPct` of interest each year. */
function effectiveRate(nominal: number, savingPct: number): number {
  return round4(nominal * (1 - savingPct));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
