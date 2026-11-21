import type {
  AmortizationMonthRow,
  AmortizationScenarioKey,
  AmortizationScenarioResult,
  AmortizationYearRow,
  LoanAuditInput,
  LoanAuditResult,
} from './types';
import { addMonthsLabel, computeEmi } from './math';

export interface SingleAmortizationParams {
  key: AmortizationScenarioKey;
  label: string;
  subtitle: string;
  principal: number;
  annualRate: number;
  monthlyEmi: number;
  extraMonthly?: number;
  annualStepUpPct?: number;
  stepUpStartMonth?: number;
  maxMonths?: number;
}

/**
 * Computes an exact, drift-free reducing-balance amortization schedule (monthly + yearly).
 * Guarantees sum(principalPaid + extraPrincipal) === principal (within 1 unit) whenever the loan amortizes.
 */
export function buildAmortizationSchedule(
  params: SingleAmortizationParams,
  baseline?: { totalInterest: number; totalMonths: number },
): AmortizationScenarioResult {
  const principal = Math.max(0, Math.round(params.principal));
  const annualRate = Math.max(0, params.annualRate);
  const monthlyRate = annualRate / 12;
  const baseEmi = Math.max(0, Math.round(params.monthlyEmi));
  const baseExtra = Math.max(0, Math.round(params.extraMonthly ?? 0));
  const stepUpPct = Math.max(0, params.annualStepUpPct ?? 0) / 100;
  const stepUpStart = Math.max(1, Math.round(params.stepUpStartMonth ?? 13));
  const maxMonths = Math.min(480, Math.max(12, params.maxMonths ?? 420));

  const monthly: AmortizationMonthRow[] = [];
  let balance = principal;
  let cumPrincipal = 0;
  let cumInterest = 0;
  let crossoverMonth: number | null = null;
  let negativeAmortization = false;

  if (principal > 0 && baseEmi + baseExtra <= principal * monthlyRate && monthlyRate > 0) {
    negativeAmortization = true;
  }

  let m = 0;
  while (m < maxMonths && balance > 0.5) {
    m += 1;
    const openingBalance = balance;
    const interestExact = openingBalance * monthlyRate;

    // Step up EMI/extra annually once we pass stepUpStart
    const stepUpYears =
      stepUpPct > 0 && m >= stepUpStart ? Math.floor((m - stepUpStart) / 12) + 1 : 0;
    const stepMult = stepUpYears > 0 ? Math.pow(1 + stepUpPct, stepUpYears) : 1;

    const scheduledEmi = baseEmi;
    const scheduledExtra = Math.round(baseExtra * stepMult + (stepUpYears > 0 ? baseEmi * (stepMult - 1) : 0));

    let emiPaid = scheduledEmi;
    let principalFromEmi = 0;
    let extraPrincipal = 0;

    if (openingBalance + interestExact <= scheduledEmi) {
      // Final month clears remaining principal + exact accrued interest
      emiPaid = openingBalance + interestExact;
      principalFromEmi = openingBalance;
      extraPrincipal = 0;
      balance = 0;
    } else if (scheduledEmi <= interestExact) {
      // Negative amortization unless extra payment covers the gap
      const totalPayment = scheduledEmi + scheduledExtra;
      if (totalPayment <= interestExact) {
        negativeAmortization = true;
        const unpaidInt = interestExact - totalPayment;
        emiPaid = scheduledEmi;
        principalFromEmi = 0;
        extraPrincipal = 0;
        balance = openingBalance + unpaidInt;
      } else {
        const netPrin = Math.min(openingBalance, totalPayment - interestExact);
        emiPaid = scheduledEmi;
        principalFromEmi = 0;
        extraPrincipal = netPrin;
        balance = Math.max(0, openingBalance - netPrin);
      }
    } else {
      principalFromEmi = scheduledEmi - interestExact;
      const remainingAfterEmi = Math.max(0, openingBalance - principalFromEmi);
      extraPrincipal = Math.min(remainingAfterEmi, scheduledExtra);
      balance = Math.max(0, remainingAfterEmi - extraPrincipal);
    }

    const totalPrincipalThisMonth = principalFromEmi + extraPrincipal;
    cumPrincipal += totalPrincipalThisMonth;
    cumInterest += interestExact;

    if (crossoverMonth === null && totalPrincipalThisMonth > interestExact) {
      crossoverMonth = m;
    }

    monthly.push({
      month: m,
      label: addMonthsLabel(m, 'short'),
      openingBalance: Math.round(openingBalance),
      emiPaid: Math.round(emiPaid + extraPrincipal),
      principalPaid: Math.round(principalFromEmi),
      interestPaid: Math.round(interestExact),
      extraPrincipal: Math.round(extraPrincipal),
      closingBalance: Math.round(balance),
      cumulativePrincipal: Math.round(cumPrincipal),
      cumulativeInterest: Math.round(cumInterest),
    });
  }

  // Aggregate into yearly buckets for crisp visual stacked bars & printable PDF annexures
  const yearly: AmortizationYearRow[] = [];
  for (let i = 0; i < monthly.length; i += 12) {
    const chunk = monthly.slice(i, i + 12);
    const yearNum = Math.floor(i / 12) + 1;
    const opening = chunk[0].openingBalance;
    const closing = chunk[chunk.length - 1].closingBalance;
    const prin = chunk.reduce((s, r) => s + r.principalPaid, 0);
    const extra = chunk.reduce((s, r) => s + r.extraPrincipal, 0);
    const intr = chunk.reduce((s, r) => s + r.interestPaid, 0);
    const totalPrin = prin + extra;
    const totalPaid = totalPrin + intr;
    const principalSharePct = totalPaid > 0 ? Math.round((totalPrin / totalPaid) * 100) : 0;

    yearly.push({
      year: yearNum,
      yearLabel: `Yr ${yearNum}`,
      openingBalance: opening,
      totalPaid: Math.round(totalPaid),
      principalPaid: Math.round(totalPrin),
      interestPaid: Math.round(intr),
      extraPrincipal: Math.round(extra),
      closingBalance: closing,
      principalSharePct,
    });
  }

  const totalInterest = Math.round(cumInterest);
  const totalPaid = Math.round(cumPrincipal + cumInterest);
  const totalMonths = monthly.length;

  return {
    key: params.key,
    label: params.label,
    subtitle: params.subtitle,
    annualRate,
    monthlyEmi: baseEmi,
    extraMonthly: baseExtra,
    annualStepUpPct: params.annualStepUpPct ?? 0,
    totalMonths,
    payoffDateLabel: addMonthsLabel(totalMonths, 'long'),
    totalInterest,
    totalPaid,
    interestSavedVsCurrent: baseline ? Math.round(baseline.totalInterest - totalInterest) : 0,
    monthsSavedVsCurrent: baseline ? baseline.totalMonths - totalMonths : 0,
    crossoverMonth,
    negativeAmortization,
    monthly,
    yearly,
  };
}

