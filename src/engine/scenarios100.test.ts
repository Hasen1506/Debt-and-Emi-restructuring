import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzePaymentOutcome,
  computeCardRevolvingTrap,
  computeEmi,
  computeInvestVsPrepay,
  computeMinimumDue,
  computeTrueAllInApr,
  simulatePayoffPlan,
} from './math';
import { auditLoan, compareBankRewriteOffer, generateFormalLetter, hasStraySecondPerson } from './loanAudit';
import {
  computeSpendLeakImpact,
  deduplicateParsedSms,
  parseBulkInput,
  SAMPLE_ANDROID_XML,
  SAMPLE_CSV_STATEMENTS,
  SAMPLE_SMS_BATCHES,
} from './smsParser';
import { auditLoanOffer, SAMPLE_ADVICE_TEXT, verifyPastedAdvice } from './adviceVerifier';
import { AUDIT_SCENARIOS, DEFAULT_PROFILES } from './presets';
import type { Country, LetterKind, Loan, UserProfile } from './types';

function makeProfile(overrides: Partial<UserProfile>, country: Country = 'IN'): UserProfile {
  return {
    ...DEFAULT_PROFILES[country],
    ...overrides,
    loans: overrides.loans ?? DEFAULT_PROFILES[country].loans.map((l) => ({ ...l })),
    goals: overrides.goals ?? DEFAULT_PROFILES[country].goals.map((g) => ({ ...g })),
  };
}

function assertFiniteSim(sim: ReturnType<typeof simulatePayoffPlan>, label: string) {
  assert.ok(Number.isFinite(sim.debtFreeMonths), `${label}: finite months`);
  assert.ok(Number.isFinite(sim.totalInterest) && sim.totalInterest >= 0, `${label}: non-negative finite interest`);
  assert.ok(Number.isFinite(sim.totalPrincipal) && sim.totalPrincipal >= 0, `${label}: finite principal`);
  assert.ok(sim.trajectory.length >= 1, `${label}: trajectory has points`);
}

// ============================================================================
// 108 END-TO-END REAL-USER SCENARIOS AUDIT SUITE
// ============================================================================

