import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PROFILES, AUDIT_SCENARIO_PRESETS } from './presets';
import {
  computeEmi,
  computeInvestVsPrepay,
  computeMinimumDue,
  computeTrueAllInApr,
  formatPct,
  simulatePayoffPlan,
} from './math';
import { auditLoan, compareBankRewriteOffer, generateFormalLetter } from './loanAudit';
import { computeSpendLeakImpact, parseSmsBatch, SAMPLE_SMS_BATCHES } from './smsParser';
import { auditLoanOffer, SAMPLE_ADVICE_TEXT, verifyPastedAdvice } from './adviceVerifier';
import { buildLoanShieldAmortizationScenarios } from './amortization';
import { buildAuditPdfPayload } from './pdfAuditReport';
import { policyRateOn } from './policyRates';
import type { LetterKind, ThemeMode } from './types';

test('RBI & Fed policy rate lookup matches verified Oct 2026 history', () => {
  assert.equal(policyRateOn('IN', '2023-04-15'), 0.065);
  assert.equal(policyRateOn('IN', '2025-12-10'), 0.0525);
  assert.equal(policyRateOn('IN', '2026-10-07'), 0.055);
  assert.equal(policyRateOn('US', '2026-09-16'), 0.04);
});

test('True All-In APR matches audited India card (60.31%) and home loan (8.84%) figures', () => {
  const inProfile = DEFAULT_PROFILES.IN;
  const home = inProfile.loans[0];
  const card = inProfile.loans[1];

  const homeApr = computeTrueAllInApr(home, 'IN', 'new', 0.3);
  const cardApr = computeTrueAllInApr(card, 'IN', 'new', 0.3);

  assert.equal(formatPct(homeApr.trueAllInApr), '8.84%');
  assert.equal(formatPct(cardApr.trueAllInApr), '60.31%');

  const cardMin = computeMinimumDue(card, 'IN');
  assert.ok(cardMin >= 7200 && cardMin <= 7400, `Expected unified card min ~7304, got ${cardMin}`);

  // Exact parity: Active Loans table minimumDueThisMonth MUST equal Execution allocation minimum
  const sim = simulatePayoffPlan(inProfile, 'avalanche');
  const cardMetric = sim.loanMetrics.find((m) => m.loan.id === card.id);
  const cardAlloc = sim.allocations.find((a) => a.loanId === card.id);
  assert.ok(cardMetric && cardAlloc, 'Card metric and allocation must exist');
  assert.equal(
    cardMetric.minimumDueThisMonth,
    cardAlloc.minimum,
    'Active Loans table and Execution checklist must show identical card minimum due',
  );
});

test('Payoff simulator reduces interest and months compared to minimums (IN & US)', () => {
  const simIN = simulatePayoffPlan(DEFAULT_PROFILES.IN, 'avalanche');
  assert.equal(simIN.isShortfall, false);
  assert.ok(simIN.interestSavedVsMinimums > 100000, 'Expected substantial interest savings vs minimums');
  assert.ok(simIN.monthsSavedVsMinimums > 60, 'Expected substantial months saved vs minimums');
  assert.equal(simIN.allocations.find((a) => a.isExtraTarget)?.loanType, 'credit_card');
  assert.ok(simIN.trajectory.length >= 10, 'Trajectory chart should have enough points');

  // US Mortgage preset EMI ($2,130) must amortize smoothly over ~312 months without a premature cliff
  const simUS = simulatePayoffPlan(DEFAULT_PROFILES.US, 'avalanche');
  assert.equal(simUS.isShortfall, false);
  assert.ok(simUS.minimumsMonths >= 300 && simUS.minimumsMonths <= 320, `Expected US minimums ~312 mo, got ${simUS.minimumsMonths}`);
  assert.ok(simUS.debtFreeMonths < simUS.minimumsMonths, 'US optimized plan must beat minimums');
  assert.ok(simUS.interestSavedVsMinimums > 100000, 'US optimized plan must save >$100k interest');
  const firstPt = simUS.trajectory[0];
  const lastPt = simUS.trajectory[simUS.trajectory.length - 1];
  assert.equal(firstPt.optimizedBalance, simUS.totalPrincipal);
  assert.equal(lastPt.optimizedBalance, 0);
  assert.equal(lastPt.minimumsBalance, 0);
});

