import type {
  CardRevolvingAnalysis,
  Country,
  DisagreementInsight,
  GoalTradeoffSummary,
  Loan,
  LoanMetrics,
  MonthAllocationRow,
  PaymentConsequence,
  PayoffStrategy,
  SimulationResult,
  StressScenario,
  TaxRegimeIN,
  TrajectoryPoint,
  UserProfile,
} from './types';
import { MARKET_BENCHMARKS } from './policyRates';
import { DEFAULT_STRESS_SCENARIO } from './presets';

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export function formatMoney(amount: number, country: Country): string {
  const rounded = Math.round(Number.isFinite(amount) ? amount : 0);
  const abs = Math.abs(rounded);
  const sign = rounded < 0 ? '−' : '';
  if (country === 'IN') {
    return `${sign}₹${abs.toLocaleString('en-IN')}`;
  }
  return `${sign}$${abs.toLocaleString('en-US')}`;
}

export function formatMoneyCompact(amount: number, country: Country): string {
  const abs = Math.abs(Number.isFinite(amount) ? amount : 0);
  const sign = amount < 0 ? '−' : '';
  if (country === 'IN') {
    if (abs >= 1e7) return `${sign}₹${(abs / 1e7).toFixed(2)} Cr`;
    if (abs >= 1e5) return `${sign}₹${(abs / 1e5).toFixed(2)} L`;
    if (abs >= 1e3) return `${sign}₹${(abs / 1e3).toFixed(1)}k`;
    return `${sign}₹${Math.round(abs)}`;
  }
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1)}k`;
  return `${sign}$${Math.round(abs)}`;
}

export function formatPct(fraction: number, decimals = 2): string {
  const safe = Number.isFinite(fraction) ? fraction : 0;
  return `${(safe * 100).toFixed(decimals)}%`;
}

export function addMonthsLabel(monthsAhead: number, style: 'short' | 'long' = 'short', baseDate = new Date(2026, 10, 1)): string {
  const clamped = Math.min(600, Math.max(0, Math.round(monthsAhead)));
  const d = new Date(baseDate.getFullYear(), baseDate.getMonth() + clamped, 1);
  const names = style === 'long' ? MONTHS_LONG : MONTHS_SHORT;
  return `${names[d.getMonth()]} ${d.getFullYear()}`;
}

export function formatDuration(months: number): string {
  if (!Number.isFinite(months) || months >= 360) return '30+ yrs';
  if (months <= 0) return 'Debt-free now';
  const y = Math.floor(months / 12);
  const m = months % 12;
  if (y === 0) return `${m} mo`;
  if (m === 0) return `${y} yr${y === 1 ? '' : 's'}`;
  return `${y} yr${y === 1 ? '' : 's'} ${m} mo`;
}

/**
 * Standard reducing-balance monthly EMI formula.
 */
export function computeEmi(principal: number, annualRate: number, months: number): number {
  if (principal <= 0 || months <= 0) return 0;
  const r = Math.max(0, annualRate) / 12;
  if (r <= 1e-9) return Math.ceil(principal / months);
  const factor = Math.pow(1 + r, months);
  return Math.ceil((principal * r * factor) / (factor - 1));
}

/**
 * Remaining months given principal, annual rate, and fixed EMI.
 * Returns Infinity if EMI cannot cover monthly interest (negative amortization).
 */
export function computeMonthsRemaining(principal: number, annualRate: number, emi: number): number {
  if (principal <= 0) return 0;
  const r = Math.max(0, annualRate) / 12;
  if (r <= 1e-9) return emi > 0 ? Math.ceil(principal / emi) : 600;
  const monthlyInt = principal * r;
  if (emi <= monthlyInt) return Infinity;
  const n = Math.log(emi / (emi - monthlyInt)) / Math.log(1 + r);
  return Math.ceil(n);
}

/**
 * True All-In Annualized Cost of Debt (EAR) accounting for:
 * - India credit card monthly compounding + 18% GST on revolving interest (42% -> 60.31%)
 * - India home loan effective rate (8.50% -> 8.84% New Regime; Sec 24(b) shield in Old Regime)
 * - US daily compounding on revolving cards (APR/365)^365
 */
export function computeTrueAllInApr(
  loan: Loan,
  country: Country,
  taxRegimeIN: TaxRegimeIN,
  marginalTaxRate: number,
): { trueAllInApr: number; explanation: string } {
  const nominal = Math.max(0, loan.annualRate);
  const ear = Math.pow(1 + nominal / 12, 12) - 1;

  if (country === 'IN') {
    if (loan.loanType === 'credit_card') {
      const withGst = ear * (1 + MARKET_BENCHMARKS.IN.gstRate);
      return {
        trueAllInApr: withGst,
        explanation: `${formatPct(nominal)} stated rate compounds monthly to ${formatPct(ear)}, plus 18% GST on card interest = ${formatPct(withGst)} true annual cost.`,
      };
    }
    if (loan.loanType === 'home_loan') {
      if (taxRegimeIN === 'old' && loan.isSelfOccupied !== false) {
        const annualInterest = loan.outstanding * nominal;
        const shieldedShare = annualInterest > 0 ? Math.min(1, 200000 / annualInterest) : 0;
        const postTax = ear * (1 - marginalTaxRate * shieldedShare);
        return {
          trueAllInApr: postTax,
          explanation: `Compounded ${formatPct(ear)} reduced by Section 24(b) old-regime tax shield (${Math.round(marginalTaxRate * 100)}% slab up to ₹2L/yr) = ${formatPct(postTax)} net cost.`,
        };
      }
      return {
        trueAllInApr: ear,
        explanation: `${formatPct(nominal)} compounded monthly = ${formatPct(ear)} effective cost (no Section 24(b) deduction on self-occupied homes under New Tax Regime).`,
      };
    }
    if (loan.loanType === 'education_loan' && taxRegimeIN === 'old') {
      const postTax = ear * (1 - marginalTaxRate);
      return {
        trueAllInApr: postTax,
        explanation: `Compounded ${formatPct(ear)} reduced by Section 80E deduction (${Math.round(marginalTaxRate * 100)}% slab) = ${formatPct(postTax)} net cost.`,
      };
    }
    return {
      trueAllInApr: ear,
      explanation: `${formatPct(nominal)} compounded monthly = ${formatPct(ear)} all-in annual cost.`,
    };
  }

  // US rules
  if (loan.loanType === 'credit_card') {
    const dailyEar = Math.pow(1 + nominal / 365, 365) - 1;
    return {
      trueAllInApr: dailyEar,
      explanation: `${formatPct(nominal)} APR compounded daily on revolving balance = ${formatPct(dailyEar)} effective APY.`,
    };
  }
  return {
    trueAllInApr: ear,
    explanation: `${formatPct(nominal)} nominal compounded monthly = ${formatPct(ear)} effective rate.`,
  };
}

/**
 * Single source of truth for a revolving credit card billing cycle.
 * Ensures Active Loans table, Execution checklist, and multi-month simulation match to the exact rupee/dollar.
 */
export function computeCardCycleCharges(
  principal: number,
  annualRate: number,
  monthlyNewSpend: number,
  country: Country,
): { interestWithTax: number; minimumDue: number } {
  if (principal <= 0 && monthlyNewSpend <= 0) {
    return { interestWithTax: 0, minimumDue: 0 };
  }
  const gstMult = country === 'IN' ? 1 + MARKET_BENCHMARKS.IN.gstRate : 1;
  const monthlyRate = (Math.max(0, annualRate) / 12) * gstMult;
  // When revolving, grace period is revoked: existing balance accrues full-month interest + new spend accrues avg 15 days
  const interestWithTax = (principal + Math.max(0, monthlyNewSpend) * 0.5) * monthlyRate;
  const statementTotal = principal + Math.max(0, monthlyNewSpend) + interestWithTax;
  const rawMin =
    country === 'IN'
      ? Math.max(200, principal * 0.05 + interestWithTax)
      : Math.max(35, principal * 0.01 + interestWithTax);
  const minimumDue = Math.min(Math.round(statementTotal), Math.round(rawMin));
  return { interestWithTax, minimumDue };
}

/**
 * Computes minimum payment due this month.
 */
export function computeMinimumDue(loan: Loan, country: Country): number {
  if (loan.outstanding <= 0) return 0;
  if (loan.loanType === 'credit_card') {
    return computeCardCycleCharges(
      loan.outstanding,
      loan.annualRate,
      loan.monthlyNewSpend ?? 0,
      country,
    ).minimumDue;
  }
  const emi = loan.emi > 0 ? loan.emi : computeEmi(loan.outstanding, loan.annualRate, Math.max(1, loan.monthsRemaining));
  const monthlyInt = loan.outstanding * (loan.annualRate / 12);
  return Math.min(Math.round(loan.outstanding + monthlyInt), Math.round(emi));
}

/**
 * Deep Revolving Credit Card Physics:
 * Models grace-period revocation, Day-1 interest on new spends, daily interest bleed,
 * 18% GST surcharge (IN), and exact minimum-only trap duration & total interest.
 */
export function computeCardRevolvingTrap(loan: Loan, country: Country): CardRevolvingAnalysis {
  const balance = Math.max(0, loan.outstanding);
  const monthlyNewSpend = Math.max(0, loan.monthlyNewSpend ?? 0);
  const gstMult = country === 'IN' ? 1 + MARKET_BENCHMARKS.IN.gstRate : 1;
  const monthlyRate = (loan.annualRate / 12) * gstMult;
  const dailyRate = (loan.annualRate / 365) * gstMult;

  const dailyInterestBleed = Math.round((balance + monthlyNewSpend * 0.5) * dailyRate * 100) / 100;
  const newSpendDayOneCostPerMonth = Math.round(monthlyNewSpend * monthlyRate * 0.5);
  const gstPortionAnnual =
    country === 'IN' ? Math.round(balance * loan.annualRate * MARKET_BENCHMARKS.IN.gstRate) : 0;

  let simBal = balance;
  let totalInt = 0;
  let months = 0;
  let isDebtSpiral = false;
  const MAX_CARD_MONTHS = 360;

  while (months < MAX_CARD_MONTHS && simBal > 1) {
    months += 1;
    const { interestWithTax, minimumDue } = computeCardCycleCharges(
      simBal,
      loan.annualRate,
      monthlyNewSpend,
      country,
    );
    totalInt += interestWithTax;
    simBal = Math.max(0, simBal + monthlyNewSpend + interestWithTax - minimumDue);
    if (months > 12 && simBal > balance * 1.15) {
      isDebtSpiral = true;
    }
  }
  if (simBal > 10) {
    isDebtSpiral = true;
  }

  return {
    loanId: loan.id,
    loanName: loan.name,
    balance,
    monthlyNewSpend,
    gracePeriodActive: balance <= 0,
    minimumOnlyMonths: months,
    minimumOnlyTotalInterest: Math.round(totalInt),
    dailyInterestBleed,
    newSpendDayOneCostPerMonth,
    gstPortionAnnual,
    isDebtSpiral,
  };
}

/**
 * Exact real-world consequences when a borrower pays Full, Extra, Partial, or Unable to Pay (0).
 */
export function analyzePaymentOutcome(params: {
  loan: Loan;
  amountPaid: number;
  plannedTotal: number;
  minimumDue: number;
  country: Country;
}): PaymentConsequence {
  const { loan, amountPaid, plannedTotal, minimumDue, country } = params;
  const paid = Math.max(0, Math.round(amountPaid));
  const isCard = loan.loanType === 'credit_card';
  const gstMult = country === 'IN' ? 1 + MARKET_BENCHMARKS.IN.gstRate : 1;

  // 1. Paid more than planned (Prepayment surplus)
  if (paid > plannedTotal + (country === 'IN' ? 100 : 5)) {
    const extraAbovePlan = paid - plannedTotal;
    const annualSaved = Math.round(extraAbovePlan * loan.annualRate * (isCard ? gstMult : 1));
    return {
      severity: 'positive',
      headline: `Extra ${formatMoney(extraAbovePlan, country)} principal cut logged`,
      summary: `Paying ${formatMoney(paid, country)} attacks principal directly and saves roughly ${formatMoney(annualSaved, country)}/yr in ongoing interest.`,
      immediateFee: 0,
      monthlyInterestImpact: -Math.round(annualSaved / 12),
      graceRevoked: isCard && paid < loan.outstanding,
      bureauImpact: 'Positive — lower credit utilization & clean on-time history.',
      recommendedAction:
        loan.rateType === 'floating' && country === 'IN' && !isCard
          ? 'Verify your bank applies this extra payment to reduce tenure (not EMI) with ₹0 foreclosure penalty under RBI Directions 2025.'
          : 'Great execution — keep extra cash aimed at your highest True-APR account.',
    };
  }

  // 2. Paid full planned amount (or full card balance)
  if (paid >= plannedTotal || (isCard && paid >= loan.outstanding)) {
    const fullCardCleared = isCard && paid >= loan.outstanding;
    return {
      severity: 'positive',
      headline: fullCardCleared ? 'Full statement cleared — grace period restored' : 'Scheduled plan payment completed',
      summary: fullCardCleared
        ? `Clearing ${formatMoney(paid, country)} restores your interest-free grace period on future swipes.`
        : `On-track payment of ${formatMoney(paid, country)} keeps your account current and on schedule.`,
      immediateFee: 0,
      monthlyInterestImpact: 0,
      graceRevoked: isCard && !fullCardCleared,
      bureauImpact: 'On-time payment reported cleanly to CIBIL/Experian/Equifax.',
      recommendedAction:
        isCard && !fullCardCleared
          ? 'Pause new swipes on this card until the remaining revolving balance hits zero so new purchases do not incur Day-1 interest.'
          : 'No further action needed this month.',
    };
  }

  // 3. Credit Card Partial Payment (paid >= minimumDue, but < planned / total due)
  if (isCard && paid >= minimumDue && paid > 0) {
    const unpaid = Math.max(0, loan.outstanding - paid);
    const nextMonthInt = Math.round(unpaid * (loan.annualRate / 12) * gstMult);
    return {
      severity: 'warning',
      headline: 'Late fee avoided — but interest-free grace period is REVOKED',
      summary: `Paying ${formatMoney(paid, country)} covers the ${formatMoney(minimumDue, country)} minimum due, so you avoid a late penalty. However, the remaining ${formatMoney(unpaid, country)} plus EVERY new swipe on this card accrues daily interest from Day 1 (~${formatMoney(nextMonthInt, country)} next cycle${country === 'IN' ? ', incl. 18% GST' : ''}).`,
      immediateFee: 0,
      monthlyInterestImpact: nextMonthInt,
      graceRevoked: true,
      bureauImpact: 'No missed-payment mark, though high utilization (>30%) can temporarily dip score.',
      recommendedAction: 'Switch daily spending to UPI/debit immediately until this card balance is ₹0/$0 so new purchases stop triggering Day-1 revolving interest.',
    };
  }

  // 4. Credit Card Below Minimum or Unable to Pay (paid < minimumDue)
  if (isCard) {
    const lateFee =
      country === 'IN'
        ? Math.round((loan.outstanding > 50000 ? 1300 : loan.outstanding > 10000 ? 950 : 500) * gstMult)
        : 41;
    const unpaid = Math.max(0, loan.outstanding - paid);
    const nextMonthInt = Math.round(unpaid * (loan.annualRate / 12) * gstMult);
    return {
      severity: 'critical',
      headline: paid === 0 ? 'Unable to pay card — Late fee + bureau alert triggered' : 'Below Minimum Due — Treated as Missed Payment',
      summary: `Paying ${formatMoney(paid, country)} is below the ${formatMoney(minimumDue, country)} minimum due. Expect ~${formatMoney(lateFee, country)} late fee${country === 'IN' ? ' (incl. 18% GST)' : ''}, revoked grace period, and ~${formatMoney(nextMonthInt, country)} next-cycle interest.`,
      immediateFee: lateFee,
      monthlyInterestImpact: nextMonthInt,
      graceRevoked: true,
      bureauImpact:
        country === 'IN'
          ? 'Reported as SMA-0 (1–30 DPD); crossing 30 days overdue drops CIBIL by 50–100+ points.'
          : '30-day delinquency reported to Equifax/Experian/TransUnion can drop FICO by 60–110 points.',
      legalTimeline:
        country === 'IN'
          ? 'Day 1–30: SMA-0 (Late fee + calls) · Day 31–60: SMA-1 · Day 61–90: SMA-2 · Day 90+: NPA / Card blocked'
          : 'Day 1: Late fee · Day 30: Bureau 30-DPD mark · Day 60: Penalty APR (~29.99%) · Day 180: Charge-off',
      recommendedAction: `Even paying ${formatMoney(minimumDue, country)} before the 3-day grace cutoff prevents the bureau hit. Otherwise, open Can't Pay Shield to request a written hardship EMI conversion.`,
    };
  }

  // 5. Term Loan (Home / Auto / Personal / Education / Gold) Partial or Unable to Pay
  const shortfall = Math.max(0, minimumDue - paid);
  const bounceFee = country === 'IN' ? 590 : 35; // ₹500 + 18% GST NACH bounce / $35 US late fee
  const penalMonthly = Math.round((shortfall * 0.02) / 12); // 2% p.a. simple penal charge on overdue (RBI 2024: non-compounding!)
  const isSecured = loan.loanType === 'home_loan' || loan.loanType === 'gold_loan' || loan.loanType === 'auto_loan';

  return {
    severity: 'critical',
    headline:
      paid === 0
        ? `Missed EMI on ${loan.name} — NACH bounce & delinquency clock`
        : `Short by ${formatMoney(shortfall, country)} — Partial EMI triggers bounce/overdue status`,
    summary: `Most banks cannot debit a partial NACH/ACH mandate. Expect ~${formatMoney(bounceFee, country)} bounce/late fee plus ~${formatMoney(penalMonthly, country)}/mo penal charge on the overdue portion.${country === 'IN' ? ' (Under RBI 2024 Fair Lending Directions, penal charges CANNOT be compounded onto principal.)' : ''}`,
    immediateFee: bounceFee,
    monthlyInterestImpact: Math.round((shortfall * loan.annualRate) / 12) + penalMonthly,
    graceRevoked: false,
    bureauImpact:
      country === 'IN'
        ? `Account enters SMA-0 on Day 1 overdue; CIBIL DPD counter increments at 30 days.${isSecured ? ' Priority #1 collateral account!' : ''}`
        : `30-day late mark reported after grace period (typically 15 days for mortgages).${isSecured ? ' Secured asset priority!' : ''}`,
    legalTimeline:
      country === 'IN'
        ? 'Day 1–30: SMA-0 · Day 31–60: SMA-1 · Day 61–90: SMA-2 · Day 90+: NPA (SARFAESI 60-day notice risk on secured loans)'
        : 'Day 15: Late fee · Day 30: Credit bureau report · Day 120: Formal foreclosure / repossession eligibility',
    recommendedAction:
      'Open Can\'t Pay Shield immediately to send a written proactive Hardship & Tenure-Extension notice BEFORE the due date — this creates a statutory paper trail and protects your collateral.',
  };
}