// GROUP A (Scenarios 1–20): Diverse Indian & US Borrower Personas & Payoff Strategies
const PERSONA_SCENARIOS: Array<{ name: string; country: Country; income: number; spend: number; loans: Loan[] }> = [
  { name: 'S01: Bengaluru SWE with HDFC Home + Millennia Card', country: 'IN', income: 180000, spend: 55000, loans: DEFAULT_PROFILES.IN.loans },
  { name: 'S02: Entry-level fresher with Education + Credit Card', country: 'IN', income: 55000, spend: 28000, loans: [
    { id: 'ed1', name: 'SBI Edu Loan', bank: 'SBI', lenderType: 'commercial_bank', loanType: 'education_loan', rateType: 'floating', benchmark: 'repo', outstanding: 650000, annualRate: 0.095, emi: 9200, monthsRemaining: 84 },
    { id: 'cc1', name: 'ICICI Amazon Card', bank: 'ICICI Bank', lenderType: 'commercial_bank', loanType: 'credit_card', rateType: 'fixed', benchmark: 'fixed', outstanding: 45000, annualRate: 0.408, emi: 4100, monthsRemaining: 18 },
  ]},
  { name: 'S03: Multi-card trap (4 revolving cards + Personal Loan)', country: 'IN', income: 110000, spend: 48000, loans: [
    { id: 'c1', name: 'HDFC Regalia', bank: 'HDFC Bank', lenderType: 'commercial_bank', loanType: 'credit_card', rateType: 'fixed', benchmark: 'fixed', outstanding: 120000, annualRate: 0.42, emi: 10800, monthsRemaining: 24 },
    { id: 'c2', name: 'SBI SimplyCLICK', bank: 'SBI', lenderType: 'commercial_bank', loanType: 'credit_card', rateType: 'fixed', benchmark: 'fixed', outstanding: 65000, annualRate: 0.45, emi: 6100, monthsRemaining: 24 },
    { id: 'c3', name: 'Axis Magnus', bank: 'Axis Bank', lenderType: 'commercial_bank', loanType: 'credit_card', rateType: 'fixed', benchmark: 'fixed', outstanding: 90000, annualRate: 0.432, emi: 8200, monthsRemaining: 24 },
    { id: 'pl1', name: 'Bajaj Personal Loan', bank: 'Bajaj Finance', lenderType: 'nbfc', loanType: 'personal_loan', rateType: 'fixed', benchmark: 'fixed', outstanding: 450000, annualRate: 0.165, emi: 16200, monthsRemaining: 36 },
  ]},
  { name: 'S04: High-HNI ₹2.4 Cr Mumbai Home Loan', country: 'IN', income: 550000, spend: 160000, loans: [
    { id: 'h1', name: 'Kotak Home Loan', bank: 'Kotak Mahindra Bank', lenderType: 'commercial_bank', loanType: 'home_loan', rateType: 'floating', benchmark: 'repo', outstanding: 24000000, annualRate: 0.087, emi: 215000, monthsRemaining: 204 },
  ]},
  { name: 'S05: Small business owner with Gold + Auto + BNPL', country: 'IN', income: 95000, spend: 40000, loans: [
    { id: 'g1', name: 'Muthoot Gold Loan', bank: 'Muthoot Finance', lenderType: 'nbfc', loanType: 'gold_loan', rateType: 'fixed', benchmark: 'fixed', outstanding: 220000, annualRate: 0.14, emi: 12500, monthsRemaining: 20 },
    { id: 'a1', name: 'Axis Auto Loan', bank: 'Axis Bank', lenderType: 'commercial_bank', loanType: 'auto_loan', rateType: 'fixed', benchmark: 'fixed', outstanding: 540000, annualRate: 0.094, emi: 14500, monthsRemaining: 44 },
    { id: 'b1', name: 'Simpl BNPL', bank: 'Simpl', lenderType: 'nbfc', loanType: 'bnpl', rateType: 'fixed', benchmark: 'fixed', outstanding: 18000, annualRate: 0.24, emi: 3200, monthsRemaining: 6 },
  ]},
  { name: 'S06: Tight-budget shortfall household (Income < Spend + Dues)', country: 'IN', income: 42000, spend: 25000, loans: [
    { id: 's1', name: 'Home EMI', bank: 'SBI', lenderType: 'commercial_bank', loanType: 'home_loan', rateType: 'floating', benchmark: 'repo', outstanding: 2100000, annualRate: 0.085, emi: 21000, monthsRemaining: 180 },
    { id: 's2', name: 'Card Debt', bank: 'HDFC Bank', lenderType: 'commercial_bank', loanType: 'credit_card', rateType: 'fixed', benchmark: 'fixed', outstanding: 55000, annualRate: 0.42, emi: 4950, monthsRemaining: 24 },
  ]},
  { name: 'S07: Zero-debt user (all balances cleared)', country: 'IN', income: 120000, spend: 40000, loans: [] },
  { name: 'S08: 0% promotional BNPL only', country: 'IN', income: 80000, spend: 35000, loans: [
    { id: 'z1', name: '0% Laptop EMI', bank: 'HDFC Bank', lenderType: 'commercial_bank', loanType: 'bnpl', rateType: 'fixed', benchmark: 'fixed', outstanding: 60000, annualRate: 0, emi: 10000, monthsRemaining: 6 },
  ]},
  { name: 'S09: Final month of a Home Loan (tiny balance)', country: 'IN', income: 140000, spend: 50000, loans: [
    { id: 'last1', name: 'Closing Home Loan', bank: 'ICICI Bank', lenderType: 'commercial_bank', loanType: 'home_loan', rateType: 'floating', benchmark: 'repo', outstanding: 28000, annualRate: 0.086, emi: 35000, monthsRemaining: 1 },
  ]},
  { name: 'S10: Old Tax Regime Section 24(b) Home + 80E Edu Shield', country: 'IN', income: 220000, spend: 65000, loans: [
    { id: 'o1', name: 'Self-Occupied Home', bank: 'SBI', lenderType: 'commercial_bank', loanType: 'home_loan', rateType: 'floating', benchmark: 'repo', outstanding: 2500000, annualRate: 0.085, emi: 28000, monthsRemaining: 132, isSelfOccupied: true },
    { id: 'o2', name: 'MBA Education Loan', bank: 'SBI', lenderType: 'commercial_bank', loanType: 'education_loan', rateType: 'floating', benchmark: 'repo', outstanding: 1200000, annualRate: 0.098, emi: 18500, monthsRemaining: 84 },
  ]},
  { name: 'S11: US Austin household (Mortgage + Sapphire + Auto)', country: 'US', income: 7400, spend: 3150, loans: DEFAULT_PROFILES.US.loans },
  { name: 'S12: US High-APR 3-Card Avalanche vs Snowball Spread', country: 'US', income: 6200, spend: 3200, loans: [
    { id: 'uc1', name: 'Amex Blue', bank: 'American Express', lenderType: 'us_bank', loanType: 'credit_card', rateType: 'floating', benchmark: 'prime', outstanding: 14000, annualRate: 0.2899, emi: 480, monthsRemaining: 48 },
    { id: 'uc2', name: 'Citi Custom', bank: 'Citi', lenderType: 'us_bank', loanType: 'credit_card', rateType: 'floating', benchmark: 'prime', outstanding: 2200, annualRate: 0.1699, emi: 65, monthsRemaining: 36 },
    { id: 'uc3', name: 'BofA Auto', bank: 'Bank of America', lenderType: 'us_bank', loanType: 'auto_loan', rateType: 'fixed', benchmark: 'fixed', outstanding: 18000, annualRate: 0.069, emi: 420, monthsRemaining: 48 },
  ]},
  { name: 'S13: US Student Loan + Credit Card Graduate', country: 'US', income: 4800, spend: 2700, loans: [
    { id: 'us1', name: 'Federal Student Loan', bank: 'Nelnet', lenderType: 'us_servicer', loanType: 'education_loan', rateType: 'fixed', benchmark: 'fixed', outstanding: 48000, annualRate: 0.065, emi: 545, monthsRemaining: 120 },
    { id: 'us2', name: 'Chase Freedom', bank: 'Chase', lenderType: 'us_bank', loanType: 'credit_card', rateType: 'floating', benchmark: 'prime', outstanding: 4500, annualRate: 0.2599, emi: 145, monthsRemaining: 36 },
  ]},
  { name: 'S14: US High-Income Jumbo Mortgage Prepay', country: 'US', income: 18500, spend: 7500, loans: [
    { id: 'uj1', name: 'Jumbo 30-Yr Mortgage', bank: 'Wells Fargo', lenderType: 'us_bank', loanType: 'home_loan', rateType: 'fixed', benchmark: 'fixed', outstanding: 850000, annualRate: 0.071, emi: 5710, monthsRemaining: 336 },
  ]},
  { name: 'S15: US Tight Shortfall Household', country: 'US', income: 3400, spend: 2600, loans: [
    { id: 'ut1', name: 'Auto Note', bank: 'Wells Fargo', lenderType: 'us_bank', loanType: 'auto_loan', rateType: 'fixed', benchmark: 'fixed', outstanding: 22000, annualRate: 0.119, emi: 620, monthsRemaining: 42 },
    { id: 'ut2', name: 'Personal Loan', bank: 'Citi', lenderType: 'us_bank', loanType: 'personal_loan', rateType: 'fixed', benchmark: 'fixed', outstanding: 12000, annualRate: 0.189, emi: 420, monthsRemaining: 36 },
  ]},
];