test('Timing-aware Life-Event & Stress Simulator respects hikeStartMonth, recurring windfalls, inflation, step-up, rate shock action, and layoff duration', () => {
  const baseIN = DEFAULT_PROFILES.IN;
  const baseline = simulatePayoffPlan(baseIN, 'avalanche');

  // 1. Earlier hikeStartMonth saves more interest than later hikeStartMonth
  const earlyHike = simulatePayoffPlan(baseIN, 'avalanche', undefined, {
    annualHikePct: 10,
    hikeStartMonth: 2,
    hikeToDebtPct: 75,
  });
  const lateHike = simulatePayoffPlan(baseIN, 'avalanche', undefined, {
    annualHikePct: 10,
    hikeStartMonth: 11,
    hikeToDebtPct: 75,
  });
  assert.ok(
    earlyHike.totalInterest < lateHike.totalInterest,
    `Early hike (${earlyHike.totalInterest}) should cost less interest than late hike (${lateHike.totalInterest})`,
  );

  // 2. Recurring annual bonus beats one-time bonus
  const oneTimeBonus = simulatePayoffPlan(baseIN, 'avalanche', undefined, {
    windfallAmount: 200000,
    windfallMonth: 6,
    windfallRecurring: false,
  });
  const recurringBonus = simulatePayoffPlan(baseIN, 'avalanche', undefined, {
    windfallAmount: 200000,
    windfallMonth: 6,
    windfallRecurring: true,
  });
  assert.ok(
    recurringBonus.totalInterest < oneTimeBonus.totalInterest,
    'Recurring yearly bonus must beat one-time bonus',
  );

  // 3. Expense inflation increases total interest vs 0% inflation
  const highInflation = simulatePayoffPlan(baseIN, 'avalanche', undefined, {
    expenseInflationPct: 8,
  });
  assert.ok(
    highInflation.totalInterest > baseline.totalInterest,
    '8% expense inflation must erode spare cash and increase total interest',
  );

  // 4. Annual Extra Step-Up reduces payoff months and interest
  const withStepUp = simulatePayoffPlan(baseIN, 'avalanche', undefined, {
    annualStepUpPct: 10,
  });
  assert.ok(
    withStepUp.totalInterest < baseline.totalInterest && withStepUp.debtFreeMonths <= baseline.debtFreeMonths,
    '10% annual step-up must save interest and shorten timeline',
  );

  // 5. Rate shock +100 bps: raising EMI costs less total interest than extending tenure
  const shockExtend = simulatePayoffPlan(baseIN, 'minimums', undefined, {
    rateShockBps: 100,
    rateShockMonth: 3,
    rateShockAction: 'extend_tenure',
  });
  const shockRaiseEmi = simulatePayoffPlan(baseIN, 'minimums', undefined, {
    rateShockBps: 100,
    rateShockMonth: 3,
    rateShockAction: 'raise_emi',
  });
  assert.ok(
    shockRaiseEmi.totalInterest < shockExtend.totalInterest,
    'Raising EMI on a +100 bps hike must cost less lifetime interest than silently extending tenure',
  );

  // 6. Temporary 6-month layoff finishes faster than ongoing pay cut
  const tempDrop = simulatePayoffPlan(baseIN, 'avalanche', undefined, {
    incomeDropPct: 50,
    incomeDropStartMonth: 2,
    incomeDropDurationMonths: 6,
  });
  const permanentDrop = simulatePayoffPlan(baseIN, 'avalanche', undefined, {
    incomeDropPct: 50,
    incomeDropStartMonth: 2,
    incomeDropDurationMonths: 0,
  });
  assert.ok(
    tempDrop.totalInterest < permanentDrop.totalInterest,
    'Temporary 6-month income drop must recover faster than permanent drop',
  );
});

