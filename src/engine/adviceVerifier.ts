import type {
  AdviceClaim,
  AdviceReport,
  OfferAuditInput,
  OfferAuditResult,
  UserProfile,
} from './types';
import { CITATIONS, MARKET_BENCHMARKS, policyRateOn } from './policyRates';
import { computeEmi, computeTrueAllInApr, formatMoney, formatPct, simulatePayoffPlan } from './math';

/**
 * Deterministic Advice & Bank RM Verifier (zero AI hallucination).
 * Splits pasted text into sentences, extracts checkable claims (prepayment fees,
 * payoff order, rates, repo rate, card minimum traps, consolidation), and checks
 * each against the user's real loans + RBI/US rules.
 */
export function verifyPastedAdvice(rawText: string, profile: UserProfile): AdviceReport {
  const text = rawText.trim();
  const sentences = text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 8);

  const sim = simulatePayoffPlan(profile, 'avalanche');
  const claims: AdviceClaim[] = [];
  const notChecked: string[] = [];
  const repoNow = policyRateOn(profile.country, '2026-11-20');
  const topTarget = sim.allocations.find((a) => a.isExtraTarget) || sim.allocations[0];

  sentences.forEach((sentence, idx) => {
    const lower = sentence.toLowerCase();
    let matched = false;

    // 1. Prepayment penalty claim on floating-rate loan in India
    if (
      profile.country === 'IN' &&
      /(?:prepay|foreclos|part[\s-]?pay)/i.test(lower) &&
      /(?:charge|fee|penalty|2%|3%|4%)/i.test(lower)
    ) {
      matched = true;
      const floatingLoan = profile.loans.find((l) => l.rateType === 'floating' && l.loanType !== 'credit_card');
      if (floatingLoan) {
        const claimsZeroFee = /\b(?:no|zero|0%|waived|free|cannot\s+charge)\b/i.test(lower);
        claims.push({
          id: `claim-${idx}-prepay`,
          kind: 'Prepayment Penalty Rule',
          quote: sentence,
          verdict: claimsZeroFee ? 'verified' : 'wrong',
          theirs: claimsZeroFee ? 'No prepayment penalty' : 'Claims a prepayment / foreclosure fee applies',
          ours: '₹0 penalty legally mandated on individual floating-rate loans',
          why: claimsZeroFee
            ? `Correct — ${floatingLoan.bank} cannot levy prepayment charges on individual non-business floating-rate loans.`
            : `Wrong — under RBI (Pre-payment Charges on Loans) Directions, 2025, ${floatingLoan.bank} is barred from charging any prepayment or foreclosure fee on your floating-rate ${floatingLoan.name}.`,
          impactAmount: Math.round(floatingLoan.outstanding * 0.02),
          citation: CITATIONS.PREPAYMENT_NO_CHARGE.rule,
        });
      }
    }

    // 2. Payoff priority / "pay home loan first" vs credit card
    if (
      /(?:pay\s+off|clear|prepay|prioriti[sz]e|tackle|focus\s+on).*(?:first|before)/i.test(lower) &&
      topTarget
    ) {
      matched = true;
      const homeIdx = lower.search(/\b(?:home|mortgage|housing)\b/i);
      const cardIdx = lower.search(/\b(?:credit\s+card|card)\b/i);
      const recommendsHome = homeIdx >= 0 && (cardIdx === -1 || homeIdx < cardIdx);
      const recommendsCard = cardIdx >= 0 && (homeIdx === -1 || cardIdx < homeIdx);
      const recommendsSmallest = /\bsmallest\b/i.test(lower);
      const topIsCard = topTarget.loanType === 'credit_card';

      if (recommendsHome && topIsCard) {
        const cardMetric = sim.loanMetrics.find((m) => m.loan.id === topTarget.loanId);
        const homeMetric = sim.loanMetrics.find((m) => m.loan.loanType === 'home_loan');
        const spread = (cardMetric?.trueAllInApr ?? 0.6) - (homeMetric?.trueAllInApr ?? 0.09);
        const costOfBadOrder = Math.round(
          Math.min(sim.monthlyExtraToDebt * 12, cardMetric?.loan.outstanding ?? 0) * Math.max(0.05, spread),
        );
        claims.push({
          id: `claim-${idx}-order`,
          kind: 'Payoff Priority',
          quote: sentence,
          verdict: 'wrong',
          theirs: 'Prepay home loan / mortgage first',
          ours: `Attack ${topTarget.label} first (${formatPct(topTarget.trueAllInApr)} true APR)`,
          why: `Your ${topTarget.label} costs ${formatPct(topTarget.trueAllInApr)} all-in versus ~${formatPct(homeMetric?.trueAllInApr ?? 0.088)} on your home loan. Putting extra cash toward the home loan first costs roughly ${formatMoney(costOfBadOrder, profile.country)} extra.`,
          impactAmount: costOfBadOrder,
        });
      } else if (recommendsCard && topIsCard) {
        claims.push({
          id: `claim-${idx}-order`,
          kind: 'Payoff Priority',
          quote: sentence,
          verdict: 'verified',
          theirs: 'Clear credit card first',
          ours: `Matches your plan — ${topTarget.label} at ${formatPct(topTarget.trueAllInApr)} true APR`,
          why: 'Clearing revolving credit card debt first delivers the highest guaranteed risk-free return.',
        });
      } else if (recommendsSmallest) {
        claims.push({
          id: `claim-${idx}-order`,
          kind: 'Payoff Priority',
          quote: sentence,
          verdict: sim.interestSavedVsSnowball > 500 ? 'wrong' : 'verified',
          theirs: 'Smallest balance first (Snowball)',
          ours:
            sim.interestSavedVsSnowball > 500
              ? `Avalanche saves ${formatMoney(sim.interestSavedVsSnowball, profile.country)} more`
              : 'Matches your cheapest order right now',
          why:
            sim.interestSavedVsSnowball > 500
              ? `Paying smallest balance first costs ${formatMoney(sim.interestSavedVsSnowball, profile.country)} extra interest compared to targeting true all-in APR.`
              : 'Your smallest balance is also your costliest debt right now, so both orders agree.',
          impactAmount: sim.interestSavedVsSnowball > 500 ? sim.interestSavedVsSnowball : undefined,
        });
      }
    }

    // 3. Policy repo / Fed rate claim
    const repoMatch = sentence.match(/(?:repo\s+rate|fed\s+funds?(?:\s+rate)?)\s+(?:is|remains|stands|at|currently|still|\s){1,24}(\d+(?:\.\d+)?)\s*%/i);
    if (repoMatch) {
      matched = true;
      const claimed = parseFloat(repoMatch[1]) / 100;
      const diff = Math.abs(claimed - repoNow);
      claims.push({
        id: `claim-${idx}-repo`,
        kind: profile.country === 'IN' ? 'RBI Repo Rate' : 'Fed Funds Rate',
        quote: sentence,
        verdict: diff <= 0.001 ? 'verified' : 'wrong',
        theirs: formatPct(claimed),
        ours: `${formatPct(repoNow)} (verified Oct 2026)`,
        why:
          diff <= 0.001
            ? `Matches the verified ${profile.country === 'IN' ? 'RBI repo rate' : 'Fed funds upper bound'} of ${formatPct(repoNow)}.`
            : `Outdated or incorrect — the verified ${profile.country === 'IN' ? 'RBI repo rate is 5.50% (raised 7 Oct 2026)' : 'Fed funds upper bound is 4.00% (16 Sep 2026)'}.`,
      });
    }

    // 4. Credit card "minimum due keeps you safe / interest-free" myth
    if (/(?:minimum\s+(?:amount\s+)?due|pay\s+minimum)/i.test(lower) && /(?:safe|no\s+interest|avoid\s+interest|fine|only\s+pay)/i.test(lower)) {
      matched = true;
      claims.push({
        id: `claim-${idx}-mindue`,
        kind: 'Card Minimum Due Trap',
        quote: sentence,
        verdict: 'wrong',
        theirs: 'Paying minimum due avoids trouble / interest',
        ours:
          profile.country === 'IN'
            ? 'Triggers ~60.31% effective APR (42% + compounding + 18% GST) on all balances + new spends'
            : 'Triggers immediate daily compounding APR on the entire remaining balance',
        why: 'Paying only the minimum due prevents a late fee, NOT interest. It revokes your interest-free grace period on new purchases too.',
      });
    }

    // 5. "Invest in mutual funds/FD instead of prepaying high-cost debt"
    if (/invest/i.test(lower) && /(?:instead\s+of|better\s+than)\s+prepay/i.test(lower)) {
      matched = true;
      const highest = sim.loanMetrics.reduce((a, b) => (b.trueAllInApr > a.trueAllInApr ? b : a), sim.loanMetrics[0]);
      if (highest && highest.trueAllInApr > 0.14) {
        claims.push({
          id: `claim-${idx}-invest`,
          kind: 'Invest vs Prepay',
          quote: sentence,
          verdict: 'wrong',
          theirs: 'Invest instead of prepaying',
          ours: `Need >${formatPct(highest.trueAllInApr / 0.875)} pre-tax guaranteed return just to break even`,
          why: `Your ${highest.loan.name} costs ${formatPct(highest.trueAllInApr)} guaranteed after-tax. No safe investment beats clearing debt above 14%.`,
        });
      } else {
        claims.push({
          id: `claim-${idx}-invest`,
          kind: 'Invest vs Prepay',
          quote: sentence,
          verdict: 'cant_check',
          theirs: 'Invest instead of prepaying',
          ours: `Break-even return is ~${formatPct((highest?.trueAllInApr ?? 0.088) / 0.875)} pre-tax`,
          why: 'Depends on your risk tolerance and tax regime — use the Invest vs Prepay slider below to test exact break-even returns.',
        });
      }
    }

    // 6. Bank RM "reduce EMI instead of tenure" on prepayment
    if (/(?:reduc(?:e|ing)|lower(?:ing)?)\s+(?:your\s+)?emi/i.test(lower) && /(?:tenure|term)/i.test(lower) && /better|saves?\s+more/i.test(lower)) {
      matched = true;
      claims.push({
        id: `claim-${idx}-tenure`,
        kind: 'Reduce Tenure vs Reduce EMI',
        quote: sentence,
        verdict: 'wrong',
        theirs: 'Lowering EMI saves more interest than reducing tenure',
        ours: 'Keeping the same EMI (shorter tenure) always saves substantially more total interest',
        why: 'Reducing tenure accelerates principal reduction every month. The best move is keeping lower mandatory EMI for cash-flow safety ONLY if you voluntarily prepay the difference.',
      });
    }

    if (!matched) {
      notChecked.push(sentence);
    }
  });

  const verifiedCount = claims.filter((c) => c.verdict === 'verified').length;
  const wrongCount = claims.filter((c) => c.verdict === 'wrong').length;
  const cantCheckCount = claims.filter((c) => c.verdict === 'cant_check').length;

  let headline = 'No checkable financial claims found — paste text containing a rate, EMI, fee, or payoff recommendation.';
  if (claims.length > 0) {
    headline =
      wrongCount > 0
        ? `Audited ${claims.length} claim${claims.length === 1 ? '' : 's'}: ${wrongCount} contradict${wrongCount === 1 ? 's' : ''} your loans or statutory rules.`
        : `Audited ${claims.length} claim${claims.length === 1 ? '' : 's'}: none contradict your loans or statutory rules.`;
  }

  return {
    headline,
    verifiedCount,
    wrongCount,
    cantCheckCount,
    claims,
    notChecked,
  };
}