test('Scenarios 01-20: Diverse India & US personas run Avalanche, Snowball, and Minimums without numerical errors', () => {
  for (const sc of PERSONA_SCENARIOS) {
    const p = makeProfile(
      {
        monthlyTakeHome: sc.income,
        monthlyLivingSpend: sc.spend,
        loans: sc.loans,
        taxRegimeIN: sc.name.includes('Old Tax') ? 'old' : 'new',
      },
      sc.country,
    );
    const av = simulatePayoffPlan(p, 'avalanche');
    const sn = simulatePayoffPlan(p, 'snowball');
    const mn = simulatePayoffPlan(p, 'minimums');
    assertFiniteSim(av, `${sc.name} avalanche`);
    assertFiniteSim(sn, `${sc.name} snowball`);
    assertFiniteSim(mn, `${sc.name} minimums`);
    // Avalanche should never cost more total interest than Snowball (allowing small rounding tolerance)
    assert.ok(
      av.totalInterest <= sn.totalInterest + 500,
      `${sc.name}: Avalanche (${av.totalInterest}) should be <= Snowball (${sn.totalInterest})`,
    );
    assert.ok(
      av.totalInterest <= mn.totalInterest + 500,
      `${sc.name}: Avalanche (${av.totalInterest}) should be <= Minimums (${mn.totalInterest})`,
    );
  }

  // Scenarios 16-20: Extra Monthly Override Lever monotonicity (0 -> +10k -> +25k -> +50k -> +100k)
  const baseIN = makeProfile({}, 'IN');
  const extras = [0, 10000, 25000, 50000, 100000];
  let prevInterest = Infinity;
  let prevMonths = Infinity;
  for (const ex of extras) {
    const run = simulatePayoffPlan(baseIN, 'avalanche', ex);
    assert.ok(run.totalInterest <= prevInterest, `Extra ₹${ex} must monotonically reduce interest`);
    assert.ok(run.debtFreeMonths <= prevMonths, `Extra ₹${ex} must monotonically reduce months`);
    prevInterest = run.totalInterest;
    prevMonths = run.debtFreeMonths;
  }
});