interface SimRun {
  months: number;
  totalInterest: number;
  monthlyBalances: number[];
  monthlyCumInterest: number[];
  monthOneAllocations: MonthAllocationRow[];
  monthOneInterest: number;
  negativeAmortizationLoans: string[];
}

function runSingleSimulation(
  loans: Loan[],
  metrics: LoanMetrics[],
  country: Country,
  strategy: PayoffStrategy,
  monthlyExtraBudget: number,
  baseMonthlyIncome: number,
  baseLivingSpend: number,
  stress: StressScenario,
): SimRun {
  const shockFraction = (stress.rateShockBps || 0) / 10000;
  const rateShockMonth = Math.max(1, Math.round(stress.rateShockMonth || 1));
  const raiseEmiOnShock = stress.rateShockAction === 'raise_emi';

  const active = loans.map((l, idx) => {
    const isFloatingLoan = l.rateType === 'floating' && l.loanType !== 'credit_card';
    const baseAnnualRate = l.annualRate;
    const shockedAnnualRate = isFloatingLoan
      ? Math.max(0.01, baseAnnualRate + shockFraction)
      : baseAnnualRate;

    return {
      loan: l,
      metric: metrics[idx],
      isFloatingLoan,
      balance: Math.max(0, l.outstanding),
      baseAnnualRate,
      shockedAnnualRate,
      shockApplied: false,
      currentEmi: metrics[idx].minimumDueThisMonth,
      baseMin: metrics[idx].minimumDueThisMonth,
      newSpend: l.loanType === 'credit_card' ? Math.max(0, l.monthlyNewSpend ?? 0) : 0,
    };
  });

  const negativeAmortizationLoans = new Set<string>();

  const MAX_MONTHS = 360;
  let month = 0;
  let totalInterest = 0;
  const monthlyBalances: number[] = [active.reduce((s, a) => s + a.balance, 0)];
  const monthlyCumInterest: number[] = [0];
  let monthOneAllocations: MonthAllocationRow[] = [];
  let monthOneInterest = 0;

  const hikePct = Math.max(0, stress.annualHikePct || 0) / 100;
  const hikeStartMonth = Math.max(1, Math.round(stress.hikeStartMonth || 5));
  const hikeShare = Math.min(1, Math.max(0, (stress.hikeToDebtPct ?? 50) / 100));
  const windfallAmt = Math.max(0, stress.windfallAmount || 0);
  const windfallMonth = Math.max(1, Math.round(stress.windfallMonth || 6));
  const windfallRecurring = Boolean(stress.windfallRecurring);
  const expenseInflationPct = Math.max(0, stress.expenseInflationPct || 0) / 100;
  const annualStepUpPct = Math.max(0, stress.annualStepUpPct || 0) / 100;
  const incomeDropFraction = Math.min(1, Math.max(0, (stress.incomeDropPct || 0) / 100));
  const incomeDropStart = Math.max(1, Math.round(stress.incomeDropStartMonth || 1));
  const incomeDropDuration = Math.max(0, Math.round(stress.incomeDropDurationMonths || 0));

  while (month < MAX_MONTHS && active.some((a) => a.balance > 1)) {
    month += 1;
    let monthInterestSum = 0;

    // Apply dated floating-rate shock when month reaches rateShockMonth
    for (const a of active) {
      if (a.isFloatingLoan && !a.shockApplied && month >= rateShockMonth && shockFraction !== 0) {
        a.shockApplied = true;
        if (raiseEmiOnShock && a.balance > 1) {
          const remMonths = Math.max(12, a.loan.monthsRemaining - (month - 1));
          a.currentEmi = computeEmi(a.balance, a.shockedAnnualRate, remMonths);
        }
      }
    }

    // Annual salary hike starting from hikeStartMonth (repeats every 12 months)
    const hikeCycles =
      hikePct > 0 && month >= hikeStartMonth ? Math.floor((month - hikeStartMonth) / 12) + 1 : 0;
    const hikeExtraBoost =
      hikeCycles > 0 && strategy !== 'minimums'
        ? Math.round(baseMonthlyIncome * (Math.pow(1 + hikePct, hikeCycles) - 1) * hikeShare)
        : 0;

    // Annual step-up on extra payments starting from hikeStartMonth
    const stepUpCycles =
      annualStepUpPct > 0 && month >= hikeStartMonth
        ? Math.floor((month - hikeStartMonth) / 12) + 1
        : 0;
    const steppedExtraBase =
      stepUpCycles > 0 && strategy !== 'minimums'
        ? Math.round(monthlyExtraBudget * Math.pow(1 + annualStepUpPct, stepUpCycles))
        : monthlyExtraBudget;

    // Annual living-expense inflation drag (starts Month 13)
    const inflationYears = Math.floor((month - 1) / 12);
    const inflationDrag =
      expenseInflationPct > 0 && inflationYears > 0 && strategy !== 'minimums'
        ? Math.round(baseLivingSpend * (Math.pow(1 + expenseInflationPct, inflationYears) - 1))
        : 0;

    // Temporary or permanent income drop window
    const inIncomeDropWindow =
      incomeDropFraction > 0 &&
      month >= incomeDropStart &&
      (incomeDropDuration === 0 || month < incomeDropStart + incomeDropDuration);
    const incomeDropDrag = inIncomeDropWindow
      ? Math.round(baseMonthlyIncome * incomeDropFraction)
      : 0;

    // 1. Accrue interest and compute required minimums
    const reqMins: number[] = active.map((a) => {
      if (a.balance <= 0.5) return 0;
      const effAnnualRate = a.shockApplied ? a.shockedAnnualRate : a.baseAnnualRate;

      if (a.loan.loanType === 'credit_card') {
        const { interestWithTax, minimumDue } = computeCardCycleCharges(
          a.balance,
          effAnnualRate,
          a.newSpend,
          country,
        );
        monthInterestSum += interestWithTax;
        a.balance += a.newSpend + interestWithTax;
        return Math.min(Math.round(a.balance), minimumDue);
      }

      const interest = a.balance * (effAnnualRate / 12);
      monthInterestSum += interest;
      if (a.currentEmi > 0 && a.currentEmi <= interest) {
        negativeAmortizationLoans.add(a.loan.name);
      }
      a.balance += interest;
      return Math.min(Math.round(a.balance), Math.round(a.currentEmi));
    });

    // Apply minimums & capture BOTH completed loans AND partial final-month leftover EMI rollover
    let freedEmiRollover = 0;
    active.forEach((a, i) => {
      if (a.balance <= 0.5) {
        if (strategy !== 'minimums') {
          freedEmiRollover += a.baseMin;
        }
        return;
      }
      a.balance = Math.max(0, a.balance - reqMins[i]);
      if (a.balance < 1) a.balance = 0;
      if (strategy !== 'minimums' && a.balance === 0 && reqMins[i] < a.baseMin) {
        freedEmiRollover += Math.max(0, a.baseMin - reqMins[i]);
      }
    });

    // 2. Allocate extra cash (stepped base + hike boost + windfall + freed rollover - inflation - income shock)
    const extraPerLoan = active.map(() => 0);
    const isWindfallMonth =
      windfallAmt > 0 &&
      strategy !== 'minimums' &&
      (month === windfallMonth ||
        (windfallRecurring && month > windfallMonth && (month - windfallMonth) % 12 === 0));
    const windfallNow = isWindfallMonth ? windfallAmt : 0;

    // If an income shock is active in Month 1, monthlyExtraBudget was already computed from effectiveIncome in simulatePayoffPlan;
    // only subtract incomeDropDrag for delayed drop windows (incomeDropStart > 1) so we don't double-count!
    const dynamicDropDrag = incomeDropStart > 1 ? incomeDropDrag : 0;

    let extraPool =
      strategy === 'minimums'
        ? 0
        : Math.max(
            0,
            steppedExtraBase +
              hikeExtraBoost +
              windfallNow +
              freedEmiRollover -
              inflationDrag -
              dynamicDropDrag,
          );

    if (extraPool > 0) {
      const order = active
        .map((a, i) => ({ a, i }))
        .filter(({ a }) => a.balance > 0.5)
        .sort((x, y) => {
          if (strategy === 'snowball') {
            return x.a.balance - y.a.balance;
          }
          return y.a.metric.trueAllInApr - x.a.metric.trueAllInApr;
        });

      for (const { a, i } of order) {
        if (extraPool <= 0.5) break;
        const pay = Math.min(a.balance, extraPool);
        a.balance = Math.max(0, a.balance - pay);
        if (a.balance < 1) a.balance = 0;
        extraPerLoan[i] += pay;
        extraPool -= pay;
      }
    }

    totalInterest += monthInterestSum;

    if (month === 1) {
      monthOneInterest = Math.round(monthInterestSum);
      const topExtraIdx = extraPerLoan.findIndex((x) => x > 0);
      monthOneAllocations = active
        .filter((_, i) => reqMins[i] > 0 || extraPerLoan[i] > 0)
        .map((a, i) => ({
          loanId: a.loan.id,
          label: a.loan.name,
          bank: a.loan.bank,
          loanType: a.loan.loanType,
          minimum: Math.round(reqMins[i]),
          extra: Math.round(extraPerLoan[i]),
          total: Math.round(reqMins[i] + extraPerLoan[i]),
          trueAllInApr: a.metric.trueAllInApr,
          isExtraTarget: i === topExtraIdx && extraPerLoan[i] > 0,
          reason:
            extraPerLoan[i] > 0
              ? strategy === 'snowball'
                ? `Smallest balance — clearing this frees ${formatMoney(a.baseMin, country)}/mo fastest.`
                : `Highest real rate (${formatPct(a.metric.trueAllInApr)}) — every extra ${country === 'IN' ? 'rupee' : 'dollar'} here saves the most.`
              : a.loan.loanType === 'credit_card'
                ? 'Minimum due to keep card current'
                : 'Scheduled EMI payment',
        }));
    }

    monthlyBalances.push(Math.round(active.reduce((s, a) => s + a.balance, 0)));
    monthlyCumInterest.push(Math.round(totalInterest));
  }

  return {
    months: month,
    totalInterest: Math.round(totalInterest),
    monthlyBalances,
    monthlyCumInterest,
    monthOneAllocations,
    monthOneInterest,
    negativeAmortizationLoans: Array.from(negativeAmortizationLoans),
  };
}