/**
 * Solve true IRR / APR via binary search on monthly cashflows
 * Accounts for upfront processing fees + 18% GST (IN) + foregone no-cost EMI upfront discount!
 */
function solveMonthlyIrr(netDisbursed: number, emi: number, months: number): number {
  if (netDisbursed <= 0 || emi * months <= netDisbursed) return 0;
  let lo = 0;
  let hi = 0.25; // up to 300%+ monthly
  for (let i = 0; i < 60; i += 1) {
    const mid = (lo + hi) / 2;
    const pv = mid < 1e-9 ? emi * months : (emi * (1 - Math.pow(1 + mid, -months))) / mid;
    if (pv > netDisbursed) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  const monthly = (lo + hi) / 2;
  return Math.pow(1 + monthly, 12) - 1;
}

/**
 * "Don't Sign That" Offer & Consolidation Checker
 */
export function auditLoanOffer(input: OfferAuditInput, profile: UserProfile): OfferAuditResult {
  const gstMult = input.country === 'IN' ? 1 + MARKET_BENCHMARKS.IN.gstRate : 1;
  const rawFee = input.processingFeeAmount + input.principal * (input.processingFeePct / 100);
  const upfrontFeesWithTax = Math.round(rawFee * gstMult);

  // In India, "No-Cost EMI" on credit cards still charges 18% GST on the implicit interest component!
  const effectiveQuotedRate = input.kind === 'no_cost_emi' ? 0 : input.quotedAnnualRate;
  const emi = computeEmi(input.principal, effectiveQuotedRate, input.tenureMonths);
  const implicitNoCostGst =
    input.kind === 'no_cost_emi' && input.country === 'IN'
      ? Math.round(input.foregoneDiscount * MARKET_BENCHMARKS.IN.gstRate)
      : 0;

  const totalOutflow = emi * input.tenureMonths + upfrontFeesWithTax + implicitNoCostGst;
  const netCashBenefit = Math.max(1, input.principal - upfrontFeesWithTax - input.foregoneDiscount - implicitNoCostGst);
  const trueAllInApr = solveMonthlyIrr(netCashBenefit, emi, input.tenureMonths);
  const totalInterest = Math.max(0, totalOutflow - (input.principal - input.foregoneDiscount));

  const currentDues = profile.loans.reduce((s, l) => s + (l.outstanding > 0 ? l.emi : 0), 0);
  const replacedLoan = input.replacesLoanId ? profile.loans.find((l) => l.id === input.replacesLoanId) : undefined;
  const projectedDues = currentDues - (replacedLoan?.emi ?? 0) + emi;
  const emiToIncomePct = profile.monthlyTakeHome > 0 ? (projectedDues / profile.monthlyTakeHome) * 100 : 0;

  let netSavingsVsCurrent: number | null = null;
  let breakEvenMonths: number | null = null;
  let verdict: 'worth_it' | 'trap' | 'borderline' = 'borderline';
  let headline = '';
  let explanation = '';

  if (replacedLoan) {
    const { trueAllInApr: oldApr } = computeTrueAllInApr(
      replacedLoan,
      profile.country,
      profile.taxRegimeIN,
      profile.marginalTaxRate,
    );
    const oldInterestOverHorizon = Math.round(
      Math.min(replacedLoan.outstanding, input.principal) * oldApr * (input.tenureMonths / 12) * 0.55,
    );
    netSavingsVsCurrent = oldInterestOverHorizon - totalInterest - upfrontFeesWithTax;
    const monthlyRateGain = Math.max(0, (oldApr - trueAllInApr) * (input.principal / 12));
    breakEvenMonths = monthlyRateGain > 1 ? Math.ceil(upfrontFeesWithTax / monthlyRateGain) : null;

    if (trueAllInApr < oldApr - 0.04 && netSavingsVsCurrent > 0) {
      verdict = 'worth_it';
      headline = `Saves ~${formatMoney(netSavingsVsCurrent, input.country)} vs keeping ${replacedLoan.name}`;
      explanation = `True all-in APR is ${formatPct(trueAllInApr)} (fees + tax included) vs ${formatPct(oldApr)} on ${replacedLoan.name}. Only sign if you lock the card from new revolving spend.`;
    } else {
      verdict = 'trap';
      headline = `Do not sign — fees & rate leave you worse off than your current plan`;
      explanation = `Once ${formatMoney(upfrontFeesWithTax, input.country)} in fees/GST are counted, true all-in APR is ${formatPct(trueAllInApr)} and your current payoff plan clears ${replacedLoan.name} cheaper.`;
    }
  } else if (input.kind === 'no_cost_emi') {
    verdict = trueAllInApr > 0.12 ? 'trap' : trueAllInApr > 0.05 ? 'borderline' : 'worth_it';
    headline =
      trueAllInApr > 0.08
        ? `"No-Cost EMI" actually costs ${formatPct(trueAllInApr)} true APR`
        : `Low hidden cost (${formatPct(trueAllInApr)} true APR)`;
    explanation = `Between the ${formatMoney(upfrontFeesWithTax, input.country)} fee+GST and ${formatMoney(input.foregoneDiscount, input.country)} lost upfront cash discount, you pay ${formatMoney(totalInterest, input.country)} extra over ${input.tenureMonths} months.`;
  } else {
    verdict = emiToIncomePct > 50 || trueAllInApr > 0.16 ? 'trap' : trueAllInApr > 0.11 ? 'borderline' : 'worth_it';
    headline =
      emiToIncomePct > 50
        ? `High stress warning: EMIs would consume ${emiToIncomePct.toFixed(0)}% of take-home`
        : `True all-in APR is ${formatPct(trueAllInApr)} (${formatMoney(totalInterest, input.country)} total cost)`;
    explanation = `Quoted ${formatPct(input.quotedAnnualRate)} rises to ${formatPct(trueAllInApr)} after ${formatMoney(upfrontFeesWithTax, input.country)} upfront fee & tax. Total EMI load reaches ${emiToIncomePct.toFixed(1)}% of monthly income.`;
  }

  return {
    emi,
    upfrontFeesWithTax,
    totalInterest,
    totalOutflow,
    trueAllInApr,
    verdict,
    headline,
    explanation,
    emiToIncomePct,
    netSavingsVsCurrent,
    breakEvenMonths,
  };
}

export const SAMPLE_ADVICE_TEXT: Record<'IN' | 'US', string> = {
  IN: `Your bank RM says: Prepaying your HDFC floating-rate home loan will attract a 2% foreclosure charge so avoid part-paying. Instead, prioritize paying off your home loan first before worrying about the credit card because the home loan balance is bigger. Just pay the minimum due on your credit card so it stays safe and interest-free. Also, the RBI repo rate is still 6.50% so your 8.50% rate is already rock-bottom. Whenever you prepay, lowering your EMI saves more interest than reducing tenure.`,
  US: `Financial influencer tip: Always prioritize paying off your mortgage first before your Chase credit card since your mortgage is a larger balance. Just pay the minimum due on your card so you stay safe and avoid interest. Also, the Fed funds rate is currently 5.50% and investing in an index fund is always better than prepaying high-APR card debt.`,
};