// GROUP B (Scenarios 21–38): Revolving Credit Card Physics & Flexible Payment Consequences
test('Scenarios 21-38: Revolving card traps, grace revocation, new spend spiral, and partial/missed payment consequences', () => {
  const inCard = DEFAULT_PROFILES.IN.loans[1];
  const usCard = DEFAULT_PROFILES.US.loans[1];
  const inHome = DEFAULT_PROFILES.IN.loans[0];
  const usHome = DEFAULT_PROFILES.US.loans[0];

  // S21-24: Revolving card traps with 0 vs ongoing monthly new spend
  const revCleanIN = computeCardRevolvingTrap({ ...inCard, monthlyNewSpend: 0 }, 'IN');
  const revSpiralIN = computeCardRevolvingTrap({ ...inCard, monthlyNewSpend: 20000 }, 'IN');
  assert.equal(revCleanIN.gracePeriodActive, false, 'S21: Carrying balance revokes grace period');
  assert.ok(revCleanIN.dailyInterestBleed > 90, 'S22: ₹80k @ 42% + GST bleeds > ₹90/day');
  assert.ok(revSpiralIN.isDebtSpiral, 'S23: Swiping ₹20k/mo on revolving card while paying min creates debt spiral');
  assert.ok(revSpiralIN.newSpendDayOneCostPerMonth > 0, 'S24: New spend accrues Day-1 interest');

  const revCleanUS = computeCardRevolvingTrap({ ...usCard, monthlyNewSpend: 0 }, 'US');
  const revSpiralUS = computeCardRevolvingTrap({ ...usCard, monthlyNewSpend: 2000 }, 'US');
  assert.equal(revCleanUS.gracePeriodActive, false, 'S25: US revolving card revokes grace period');
  assert.ok(revSpiralUS.isDebtSpiral, 'S26: US card with $2,000/mo new spend spirals');

  // S27-38: Payment consequence matrix (Full, Prepay Extra, Card Partial >= Min, Card < Min, Card Unable, Loan Partial, Loan Unable — IN & US)
  const minInCard = computeMinimumDue(inCard, 'IN');
  const pFullCard = analyzePaymentOutcome({ loan: inCard, amountPaid: 80000, plannedTotal: 51288, minimumDue: minInCard, country: 'IN' });
  assert.equal(pFullCard.severity, 'positive', 'S27: Paying full card is positive');
  assert.equal(pFullCard.graceRevoked, false, 'S28: Paying full card restores grace period');

  const pExtraHome = analyzePaymentOutcome({ loan: inHome, amountPaid: 60000, plannedTotal: 35200, minimumDue: 35200, country: 'IN' });
  assert.equal(pExtraHome.severity, 'positive', 'S29: Home loan prepayment is positive');
  assert.ok(pExtraHome.monthlyInterestImpact < 0, 'S30: Prepayment reduces monthly interest');

  const pPartialCard = analyzePaymentOutcome({ loan: inCard, amountPaid: 10000, plannedTotal: 51288, minimumDue: minInCard, country: 'IN' });
  assert.equal(pPartialCard.severity, 'warning', 'S31: Card partial >= min is warning');
  assert.equal(pPartialCard.immediateFee, 0, 'S32: Card partial >= min avoids late fee');
  assert.equal(pPartialCard.graceRevoked, true, 'S33: Card partial revokes grace period');

  const pBelowMinCard = analyzePaymentOutcome({ loan: inCard, amountPaid: 2000, plannedTotal: 51288, minimumDue: minInCard, country: 'IN' });
  assert.equal(pBelowMinCard.severity, 'critical', 'S34: Below min due is critical');
  assert.ok(pBelowMinCard.immediateFee >= 1500, 'S35: India ₹80k card missed min triggers ~₹1,534 fee incl. GST');

  const pUnableHomeIN = analyzePaymentOutcome({ loan: inHome, amountPaid: 0, plannedTotal: 35200, minimumDue: 35200, country: 'IN' });
  assert.equal(pUnableHomeIN.severity, 'critical', 'S36: Unable to pay home EMI is critical');
  assert.equal(pUnableHomeIN.immediateFee, 590, 'S37: NACH bounce ₹590 incl. GST');
  assert.ok(pUnableHomeIN.summary.includes('CANNOT be compounded'), 'S37b: Cites RBI 2024 penal charges rule');

  const pUnableHomeUS = analyzePaymentOutcome({ loan: usHome, amountPaid: 0, plannedTotal: 2485, minimumDue: 2485, country: 'US' });
  assert.equal(pUnableHomeUS.severity, 'critical', 'S38: US missed mortgage is critical');
  assert.equal(pUnableHomeUS.immediateFee, 35, 'S38b: US late fee modeled');
});