/**
 * Builds 4 directly comparable repayment scenarios for the LoanShield Visual Amortization Schedule:
 * 1. Current Schedule (bank's current rate & EMI)
 * 2. Fair Rate Reset (audit.expectedRateNow if lower, else -0.50% negotiated rate, keeping same EMI so tenure drops!)
 * 3. Post-Hike Higher EMI (+0.25% rate rise absorbed by raising EMI instead of extending tenure)
 * 4. Extra Prepayment & Step-Up (user-controlled extra monthly prepayment + annual EMI step-up %)
 */
export function buildLoanShieldAmortizationScenarios(
  input: LoanAuditInput,
  audit: LoanAuditResult,
  options?: { extraMonthly?: number; annualStepUpPct?: number },
): Record<AmortizationScenarioKey, AmortizationScenarioResult> {
  const principal = Math.max(0, input.outstanding);
  const months = Math.max(1, input.monthsRemaining);
  const baseEmi =
    input.emi > 0 ? input.emi : computeEmi(principal, input.currentRate, months);

  const current = buildAmortizationSchedule({
    key: 'current',
    label: 'Current Bank Schedule',
    subtitle: `${(input.currentRate * 100).toFixed(2)}% billed rate · current EMI`,
    principal,
    annualRate: input.currentRate,
    monthlyEmi: baseEmi,
  });

  const hasOwedCut = audit.expectedRateNow < input.currentRate - 0.0005;
  const resetRate = hasOwedCut
    ? audit.expectedRateNow
    : Math.max(0.03, input.currentRate - 0.005);

  const fair_reset = buildAmortizationSchedule(
    {
      key: 'fair_reset',
      label: hasOwedCut ? 'After RBI/Benchmark Reset' : 'After −0.50% Rate Rewrite',
      subtitle: `${(resetRate * 100).toFixed(2)}% rate · keep same EMI to cut tenure`,
      principal,
      annualRate: resetRate,
      monthlyEmi: baseEmi,
    },
    { totalInterest: current.totalInterest, totalMonths: current.totalMonths },
  );

  const hikedRate = input.currentRate + 0.0025;
  const raisedEmi = computeEmi(principal, hikedRate, months);
  const hike_higher_emi = buildAmortizationSchedule(
    {
      key: 'hike_higher_emi',
      label: 'Post-Hike (+0.25%) Higher EMI',
      subtitle: `${(hikedRate * 100).toFixed(2)}% rate · raise EMI to protect tenure`,
      principal,
      annualRate: hikedRate,
      monthlyEmi: raisedEmi,
    },
    { totalInterest: current.totalInterest, totalMonths: current.totalMonths },
  );

  const defaultExtra = input.country === 'IN' ? 10000 : 300;
  const extraMonthly = options?.extraMonthly ?? defaultExtra;
  const annualStepUpPct = options?.annualStepUpPct ?? 5;

  const extra_prepay = buildAmortizationSchedule(
    {
      key: 'extra_prepay',
      label: 'Extra Prepay + Annual Step-Up',
      subtitle: `${(input.currentRate * 100).toFixed(2)}% rate · +extra/mo & ${annualStepUpPct}% yearly step-up`,
      principal,
      annualRate: input.currentRate,
      monthlyEmi: baseEmi,
      extraMonthly,
      annualStepUpPct,
    },
    { totalInterest: current.totalInterest, totalMonths: current.totalMonths },
  );

  return {
    current,
    fair_reset,
    hike_higher_emi,
    extra_prepay,
  };
}