test('Visual Amortization Schedule conserves principal and compares 4 scenarios accurately', () => {
  const input = AUDIT_SCENARIO_PRESETS.missed_cut_in.input;
  const audit = auditLoan(input);
  const scenarios = buildLoanShieldAmortizationScenarios(input, audit, {
    extraMonthly: 10000,
    annualStepUpPct: 5,
  });

  for (const sc of Object.values(scenarios)) {
    const sumPrin = sc.monthly.reduce((s, r) => s + r.principalPaid + r.extraPrincipal, 0);
    assert.ok(
      Math.abs(sumPrin - input.outstanding) <= sc.monthly.length,
      `${sc.key}: sum of principal (${sumPrin}) should match outstanding (${input.outstanding}) within rounding`,
    );
    assert.equal(sc.monthly[sc.monthly.length - 1].closingBalance, 0, `${sc.key}: ends at 0 balance`);
    assert.ok(sc.yearly.length >= 1, `${sc.key}: has yearly breakdown`);
  }

  assert.ok(
    scenarios.fair_reset.interestSavedVsCurrent > 0,
    'Fair RBI reset scenario must save strictly positive interest vs current schedule',
  );
  assert.ok(
    scenarios.extra_prepay.interestSavedVsCurrent > 0,
    'Extra prepayment + step-up scenario must save strictly positive interest',
  );
  assert.ok(
    (scenarios.extra_prepay.crossoverMonth ?? 999) <= (scenarios.current.crossoverMonth ?? 999),
    'Extra prepayment must reach principal > interest crossover no later than baseline',
  );
});

test('Theme-matched Formal PDF Audit Dossier payload supports Light, Paper Ledger, and Dark without garbled glyphs', () => {
  const borrower = {
    name: 'Aarav Sharma',
    accountNumber: 'HL-998811',
    phone: '+91 9876543210',
    email: 'aarav@example.com',
    address: 'Bengaluru',
    sentDate: '2026-11-20',
  };

  for (const theme of ['light', 'ledger', 'dark'] as ThemeMode[]) {
    const input = AUDIT_SCENARIO_PRESETS.missed_cut_in.input;
    const audit = auditLoan(input);
    const scenarios = buildLoanShieldAmortizationScenarios(input, audit);
    const letter = generateFormalLetter('in_grievance', audit, borrower, {
      outstanding: input.outstanding,
      currentRate: input.currentRate,
      startMonth: input.startMonth,
      startRate: input.startRate,
      emi: input.emi,
    });
    const payload = buildAuditPdfPayload({
      input,
      audit,
      letter,
      borrower,
      scenarios: Object.values(scenarios),
      activeScenario: scenarios.fair_reset,
      theme,
    });

    assert.equal(payload.palette.theme, theme);
    assert.ok(payload.fileName.endsWith(`-${theme}.pdf`));
    assert.ok(payload.annexureRows.length > 0, 'Must include claimable refund annexure');
    assert.equal(payload.amortizationSummaryRows.length, 4, 'Must include all 4 amortization scenarios');
    assert.ok(payload.yearlyScheduleRows.length > 0, 'Must include yearly amortization rows');
    assert.ok(payload.escalationDeadlines.length >= 2, 'Must include statutory escalation deadlines');

    if (theme === 'ledger') {
      assert.equal(payload.palette.ruledLines, true);
      assert.equal(payload.palette.fontFamily, 'courier');
    }

    // Standard PDF Type1 fonts cannot render ₹ (U+20B9) — assert zero raw ₹ glyphs anywhere
    const serialized = JSON.stringify(payload);
    assert.equal(serialized.includes('₹'), false, `PDF payload (${theme}) must sanitize ₹ to Rs. for Type1 PDF fonts`);
  }
});

test('Loan Shield detects missed RBI repo cut and generates third-person letters with zero stray "you"', () => {
  const audit = auditLoan(AUDIT_SCENARIO_PRESETS.missed_cut_in.input);
  const missed = audit.findings.find((f) => f.kind === 'missed_rate_cut');
  assert.ok(missed, 'Should detect missed rate cut');
  assert.equal(missed.claimable, true);
  assert.ok(missed.overchargedSoFar > 0, 'Overcharge refund should be positive');
  assert.ok((missed.annexure?.length ?? 0) > 0, 'Annexure months should be populated');

  const sumAnnexure = (missed.annexure ?? []).reduce((s, r) => s + r.excessAmount, 0);
  assert.equal(sumAnnexure, missed.overchargedSoFar, 'Annexure rows must sum exactly to claimable refund');

  const kinds: LetterKind[] = [
    'in_grievance',
    'in_rbi_ombudsman',
    'in_reset_choice',
    'in_noc_closure',
    'us_respa_noe',
    'us_fcba_dispute',
    'hardship_in',
    'hardship_us',
  ];

  for (const kind of kinds) {
    const letter = generateFormalLetter(
      kind,
      audit,
      {
        name: 'Aarav Sharma',
        accountNumber: 'HL-998811',
        phone: '+91 9876543210',
        email: 'aarav@example.com',
        address: 'Bengaluru',
        sentDate: '2026-11-20',
      },
      {
        outstanding: 4200000,
        currentRate: 0.0895,
        startMonth: '2023-04',
        startRate: 0.0925,
        emi: 39800,
      },
    );
    assert.equal(
      letter.hasStraySecondPerson,
      false,
      `Letter ${kind} must never contain stray second-person "you"`,
    );
  }
});