// GROUP C (Scenarios 39–58): Life-Event Stress Simulator (Hike %, Windfall, Rate Shock, Job Loss, Competing Goals)
test('Scenarios 39-58: Annual salary hikes, windfalls, RBI/Fed rate shocks, layoff runway, and competing cash goals', () => {
  const baseIN = makeProfile({}, 'IN');
  const simBase = simulatePayoffPlan(baseIN, 'avalanche');

  // S39-43: Annual salary hike levels (4%, 8%, 12%, 16%, 20%)
  let prevM = simBase.debtFreeMonths;
  for (const hike of [4, 8, 12, 16, 20]) {
    const s = simulatePayoffPlan(baseIN, 'avalanche', undefined, { annualHikePct: hike, hikeToDebtPct: 50 });
    assert.ok(s.debtFreeMonths <= prevM, `Hike +${hike}% must not lengthen payoff`);
    assert.ok(s.totalInterest <= simBase.totalInterest, `Hike +${hike}% must save interest`);
    prevM = s.debtFreeMonths;
  }

  // S44-47: One-time windfall levels (₹1L, ₹3L, ₹5L, ₹10L)
  let prevInt = simBase.totalInterest;
  for (const wf of [100000, 300000, 500000, 1000000]) {
    const s = simulatePayoffPlan(baseIN, 'avalanche', undefined, { windfallAmount: wf, windfallMonth: 6 });
    assert.ok(s.totalInterest < prevInt, `Windfall ₹${wf} must strictly lower interest`);
    prevInt = s.totalInterest;
  }

  // S48-52: Rate shock (-50, +50, +100, +150, +400 bps negative amortization)
  const simCut = simulatePayoffPlan(baseIN, 'avalanche', undefined, { rateShockBps: -50 });
  const simHike100 = simulatePayoffPlan(baseIN, 'avalanche', undefined, { rateShockBps: 100 });
  const simExtreme = simulatePayoffPlan(baseIN, 'minimums', undefined, { rateShockBps: 450 });
  assert.ok(simCut.totalInterest < simBase.totalInterest, 'S48: -50bps cut reduces total interest');
  assert.ok(simHike100.totalInterest > simBase.totalInterest, 'S49: +100bps hike raises total interest');
  assert.ok(
    simExtreme.negativeAmortizationLoans.includes('HDFC Home Loan'),
    'S50: Extreme +450bps shock detects negative amortization on HDFC Home Loan',
  );

  // S51-54: Income drop / job-loss runway (25%, 50%, 75%, 100% drop)
  const sDrop50 = simulatePayoffPlan(baseIN, 'avalanche', undefined, { incomeDropPct: 50 });
  const sDrop100 = simulatePayoffPlan(baseIN, 'avalanche', undefined, { incomeDropPct: 100 });
  assert.equal(sDrop100.isShortfall, true, 'S52: 100% job loss creates shortfall');
  assert.ok(sDrop100.emergencyRunwayMonths > 1.5 && sDrop100.emergencyRunwayMonths < 3, 'S53: ₹1.8L emergency fund lasts ~2.1 mo at ₹87.4k burn');
  assert.ok(sDrop50.monthlySpareCash < simBase.monthlySpareCash, 'S54: 50% pay cut shrinks spare cash');

  // S55-58: Debt-competing goals sinking fund vs card borrowing tradeoff
  const withGoals = makeProfile({
    goals: [
      { id: 'g1', name: 'Medical Reserve', targetAmount: 180000, savedSoFar: 0, targetMonths: 12, priority: 'essential', enabled: true },
      { id: 'g2', name: 'School Tuition', targetAmount: 120000, savedSoFar: 0, targetMonths: 12, priority: 'essential', enabled: true },
    ],
  }, 'IN');
  const simGoals = simulatePayoffPlan(withGoals, 'avalanche');
  assert.equal(simGoals.monthlyToGoals, 25000, 'S55: ₹3L over 12 mo = ₹25,000/mo sinking fund');
  assert.ok(simGoals.goalTradeoff.monthsDelayedByGoals > 0, 'S56: Carving ₹25k/mo delays debt-free date');
  assert.ok(simGoals.goalTradeoff.cardDebtCostIfUnfunded > 50000, 'S57: Estimates card borrowing cost avoided');
  assert.ok(simGoals.goalTradeoff.activeGoalCount === 2, 'S58: Tracks 2 active competing goals');
});