export function simulatePayoffPlan(
  profile: UserProfile,
  strategy: PayoffStrategy = 'avalanche',
  extraOverride?: number | null,
  stressInput?: Partial<StressScenario>,
): SimulationResult {
  const stress: StressScenario = {
    ...DEFAULT_STRESS_SCENARIO,
    ...(stressInput ?? {}),
  };

  const openLoans = profile.loans.filter((l) => l.outstanding > 0);
  const shockFraction = (stress.rateShockBps || 0) / 10000;
  const shockStartsNow = (stress.rateShockMonth || 1) <= 1;

  const loanMetrics: LoanMetrics[] = openLoans.map((loan) => {
    const effectiveLoan: Loan =
      loan.rateType === 'floating' && loan.loanType !== 'credit_card' && shockFraction !== 0 && shockStartsNow
        ? { ...loan, annualRate: Math.max(0.01, loan.annualRate + shockFraction) }
        : loan;

    const { trueAllInApr, explanation } = computeTrueAllInApr(
      effectiveLoan,
      profile.country,
      profile.taxRegimeIN,
      profile.marginalTaxRate,
    );
    const minimumDueThisMonth = computeMinimumDue(effectiveLoan, profile.country);
    const monthlyRate =
      profile.country === 'IN' && effectiveLoan.loanType === 'credit_card'
        ? (effectiveLoan.annualRate / 12) * (1 + MARKET_BENCHMARKS.IN.gstRate)
        : effectiveLoan.annualRate / 12;

    return {
      loan: effectiveLoan,
      nominalApr: effectiveLoan.annualRate,
      trueAllInApr,
      aprExplanation: explanation,
      minimumDueThisMonth,
      monthlyInterest: Math.round(effectiveLoan.outstanding * monthlyRate),
      revolvingAnalysis:
        effectiveLoan.loanType === 'credit_card'
          ? computeCardRevolvingTrap(effectiveLoan, profile.country)
          : undefined,
    };
  });

  const dropStartsNow = (stress.incomeDropStartMonth || 1) <= 1;
  const effectiveIncome = dropStartsNow
    ? Math.round(profile.monthlyTakeHome * (1 - Math.min(1, Math.max(0, (stress.incomeDropPct || 0) / 100))))
    : profile.monthlyTakeHome;
  const totalPrincipal = Math.round(openLoans.reduce((s, l) => s + l.outstanding, 0));
  const monthlyMandatoryDues = Math.round(loanMetrics.reduce((s, m) => s + m.minimumDueThisMonth, 0));

  // Debt-competing goals sinking fund
  const enabledGoals = (profile.goals ?? []).filter(
    (g) => g.enabled && g.targetAmount > g.savedSoFar && g.targetMonths > 0,
  );
  const monthlyToGoals = Math.round(
    enabledGoals.reduce(
      (sum, g) => sum + Math.ceil((g.targetAmount - g.savedSoFar) / Math.max(1, g.targetMonths)),
      0,
    ),
  );
  const totalGoalFundingGap = enabledGoals.reduce(
    (sum, g) => sum + Math.max(0, g.targetAmount - g.savedSoFar),
    0,
  );

  const monthlySpareBeforeGoals = Math.round(effectiveIncome - profile.monthlyLivingSpend - monthlyMandatoryDues);
  const monthlySpareCash = Math.round(monthlySpareBeforeGoals - monthlyToGoals);
  const isShortfall = monthlySpareCash < 0;
  const shortfallAmount = isShortfall ? Math.abs(monthlySpareCash) : 0;

  // Emergency runway during income drop or shortfall
  const shockedIncomeForRunway = Math.round(
    profile.monthlyTakeHome * (1 - Math.min(1, Math.max(0, (stress.incomeDropPct || 0) / 100))),
  );
  const monthlyBurn = Math.max(1, profile.monthlyLivingSpend + monthlyMandatoryDues - shockedIncomeForRunway);
  const emergencyRunwayMonths =
    shockedIncomeForRunway >= profile.monthlyLivingSpend + monthlyMandatoryDues
      ? Math.round((profile.emergencyFundCurrent / Math.max(1, profile.monthlyLivingSpend + monthlyMandatoryDues)) * 10) / 10
      : Math.round((profile.emergencyFundCurrent / monthlyBurn) * 10) / 10;

  const needsEmergencyFund = profile.emergencyFundCurrent < profile.emergencyFundTarget;
  const rawEfAllocation =
    !isShortfall && needsEmergencyFund
      ? Math.round(monthlySpareCash * (Math.min(100, Math.max(0, profile.emergencySplitPct)) / 100))
      : 0;

  const effectiveExtra =
    extraOverride !== undefined && extraOverride !== null
      ? Math.max(0, extraOverride)
      : profile.extraMonthlyOverride !== null
        ? Math.max(0, profile.extraMonthlyOverride)
        : Math.max(0, monthlySpareCash - rawEfAllocation);

  const monthlyToEmergencyFund = Math.max(
    0,
    Math.min(rawEfAllocation, Math.max(0, monthlySpareCash - effectiveExtra)),
  );

  const chosenRun = runSingleSimulation(
    openLoans,
    loanMetrics,
    profile.country,
    strategy,
    effectiveExtra,
    effectiveIncome,
    profile.monthlyLivingSpend,
    stress,
  );
  const minimumsRun = runSingleSimulation(
    openLoans,
    loanMetrics,
    profile.country,
    'minimums',
    0,
    effectiveIncome,
    profile.monthlyLivingSpend,
    stress,
  );
  const snowballRun = runSingleSimulation(
    openLoans,
    loanMetrics,
    profile.country,
    'snowball',
    effectiveExtra,
    effectiveIncome,
    profile.monthlyLivingSpend,
    stress,
  );

  // Goal tradeoff comparison: what if goals weren't carved out?
  let goalTradeoff: GoalTradeoffSummary = {
    totalMonthlyGoalSinking: monthlyToGoals,
    activeGoalCount: enabledGoals.length,
    monthsDelayedByGoals: 0,
    extraLoanInterestFromGoals: 0,
    cardDebtCostIfUnfunded: 0,
    netBenefitOfSinkingFund: 0,
  };
  if (monthlyToGoals > 0 && openLoans.length > 0) {
    const noGoalExtra = effectiveExtra + monthlyToGoals;
    const noGoalRun = runSingleSimulation(
      openLoans,
      loanMetrics,
      profile.country,
      strategy,
      noGoalExtra,
      effectiveIncome,
      profile.monthlyLivingSpend,
      stress,
    );
    const monthsDelayedByGoals = Math.max(0, chosenRun.months - noGoalRun.months);
    const extraLoanInterestFromGoals = Math.max(0, chosenRun.totalInterest - noGoalRun.totalInterest);
    const emergencyCardRate = profile.country === 'IN' ? 0.6031 : 0.278;
    const cardDebtCostIfUnfunded = Math.round(totalGoalFundingGap * emergencyCardRate * 0.55);
    goalTradeoff = {
      totalMonthlyGoalSinking: monthlyToGoals,
      activeGoalCount: enabledGoals.length,
      monthsDelayedByGoals,
      extraLoanInterestFromGoals,
      cardDebtCostIfUnfunded,
      netBenefitOfSinkingFund: cardDebtCostIfUnfunded - extraLoanInterestFromGoals,
    };
  }

  // Sample trajectory points evenly
  const maxLen = Math.max(chosenRun.monthlyBalances.length, minimumsRun.monthlyBalances.length);
  const step = maxLen > 48 ? Math.ceil(maxLen / 36) : maxLen > 24 ? 2 : 1;
  const trajectory: TrajectoryPoint[] = [];
  for (let m = 0; m < maxLen; m += step) {
    trajectory.push({
      monthIndex: m,
      label: addMonthsLabel(m, 'short'),
      optimizedBalance: chosenRun.monthlyBalances[m] ?? 0,
      minimumsBalance: minimumsRun.monthlyBalances[m] ?? 0,
      snowballBalance: snowballRun.monthlyBalances[m] ?? 0,
      cumulativeInterestOptimized:
        chosenRun.monthlyCumInterest[Math.min(m, chosenRun.monthlyCumInterest.length - 1)] ??
        chosenRun.totalInterest,
      cumulativeInterestMinimums:
        minimumsRun.monthlyCumInterest[Math.min(m, minimumsRun.monthlyCumInterest.length - 1)] ??
        minimumsRun.totalInterest,
    });
  }
  if (trajectory.length > 0 && trajectory[trajectory.length - 1].monthIndex !== maxLen - 1) {
    const last = maxLen - 1;
    trajectory.push({
      monthIndex: last,
      label: addMonthsLabel(last, 'short'),
      optimizedBalance: chosenRun.monthlyBalances[last] ?? 0,
      minimumsBalance: minimumsRun.monthlyBalances[last] ?? 0,
      snowballBalance: snowballRun.monthlyBalances[last] ?? 0,
      cumulativeInterestOptimized: chosenRun.totalInterest,
      cumulativeInterestMinimums: minimumsRun.totalInterest,
    });
  }

  // Generate "Where RightDue Disagrees with Plain Calculators & Banks" receipts
  const disagreements: DisagreementInsight[] = [];

  const revolvingCard = loanMetrics.find((m) => m.loan.loanType === 'credit_card' && m.loan.outstanding > 0);
  if (revolvingCard && profile.country === 'IN') {
    const annualHiddenGst = Math.round(revolvingCard.loan.outstanding * revolvingCard.nominalApr * 0.18);
    disagreements.push({
      id: 'in-card-gst',
      title: `Your ${revolvingCard.loan.name} really costs ${formatPct(revolvingCard.trueAllInApr)}, not ${formatPct(revolvingCard.nominalApr)}`,
      rupeeImpact: annualHiddenGst,
      summary: `At ${formatPct(revolvingCard.nominalApr)} stated rate, compounding plus 18% GST adds ${formatMoney(annualHiddenGst, 'IN')}/yr in hidden cost if revolved — plus revoking the interest-free grace period on all new swipes.`,
      detail:
        'Plain EMI calculators ignore India’s 18% GST on credit-card finance charges and grace-period revocation. RightDue ranks debt by true after-tax, after-GST cost.',
      severity: 'high',
      actionLabel: 'Check Consolidation Math',
      actionTab: 'decisions',
    });
  } else if (revolvingCard && profile.country === 'US') {
    const annualCompoundingSpread = Math.max(
      120,
      Math.round(revolvingCard.loan.outstanding * Math.max(0.02, revolvingCard.trueAllInApr - revolvingCard.nominalApr)),
    );
    disagreements.push({
      id: 'us-card-daily',
      title: `Your ${revolvingCard.loan.name} really costs ${formatPct(revolvingCard.trueAllInApr)} APY, not ${formatPct(revolvingCard.nominalApr)}`,
      rupeeImpact: annualCompoundingSpread,
      summary: `Daily compounding plus losing your interest-free grace period adds ~${formatMoney(annualCompoundingSpread, 'US')}/yr in hidden cost — and every new swipe accrues interest from Day 1.`,
      detail:
        'Standard debt calculators treat card APR as simple monthly interest and ignore grace-period revocation. RightDue models true daily compounding.',
      severity: 'high',
      actionLabel: 'Check Consolidation Math',
      actionTab: 'decisions',
    });
  }

  const floatingHome = loanMetrics.find((m) => m.loan.loanType === 'home_loan' && m.loan.rateType === 'floating');
  const anyUsHome = loanMetrics.find((m) => m.loan.loanType === 'home_loan');
  if (floatingHome && profile.country === 'IN') {
    const halfPctCost = Math.round(floatingHome.loan.outstanding * 0.005);
    disagreements.push({
      id: 'in-eblr-audit',
      title: `Audit ${floatingHome.loan.bank} against the Oct 2026 RBI repo move (5.50%)`,
      rupeeImpact: halfPctCost,
      summary: `Run Loan Shield to verify whether past repo cuts reached ${floatingHome.loan.bank} and see exact Higher EMI vs Longer Tenure cost.`,
      detail:
        'Every 0.50% missed reset costs roughly this amount per year in excess interest — claimable under RBI Directions, 2025.',
      severity: 'high',
      actionLabel: 'Run Loan Shield Audit',
      actionTab: 'shield',
    });
  } else if (anyUsHome && profile.country === 'US') {
    const halfPctCost = Math.round(anyUsHome.loan.outstanding * 0.005);
    disagreements.push({
      id: 'us-respa-audit',
      title: `Audit ${anyUsHome.loan.bank} amortization & RESPA servicing rules`,
      rupeeImpact: halfPctCost,
      summary: `Inspect your principal-vs-interest crossover year, test a 0.50% rate recast, or draft a RESPA Reg X Notice of Error for escrow/payment misapplication.`,
      detail:
        'Even a 0.50% lower mortgage rate saves roughly this much per year — and RESPA § 1024.35 gives servicers a strict 30-business-day response deadline.',
      severity: 'high',
      actionLabel: 'Open Loan Shield & Amortization',
      actionTab: 'shield',
    });
  }

  if (chosenRun.negativeAmortizationLoans.length > 0) {
    disagreements.push({
      id: 'neg-amort',
      title: `Rate shock causes negative amortization on ${chosenRun.negativeAmortizationLoans[0]}`,
      rupeeImpact: Math.round(totalPrincipal * 0.01),
      summary: `At +${stress.rateShockBps} bps, your current EMI no longer covers monthly interest — the balance grows every month unless you increase EMI.`,
      detail: 'Under RBI Responsible Business Conduct para 349, banks must notify you and offer an EMI increase or part-prepayment option.',
      severity: 'high',
      actionLabel: 'Audit Rate Move',
      actionTab: 'shield',
    });
  } else {
    const snowballDiff = Math.max(0, snowballRun.totalInterest - chosenRun.totalInterest);
    disagreements.push({
      id: 'order-diff',
      title:
        snowballDiff > 1000
          ? `True-APR order saves ${formatMoney(snowballDiff, profile.country)} more than Smallest-First`
          : `Routing ${formatMoney(effectiveExtra, profile.country)}/mo extra saves ${formatMoney(Math.max(0, minimumsRun.totalInterest - chosenRun.totalInterest), profile.country)}`,
      rupeeImpact:
        snowballDiff > 1000 ? snowballDiff : Math.max(0, minimumsRun.totalInterest - chosenRun.totalInterest),
      summary:
        snowballDiff > 1000
          ? `Paying smallest balances first leaves your costliest compounding debt alive longer.`
          : `Both Avalanche and Snowball target your costliest debt first right now, giving you speed and math together.`,
      detail: 'Toggle True-APR First vs Smallest First above to inspect the exact timeline delta.',
      severity: 'info',
    });
  }

  return {
    strategy,
    debtFreeMonths: chosenRun.months,
    debtFreeDateLabel: addMonthsLabel(chosenRun.months, 'long'),
    totalInterest: chosenRun.totalInterest,
    totalPrincipal,
    minimumsInterest: minimumsRun.totalInterest,
    minimumsMonths: minimumsRun.months,
    snowballInterest: snowballRun.totalInterest,
    snowballMonths: snowballRun.months,
    interestSavedVsMinimums: Math.max(0, minimumsRun.totalInterest - chosenRun.totalInterest),
    monthsSavedVsMinimums: Math.max(0, minimumsRun.months - chosenRun.months),
    interestSavedVsSnowball: Math.max(0, snowballRun.totalInterest - chosenRun.totalInterest),
    monthsSavedVsSnowball: Math.max(0, snowballRun.months - chosenRun.months),
    monthlyIncome: effectiveIncome,
    monthlyLivingSpend: profile.monthlyLivingSpend,
    monthlyMandatoryDues,
    monthlyToGoals,
    monthlySpareCash,
    monthlyExtraToDebt: effectiveExtra,
    monthlyToEmergencyFund,
    isShortfall,
    shortfallAmount,
    monthOneInterest: chosenRun.monthOneInterest,
    negativeAmortizationLoans: chosenRun.negativeAmortizationLoans,
    emergencyRunwayMonths,
    goalTradeoff,
    allocations: chosenRun.monthOneAllocations,
    loanMetrics,
    trajectory,
    disagreements,
  };
}