test('Bank rewrite offer comparator refuses paying a fee for an already-owed RBI rate cut', () => {
  const cmp = compareBankRewriteOffer({
    country: 'IN',
    outstanding: 4000000,
    currentRate: 0.09,
    monthsRemaining: 180,
    expectedKeepYears: 5,
    owedCutRate: 0.0825,
    conversionRate: 0.0835,
    conversionFee: 10000,
    transferRate: 0.0815,
    transferCosts: 35000,
    oldForeclosureFee: 40000,
    isFloatingIndividualIN: true,
  });
  assert.equal(cmp.winner, 'press_owed_cut');
  assert.equal(cmp.illegalForeclosureFlag, true);
});

test('On-device SMS parser skips OTP/promo, matches EMI/card statements, and computes spend-leak savings', () => {
  const parsed = parseSmsBatch(SAMPLE_SMS_BATCHES.IN, DEFAULT_PROFILES.IN.loans);
  assert.ok(parsed.some((p) => p.kind === 'otp'), 'Should identify OTP');
  assert.ok(parsed.some((p) => p.kind === 'promo'), 'Should identify promo');
  const stmt = parsed.find((p) => p.kind === 'card_statement');
  assert.ok(stmt, 'Should parse card statement');
  assert.equal(stmt.amount, 84650);
  assert.equal(stmt.minDue, 7620);
  assert.equal(stmt.matchedLoanId, 'in-card-1');

  const emiRow = parsed.find((p) => p.kind === 'emi_debit');
  assert.ok(emiRow, 'Should parse EMI debit');
  assert.equal(emiRow.matchedLoanId, 'in-home-1');

  const leaks = computeSpendLeakImpact(parsed, DEFAULT_PROFILES.IN);
  assert.ok(leaks.length >= 3, 'Should aggregate spend leak categories');
  assert.ok(leaks[0].interestSavedIfRedirected > 0, 'Redirecting top leak should save interest');
});

test('Deterministic Advice Verifier flags Bank RM myths accurately', () => {
  const report = verifyPastedAdvice(SAMPLE_ADVICE_TEXT.IN, DEFAULT_PROFILES.IN);
  assert.ok(report.wrongCount >= 4, `Expected at least 4 wrong claims caught, got ${report.wrongCount}`);
  assert.ok(
    report.claims.some((c) => c.kind === 'Prepayment Penalty Rule' && c.verdict === 'wrong'),
    'Must catch illegal floating-rate foreclosure fee myth',
  );
  assert.ok(
    report.claims.some((c) => c.kind === 'RBI Repo Rate' && c.verdict === 'wrong'),
    'Must catch outdated 6.50% repo rate claim',
  );
});

test('Offer checker exposes hidden APR on No-Cost EMI with foregone discount & GST', () => {
  const offer = auditLoanOffer(
    {
      country: 'IN',
      kind: 'no_cost_emi',
      principal: 100000,
      quotedAnnualRate: 0,
      tenureMonths: 12,
      processingFeeAmount: 1999,
      processingFeePct: 0,
      foregoneDiscount: 8000,
    },
    DEFAULT_PROFILES.IN,
  );
  assert.ok(offer.trueAllInApr > 0.18, `Expected true APR > 18%, got ${formatPct(offer.trueAllInApr)}`);
  assert.equal(offer.verdict, 'trap');
});

test('Invest vs Prepay computes exact tax-regime-aware break-even return', () => {
  const res = computeInvestVsPrepay({
    country: 'IN',
    loan: DEFAULT_PROFILES.IN.loans[0],
    taxRegimeIN: 'new',
    marginalTaxRate: 0.3,
    amount: 200000,
    expectedPreTaxReturn: 0.11,
    investmentTaxRate: 0.125,
    prepaySharePct: 50,
    horizonYears: 5,
  });
  assert.ok(res.breakEvenPreTaxReturn > 0.095 && res.breakEvenPreTaxReturn < 0.105);
  assert.equal(computeEmi(3500000, 0.085, 180), 34466);
});