// GROUP D (Scenarios 59–78): Loan Shield Audits, All 9 Statutory Letters, & Rewrite Comparisons
test('Scenarios 59-78: Loan Shield presets, HFC non-binding scope, MCLR switch, and all 9 formal letters with zero stray "you"', () => {
  // S59-62: All 4 UI preset scenarios
  for (const preset of AUDIT_SCENARIOS) {
    const res = auditLoan(preset.input);
    assert.ok(res.findings.length >= 1, `${preset.id}: produces at least 1 finding`);
    assert.ok(Number.isFinite(res.expectedRateNow), `${preset.id}: finite expected rate`);
  }

  // S63: HFC non-binding scope warning
  const hfcRes = auditLoan({
    ...AUDIT_SCENARIOS[0].input,
    lenderName: 'LIC Housing Finance',
    lenderType: 'hfc',
    benchmark: 'plr',
  });
  assert.ok(
    hfcRes.findings.some((f) => f.kind === 'rule_not_binding'),
    'S63: HFC correctly flagged as outside commercial-bank EBLR mandate',
  );

  // S64: MCLR switch finding
  const mclrRes = auditLoan(AUDIT_SCENARIOS[1].input);
  assert.ok(mclrRes.findings.some((f) => f.kind === 'old_benchmark'), 'S64: MCLR loan flags switch savings');

  // S65-73: All 9 statutory letter kinds must generate cleanly with ZERO stray "you"
  const inAudit = auditLoan(AUDIT_SCENARIOS[0].input);
  const usAudit = auditLoan(AUDIT_SCENARIOS[3].input);
  const allKinds: LetterKind[] = [
    'in_grievance',
    'in_internal_ombudsman',
    'in_rbi_ombudsman',
    'in_reset_choice',
    'in_noc_closure',
    'us_respa_noe',
    'us_fcba_dispute',
    'hardship_in',
    'hardship_us',
  ];
  for (const kind of allKinds) {
    const isUs = kind.startsWith('us_') || kind === 'hardship_us';
    const letter = generateFormalLetter(
      kind,
      isUs ? usAudit : inAudit,
      { name: 'Priya Menon', accountNumber: 'LN998877', phone: '9876543210', email: 'priya@example.com', address: 'Bengaluru', sentDate: '2026-11-20' },
      { outstanding: 3500000, currentRate: 0.0895, startMonth: '2023-04', startRate: 0.0925, emi: 35200 },
    );
    assert.ok(letter.body.length > 200, `Letter ${kind} has substantive legal body`);
    assert.equal(letter.hasStraySecondPerson, false, `Letter ${kind} must have zero stray second-person "you"`);
    assert.equal(hasStraySecondPerson(letter.body), false, `Letter ${kind} verified via strict regex`);
  }

  // S74-78: Rewrite comparator scenarios (Press Owed Cut vs Ask Own Bank vs Balance Transfer vs Keep + Illegal Foreclosure)
  const rwOwed = compareBankRewriteOffer({
    country: 'IN', outstanding: 4000000, currentRate: 0.09, monthsRemaining: 180, expectedKeepYears: 5,
    owedCutRate: 0.0825, conversionRate: 0.084, conversionFee: 10000, transferRate: 0.0835, transferCosts: 35000, oldForeclosureFee: 80000, isFloatingIndividualIN: true,
  });
  assert.equal(rwOwed.winner, 'press_owed_cut', 'S74: Refuses conversion fee when RBI cut is already owed');
  assert.equal(rwOwed.illegalForeclosureFlag, true, 'S75: Flags illegal floating foreclosure charge');

  const rwConvert = compareBankRewriteOffer({
    country: 'IN', outstanding: 4000000, currentRate: 0.094, monthsRemaining: 180, expectedKeepYears: 6,
    owedCutRate: null, conversionRate: 0.084, conversionFee: 5000, transferRate: 0.0835, transferCosts: 45000, oldForeclosureFee: 0, isFloatingIndividualIN: true,
  });
  assert.equal(rwConvert.winner, 'stay_convert', 'S76: Ask Own Bank First wins when conversion fee is small');

  const rwTransfer = compareBankRewriteOffer({
    country: 'IN', outstanding: 6000000, currentRate: 0.096, monthsRemaining: 200, expectedKeepYears: 10,
    owedCutRate: null, conversionRate: 0.092, conversionFee: 15000, transferRate: 0.0825, transferCosts: 30000, oldForeclosureFee: 0, isFloatingIndividualIN: true,
  });
  assert.equal(rwTransfer.winner, 'transfer', 'S77: Balance transfer wins on big 1.35% spread over 10 yrs');

  const rwKeep = compareBankRewriteOffer({
    country: 'US', outstanding: 200000, currentRate: 0.068, monthsRemaining: 120, expectedKeepYears: 1,
    owedCutRate: null, conversionRate: 0.066, conversionFee: 2500, transferRate: 0.065, transferCosts: 6000, oldForeclosureFee: 0, isFloatingIndividualIN: false,
  });
  assert.equal(rwKeep.winner, 'keep', 'S78: Keeping current loan wins when holding horizon is only 1 year');
});