export function computeInvestVsPrepay(params: {
  country: Country;
  loan: Loan;
  taxRegimeIN: TaxRegimeIN;
  marginalTaxRate: number;
  amount: number;
  expectedPreTaxReturn: number;
  investmentTaxRate: number;
  prepaySharePct: number;
  horizonYears: number;
}) {
  const { trueAllInApr } = computeTrueAllInApr(
    params.loan,
    params.country,
    params.taxRegimeIN,
    params.marginalTaxRate,
  );
  const postTaxInvestReturn = params.expectedPreTaxReturn * (1 - params.investmentTaxRate);
  const breakEvenPreTaxReturn = trueAllInApr / Math.max(0.01, 1 - params.investmentTaxRate);

  const prepayAmount = params.amount * (params.prepaySharePct / 100);
  const investAmount = params.amount - prepayAmount;

  const prepayBenefit = prepayAmount * (Math.pow(1 + trueAllInApr, params.horizonYears) - 1);
  const investGain = investAmount * (Math.pow(1 + postTaxInvestReturn, params.horizonYears) - 1);
  const purePrepayBenefit = params.amount * (Math.pow(1 + trueAllInApr, params.horizonYears) - 1);
  const pureInvestGain = params.amount * (Math.pow(1 + postTaxInvestReturn, params.horizonYears) - 1);

  return {
    trueLoanCost: trueAllInApr,
    postTaxInvestReturn,
    breakEvenPreTaxReturn,
    prepayAmount: Math.round(prepayAmount),
    investAmount: Math.round(investAmount),
    combinedNetAdvantage: Math.round(prepayBenefit + investGain),
    purePrepayBenefit: Math.round(purePrepayBenefit),
    pureInvestGain: Math.round(pureInvestGain),
    edgeFavors:
      Math.abs(postTaxInvestReturn - trueAllInApr) < 0.004
        ? ('close_call' as const)
        : trueAllInApr > postTaxInvestReturn
          ? ('prepay' as const)
          : ('invest' as const),
  };
}