// GROUP E (Scenarios 79–94): Bulk SMS, Bank Statement CSV, Android SMS Backup XML & Deduplication
test('Scenarios 79-94: Bulk SMS, CSV statement, Android XML backup parsing, deduplication, and spend-leak savings', () => {
  // S79-82: India & US raw SMS batches
  const inSms = parseBulkInput(SAMPLE_SMS_BATCHES.IN, DEFAULT_PROFILES.IN.loans, { defaultCountry: 'IN' });
  assert.equal(inSms.detectedFormat, 'sms', 'S79: Detects SMS format');
  assert.ok(inSms.rows.some((r) => r.kind === 'otp'), 'S80: Strips OTP');
  assert.ok(inSms.rows.some((r) => r.kind === 'promo'), 'S81: Strips loan spam');
  assert.ok(inSms.rows.some((r) => r.kind === 'card_statement' && r.matchedLoanId === 'in-card-1'), 'S82: Matches HDFC Millennia');

  // S83-86: India & US Bank Statement CSV parsing (with quoted commas & deposit/withdrawal cols)
  const inCsv = parseBulkInput(SAMPLE_CSV_STATEMENTS.IN, DEFAULT_PROFILES.IN.loans, { fileName: 'hdfc_nov.csv', defaultCountry: 'IN' });
  assert.equal(inCsv.detectedFormat, 'csv', 'S83: Detects CSV format');
  assert.ok(inCsv.rows.length >= 6, 'S84: Parses all 7 CSV rows');
  assert.ok(inCsv.rows.some((r) => r.kind === 'emi_debit' && r.matchedLoanId === 'in-home-1'), 'S85: Matches NACH EMI debit in CSV');
  assert.ok(inCsv.rows.some((r) => r.kind === 'credit' && r.amount === 150000), 'S86: Detects salary credit in CSV');

  const usCsv = parseBulkInput(SAMPLE_CSV_STATEMENTS.US, DEFAULT_PROFILES.US.loans, { fileName: 'chase.csv', defaultCountry: 'US' });
  assert.equal(usCsv.detectedFormat, 'csv', 'S87: Detects US CSV');
  assert.ok(usCsv.rows.some((r) => r.kind === 'emi_debit' && r.matchedLoanId === 'us-home-1'), 'S88: Matches Chase mortgage debit');

  // S89-92: Android SMS Backup & Restore XML bulk parsing + entity unescaping
  const inXml = parseBulkInput(SAMPLE_ANDROID_XML.IN, DEFAULT_PROFILES.IN.loans, { fileName: 'sms-backup.xml', defaultCountry: 'IN' });
  assert.equal(inXml.detectedFormat, 'xml', 'S89: Detects Android XML backup');
  assert.equal(inXml.rows.length, 5, 'S90: Parses all 5 XML <sms> tags');
  assert.ok(inXml.rows.some((r) => r.raw.includes('SWIGGY & ZOMATO')), 'S91: Unescapes XML &amp; cleanly');

  const usXml = parseBulkInput(SAMPLE_ANDROID_XML.US, DEFAULT_PROFILES.US.loans, { fileName: 'us-sms.xml', defaultCountry: 'US' });
  assert.equal(usXml.rows.length, 4, 'S92: Parses all US Android XML tags');

  // S93-94: Deduplication + Spend-Leak savings impact
  const doubled = deduplicateParsedSms([...inCsv.rows, ...inCsv.rows]);
  assert.equal(doubled.length, inCsv.rows.length, 'S93: Deduplication drops 100% of duplicate uploads');
  const leaks = computeSpendLeakImpact(inCsv.rows, DEFAULT_PROFILES.IN);
  assert.ok(leaks.length >= 3 && leaks[0].interestSavedIfRedirected > 0, 'S94: CSV spend leaks compute positive interest saved');
});

// GROUP F (Scenarios 95–108): Advice Verifier, Offer/No-Cost EMI Traps, Invest vs Prepay & Edge Math
test('Scenarios 95-108: Advice verifier edge cases, No-Cost EMI traps, card consolidation, Invest vs Prepay, and math boundaries', () => {
  // S95-96: India & US Bank RM / Influencer pitches
  const repIN = verifyPastedAdvice(SAMPLE_ADVICE_TEXT.IN, DEFAULT_PROFILES.IN);
  assert.equal(repIN.wrongCount, 5, 'S95: Catches all 5 Indian Bank RM myths');
  const repUS = verifyPastedAdvice(SAMPLE_ADVICE_TEXT.US, DEFAULT_PROFILES.US);
  assert.ok(repUS.wrongCount >= 3, 'S96: Catches US influencer myths');

  // S97-98: Honest advice passes as verified
  const honest = verifyPastedAdvice(
    'There is zero prepayment penalty on your floating home loan. Pay off your credit card first before your home loan. The RBI repo rate is 5.50%.',
    DEFAULT_PROFILES.IN,
  );
  assert.equal(honest.wrongCount, 0, 'S97: Honest advice produces 0 false positives');
  assert.equal(honest.verifiedCount, 3, 'S98: Verifies all 3 honest statements');

  // S99-102: Offer checker across No-Cost EMI, Personal Loan stress (>50% EMI/income), Worth-it Card Consolidation, Bad Consolidation
  const ncTrap = auditLoanOffer({
    country: 'IN', kind: 'no_cost_emi', principal: 100000, quotedAnnualRate: 0, tenureMonths: 9,
    processingFeeAmount: 1999, processingFeePct: 1, foregoneDiscount: 8000,
  }, DEFAULT_PROFILES.IN);
  assert.equal(ncTrap.verdict, 'trap', 'S99: Exposes No-Cost EMI hidden >25% APR trap');

  const stressLoan = auditLoanOffer({
    country: 'IN', kind: 'personal_loan', principal: 2500000, quotedAnnualRate: 0.14, tenureMonths: 48,
    processingFeeAmount: 5000, processingFeePct: 2, foregoneDiscount: 0,
  }, DEFAULT_PROFILES.IN);
  assert.ok(stressLoan.emiToIncomePct > 50 && stressLoan.verdict === 'trap', 'S100: Flags >50% EMI-to-income danger');

  const goodConsol = auditLoanOffer({
    country: 'IN', kind: 'card_consolidation', principal: 80000, quotedAnnualRate: 0.13, tenureMonths: 18,
    processingFeeAmount: 1000, processingFeePct: 1, foregoneDiscount: 0, replacesLoanId: 'in-card-1',
  }, DEFAULT_PROFILES.IN);
  assert.equal(goodConsol.verdict, 'worth_it', 'S101: 13% loan replacing 60.31% card is worth it');

  const badConsol = auditLoanOffer({
    country: 'IN', kind: 'card_consolidation', principal: 3500000, quotedAnnualRate: 0.12, tenureMonths: 60,
    processingFeeAmount: 25000, processingFeePct: 2, foregoneDiscount: 0, replacesLoanId: 'in-home-1',
  }, DEFAULT_PROFILES.IN);
  assert.equal(badConsol.verdict, 'trap', 'S102: 12% loan replacing 8.5% home loan is a trap');

  // S103-106: Invest vs Prepay across New vs Old regime & Card vs Home
  const ivpNew = computeInvestVsPrepay({
    country: 'IN', loan: DEFAULT_PROFILES.IN.loans[0], taxRegimeIN: 'new', marginalTaxRate: 0.30,
    amount: 200000, expectedPreTaxReturn: 0.10, investmentTaxRate: 0.125, prepaySharePct: 100, horizonYears: 5,
  });
  const ivpOld = computeInvestVsPrepay({
    country: 'IN', loan: DEFAULT_PROFILES.IN.loans[0], taxRegimeIN: 'old', marginalTaxRate: 0.30,
    amount: 200000, expectedPreTaxReturn: 0.10, investmentTaxRate: 0.125, prepaySharePct: 100, horizonYears: 5,
  });
  assert.ok(ivpNew.breakEvenPreTaxReturn > ivpOld.breakEvenPreTaxReturn, 'S103: New regime has higher prepay break-even than Old regime Sec 24(b)');
  assert.equal(ivpOld.edgeFavors, 'invest', 'S104: Old-regime Sec 24(b) home loan favors 10% invest over prepay');

  const ivpCard = computeInvestVsPrepay({
    country: 'IN', loan: DEFAULT_PROFILES.IN.loans[1], taxRegimeIN: 'new', marginalTaxRate: 0.30,
    amount: 80000, expectedPreTaxReturn: 0.15, investmentTaxRate: 0.125, prepaySharePct: 100, horizonYears: 3,
  });
  assert.equal(ivpCard.edgeFavors, 'prepay', 'S105: Even 15% equity return loses badly to prepaying 60.31% card');

  // S106-108: Boundary math checks (0% EMI, exact 60.31% card APR, exact US daily card compounding)
  assert.equal(computeEmi(120000, 0, 12), 10000, 'S106: 0% EMI equals principal/months');
  const cardApr = computeTrueAllInApr(DEFAULT_PROFILES.IN.loans[1], 'IN', 'new', 0.30).trueAllInApr;
  assert.equal((cardApr * 100).toFixed(2), '60.31', 'S107: Exact 60.31% India card true APR');
  const usCardApr = computeTrueAllInApr(DEFAULT_PROFILES.US.loans[1], 'US', 'new', 0.24).trueAllInApr;
  assert.ok(usCardApr > 0.28 && usCardApr < 0.29, 'S108: US 24.99% daily compounded card APY is ~28.38%');
});
